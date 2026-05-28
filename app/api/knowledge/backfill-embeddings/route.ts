import { NextResponse } from "next/server";
import { getSupabase } from "../../../../lib/supabase";
import { generateEmbedding } from "../../../../lib/embeddings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// One-off endpoint to compute embeddings for existing knowledge_fragments and faqs.
// Idempotent: only processes rows where embedding IS NULL.
// Trigger manually with: curl -X POST <host>/api/knowledge/backfill-embeddings
export async function POST() {
  const supabase = getSupabase();
  const stats = { fragments: 0, faqs: 0, errors: [] as string[] };

  // Fragments
  const { data: frags, error: fragErr } = await supabase
    .from("knowledge_fragments")
    .select("id, content")
    .is("embedding", null);
  if (fragErr) return NextResponse.json({ error: fragErr.message }, { status: 500 });

  for (const row of frags ?? []) {
    try {
      const embedding = await generateEmbedding(row.content);
      const { error } = await supabase
        .from("knowledge_fragments")
        .update({ embedding: embedding as unknown as string })
        .eq("id", row.id);
      if (error) throw error;
      stats.fragments++;
      await new Promise((r) => setTimeout(r, 1500));
    } catch (err) {
      stats.errors.push(`fragment ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  // FAQs (embed question + answer concatenated, since both define the topic semantically)
  const { data: faqs, error: faqErr } = await supabase
    .from("faqs")
    .select("id, question, answer")
    .is("embedding", null);
  if (faqErr) return NextResponse.json({ error: faqErr.message, stats }, { status: 500 });

  for (const row of faqs ?? []) {
    try {
      const text = `${row.question}\n${row.answer ?? ""}`.trim();
      if (!text) continue;
      const embedding = await generateEmbedding(text);
      const { error } = await supabase
        .from("faqs")
        .update({ embedding: embedding as unknown as string })
        .eq("id", row.id);
      if (error) throw error;
      stats.faqs++;
      await new Promise((r) => setTimeout(r, 1500));
    } catch (err) {
      stats.errors.push(`faq ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  return NextResponse.json(stats);
}
