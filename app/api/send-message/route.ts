import { NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabase } from "../../../lib/supabase";
import { sendTextMessage } from "../../../lib/whatsapp";

export async function POST(request: Request) {
  // Verify the caller is an authenticated admin session
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
    const { conversation_id, phone_number, content } = await request.json();

    if (!conversation_id || !phone_number || !content) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const supabase = getSupabase();

    // 1. FIRST: Set conversation to 'attended' BEFORE anything else.
    //    This ensures the bot is paused even if the WhatsApp send fails.
    const { error: statusError } = await supabase
      .from("conversations")
      .update({ status: "attended", updated_at: new Date().toISOString() })
      .eq("id", conversation_id);

    if (statusError) {
      console.error("❌ Failed to set attended status:", statusError);
      return NextResponse.json({ error: "Failed to pause bot" }, { status: 500 });
    }

    console.log(`✅ Conversation ${conversation_id} set to 'attended'`);

    // 2. Save the admin message to the database
    const { error: dbError } = await supabase.from("messages").insert({
      conversation_id,
      sender: "bot",
      content: `[ADMIN] ${content}`,
      message_type: "text",
      wa_message_id: `admin-${Date.now()}`
    });

    if (dbError) {
      console.error("Database Error:", dbError);
    }

    // 3. Send the message via WhatsApp Cloud API
    const success = await sendTextMessage(phone_number, content);

    if (!success) {
      console.error("❌ WhatsApp send failed, but conversation is already paused");
      // Don't return error — the bot is paused and the message is saved.
    }

    return NextResponse.json({ success: true, message: "Message sent" });
  } catch (error: unknown) {
    console.error("Send message error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
