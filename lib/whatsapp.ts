import crypto from "crypto";
import type {
  WhatsAppWebhookPayload,
  WhatsAppMessage,
  WhatsAppContact,
} from "./types";

const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN!;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID!;
const WHATSAPP_APP_SECRET = process.env.WHATSAPP_APP_SECRET!;

const GRAPH_API_URL = "https://graph.facebook.com/v25.0";

/**
 * Normalize Mexican phone numbers for WhatsApp Cloud API.
 * Incoming webhook messages use format: 5218xxxxxxxxx (10-digit with extra 1)
 * But the API / test recipient list expects: 52xxxxxxxxxx
 * Strip the '1' after country code 52 if the total length is 13 digits.
 */
function normalizeMexicanNumber(phone: string): string {
  // 521 + 10 digits = 13 chars → strip the 1 → 52 + 10 digits = 12 chars
  if (phone.startsWith("521") && phone.length === 13) {
    return "52" + phone.slice(3);
  }
  return phone;
}

// ============================================
// Send Messages
// ============================================

export async function sendTextMessage(
  to: string,
  text: string
): Promise<boolean> {
  const normalizedTo = normalizeMexicanNumber(to);
  try {
    console.log(`📤 Sending to ${normalizedTo} (original: ${to})`);
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
          to: normalizedTo,
          type: "text",
          text: { body: text },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      const code = error?.error?.code;
      const msg = error?.error?.message || "unknown error";
      if (code === 190) {
        console.error(`🔑 WHATSAPP TOKEN EXPIRED (code 190): ${msg} — Regenerate WHATSAPP_ACCESS_TOKEN in Vercel env vars.`);
      } else {
        console.error(`❌ WhatsApp send error (code ${code}): ${msg}`, JSON.stringify(error));
      }
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
