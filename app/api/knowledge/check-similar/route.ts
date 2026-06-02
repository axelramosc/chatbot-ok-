import { NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabase } from "../../../../lib/supabase";
import { generateEmbedding } from "../../../../lib/embeddings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = {
  content: string;
  topic?: string | null;
  threshold?: number;
  limit?: number;
};

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

export async function POST(req: Request) {
  if (!await getAuthUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  const threshold = typeof body.threshold === "number" ? body.threshold : 0.75;
  const limit = typeof body.limit === "number" ? body.limit : 5;

  try {
    const embedding = await generateEmbedding(content);

    const supabase = getSupabase();
    const { data, error } = await supabase.rpc("search_similar_knowledge", {
      query_embedding: embedding as unknown as string,
      match_threshold: threshold,
      match_count: limit,
    });

    if (error) {
      console.error("search_similar_knowledge error:", error);
      return NextResponse.json({ error: "rpc_failed" }, { status: 500 });
    }

    return NextResponse.json({
      embedding,
      candidates: data ?? [],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("check-similar failed:", message);
    return NextResponse.json({ error: "embedding_failed" }, { status: 500 });
  }
}
