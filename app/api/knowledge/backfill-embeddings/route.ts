import { NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabase } from "../../../../lib/supabase";
import { generateEmbedding } from "../../../../lib/embeddings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// Idempotent: only processes rows where embedding IS NULL.
async function getAuthUser() {
  const cookieStore = await cookies();
  const sessionClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) { return cookieStore.get(name)?.value; },
        set(_n: string, _v: string, _o: CookieOptions) {},
        remove(_n: string, _o: CookieOptions) {},
      },
    }
  );
  const { data: { user } } = await sessionClient.auth.getUser();
  return user;
}

export async function POST() {
  if (!await getAuthUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabase();
  const stats = { fragments: 0, faqs: 0, errors: [] as string[] };

  // Fragments
  const { data: frags, error: fragErr } = await supabase
    .from("knowledge_fragments")
    .select("id, content")
    .is("embedding", null);
  if (fragErr) return NextResponse.json({ error: "fetch_failed" }, { status: 500 });

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

  // FAQs (embed question + answer concatenated)
  const { data: faqs, error: faqErr } = await supabase
    .from("faqs")
    .select("id, question, answer")
    .is("embedding", null);
  if (faqErr) return NextResponse.json({ error: "fetch_failed", stats }, { status: 500 });

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
