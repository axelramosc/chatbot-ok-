// One-off: (1) backfill embeddings de FAQs/fragmentos sin embedding (para goal-02),
// (2) detectar y eliminar FAQs PENDIENTES que ya están cubiertas por una FAQ ACTIVA
// ya respondida, comparando PREGUNTA-contra-PREGUNTA (la escala usable; el RPC con
// embeddings de pregunta+respuesta diluye demasiado la similitud).
//
// Carga .env.local de ESTE proyecto y actúa solo sobre su Supabase.
// Uso:
//   node scripts/backfill-and-dedupe-faqs.mjs            (dry-run: solo reporta)
//   node scripts/backfill-and-dedupe-faqs.mjs --apply    (aplica borrados)
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { embed, cosineSimilarity } from "ai";
import { gateway } from "@ai-sdk/gateway";

// --- cargar .env.local ---
const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
process.env.AI_GATEWAY_API_KEY = env.AI_GATEWAY_API_KEY;

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const APPLY = process.argv.includes("--apply");
const CLEANUP_THRESHOLD = 0.8; // mismo umbral que el cron (pregunta vs pregunta)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const genEmbedding = async (text) =>
  (await embed({ model: gateway.embeddingModel("openai/text-embedding-3-small"), value: text })).embedding;

// ============ FASE 1: backfill de embeddings (para goal-02 conflict detection) ============
async function backfill() {
  console.log("\n=== FASE 1: Backfill de embeddings (columna embedding = pregunta+respuesta) ===");
  const { data: frags } = await supabase.from("knowledge_fragments").select("id, content").is("embedding", null);
  let nf = 0;
  for (const row of frags ?? []) {
    await supabase.from("knowledge_fragments").update({ embedding: await genEmbedding(row.content) }).eq("id", row.id);
    nf++;
    await sleep(1000);
  }
  const { data: faqs } = await supabase.from("faqs").select("id, question, answer").is("embedding", null);
  let nq = 0;
  for (const row of faqs ?? []) {
    const text = `${row.question}\n${row.answer ?? ""}`.trim();
    if (!text) continue;
    await supabase.from("faqs").update({ embedding: await genEmbedding(text) }).eq("id", row.id);
    nq++;
    await sleep(1000);
  }
  console.log(`Embeddings nuevos → fragmentos: ${nf}, faqs: ${nq}`);
}

// ============ FASE 2: pendientes ya cubiertas (pregunta vs pregunta) ============
async function dedupePending() {
  console.log("\n=== FASE 2: FAQs pendientes ya cubiertas por una FAQ activa ===");

  const { data: active } = await supabase
    .from("faqs")
    .select("id, question, answer")
    .eq("is_active", true);
  const answered = (active ?? []).filter((f) => (f.answer ?? "").trim().length > 0);
  const activeEmb = await Promise.all(
    answered.map(async (f) => ({ question: f.question, embedding: await genEmbedding(f.question) }))
  );

  const { data: pending } = await supabase
    .from("faqs")
    .select("id, question, created_at")
    .eq("is_active", false)
    .order("created_at", { ascending: true });
  if (!pending || pending.length === 0) {
    console.log("No hay FAQs pendientes.");
    return;
  }

  const toDelete = [];
  const keep = [];
  for (const p of pending) {
    const pe = await genEmbedding(p.question);
    let best = { sim: 0, q: "" };
    for (const a of activeEmb) {
      const s = cosineSimilarity(pe, a.embedding);
      if (s > best.sim) best = { sim: s, q: a.question };
    }
    if (best.sim >= CLEANUP_THRESHOLD) toDelete.push({ ...p, match: best.q, sim: best.sim });
    else keep.push({ ...p, match: best.q, sim: best.sim });
  }

  console.log(`\nPendientes totales: ${pending.length}`);
  console.log(`\n→ YA CUBIERTAS (se borran con --apply): ${toDelete.length}`);
  for (const d of toDelete) {
    console.log(`   ✗ "${d.question}"`);
    console.log(`        ≈ "${d.match}"  sim=${d.sim.toFixed(3)}`);
  }
  console.log(`\n→ SE MANTIENEN (mejor coincidencia por debajo de ${CLEANUP_THRESHOLD}): ${keep.length}`);
  for (const k of keep) console.log(`   • [${k.sim.toFixed(3)}] "${k.question}"`);

  if (toDelete.length === 0) return;
  if (!APPLY) {
    console.log("\n[DRY-RUN] No se borró nada. Re-ejecuta con --apply para aplicar.");
    return;
  }
  const ids = toDelete.map((d) => d.id);
  const { error } = await supabase.from("faqs").delete().in("id", ids);
  console.log(error ? `❌ Error al borrar: ${error.message}` : `\n✅ Borradas ${ids.length} FAQs pendientes ya cubiertas.`);
}

await backfill();
await dedupePending();
console.log("\nListo.");
