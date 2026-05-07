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
import { notifyAdminOfSale } from "./notifications";
import type { WhatsAppWebhookPayload } from "./types";

// Intents that trigger admin notification
const SALE_INTENTS = ["ready_to_buy", "bought"];

export async function handleIncomingMessage(
  payload: WhatsAppWebhookPayload
): Promise<void> {
  // 1. Extract message data from webhook payload
  const messageData: ExtractedMessage | null = extractMessageData(payload);

  if (!messageData) {
    // Not a text message or status update — ignore
    return;
  }

  const { from, messageId, text, contactName } = messageData;

  console.log(`📩 Message from ${from} (${contactName}): ${text}`);

  // 2. Deduplication check
  const alreadyProcessed = await isMessageProcessed(messageId);
  if (alreadyProcessed) {
    console.log(`⏭️ Skipping duplicate message: ${messageId}`);
    return;
  }

  try {
    // 3. Get or create conversation
    const conversation = await getOrCreateConversation(from, contactName);

    // 4. Save incoming message
    await saveMessage(conversation.id, "user", text, messageId);

    // 5. Fetch context in parallel for speed
    const [recentMessages, products, faqs] = await Promise.all([
      getRecentMessages(conversation.id, 10),
      getActiveProducts(),
      getActiveFAQs(),
    ]);

    // 6. Generate AI response
    const aiResponse = await generateResponse(
      text,
      products,
      faqs,
      recentMessages,
      conversation.customer_name || contactName
    );

    console.log(`🤖 Response (intent: ${aiResponse.intent}): ${aiResponse.message.substring(0, 100)}...`);

    // 7. Save bot response
    await saveMessage(conversation.id, "bot", aiResponse.message);

    // 8. Send response to user via WhatsApp
    const sent = await sendTextMessage(from, aiResponse.message);

    if (!sent) {
      console.error(`❌ Failed to send message to ${from}`);
      return;
    }

    console.log(`✅ Response sent to ${from}`);

    // 9. Check if we should notify admin (sale detected)
    if (SALE_INTENTS.includes(aiResponse.intent)) {
      console.log(`🛒 Sale intent detected for ${from}! Notifying admin...`);

      // Update conversation status
      await updateConversationStatus(conversation.id, "sale_pending");

      // Build conversation summary from recent messages
      const summary = recentMessages
        .slice(-5)
        .map((m) => `${m.sender === "user" ? "Cliente" : "Bot"}: ${m.content}`)
        .join("\n");

      // Notify admin
      await notifyAdminOfSale({
        conversationId: conversation.id,
        phoneNumber: from,
        customerName: conversation.customer_name || contactName,
        productsInterested: aiResponse.products_mentioned,
        conversationSummary: summary,
      });
    }
  } catch (error) {
    console.error(`❌ Error handling message from ${from}:`, error);

    // Send error message to user
    await sendTextMessage(
      from,
      "Disculpa, tuve un problema procesando tu mensaje. Por favor intenta de nuevo en unos segundos. 🙏"
    );
  }
}
