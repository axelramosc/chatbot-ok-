import crypto from "crypto";
import type { NormalizedMessage, ChannelClient } from "./types";

const GRAPH_API_VERSION = "v21.0";
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

// ── Types ──────────────────────────────────────────────────────────────────

interface MessengerEntry {
  id: string;
  time: number;
  messaging?: MessengerMessaging[];
}

interface MessengerMessaging {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: {
    mid: string;
    text?: string;
    is_echo?: boolean;
  };
  postback?: unknown;
  read?: unknown;
  delivery?: unknown;
}

interface MessengerPayload {
  object: string;
  entry: MessengerEntry[];
}

// ── Extract ────────────────────────────────────────────────────────────────

export function extractMessengerMessages(rawBody: string): NormalizedMessage[] {
  let payload: MessengerPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return [];
  }

  if (payload.object !== "page") return [];

  const results: NormalizedMessage[] = [];

  for (const entry of payload.entry ?? []) {
    for (const event of entry.messaging ?? []) {
      // Skip echoes (messages sent by the page itself), postbacks, read/delivery receipts
      if (!event.message) continue;
      if (event.message.is_echo) continue;
      if (!event.message.text) continue;

      results.push({
        senderId: event.sender.id,
        messageId: event.message.mid,
        text: event.message.text,
        contactName: "Cliente",
        channel: "messenger",
      });
    }
  }

  return results;
}

// ── Send ───────────────────────────────────────────────────────────────────

export async function sendMessengerMessage(psid: string, text: string): Promise<boolean> {
  const token = process.env.META_MESSENGER_PAGE_ACCESS_TOKEN;
  if (!token) {
    console.error("❌ META_MESSENGER_PAGE_ACCESS_TOKEN not configured");
    return false;
  }

  try {
    const res = await fetch(`${GRAPH_API_BASE}/me/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_type: "RESPONSE",
        recipient: { id: psid },
        message: { text },
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      // Code 10 = outside 24-hour messaging window; log distinctly
      if ((err as any)?.error?.code === 10) {
        console.warn(`⚠️ Messenger: 24-hour window expired for PSID ${psid}`);
      } else {
        console.error(`❌ Messenger send failed (${res.status}):`, err);
      }
      return false;
    }

    console.log(`✅ Messenger message sent to PSID ${psid}`);
    return true;
  } catch (err) {
    console.error(`❌ Messenger send error:`, err);
    return false;
  }
}

export async function sendMessengerImage(
  psid: string,
  imageUrl: string,
  _caption?: string,
): Promise<boolean> {
  // Messenger no soporta caption en attachments; el caller debe enviar texto aparte.
  const token = process.env.META_MESSENGER_PAGE_ACCESS_TOKEN;
  if (!token) {
    console.error("❌ META_MESSENGER_PAGE_ACCESS_TOKEN not configured");
    return false;
  }
  try {
    const res = await fetch(`${GRAPH_API_BASE}/me/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_type: "RESPONSE",
        recipient: { id: psid },
        message: {
          attachment: {
            type: "image",
            payload: { url: imageUrl, is_reusable: true },
          },
        },
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error(`❌ Messenger image send failed (${res.status}):`, err);
      return false;
    }
    console.log(`✅ Messenger image sent to PSID ${psid}`);
    return true;
  } catch (err) {
    console.error(`❌ Messenger image send error:`, err);
    return false;
  }
}

// ── Verify signature ───────────────────────────────────────────────────────

export function verifyMessengerSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return false;
  if (!signature) return false;

  const expected = "sha256=" + crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ── Client ─────────────────────────────────────────────────────────────────

export const messengerClient: ChannelClient = {
  name: "messenger",
  extractMessages: extractMessengerMessages,
  sendMessage: sendMessengerMessage,
  sendImage: sendMessengerImage,
  verifySignature: verifyMessengerSignature,
};
