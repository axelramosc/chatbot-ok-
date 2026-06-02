import { NextResponse } from "next/server";
import { getSupabase } from "../../../../lib/supabase";
import { generateText, cosineSimilarity } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { generateEmbedding } from "../../../../lib/embeddings";
import { getActiveFAQs, getKnowledgeFragments, getBusinessSettings } from "../../../../lib/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// Umbral de deduplicación semántica (Capa B). Compara PREGUNTA-contra-PREGUNTA
// (no usamos el RPC search_similar_knowledge porque sus embeddings son de
// pregunta+respuesta, lo que diluye la similitud y comprime la escala).
// Calibrado con datos reales (text-embedding-3-small, pregunta vs pregunta):
//   duplicados reales caen en 0.74–0.84 ("tienda física" vs "sucursal física" = 0.84),
//   preguntas distintas en ~0.35. 0.80 es estricto y separa ambos con margen amplio.
const DEDUP_THRESHOLD = 0.8;
const MAX_FAQS = 5;

// Normaliza una pregunta para detectar duplicados triviales dentro del mismo lote.
function normalize(q: string): string {
  return q
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita acentos
    .replace(/[¿?¡!.,;:"']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

type Discarded = {
  question: string;
  reason: string;
  match?: string;
  similarity?: number;
};

export async function GET(request: Request) {
  // Verificación de seguridad para Cron Job (Vercel manda un header específico)
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const supabase = getSupabase();

    // 1. Obtener mensajes de clientes de las últimas 24 horas
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: messages, error } = await supabase
      .from("messages")
      .select("content")
      .eq("sender", "user")
      .gte("created_at", twentyFourHoursAgo);

    if (error || !messages || messages.length === 0) {
      return NextResponse.json({ message: "No recent messages found." });
    }

    const messageTexts = messages.map((m) => m.content).join("\n");

    // 2. CAPA A — Cargar el conocimiento ya existente para que la IA NO proponga
    //    preguntas que ya están respondidas o cubiertas.
    const [activeFaqs, fragments, settings] = await Promise.all([
      getActiveFAQs(),
      getKnowledgeFragments(),
      getBusinessSettings(),
    ]);

    const knownFaqs = activeFaqs
      .filter((f) => (f.answer ?? "").trim().length > 0)
      .map((f) => `- ${f.question}`)
      .join("\n");

    const knownFragments = fragments
      .map((f) => {
        const content = f.content.length > 300 ? `${f.content.slice(0, 300)}…` : f.content;
        return `- ${f.topic ? `[${f.topic}] ` : ""}${content}`;
      })
      .join("\n");

    const knownSettings = Object.entries(settings)
      .map(([k, v]) => `- ${k}: ${v}`)
      .join("\n");

    const existingKnowledge =
      [
        knownFaqs && `PREGUNTAS YA RESPONDIDAS (FAQs activas):\n${knownFaqs}`,
        knownFragments && `CONOCIMIENTO ENSEÑADO A AVA:\n${knownFragments}`,
        knownSettings && `DATOS DEL NEGOCIO (horario, dirección, pagos, contacto, etc.):\n${knownSettings}`,
      ]
        .filter(Boolean)
        .join("\n\n") || "(sin conocimiento previo registrado)";

    // 3. Extraer dudas NUEVAS con la IA, dándole el conocimiento existente como contexto.
    const systemPrompt = `Eres el analista de soporte de Greenland Deco (tienda de diseño y acabados interiores).
Tu tarea: leer los mensajes de clientes de las últimas 24h y proponer SOLO "Preguntas Frecuentes" NUEVAS que el negocio aún NO tenga cubiertas.

REGLA CRÍTICA — NO DUPLICAR:
Abajo está el CONOCIMIENTO YA EXISTENTE (FAQs ya respondidas, lo que se le enseñó a Ava y los datos del negocio).
Si la duda de un cliente YA está respondida o se puede deducir de ese conocimiento —aunque esté redactada distinta o use sinónimos (por ejemplo "tienda" vs "sucursal", "a qué hora abren" vs "horario de atención")— NO la incluyas.
Incluye únicamente preguntas genuinamente nuevas, cuya respuesta NO se pueda obtener del conocimiento existente.

=== CONOCIMIENTO YA EXISTENTE ===
${existingKnowledge}
=== FIN DEL CONOCIMIENTO EXISTENTE ===

Formula cada duda como una pregunta clara. Devuelve ÚNICAMENTE un array de strings en formato JSON con un máximo de ${MAX_FAQS} preguntas NUEVAS.
Ejemplo: ["¿Hacen envíos a otros estados?", "¿Tienen catálogo en PDF?"].
Si todo lo que preguntaron ya está cubierto, devuelve [].`;

    const { text } = await generateText({
      model: gateway("anthropic/claude-haiku-4.5"),
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Mensajes de clientes (últimas 24h):\n${messageTexts}\n\nExtrae las FAQs nuevas ahora.`,
        },
      ],
      temperature: 0.1,
      maxOutputTokens: 512,
    });

    let extractedFaqs: string[] = [];
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
      const candidate = jsonMatch ? jsonMatch[0] : text;
      const result = JSON.parse(candidate);
      if (Array.isArray(result)) {
        extractedFaqs = result as string[];
      } else {
        // Manejar el formato wrapper { "faqs": [...] }
        extractedFaqs = (Object.values(result).find((val) => Array.isArray(val)) as string[]) || [];
      }
    } catch (e) {
      console.error("[extract-faqs] Error parsing LLM response", e);
    }

    if (extractedFaqs.length === 0) {
      return NextResponse.json({ message: "No new FAQs extracted.", candidates: 0, inserted: 0 });
    }

    // 4. CAPA B — Respaldo semántico (pregunta-contra-pregunta): descartar candidatas
    //    casi idénticas a una FAQ activa ya respondida. Embebemos las preguntas de las
    //    FAQs activas y cada candidata, y comparamos por similitud coseno en memoria.
    //    Si la generación de embeddings falla, se registra el error pero NO se descarta
    //    (preferimos un falso positivo revisable a perder una pregunta real).
    const answeredFaqs = activeFaqs.filter((f) => (f.answer ?? "").trim().length > 0);

    let faqEmbeddings: { question: string; embedding: number[] }[] = [];
    try {
      faqEmbeddings = await Promise.all(
        answeredFaqs.map(async (f) => ({ question: f.question, embedding: await generateEmbedding(f.question) }))
      );
    } catch (e) {
      console.error(
        "[extract-faqs] no se pudieron embeber las FAQs activas; la Capa B queda inactiva este run:",
        e instanceof Error ? e.message : e
      );
    }

    const kept: string[] = [];
    const discarded: Discarded[] = [];
    const seenInBatch = new Set<string>();

    for (const rawQ of extractedFaqs) {
      const q = (rawQ ?? "").toString().trim();
      if (!q) continue;

      const norm = normalize(q);
      if (seenInBatch.has(norm)) {
        discarded.push({ question: q, reason: "duplicado_en_lote" });
        continue;
      }
      seenInBatch.add(norm);

      let dupMatch: { text: string; similarity: number } | null = null;
      if (faqEmbeddings.length > 0) {
        try {
          const qEmbedding = await generateEmbedding(q);
          for (const f of faqEmbeddings) {
            const sim = cosineSimilarity(qEmbedding, f.embedding);
            if (sim >= DEDUP_THRESHOLD && (!dupMatch || sim > dupMatch.similarity)) {
              dupMatch = { text: f.question, similarity: sim };
            }
          }
        } catch (e) {
          console.error(
            `[extract-faqs] embedding dedup falló para "${q}" (continúo sin descartar):`,
            e instanceof Error ? e.message : e
          );
        }
      }

      if (dupMatch) {
        discarded.push({
          question: q,
          reason: "similar_a_faq_activa",
          match: dupMatch.text,
          similarity: dupMatch.similarity,
        });
        continue;
      }

      kept.push(q);
    }

    // Logs detallados de cada decisión (validación en producción).
    console.log(
      `[extract-faqs] candidatas=${extractedFaqs.length} insertadas=${kept.length} descartadas=${discarded.length}`
    );
    for (const d of discarded) {
      const extra = d.match ? ` (≈ "${d.match}" sim=${d.similarity?.toFixed(3)})` : "";
      console.log(`[extract-faqs] DESCARTADA "${d.question}" → ${d.reason}${extra}`);
    }
    for (const k of kept) {
      console.log(`[extract-faqs] NUEVA "${k}"`);
    }

    if (kept.length === 0) {
      return NextResponse.json({
        message: "All extracted FAQs were already covered by existing knowledge.",
        candidates: extractedFaqs.length,
        inserted: 0,
        discarded,
      });
    }

    // 5. Insertar solo las preguntas genuinamente nuevas (pendientes de responder).
    const faqsToInsert = kept.map((q) => ({
      question: q,
      answer: "",
      is_active: false,
      priority: 0,
      category: "automático",
    }));

    const { error: insertErr } = await supabase.from("faqs").insert(faqsToInsert);
    if (insertErr) {
      console.error("[extract-faqs] insert error:", insertErr.message);
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    return NextResponse.json({
      message: "Successfully extracted and inserted new FAQs",
      candidates: extractedFaqs.length,
      inserted: kept.length,
      discarded,
    });
  } catch (err: any) {
    console.error("Cron Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
