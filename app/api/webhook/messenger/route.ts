import { NextResponse } from "next/server";
import { messengerClient } from "../../../../lib/channels/messenger";
import { handleChannelMessage } from "../../../../lib/channel-handler";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET — Meta webhook verification handshake
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode      = searchParams.get("hub.mode");
  const token     = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.META_VERIFY_TOKEN) {
    console.log("✅ Messenger webhook verified");
    return new Response(challenge, { status: 200 });
  }

  console.warn("❌ Messenger webhook verification failed");
  return new NextResponse("Forbidden", { status: 403 });
}

// POST — Receive messages from Facebook Messenger
export async function POST(request: Request) {
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return new NextResponse("Bad Request", { status: 400 });
  }

  // Always return 200 first — Meta retries if it doesn't get 200 quickly
  const signature = request.headers.get("x-hub-signature-256");
  if (!messengerClient.verifySignature(rawBody, signature)) {
    console.warn("❌ Invalid Messenger webhook signature");
    return new NextResponse("Forbidden", { status: 403 });
  }

  const messages = messengerClient.extractMessages(rawBody);

  // Process each message; await to keep the serverless function alive
  for (const msg of messages) {
    await handleChannelMessage(msg, messengerClient).catch((err) =>
      console.error("❌ Error in handleChannelMessage (Messenger):", err)
    );
  }

  return new NextResponse("OK", { status: 200 });
}
