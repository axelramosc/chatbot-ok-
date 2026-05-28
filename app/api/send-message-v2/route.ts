import { NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabase } from "../../../lib/supabase";
import { routeAdminReply } from "../../../lib/channel-router";

export async function POST(request: Request) {
  // Verify authenticated admin session
  const cookieStore = await cookies();
  const sessionClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) { return cookieStore.get(name)?.value; },
        set(_name: string, _value: string, _options: CookieOptions) {},
        remove(_name: string, _options: CookieOptions) {},
      },
    }
  );

  const { data: { user } } = await sessionClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { conversation_id, content } = await request.json();

    if (!conversation_id || !content) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const supabase = getSupabase();

    // 1. Pause bot FIRST — before sending, so bot can't reply concurrently
    const { error: statusError } = await supabase
      .from("conversations")
      .update({ status: "attended", updated_at: new Date().toISOString() })
      .eq("id", conversation_id);

    if (statusError) {
      console.error("❌ Failed to set attended status:", statusError);
      return NextResponse.json({ error: "Failed to pause bot" }, { status: 500 });
    }

    // 2. Save admin message to DB
    await supabase.from("messages").insert({
      conversation_id,
      sender: "bot",
      content: `[ADMIN] ${content}`,
      message_type: "text",
      wa_message_id: `admin-${Date.now()}`,
    });

    // 3. Route to the correct channel (WhatsApp, Messenger, or Instagram)
    const success = await routeAdminReply(conversation_id, content);

    if (!success) {
      console.error("❌ Channel send failed, but conversation is paused and message saved.");
      // Don't return error — bot is paused and message is in DB
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("send-message-v2 error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
