import { NextResponse } from "next/server";
import { getSupabase } from "../../../../lib/supabase";
import { generateEmbedding } from "../../../../lib/embeddings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Decision = {
  source: "fragment" | "faq";
  id: string;
  action: "keep" | "deactivate" | "delete";
};

type Body = {
  content: string;
  topic?: string | null;
  embedding?: number[];
  decisions?: Decision[];
  supersedesId?: string | null;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const content = (body.content ?? "").trim();
  if (!content) {
    return NextResponse.json({ error: "content_required" }, { status: 400 });
  }

  const topic = body.topic?.trim() || null;
  const decisions = Array.isArray(body.decisions) ? body.decisions : [];
  const supersedesId = body.supersedesId ?? null;

  try {
    const embedding = body.embedding ?? (await generateEmbedding(content));
    const supabase = getSupabase();

    // Apply decisions first so the new fragment ends up as the only active source of truth
    for (const d of decisions) {
      if (d.action === "keep") continue;

      const table = d.source === "faq" ? "faqs" : "knowledge_fragments";

      if (d.action === "deactivate") {
        const { error } = await supabase.from(table).update({ is_active: false }).eq("id", d.id);
        if (error) {
          console.error(`deactivate ${table} ${d.id} failed:`, error);
          return NextResponse.json({ error: "decision_failed", detail: error.message }, { status: 500 });
        }
      } else if (d.action === "delete") {
        const { error } = await supabase.from(table).delete().eq("id", d.id);
        if (error) {
          console.error(`delete ${table} ${d.id} failed:`, error);
          return NextResponse.json({ error: "decision_failed", detail: error.message }, { status: 500 });
        }
      }
    }

    // Legacy auto-deactivation by topic (kept for backwards compatibility with the
    // previous behavior of the knowledge page) — only fires when topic is set.
    if (topic) {
      await supabase
        .from("knowledge_fragments")
        .update({ is_active: false })
        .eq("topic", topic)
        .eq("is_active", true);
    }

    const insertPayload: Record<string, unknown> = {
      content,
      topic,
      is_active: true,
      embedding: embedding as unknown as string,
    };
    if (supersedesId) insertPayload.supersedes_id = supersedesId;

    const { data, error } = await supabase
      .from("knowledge_fragments")
      .insert(insertPayload)
      .select("id, content, topic, is_active, supersedes_id, created_at")
      .single();

    if (error) {
      console.error("insert knowledge_fragment failed:", error);
      return NextResponse.json({ error: "insert_failed", detail: error.message }, { status: 500 });
    }

    return NextResponse.json({ fragment: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("save-fragment failed:", message);
    return NextResponse.json({ error: "save_failed", detail: message }, { status: 500 });
  }
}
