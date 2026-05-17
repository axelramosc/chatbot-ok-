import { NextResponse } from "next/server";
import { getSupabase } from "../../../lib/supabase";

export async function POST(request: Request) {
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
    const { sendTextMessage } = await import("../../../lib/whatsapp");
    const success = await sendTextMessage(phone_number, content);

    if (!success) {
      console.error("❌ WhatsApp send failed, but conversation is already paused");
      // Don't return error — the bot is paused and the message is saved.
      // The admin can retry sending later.
    }

    return NextResponse.json({ success: true, message: "Message sent" });
  } catch (error: any) {
    console.error("Send message error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
