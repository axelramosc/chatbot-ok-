import { extractMessageData, sendTextMessage, type ExtractedMessage } from "./whatsapp";
import {
  getOrCreateConversation,
  saveMessage,
  getRecentMessages,
  getActiveProducts,
  getActiveFAQs,
  getBusinessSettings,
  getKnowledgeFragments,
  isMessageProcessed,
  updateConversationStatus,
} from "./database";
import { getSupabase } from "./supabase";
import { generateResponse } from "./ai";
import { notifyAdminOfSale, notifyAdminOfUnknownQuery, notifyAdminOfRepresentativeRequest } from "./notifications";
import type { WhatsAppWebhookPayload } from "./types";

// Intents que activan notificación de venta al admin
const SALE_INTENTS = ["ready_to_buy", "bought"];

// Intents que activan notificación de consulta sin respuesta al admin
const UNKNOWN_INTENTS = ["unknown"];

// Intents que activan notificación de solicitud de representante
const REPRESENTATIVE_INTENTS = ["representative"];

export async function handleIncomingMessage(
  payload: WhatsAppWebhookPayload
): Promise<void> {
  // 1. Extraer datos del mensaje del webhook
  const messageData: ExtractedMessage | null = extractMessageData(payload);

  if (!messageData) {
    // No es un mensaje de texto o es una actualización de estado — ignorar
    return;
  }

  const { from, messageId, text, contactName } = messageData;

  console.log(`📩 Message from ${from} (${contactName}): ${text}`);

  // 2. Verificar duplicados (con guarda para que un error en DB no rompa el flujo)
  let alreadyProcessed = false;
  try {
    alreadyProcessed = await isMessageProcessed(messageId);
  } catch (e) {
    console.warn(`⚠️ isMessageProcessed threw, treating as new:`, e);
  }
  if (alreadyProcessed) {
    console.log(`⏭️ Skipping duplicate message: ${messageId}`);
    return;
  }

  try {
    // 3. Obtener o crear conversación (con fallback)
    let conversation;
    try {
      conversation = await getOrCreateConversation(from, contactName);
    } catch (e) {
      console.error(`⚠️ Database error getting conversation for ${from}:`, e);
      // Fallback minimal conversation to keep the bot running
      conversation = {
        id: "fallback-id",
        phone_number: from,
        customer_name: contactName || null,
        status: "active",
        context: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    }

    // 4. ALWAYS save the incoming message — non-critical
    try {
      await saveMessage(conversation.id, "user", text, messageId);

      const supabase = getSupabase();
      await supabase
        .from("conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", conversation.id);
    } catch (e) {
      console.warn(`⚠️ Non-critical error saving incoming message:`, e);
    }

    // 5. Fresh status check from DB (non-critical)
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

    if (currentStatus === "attended" || currentStatus === "sale_completed" || currentStatus === "closed") {
      console.log(`⏭️ Bot paused. Conversation ${conversation.id} status is: ${currentStatus}.`);
      return;
    }

    // 6. Obtener contexto en paralelo (non-critical)
    let recentMessages: any[] = [];
    let products: any[] = [];
    let faqs: any[] = [];
    let businessSettings: Record<string, string> = {};
    let knowledgeFragments: any[] = [];

    try {
      const [rm, p, f, bs, kf] = await Promise.all([
        getRecentMessages(conversation.id, 10).catch(e => { console.warn("Error fetching recent messages:", e); return []; }),
        getActiveProducts().catch(e => { console.warn("Error fetching products:", e); return []; }),
        getActiveFAQs().catch(e => { console.warn("Error fetching FAQs:", e); return []; }),
        getBusinessSettings().catch(e => { console.warn("Error fetching business settings:", e); return {}; }),
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

    // 7. Generar respuesta con IA
    const aiResponse = await generateResponse(
      text,
      products,
      faqs,
      recentMessages,
      conversation.customer_name || contactName,
      businessSettings,
      knowledgeFragments,
      { conversationId: conversation.id, phoneNumber: from },
    );

    console.log(`🤖 Response (intent: ${aiResponse.intent}): ${aiResponse.message.substring(0, 100)}...`);

    // 8. SECOND status check (non-critical)
    try {
      const supabase = getSupabase();
      const { data: recheckConv } = await supabase
        .from("conversations")
        .select("status")
        .eq("id", conversation.id)
        .single();

      if (recheckConv && (recheckConv.status === "attended" || recheckConv.status === "sale_completed" || recheckConv.status === "closed")) {
        console.log(`⏭️ Bot paused (post-AI check). Status: ${recheckConv.status}.`);
        return;
      }
    } catch (e) {
      console.warn(`⚠️ Non-critical error in post-AI status check:`, e);
    }

    // 9. Guardar respuesta del bot + actualizar contexto del cliente (non-critical)
    try {
      await saveMessage(conversation.id, "bot", aiResponse.message);
    } catch (e) {
      console.warn(`⚠️ Non-critical error saving bot response:`, e);
    }

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

    // 10. Enviar respuesta al cliente vía WhatsApp
    const sent = await sendTextMessage(from, aiResponse.message);

    if (!sent) {
      console.error(`❌ Failed to send message to ${from}`);
      return;
    }

    console.log(`✅ Response sent to ${from}`);

    // 11. Notificaciones al admin (non-critical)
    try {
      const allMessages = [...recentMessages, { sender: "user" as const, content: text }, { sender: "bot" as const, content: aiResponse.message }];
      const summary = allMessages
        .slice(-6)
        .map((m) => `${m.sender === "user" ? "Cliente" : "Bot"}: ${m.content}`)
        .join("\n");

      if (SALE_INTENTS.includes(aiResponse.intent)) {
        console.log(`🛒 Sale intent detected for ${from}! Notifying admin...`);
        await updateConversationStatus(conversation.id, "sale_pending").catch(e => console.warn("Error updating status:", e));
        await notifyAdminOfSale({
          conversationId: conversation.id,
          phoneNumber: from,
          customerName: conversation.customer_name || contactName,
          productsInterested: aiResponse.products_mentioned,
          conversationSummary: summary,
        }).catch(e => console.warn("Error notifying sale:", e));
      }

      if (UNKNOWN_INTENTS.includes(aiResponse.intent)) {
        console.log(`❓ Unknown query from ${from} — notifying admin...`);
        await notifyAdminOfUnknownQuery({
          conversationId: conversation.id,
          phoneNumber: from,
          customerName: conversation.customer_name || contactName,
          question: text,
          conversationSummary: summary,
        }).catch(e => console.warn("Error notifying unknown query:", e));
      }

      if (REPRESENTATIVE_INTENTS.includes(aiResponse.intent)) {
        console.log(`🙋 Representative request from ${from} — notifying admin...`);
        await notifyAdminOfRepresentativeRequest({
          conversationId: conversation.id,
          phoneNumber: from,
          customerName: conversation.customer_name || contactName,
          conversationSummary: summary,
        }).catch(e => console.warn("Error notifying representative request:", e));
      }
    } catch (e) {
      console.warn(`⚠️ Non-critical error in admin notifications:`, e);
    }

  } catch (error) {
    console.error(`❌ Error handling message from ${from}:`, error instanceof Error ? error.stack : JSON.stringify(error));

    // Check if this conversation is being handled by admin before sending error message.
    // If admin has control, stay silent — don't confuse the client with bot error messages.
    try {
      const supabase = getSupabase();
      const { data: convRows } = await supabase
        .from("conversations")
        .select("status")
        .eq("phone_number", from)
        .not("status", "eq", "closed")
        .order("updated_at", { ascending: false })
        .limit(1);

      const status = convRows?.[0]?.status;
      if (status === "attended" || status === "sale_completed" || status === "closed") {
        console.log(`🤫 Error occurred but conversation is ${status} — staying silent.`);
        return;
      }
    } catch {
      // If we can't check, fall through to send error message
    }

    // Only send error message if bot is actively handling the conversation
    await sendTextMessage(
      from,
      "Disculpa, tuve un pequeño problema procesando tu mensaje 😅 Por favor intenta de nuevo en unos segundos, o visítanos directamente en tienda. ¡Con gusto te atendemos!"
    );
  }
}
