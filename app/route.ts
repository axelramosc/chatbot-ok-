import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    name: "WhatsApp Sales Bot",
    status: "running",
    version: "1.0.0",
    webhook: "/api/webhook",
    timestamp: new Date().toISOString(),
  });
}
