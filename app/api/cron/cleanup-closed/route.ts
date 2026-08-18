import { NextResponse } from "next/server";
import { getSupabase } from "../../../../lib/supabase";

export const dynamic = "force-dynamic";

// ⚠️ DESACTIVADO. Ya no está agendado en vercel.json y además exige el flag
// CLEANUP_CLOSED_ENABLED="true" para ejecutar el borrado.
//
// Motivo: las conversaciones finalizadas (customer_status = 'cerrado') son el
// indicador principal del bot — atender al cliente y dejar la conversación
// cerrada. Borrarlas a los 60 días destruía justo la evidencia que mide ese
// objetivo: el histórico se perdía y el contador se quedaba plano. La BD pesa
// ~25 MB y crece ~3.5 MB/mes contra 500 MB de cupo, así que conservar todo no
// representa un problema de espacio en el horizonte previsible.
//
// Para reactivarlo: volver a agregar la entrada en vercel.json y definir
// CLEANUP_CLOSED_ENABLED="true". Antes de hacerlo, asegurar que el histórico de
// finalizaciones se preserve por otra vía, o las analíticas volverán a mentir.
//
// Qué hacía: eliminaba las conversaciones 'cerrado' con más de RETENTION_DAYS
// desde `closed_at`. Borrar una conversación arrastra en cascada sus mensajes y
// su sales_lead (FK ON DELETE CASCADE).
const RETENTION_DAYS = 60;
const CLEANUP_ENABLED = process.env.CLEANUP_CLOSED_ENABLED === "true";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  if (!CLEANUP_ENABLED) {
    console.log("cleanup-closed: desactivado (CLEANUP_CLOSED_ENABLED != 'true'). Sin cambios.");
    return NextResponse.json({
      message: "Cleanup disabled — closed conversations are retained indefinitely.",
      deleted: 0,
    });
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
