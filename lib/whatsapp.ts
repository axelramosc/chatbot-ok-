import crypto from "crypto";
import type {
  WhatsAppWebhookPayload,
  WhatsAppMessage,
  WhatsAppContact,
} from "./types";

const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN!;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID!;
const WHATSAPP_APP_SECRET = process.env.WHATSAPP_APP_SECRET!;

const GRAPH_API_URL = "https://graph.facebook.com/v20.0";

// ============================================
// Send Messages
// ============================================

export async function sendTextMessage(
  to: string,
  text: string
): Promise<boolean> {
  try {
    const response = await fetch(
      `${GRAPH_API_URL}/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body: text },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      console.error("WhatsApp send error:", JSON.stringify(error));
      return false;
    }

    return true;
  } catch (error) {
    console.error("WhatsApp send exception:", error);
    return false;
  }
}

export async function sendTemplateMessage(
  to: string,
  templateName: string,
  parameters: string[]
): Promise<boolean> {
  try {
    const components = parameters.length > 0
      ? [
          {
            type: "body",
            parameters: parameters.map((p) => ({
              type: "text",
              text: p,
            })),
          },
        ]
      : [];

    const response = await fetch(
      `${GRAPH_API_URL}/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "template",
          template: {
            name: templateName,
            language: { code: "es_MX" },
            components,
          },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      console.error("WhatsApp template send error:", JSON.stringify(error));
      return false;
    }

    return true;
  } catch (error) {
    console.error("WhatsApp template send exception:", error);
    return false;
  }
}

// ============================================
// Webhook Verification
// ============================================

export function verifyWebhookSignature(
  rawBody: string,
  signature: string | null
): boolean {
  if (!signature) return false;

  const expectedSignature = crypto
    .createHmac("sha256", WHATSAPP_APP_SECRET)
    .update(rawBody)
    .digest("hex");

  return signature === `sha256=${expectedSignature}`;
}

// ============================================
// Payload Parsing
// ============================================

export interface ExtractedMessage {
  from: string;
  messageId: string;
  text: string;
  contactName: string;
  timestamp: string;
}

export function extractMessageData(
  payload: WhatsAppWebhookPayload
): ExtractedMessage | null {
  try {
    if (payload.object !== "whatsapp_business_account") return null;

    for (const entry of payload.entry) {
      for (const change of entry.changes) {
        const value = change.value;

        // Skip status updates
        if (!value.messages || value.messages.length === 0) continue;

        const message: WhatsAppMessage = value.messages[0];

        // Only handle text messages for now
        if (message.type !== "text" || !message.text) continue;

        const contact: WhatsAppContact | undefined = value.contacts?.[0];

        return {
          from: message.from,
          messageId: message.id,
          text: message.text.body,
          contactName: contact?.profile?.name || "Cliente",
          timestamp: message.timestamp,
        };
      }
    }

    return null;
  } catch (error) {
    console.error("Error extracting message data:", error);
    return null;
  }
}
