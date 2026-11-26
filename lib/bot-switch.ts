import { getSupabase } from "./supabase";

/**
 * Interruptor global del bot (CB-001).
 *
 * Con el bot apagado, Ava no corre (cero llamadas a la IA) y cada cliente recibe un
 * aviso FIJO que lo redirige al teléfono de atención. Decisión D2 de Axel: ante la
 * duda el bot queda APAGADO (fail-closed): si no se puede leer `bot_control`, se
 * trata como apagado y se deja constancia en el log.
 */

/** Teléfono de redirección usado si la BD no lo entrega o es inválido. */
export const BOT_REDIRECT_PHONE_DEFAULT = "8445089882";

/** Ventana anti-spam: máximo un aviso por conversación cada 6 horas. */
export const BOT_OFF_NOTICE_WINDOW_MS = 6 * 60 * 60 * 1000;

export interface BotControl {
  enabled: boolean;
  redirectPhone: string;
  /** true si el estado "apagado" salió de un fallo de lectura y no de una orden explícita. */
  failClosed: boolean;
}

function normalizePhone(raw: unknown): string {
  const digits = typeof raw === "string" ? raw.replace(/\D/g, "") : "";
  return digits.length === 10 ? digits : BOT_REDIRECT_PHONE_DEFAULT;
}

/**
 * Lee el interruptor. NUNCA lanza. Solo devuelve `enabled: true` si la fila existe y
 * `enabled === true` de forma estricta; cualquier otra cosa (error, fila ausente,
 * valor raro, excepción) → apagado.
 */
export async function getBotControl(): Promise<BotControl> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("bot_control")
      .select("enabled, redirect_phone")
      .eq("id", 1)
      .maybeSingle();

    if (error || !data) {
      console.error(
        "[bot-switch] No se pudo leer bot_control — FAIL-CLOSED (bot apagado):",
        error ? error.message : "fila id=1 inexistente"
      );
      return { enabled: false, redirectPhone: BOT_REDIRECT_PHONE_DEFAULT, failClosed: true };
    }

    return {
      enabled: data.enabled === true,
      redirectPhone: normalizePhone(data.redirect_phone),
      failClosed: false,
    };
  } catch (e) {
    console.error(
      "[bot-switch] Excepción leyendo bot_control — FAIL-CLOSED (bot apagado):",
      e instanceof Error ? e.message : "unknown"
    );
    return { enabled: false, redirectPhone: BOT_REDIRECT_PHONE_DEFAULT, failClosed: true };
  }
}

/** "8445089882" → "844 508 9882". */
function formatPhone(phone: string): string {
  return `${phone.slice(0, 3)} ${phone.slice(3, 6)} ${phone.slice(6)}`;
}

/** Texto fijo del aviso. No interpola NADA que venga del cliente ni de la IA (S5). */
export function buildRedirectMessage(phone: string = BOT_REDIRECT_PHONE_DEFAULT): string {
  return (
    "Hola 👋 Por el momento nuestro asistente virtual no está disponible. " +
    `Para atenderte comunícate por favor al ${formatPhone(normalizePhone(phone))} ` +
    "y con gusto te ayudamos. ¡Gracias!"
  );
}

/**
 * Chequeo rápido y puro con el `context` ya cargado: false si el último aviso tiene
 * menos de 6 h. Una marca ausente, inválida o con fecha futura NO silencia al cliente.
 * La decisión definitiva y atómica la toma `claim_bot_off_notice` en la BD.
 */
export function shouldSendRedirect(
  context: Record<string, unknown> | null | undefined,
  now: number = Date.now()
): boolean {
  const raw = context && typeof context === "object" ? context["bot_off_notice_at"] : undefined;
  if (typeof raw !== "string") return true;
  const at = Date.parse(raw);
  if (Number.isNaN(at)) return true;
  const elapsed = now - at;
  return !(elapsed >= 0 && elapsed < BOT_OFF_NOTICE_WINDOW_MS);
}

/** Reserva atómica del aviso. Ante cualquier fallo → true (mejor un aviso repetido que silencio, A8). */
async function claimNotice(conversationId: string): Promise<boolean> {
  try {
    const { data, error } = await getSupabase().rpc("claim_bot_off_notice", {
      p_conversation_id: conversationId,
      p_window_seconds: BOT_OFF_NOTICE_WINDOW_MS / 1000,
    });
    if (error) {
      console.warn("[bot-switch] anti-spam no disponible, se envía el aviso igual:", error.message);
      return true;
    }
    return data !== false;
  } catch (e) {
    console.warn("[bot-switch] anti-spam lanzó excepción, se envía el aviso igual:", e);
    return true;
  }
}

async function releaseNotice(conversationId: string): Promise<void> {
  try {
    await getSupabase().rpc("release_bot_off_notice", { p_conversation_id: conversationId });
  } catch (e) {
    console.warn("[bot-switch] no se pudo liberar la marca de aviso:", e);
  }
}

export interface RedirectParams {
  conversationId: string;
  context: Record<string, unknown> | null | undefined;
  redirectPhone: string;
  /** Envía por el canal correcto; true si Meta lo aceptó. */
  send: (text: string) => Promise<boolean>;
  /** Guarda el aviso como mensaje `bot` para que se vea en la bandeja. */
  saveBotMessage: (conversationId: string, text: string) => Promise<unknown>;
  label: string;
}

/**
 * Con el bot apagado: envía el aviso de redirección (como máximo 1 cada 6 h por
 * conversación) y lo guarda en la bandeja. NUNCA lanza ni toca la IA: cualquier error
 * queda aislado aquí para no caer al `catch` genérico del handler.
 */
export async function sendBotOffRedirect(p: RedirectParams): Promise<"sent" | "skipped" | "failed"> {
  try {
    // "fallback-id" = la BD falló al obtener la conversación: no hay dónde reservar la marca.
    const hasRow = p.conversationId !== "fallback-id";

    if (hasRow) {
      if (!shouldSendRedirect(p.context)) {
        console.log(`🔕 [${p.label}] Bot apagado: aviso ya enviado en las últimas 6 h.`);
        return "skipped";
      }
      if (!(await claimNotice(p.conversationId))) {
        console.log(`🔕 [${p.label}] Bot apagado: aviso ya reservado por otra solicitud.`);
        return "skipped";
      }
    }

    let ok = false;
    try {
      ok = await p.send(buildRedirectMessage(p.redirectPhone));
    } catch (e) {
      console.error(`❌ [${p.label}] Error enviando aviso de redirección:`, e);
    }

    if (!ok) {
      console.error(`❌ [${p.label}] No se pudo enviar el aviso de redirección.`);
      if (hasRow) await releaseNotice(p.conversationId);
      return "failed";
    }

    console.log(`🔕 [${p.label}] Bot apagado: aviso de redirección enviado.`);
    if (hasRow) {
      try {
        await p.saveBotMessage(p.conversationId, buildRedirectMessage(p.redirectPhone));
      } catch (e) {
        console.warn(`⚠️ [${p.label}] No se pudo guardar el aviso en la bandeja:`, e);
      }
    }
    return "sent";
  } catch (e) {
    console.error(`❌ [${p.label}] Error inesperado en el aviso de bot apagado:`, e);
    return "failed";
  }
}
