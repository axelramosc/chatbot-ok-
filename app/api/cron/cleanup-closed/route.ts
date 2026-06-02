import { NextResponse } from "next/server";
import { getSupabase } from "../../../../lib/supabase";

export const dynamic = "force-dynamic";

// Cron: physically removes conversations the sales team closed
// (customer_status = 'cerrado') that have stayed closed and idle for more than
// RETENTION_DAYS. The clock is `closed_at` (set when the conversation became
// 'cerrado'); reopening a conversation resets it to NULL — via the auto
// 'reabierto' status or any manual change — so the 60-day timer restarts and
// only re-closing it starts a fresh countdown.
//
// Deleting a conversation cascades to its messages and its sales_lead
// (FK ON DELETE CASCADE) and nulls any ai_error_logs reference, so the
// database is left clean with no orphaned rows.
const RETENTION_DAYS = 60;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const supabase = getSupabase();
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Select first so we can report exactly what was removed.
  const { data: stale, error: selErr } = await supabase
    .from("conversations")
    .select("id")
    .eq("customer_status", "cerrado")
    .not("closed_at", "is", null)
    .lt("closed_at", cutoff);

  if (selErr) {
    console.error("cleanup-closed cron — select error:", selErr);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  if (!stale || stale.length === 0) {
    return NextResponse.json({ message: "No closed conversations past retention.", deleted: 0 });
  }

  const ids = stale.map((c) => c.id);

  const { error: delErr } = await supabase
    .from("conversations")
    .delete()
    .in("id", ids);

  if (delErr) {
    console.error("cleanup-closed cron — delete error:", delErr);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }

  console.log(`🧹 cleanup-closed: deleted ${ids.length} closed conversation(s) older than ${RETENTION_DAYS}d.`);
  return NextResponse.json({ message: "Cleanup complete.", deleted: ids.length });
}
