import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookSignature } from "../../../lib/whatsapp";
import { handleIncomingMessage } from "../../../lib/message-handler";
import type { WhatsAppWebhookPayload } from "../../../lib/types";

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || "default_verify_token";

// Allow up to 60 seconds for Groq AI + WhatsApp API calls
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

// ============================================
// GET — Webhook Verification (Meta handshake)
// ============================================
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verified successfully");
    return new NextResponse(challenge, { status: 200 });
  }

  console.warn("❌ Webhook verification failed");
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

// ============================================
// POST — Incoming Messages
// ============================================
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();

    // Verify webhook signature for security
    const signature = request.headers.get("x-hub-signature-256");

    if (process.env.WHATSAPP_APP_SECRET && !verifyWebhookSignature(rawBody, signature)) {
      console.warn("❌ Invalid webhook signature");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const payload: WhatsAppWebhookPayload = JSON.parse(rawBody);

    // CRITICAL FIX: await the full pipeline so Vercel doesn't terminate
    // the serverless function before Groq AI and WhatsApp send calls complete.
    // Previously used `void` which caused the function to exit immediately after
    // returning 200, cutting off all async processing.
    await handleIncomingMessage(payload).catch((error) => {
      console.error("Message processing error:", error);
    });

    return NextResponse.json({ status: "ok" }, { status: 200 });
  } catch (error) {
    console.error("Webhook POST error:", error);
    // Always return 200 to prevent WhatsApp from retrying
    return NextResponse.json({ status: "ok" }, { status: 200 });
  }
}
