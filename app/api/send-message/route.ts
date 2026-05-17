import { NextResponse } from "next/server";
import { getSupabase } from "../../../lib/supabase";

export async function POST(request: Request) {
  try {
    const { conversation_id, phone_number, content } = await request.json();

    if (!conversation_id || !phone_number || !content) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // 1. Send the message via WhatsApp Cloud API
    const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
    const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;

    const response = await fetch(
      `https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: phone_number,
          type: "text",
          text: {
            preview_url: false,
            body: content,
          },
        }),
      }
    );

    const whatsappData = await response.json();

    if (!response.ok) {
      console.error("WhatsApp API Error:", whatsappData);
      return NextResponse.json({ error: "Failed to send WhatsApp message" }, { status: 500 });
    }

    // 2. Save the admin message to the database
    const supabase = getSupabase();
    const { error: dbError } = await supabase.from("messages").insert({
      conversation_id,
      sender: "bot", // using bot so it displays correctly, could be "admin" if schema allowed
      content: `[ADMIN] ${content}`, // Prefix so we know it was sent by human
      message_type: "text",
      // wa_message_id is not strictly required, but we can save it if we want
      wa_message_id: whatsappData.messages?.[0]?.id || `admin-${Date.now()}`
    });

    if (dbError) {
      console.error("Database Error:", dbError);
    }

    // 3. Update conversation status to 'attended' so the bot stops replying
    await supabase.from("conversations").update({ status: "attended" }).eq("id", conversation_id);

    return NextResponse.json({ success: true, message: "Message sent" });
  } catch (error: any) {
    console.error("Send message error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
