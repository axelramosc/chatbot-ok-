import { NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabase } from "../../../lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 1024;

const NO_STORE = { "Cache-Control": "no-store" };

function json(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/** Origin (si viene) debe ser el mismo host que sirve la petición: freno a CSRF cross-site. */
function isSameOrigin(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const hosts = [request.headers.get("host"), request.headers.get("x-forwarded-host")];
  return hosts.some((h) => !!h && h === originHost);
}

/**
 * Interruptor global del bot (CB-001). Único camino de ESCRITURA a `bot_control`
 * (el CRM solo tiene SELECT por RLS).
 *
 * - Sesión obligatoria (mismo patrón que /api/ava-command). Todo el equipo con sesión
 *   puede apagar/encender (decisión D1 de Axel).
 * - Solo se acepta `{ enabled: boolean }`. El teléfono de redirección y `updated_by`
 *   jamás se toman del cliente.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return json({ error: "Forbidden" }, 403);
  }

  // Auth: sesión válida verificada contra Supabase Auth (nunca la service role).
  const cookieStore = await cookies();
  const sessionClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) { return cookieStore.get(name)?.value; },
        set(_name: string, _value: string, _options: CookieOptions) {},
        remove(_name: string, _options: CookieOptions) {},
      },
    }
  );

  const { data: { user } } = await sessionClient.auth.getUser();
  if (!user) {
    return json({ error: "Unauthorized" }, 401);
  }

  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    return json({ error: "invalid_content_type" }, 400);
  }

  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return json({ error: "invalid_body" }, 400);
    body = JSON.parse(raw);
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "invalid_body" }, 400);
  }
  const fields = Object.keys(body);
  if (fields.length !== 1 || fields[0] !== "enabled") {
    // redirect_phone, updated_by, id, updated_at, etc. NO se aceptan del cliente.
    return json({ error: "invalid_body" }, 400);
  }
  const enabled = (body as { enabled: unknown }).enabled;
  if (typeof enabled !== "boolean") {
    return json({ error: "invalid_enabled" }, 400);
  }

  try {
    const updatedAt = new Date().toISOString();
    const { error } = await getSupabase()
      .from("bot_control")
      .upsert({ id: 1, enabled, updated_at: updatedAt, updated_by: user.id }, { onConflict: "id" });

    if (error) {
      console.error("bot-control: error al escribir bot_control:", error.code ?? "unknown");
      return json({ error: "Internal server error" }, 500);
    }

    // Auditoría (quién, qué, cuándo).
    console.log(JSON.stringify({ event: "bot_control_change", user_id: user.id, enabled, at: updatedAt }));
    return json({ enabled, updated_at: updatedAt }, 200);
  } catch (e) {
    console.error("bot-control error:", e instanceof Error ? e.message : "unknown");
    return json({ error: "Internal server error" }, 500);
  }
}
