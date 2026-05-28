import {
  getOrCreateConversation,
  saveMessage,
  getRecentMessages,
  getActiveProducts,
  getActiveFAQs,
  getBusinessSettings,
  getKnowledgeFragments,
  updateConversationStatus,
} from "./database";
import { getSupabase } from "./supabase";
import { generateResponse } from "./ai";
import {
  notifyAdminOfSale,
  notifyAdminOfUnknownQuery,
  notifyAdminOfRepresentativeRequest,
} from "./notifications";
import type { NormalizedMessage, ChannelClient } from "./channels/types";

const SALE_INTENTS = ["ready_to_buy", "bought"];
const UNKNOWN_INTENTS = ["unknown"];
const REPRESENTATIVE_INTENTS = ["representative"];

// Namespaced identifier stored in phone_number column per channel
function buildChannelIdentifier(channel: string, senderId: string): string {
  if (channel === "messenger") return `fb_psid_${senderId}`;
  if (channel === "instagram") return `ig_igsid_${senderId}`;
  return senderId;
}

// Deduplication using channel_message_id column (mirrors isMessageProcessed in database.ts)
async function isChannelMessageProcessed(channelMessageId: string): Promise<boolean> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("messages")
    .select("id")
    .eq("channel_message_id", channelMessageId)
    .limit(1)
    .maybeSingle();
  return !!data;
}

