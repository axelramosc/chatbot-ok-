import { extractMessageData, sendTextMessage, type ExtractedMessage } from "./whatsapp";
import {
  getOrCreateConversation,
  saveMessage,
  getRecentMessages,
  getActiveProducts,
  getActiveFAQs,
  isMessageProcessed,
  updateConversationStatus,
} from "./database";
import { generateResponse } from "./ai";
import { notifyAdminOfSale, notifyAdminOfUnknownQuery } from "./notifications";
import type { WhatsAppWebhookPayload } from "./types";

// Intents que activan notificación de venta al admin
const SALE_INTENTS = ["ready_to_buy", "bought"];

// Intents que activan notificación de consulta sin respuesta al admin
const UNKNOWN_INTENTS = ["unknown"];

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

  // 2. Verificar duplicados
  const alreadyProcessed = await isMessageProcessed(messageId);
  if (alreadyProcessed) {
    console.log(`⏭️ Skipping duplicate message: ${messageId}`);
    return;
  }

  try {
    // 3. Obtener o crear conversación
    const conversation = await getOrCreateConversation(from, contactName);

    // 4. Guardar mensaje entrante
    await saveMessage(conversation.id, "user", text, messageId);

    if (conversation.status === "attended" || conversation.status === "sale_completed" || conversation.status === "closed") {
      console.log(`⏭️ Bot paused. Conversation status is: ${conversation.status}`);
      return;
    }

    // 5. Obtener contexto en paralelo para velocidad
    const [recentMessages, products, faqs] = await Promise.all([
      getRecentMessages(conversation.id, 10),
      getActiveProducts(),
      getActiveFAQs(),
    ]);

    // 6. Generar respuesta con IA
    const aiResponse = await generateResponse(
      text,
      products,
      faqs,
      recentMessages,
      conversation.customer_name || contactName
    );

    console.log(`🤖 Response (intent: ${aiResponse.intent}): ${aiResponse.message.substring(0, 100)}...`);

    // 7. Guardar respuesta del bot
    await saveMessage(conversation.id, "bot", aiResponse.message);

    // 8. Enviar respuesta al cliente vía WhatsApp
    const sent = await sendTextMessage(from, aiResponse.message);

    if (!sent) {
      console.error(`❌ Failed to send message to ${from}`);
      return;
    }

    console.log(`✅ Response sent to ${from}`);

    // 9. Construir resumen de conversación para notificaciones
    const allMessages = [...recentMessages, { sender: "user" as const, content: text }, { sender: "bot" as const, content: aiResponse.message }];
    const summary = allMessages
      .slice(-6)
      .map((m) => `${m.sender === "user" ? "Cliente" : "Bot"}: ${m.content}`)
      .join("\n");

    // 10. Notificar al admin si es una venta concretada o intención de compra
    if (SALE_INTENTS.includes(aiResponse.intent)) {
      console.log(`🛒 Sale intent detected for ${from}! Notifying admin...`);

      await updateConversationStatus(conversation.id, "sale_pending");

      await notifyAdminOfSale({
        conversationId: conversation.id,
        phoneNumber: from,
        customerName: conversation.customer_name || contactName,
        productsInterested: aiResponse.products_mentioned,
        conversationSummary: summary,
      });
    }

    // 11. Notificar al admin si el bot no pudo responder la pregunta
    if (UNKNOWN_INTENTS.includes(aiResponse.intent)) {
      console.log(`❓ Unknown query from ${from} — notifying admin for human followup`);

      await notifyAdminOfUnknownQuery({
        conversationId: conversation.id,
        phoneNumber: from,
        customerName: conversation.customer_name || contactName,
        question: text,
        conversationSummary: summary,
      });
    }

  } catch (error) {
    console.error(`❌ Error handling message from ${from}:`, error);

    // Enviar mensaje de error al cliente
    await sendTextMessage(
      from,
      "Disculpa, tuve un pequeño problema procesando tu mensaje 😅 Por favor intenta de nuevo en unos segundos, o visítanos directamente en tienda. ¡Con gusto te atendemos!"
    );
  }
}
