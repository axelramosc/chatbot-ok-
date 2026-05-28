import { NextResponse } from "next/server";
import { instagramClient } from "../../../../lib/channels/instagram";
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
    console.log("✅ Instagram webhook verified");
    return new Response(challenge, { status: 200 });
  }

  console.warn("❌ Instagram webhook verification failed");
  return new NextResponse("Forbidden", { status: 403 });
}

// POST — Receive messages from Instagram DMs
export async function POST(request: Request) {
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return new NextResponse("Bad Request", { status: 400 });
  }

  const signature = request.headers.get("x-hub-signature-256");
  if (!instagramClient.verifySignature(rawBody, signature)) {
    console.warn("❌ Invalid Instagram webhook signature");
    return new NextResponse("Forbidden", { status: 403 });
  }

  const messages = instagramClient.extractMessages(rawBody);

  for (const msg of messages) {
    await handleChannelMessage(msg, instagramClient).catch((err) =>
      console.error("❌ Error in handleChannelMessage (Instagram):", err)
    );
  }

  return new NextResponse("OK", { status: 200 });
}