export async function handleChannelMessage(
  msg: NormalizedMessage,
  client: ChannelClient
): Promise<void> {
  const { senderId, messageId, text, contactName, channel } = msg;
  const identifier = buildChannelIdentifier(channel, senderId);

  console.log(`📩 [${channel}] Message from ${senderId}: ${text}`);

  // 1. Deduplicate
  const alreadyProcessed = await isChannelMessageProcessed(messageId);
  if (alreadyProcessed) {
    console.log(`⏭️ Skipping duplicate [${channel}] message: ${messageId}`);
    return;
  }

  try {
    // 2. Get or create conversation (with fallback)
    let conversation;
    try {
      conversation = await getOrCreateConversation(identifier, contactName);

      // Ensure channel column is set correctly (new conversations default to 'whatsapp')
      const supabase = getSupabase();
      await supabase
        .from("conversations")
        .update({ channel, updated_at: new Date().toISOString() })
        .eq("id", conversation.id);

      conversation.channel = channel;
    } catch (e) {
      console.error(`⚠️ DB error getting conversation for ${identifier}:`, e);
      conversation = {
        id: "fallback-id",
        phone_number: identifier,
        customer_name: contactName || null,
        status: "active" as const,
        context: {},
        channel,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    }

    // 3. Save incoming message with channel_message_id for deduplication
    try {
      const supabase = getSupabase();
      await supabase.from("messages").insert({
        conversation_id: conversation.id,
        sender: "user",
        content: text,
        channel_message_id: messageId,
      });

      await supabase
        .from("conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", conversation.id);
    } catch (e) {
      console.warn(`⚠️ Non-critical error saving incoming [${channel}] message:`, e);
    }

    // 4. Fresh status check
    let currentStatus = conversation.status;
    try {
      const supabase = getSupabase();
      const { data: freshConv } = await supabase
        .from("conversations")
        .select("status")
        .eq("id", conversation.id)
        .single();
      currentStatus = freshConv?.status || conversation.status;
    } catch (e) {
      console.warn(`⚠️ Non-critical error checking conversation status:`, e);
    }

    if (
      currentStatus === "attended" ||
      currentStatus === "sale_completed" ||
      currentStatus === "closed"
    ) {
      console.log(`⏭️ Bot paused. Conversation ${conversation.id} status is: ${currentStatus}.`);
      return;
    }

    // 5. Fetch context in parallel
    let recentMessages: any[] = [];
    let products: any[] = [];
    let faqs: any[] = [];
    let businessSettings: Record<string, string> = {};
    let knowledgeFragments: any[] = [];

    try {
      const [rm, p, f, bs, kf] = await Promise.all([
        getRecentMessages(conversation.id, 10).catch(e => { console.warn("Error fetching messages:", e); return []; }),
        getActiveProducts().catch(e => { console.warn("Error fetching products:", e); return []; }),
        getActiveFAQs().catch(e => { console.warn("Error fetching FAQs:", e); return []; }),
        getBusinessSettings().catch(e => { console.warn("Error fetching settings:", e); return {}; }),
        getKnowledgeFragments().catch(e => { console.warn("Error fetching knowledge:", e); return []; }),
      ]);
      recentMessages = rm;
      products = p;
      faqs = f;
      businessSettings = bs;
      knowledgeFragments = kf;
    } catch (e) {
      console.warn(`⚠️ Error building AI context:`, e);
    }

    // 6. Generate AI response
    const aiResponse = await generateResponse(
      text,
      products,
      faqs,
      recentMessages,
      conversation.customer_name || contactName,
      businessSettings,
      knowledgeFragments,
      { conversationId: conversation.id, phoneNumber: identifier },
    );

    console.log(`🤖 [${channel}] Response (intent: ${aiResponse.intent}): ${aiResponse.message.substring(0, 100)}...`);

    // 7. Second status check (in case admin intervened during AI call)
    try {
      const supabase = getSupabase();
      const { data: recheckConv } = await supabase
        .from("conversations")
        .select("status")
        .eq("id", conversation.id)
        .single();

      if (
        recheckConv &&
        (recheckConv.status === "attended" ||
          recheckConv.status === "sale_completed" ||
          recheckConv.status === "closed")
      ) {
        console.log(`⏭️ Bot paused (post-AI check). Status: ${recheckConv.status}.`);
        return;
      }
    } catch (e) {
      console.warn(`⚠️ Non-critical error in post-AI status check:`, e);
    }

    // 8. Save bot response
    try {
      await saveMessage(conversation.id, "bot", aiResponse.message);
    } catch (e) {
      console.warn(`⚠️ Non-critical error saving bot response:`, e);
    }

    // 9. Update conversation context
    try {
      const supabase = getSupabase();
      const existingContext = (conversation.context as Record<string, unknown>) || {};
      const contextPatch: Record<string, unknown> = {
        ...existingContext,
        last_intent: aiResponse.intent,
        last_seen: new Date().toISOString(),
      };
      if (aiResponse.products_mentioned.length > 0) {
        const prev = (existingContext.products_interested as string[]) || [];
        const merged = Array.from(new Set([...prev, ...aiResponse.products_mentioned]));
        contextPatch.products_interested = merged;
      }
      if (aiResponse.intent === "interested" || aiResponse.intent === "ready_to_buy") {
        contextPatch.interest_level = aiResponse.intent;
      }
      if (contactName && contactName !== "Cliente" && !existingContext.confirmed_name) {
        contextPatch.confirmed_name = contactName;
      }
      await supabase
        .from("conversations")
        .update({ context: contextPatch })
        .eq("id", conversation.id);
    } catch (e) {
      console.warn(`⚠️ Non-critical error updating conversation context:`, e);
    }

    // 10. Send response via the appropriate channel
    const sent = await client.sendMessage(senderId, aiResponse.message);

    if (!sent) {
      console.error(`❌ Failed to send [${channel}] message to ${senderId}`);
      return;
    }

    console.log(`✅ [${channel}] Response sent to ${senderId}`);

    // 10b. Send product images if AI requested any (non-critical).
    //      Validated server-side against the products array already in memory.
    try {
      const ids = aiResponse.images_to_send ?? [];
      if (ids.length > 0 && typeof client.sendImage === "function") {
        const byId = new Map(products.map((p: any) => [p.id as string, p as any]));
        for (const id of ids.slice(0, 3)) {
          const prod = byId.get(id);
          if (!prod || !prod.image_url) {
            console.log(`📷 [${channel}] Skipping image: product ${id} missing or no image_url.`);
            continue;
          }
          const ok = await client.sendImage(senderId, prod.image_url as string);
          if (!ok) console.warn(`📷 [${channel}] Failed to send image for product ${id} to ${senderId}`);
        }
      }
    } catch (e) {
      console.warn(`⚠️ [${channel}] Non-critical error sending product images:`, e);
    }

    // 11. Admin notifications (still sent via WhatsApp to the admin)
    try {
      const allMessages = [
        ...recentMessages,
        { sender: "user" as const, content: text },
        { sender: "bot" as const, content: aiResponse.message },
      ];
      const summary = allMessages
        .slice(-6)
        .map((m) => `${m.sender === "user" ? "Cliente" : "Bot"}: ${m.content}`)
        .join("\n");

      if (SALE_INTENTS.includes(aiResponse.intent)) {
        console.log(`🛒 Sale intent detected for ${senderId} via ${channel}! Notifying admin...`);
        await updateConversationStatus(conversation.id, "sale_pending").catch(e =>
          console.warn("Error updating status:", e)
        );
        await notifyAdminOfSale({
          conversationId: conversation.id,
          phoneNumber: identifier,
          customerName: conversation.customer_name || contactName,
          productsInterested: aiResponse.products_mentioned,
          conversationSummary: `[${channel.toUpperCase()}]\n${summary}`,
        }).catch(e => console.warn("Error notifying sale:", e));
      }

      if (UNKNOWN_INTENTS.includes(aiResponse.intent)) {
        await notifyAdminOfUnknownQuery({
          conversationId: conversation.id,
          phoneNumber: identifier,
          customerName: conversation.customer_name || contactName,
          question: text,
          conversationSummary: `[${channel.toUpperCase()}]\n${summary}`,
        }).catch(e => console.warn("Error notifying unknown query:", e));
      }

      if (REPRESENTATIVE_INTENTS.includes(aiResponse.intent)) {
        await notifyAdminOfRepresentativeRequest({
          conversationId: conversation.id,
          phoneNumber: identifier,
          customerName: conversation.customer_name || contactName,
          conversationSummary: `[${channel.toUpperCase()}]\n${summary}`,
        }).catch(e => console.warn("Error notifying representative request:", e));
      }
    } catch (e) {
      console.warn(`⚠️ Non-critical error in admin notifications:`, e);
    }
  } catch (error) {
    console.error(
      `❌ Error handling [${channel}] message from ${senderId}:`,
      error instanceof Error ? error.stack : JSON.stringify(error)
    );

    // Send fallback error message via the same channel
    await client
      .sendMessage(
        senderId,
        "Disculpa, tuve un pequeño problema procesando tu mensaje 😅 Por favor intenta de nuevo en unos segundos."
      )
      .catch(() => {});
  }
}
