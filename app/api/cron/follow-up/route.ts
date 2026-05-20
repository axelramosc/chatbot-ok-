import { NextResponse } from "next/server";
import { getSupabase } from "../../../../lib/supabase";
import { sendTextMessage } from "../../../../lib/whatsapp";
import { getBusinessSettings } from "../../../../lib/database";

export const dynamic = "force-dynamic";

// Cron runs every hour — Vercel cron syntax: "0 * * * *"
// This job finds sale_pending conversations with no admin response
// in the last 3 hours and sends a warm follow-up to re-engage the customer.
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const supabase = getSupabase();
  const THREE_HOURS_AGO = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  const ONE_DAY_AGO     = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Find conversations that:
  // 1. Are still "sale_pending" (admin hasn't taken over yet)
  // 2. Were last updated 3+ hours ago (no recent activity)
  // 3. Were created within the last 24 hours (still inside WhatsApp messaging window)
  const { data: pendingConvs, error } = await supabase
    .from("conversations")
    .select("id, phone_number, customer_name, context, updated_at")
    .eq("status", "sale_pending")
    .lte("updated_at", THREE_HOURS_AGO)
    .gte("created_at", ONE_DAY_AGO);

  if (error) {
    console.error("Follow-up cron — DB error:", error);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  if (!pendingConvs || pendingConvs.length === 0) {
    return NextResponse.json({ message: "No pending conversations to follow up.", count: 0 });
  }

  const settings: Record<string, string> = await getBusinessSettings().catch(() => ({}));
  const businessName = settings["name"] || "Greenland Deco";

  let sent = 0;
  let errors = 0;

  for (const conv of pendingConvs) {
    const ctx = (conv.context as Record<string, unknown>) || {};
    const products = (ctx.products_interested as string[]) || [];
    const customerName = conv.customer_name;

    const productMention = products.length > 0
      ? ` sobre ${products.slice(0, 2).join(" y ")}`
      : "";

    const greeting = customerName ? `Hola ${customerName.split(" ")[0]}` : "Hola";

    const message =
      `${greeting}! 😊 Soy Ava de ${businessName}.\n\n` +
      `Vi que estabas interesado${productMention} y quería asegurarme de que hayas encontrado todo lo que buscabas.\n\n` +
      `Si tienes alguna pregunta o quieres continuar donde lo dejamos, aquí estoy. ¡Con gusto te ayudo!`;

    const ok = await sendTextMessage(conv.phone_number, message);

    if (ok) {
      sent++;
      // Mark as active again so Ava can handle the conversation
      await supabase
        .from("conversations")
        .update({
          status: "active",
          updated_at: new Date().toISOString(),
        })
        .eq("id", conv.id);

      console.log(`✅ Follow-up sent to ${conv.phone_number} (conv ${conv.id})`);
    } else {
      errors++;
      console.error(`❌ Failed to send follow-up to ${conv.phone_number}`);
    }
  }

  return NextResponse.json({
    message: `Follow-up cron complete.`,
    sent,
    errors,
    total: pendingConvs.length,
  });
}
