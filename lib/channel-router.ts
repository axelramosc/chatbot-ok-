import { getSupabase } from "./supabase";
import { sendTextMessage } from "./whatsapp";
import { sendMessengerMessage } from "./channels/messenger";
import { sendInstagramMessage } from "./channels/instagram";

export async function routeAdminReply(conversationId: string, text: string): Promise<boolean> {
  const supabase = getSupabase();

  const { data: conv } = await supabase
    .from("conversations")
    .select("channel, phone_number")
    .eq("id", conversationId)
    .single();

  if (!conv) {
    console.error(`❌ routeAdminReply: conversation ${conversationId} not found`);
    return false;
  }

  const channel = (conv.channel as string) || "whatsapp";
  const recipientId = conv.phone_number as string;

  if (channel === "messenger") {
    // Strip the fb_psid_ namespace prefix to get the raw PSID
    const psid = recipientId.replace("fb_psid_", "");
    return sendMessengerMessage(psid, text);
  }

  if (channel === "instagram") {
    // Strip the ig_igsid_ namespace prefix to get the raw IGSID
    const igsid = recipientId.replace("ig_igsid_", "");
    return sendInstagramMessage(igsid, text);
  }

  // Default: WhatsApp
  return sendTextMessage(recipientId, text);
}
