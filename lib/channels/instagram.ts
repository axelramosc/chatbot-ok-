import crypto from "crypto";
import type { NormalizedMessage, ChannelClient } from "./types";

const GRAPH_API_VERSION = "v21.0";
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

// ── Types ──────────────────────────────────────────────────────────────────

interface InstagramEntry {
  id: string;
  time: number;
  messaging?: InstagramMessaging[];
}

interface InstagramMessaging {
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

interface InstagramPayload {
  object: string;
  entry: InstagramEntry[];
}

// ── Extract ────────────────────────────────────────────────────────────────

export function extractInstagramMessages(rawBody: string): NormalizedMessage[] {
  let payload: InstagramPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return [];
  }

  if (payload.object !== "instagram") return [];

  const results: NormalizedMessage[] = [];

  for (const entry of payload.entry ?? []) {
    for (const event of entry.messaging ?? []) {
      if (!event.message) continue;
      if (event.message.is_echo) continue;
      if (!event.message.text) continue;

      results.push({
        senderId: event.sender.id,
        messageId: event.message.mid,
        text: event.message.text,
        contactName: "Cliente",
        channel: "instagram",
      });
    }
  }

  return results;
}

// ── Send ───────────────────────────────────────────────────────────────────

export async function sendInstagramMessage(igsid: string, text: string): Promise<boolean> {
  const token = process.env.META_INSTAGRAM_PAGE_ACCESS_TOKEN;
  if (!token) {
    console.error("❌ META_INSTAGRAM_PAGE_ACCESS_TOKEN not configured");
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
        recipient: { id: igsid },
        message: { text },
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if ((err as any)?.error?.code === 10) {
        console.warn(`⚠️ Instagram: 24-hour window expired for IGSID ${igsid}`);
      } else {
        console.error(`❌ Instagram send failed (${res.status}):`, err);
      }
      return false;
    }

    console.log(`✅ Instagram message sent to IGSID ${igsid}`);
    return true;
  } catch (err) {
    console.error(`❌ Instagram send error:`, err);
    return false;
  }
}

export async function sendInstagramImage(
  igsid: string,
  imageUrl: string,
  _caption?: string,
): Promise<boolean> {
  // Meta Graph API no soporta caption en attachments de imagen para Instagram;
  // si hay caption, el caller debe enviarlo como mensaje de texto separado.
  const token = process.env.META_INSTAGRAM_PAGE_ACCESS_TOKEN;
  if (!token) {
    console.error("❌ META_INSTAGRAM_PAGE_ACCESS_TOKEN not configured");
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
        recipient: { id: igsid },
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
      console.error(`❌ Instagram image send failed (${res.status}):`, err);
      return false;
    }
    console.log(`✅ Instagram image sent to IGSID ${igsid}`);
    return true;
  } catch (err) {
    console.error(`❌ Instagram image send error:`, err);
    return false;
  }
}

// ── Verify signature ───────────────────────────────────────────────────────

export function verifyInstagramSignature(rawBody: string, signature: string | null): boolean {
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

export const instagramClient: ChannelClient = {
  name: "instagram",
  extractMessages: extractInstagramMessages,
  sendMessage: sendInstagramMessage,
  sendImage: sendInstagramImage,
  verifySignature: verifyInstagramSignature,
};
