"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Power, AlertTriangle } from "lucide-react";
import { createClient } from "../../lib/supabase-client";
import { useToast } from "./toast";

/**
 * Interruptor global del bot (CB-001): botón, diálogo de confirmación y banner.
 * Todo el texto se pinta como texto plano de React.
 * La lectura usa la sesión del CRM (RLS solo SELECT); la escritura va SIEMPRE por
 * POST /api/bot-control.
 */

type BotState = "loading" | "on" | "off" | "unknown";

interface BotControlContextValue {
  state: BotState;
  busy: boolean;
  requestToggle: () => void;
  refresh: () => void;
}

const BotControlContext = createContext<BotControlContextValue | null>(null);

const REFRESH_MS = 30_000;

export function BotControlProvider({ children }: { children: React.ReactNode }) {
  const toast = useToast();
  const [supabase] = useState(() => createClient());

  const [state, setState] = useState<BotState>("loading");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<null | "off" | "on">(null);

  const refetch = useCallback(() => {
    supabase
      .from("bot_control")
      .select("enabled")
      .eq("id", 1)
      .maybeSingle()
      .then(
        ({ data, error }) => {
          if (error || !data) setState("unknown");
          else setState(data.enabled === true ? "on" : "off");
        },
        () => setState("unknown")
      );
  }, [supabase]);

  useEffect(() => {
    refetch();

    // En vivo vía Realtime; foco de ventana + sondeo como respaldo.
    const channel = supabase
      .channel("realtime:bot_control")
      .on("postgres_changes", { event: "*", schema: "public", table: "bot_control" }, (payload) => {
        const row = payload.new as { enabled?: unknown } | undefined;
        if (row && typeof row.enabled === "boolean") setState(row.enabled ? "on" : "off");
        else refetch();
      })
      .subscribe();

    const onFocus = () => refetch();
    window.addEventListener("focus", onFocus);
    const timer = setInterval(() => refetch(), REFRESH_MS);

    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [supabase, refetch]);

  const requestToggle = useCallback(() => {
    if (busy || state === "loading") return;
    // "unknown" también se trata como apagado en el servidor (fail-closed): el siguiente paso es encender.
    setConfirming(state === "on" ? "off" : "on");
  }, [busy, state]);

  const applyChange = async () => {
    const target = confirming;
    setConfirming(null);
    if (!target) return;
    const enabled = target === "on";
    setBusy(true);
    try {
      const res = await fetch("/api/bot-control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setState(enabled ? "on" : "off");
      toast(enabled ? "Ava activada: volverá a contestar." : "Ava apagada: los clientes serán redirigidos.", "success");
    } catch {
      // El interruptor vuelve a su valor previo (no se tocó el estado).
      toast("No se pudo cambiar el estado del bot. Intenta de nuevo.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <BotControlContext.Provider value={{ state, busy, requestToggle, refresh: refetch }}>
      {children}
      {confirming && (
        <div className="crm-modal-backdrop" role="presentation" onClick={() => setConfirming(null)}>
          <div
            className="crm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bot-confirm-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="bot-confirm-title" style={{ margin: 0, fontSize: "1.0625rem" }}>
              {confirming === "off" ? "¿Apagar a Ava?" : "¿Encender a Ava?"}
            </h3>
            <p style={{ margin: "0.75rem 0 1.25rem", fontSize: "0.9rem", color: "var(--text-secondary)" }}>
              {confirming === "off"
                ? "Ava dejará de contestar en todos los canales y los clientes serán redirigidos al 844 508 9882."
                : "Ava volverá a contestar a los clientes en todos los canales."}
            </p>
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
              <button type="button" className="crm-modal-cancel" onClick={() => setConfirming(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className={confirming === "off" ? "crm-modal-danger" : "crm-modal-ok"}
                onClick={applyChange}
              >
                {confirming === "off" ? "Apagar bot" : "Encender bot"}
              </button>
            </div>
          </div>
        </div>
      )}
    </BotControlContext.Provider>
  );
}

function useBotControl(): BotControlContextValue {
  const ctx = useContext(BotControlContext);
  if (!ctx) throw new Error("useBotControl must be used inside BotControlProvider");
  return ctx;
}

const LABELS: Record<BotState, string> = {
  loading: "Bot…",
  on: "Bot activo",
  off: "Bot apagado",
  unknown: "Bot: estado desconocido",
};

/** Botón del sidebar (desktop/tablet) o de la barra inferior (móvil). */
export function BotSwitchButton({ variant }: { variant: "sidebar" | "mobile" }) {
  const { state, busy, requestToggle } = useBotControl();
  const label = LABELS[state];
  return (
    <button
      type="button"
      onClick={requestToggle}
      disabled={busy || state === "loading"}
      aria-pressed={state === "on"}
      aria-label={`${label}. Presiona para cambiar.`}
      title={label}
      className={
        (variant === "sidebar" ? "crm-bot-switch" : "crm-mobile-nav-item crm-bot-switch-mobile") +
        ` crm-bot-${state}`
      }
    >
      <Power size={variant === "sidebar" ? 18 : 22} />
      {variant === "sidebar" ? (
        <span className="crm-nav-label">{label}</span>
      ) : (
        <span>{state === "on" ? "Bot ON" : state === "off" ? "Bot OFF" : "Bot"}</span>
      )}
    </button>
  );
}

/** Banner rojo persistente mientras el bot esté apagado. */
export function BotOffBanner() {
  const { state, requestToggle, refresh } = useBotControl();
  if (state !== "off" && state !== "unknown") return null;
  return (
    <div className={`crm-bot-banner ${state === "off" ? "crm-bot-banner-off" : "crm-bot-banner-unknown"}`} role="alert">
      <AlertTriangle size={16} />
      <span>
        {state === "off"
          ? "Ava está APAGADA: los clientes reciben un aviso para comunicarse al 844 508 9882. Los mensajes se siguen guardando aquí."
          : "No se pudo verificar el estado del bot. Si no se puede confirmar, el bot permanece apagado."}
      </span>
      <button type="button" className="crm-bot-banner-btn" onClick={state === "off" ? requestToggle : refresh}>
        {state === "off" ? "Encender" : "Reintentar"}
      </button>
    </div>
  );
}
