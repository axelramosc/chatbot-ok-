"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { createClient } from "../../../lib/supabase-client";

// El objetivo de Ava no es vender: es atender al cliente y dejar la
// conversación finalizada. Por eso el pilar es `customer_status = 'cerrado'`
// y no el estado de venta. Los estatus comerciales (venta, cotización,
// distribuidor, restock) son seguimiento del vendedor, no el indicador.
const WINDOW_DAYS = 30;

interface Stats {
  totalConversations: number;
  totalMessages: number;
  activeToday: number;
  finalized: number;        // customer_status = 'cerrado'
  reopened: number;         // cerrada y el cliente volvió a escribir
  unlabeled: number;        // sin estatus asignado
  openConvs: number;        // todo lo que no está finalizado
  windowTotal: number;      // creadas en la ventana
  windowFinalized: number;  // creadas en la ventana y ya finalizadas
  botPaused: number;        // status = 'attended' (un humano tomó el control)
  salePending: number;      // status = 'sale_pending' (lo marca el bot)
  followUp: { label: string; count: number }[];
  intentBreakdown: { intent: string; count: number }[];
  topProducts: { name: string; count: number }[];
  dailyMessages: { date: string; count: number }[];
}

// Estatus manuales del vendedor: seguimiento comercial, informativo.
const FOLLOW_UP_STATUSES: { value: string; label: string }[] = [
  { value: "venta",          label: "Venta" },
  { value: "cotizacion",     label: "Cotización" },
  { value: "distribuidor",   label: "Distribuidor" },
  { value: "avisar_restock", label: "Avisar restock" },
];

const INTENT_LABELS: Record<string, string> = {
  greeting:     "Saludo inicial",
  browsing:     "Exploración general",
  interested:   "Interés en producto",
  ready_to_buy: "Listo para comprar",
  bought:       "Confirmó compra",
  representative: "Pide representante",
  unknown:      "Sin respuesta",
  support:      "Soporte post-venta",
};

interface ConvContextRow {
  context: { last_intent?: string; products_interested?: string[] } | null;
}

interface MsgDateRow {
  created_at: string;
}

/**
 * PostgREST corta cada respuesta en 1000 filas. Al pasar la tabla ese límite,
 * contar con `data.length` dejaba los totales congelados en 1000.
 */
const PAGE_SIZE = 1000;

/** Cuenta en el servidor (head: true) — no transfiere filas. */
async function countRows(query: PromiseLike<{ count: number | null }>): Promise<number> {
  const { count } = await query;
  return count ?? 0;
}

/** Recorre una tabla por páginas de PAGE_SIZE hasta agotarla. */
async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null }>
): Promise<T[]> {
  const rows: T[] = [];
  for (let i = 0; ; i++) {
    const from = i * PAGE_SIZE;
    const { data } = await page(from, from + PAGE_SIZE - 1);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return rows;
}

function BarChart({ rows }: { rows: { label: string; value: number; max: number }[] }) {
  return (
    <div className="crm-bar-chart">
      {rows.map((r) => (
        <div key={r.label} className="crm-bar-row">
          <span className="crm-bar-label" title={r.label}>{r.label}</span>
          <div className="crm-bar-track">
            <div
              className="crm-bar-fill"
              style={{ width: r.max > 0 ? `${Math.round((r.value / r.max) * 100)}%` : "0%" }}
            />
          </div>
          <span className="crm-bar-value">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

export default function AnalyticsPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    loadStats();
  }, []);

  async function loadStats() {
    setLoading(true);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISO = today.toISOString();

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const windowStart = new Date(
      Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();

    const convCount = () =>
      supabase.from("conversations").select("*", { count: "exact", head: true });

    /** Conversaciones con una etiqueta manual del vendedor. */
    const byCustomerStatus = (value: string) =>
      countRows(convCount().eq("customer_status", value));

    /** Conversaciones según el estado del bot (¿Ava responde o está pausada?). */
    const byBotStatus = (value: string) => countRows(convCount().eq("status", value));

    const [
      totalConversations,
      totalMessages,
      activeToday,
      finalized,
      reopened,
      unlabeled,
      windowTotal,
      windowFinalized,
      botPaused,
      salePending,
      followUpCounts,
      convs,
      recentMsgs,
    ] = await Promise.all([
      countRows(convCount()),
      countRows(supabase.from("messages").select("*", { count: "exact", head: true })),
      countRows(convCount().gte("created_at", todayISO)),
      byCustomerStatus("cerrado"),
      byCustomerStatus("reabierto"),
      countRows(convCount().is("customer_status", null)),
      countRows(convCount().gte("created_at", windowStart)),
      countRows(
        convCount().gte("created_at", windowStart).eq("customer_status", "cerrado")
      ),
      byBotStatus("attended"),
      byBotStatus("sale_pending"),
      Promise.all(FOLLOW_UP_STATUSES.map((s) => byCustomerStatus(s.value))),
      fetchAllRows<ConvContextRow>((from, to) =>
        supabase.from("conversations").select("context").order("id").range(from, to)
      ),
      fetchAllRows<MsgDateRow>((from, to) =>
        supabase
          .from("messages")
          .select("created_at")
          .gte("created_at", sevenDaysAgo)
          .order("created_at")
          .range(from, to)
      ),
    ]);

    const openConvs = totalConversations - finalized;
    const followUp = FOLLOW_UP_STATUSES.map((s, i) => ({
      label: s.label,
      count: followUpCounts[i],
    }));

    // Intent breakdown from conversations.context
    const intentMap: Record<string, number> = {};
    convs.forEach((c) => {
      const intent = c.context?.last_intent;
      if (intent) intentMap[intent] = (intentMap[intent] || 0) + 1;
    });
    const intentBreakdown = Object.entries(intentMap)
      .map(([intent, count]) => ({ intent, count }))
      .sort((a, b) => b.count - a.count);

    // Top products from conversations.context
    const productMap: Record<string, number> = {};
    convs.forEach((c) => {
      const prods = c.context?.products_interested;
      prods?.forEach((p) => { productMap[p] = (productMap[p] || 0) + 1; });
    });
    const topProducts = Object.entries(productMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    // Daily messages for past 7 days
    const dayMap: Record<string, number> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      dayMap[d.toLocaleDateString("es-MX", { month: "short", day: "numeric" })] = 0;
    }
    recentMsgs.forEach((m) => {
      const label = new Date(m.created_at).toLocaleDateString("es-MX", { month: "short", day: "numeric" });
      if (label in dayMap) dayMap[label]++;
    });
    const dailyMessages = Object.entries(dayMap).map(([date, count]) => ({ date, count }));

    setStats({
      totalConversations,
      totalMessages,
      activeToday,
      finalized,
      reopened,
      unlabeled,
      openConvs,
      windowTotal,
      windowFinalized,
      botPaused,
      salePending,
      followUp,
      intentBreakdown,
      topProducts,
      dailyMessages,
    });
    setLoading(false);
  }

  if (loading) {
    return (
      <div style={{ padding: "2rem" }}>
        <h2 style={{ fontSize: "1.5rem", marginBottom: "2rem" }}>Analíticas</h2>
        <p style={{ color: "var(--text-muted)" }}>Cargando datos...</p>
      </div>
    );
  }

  if (!stats) return null;

  // Tasa de finalización sobre una ventana móvil: incluir conversaciones
  // abiertas hoy —que aún no pueden estar cerradas— aplanaría el porcentaje.
  const finalizationRate = stats.windowTotal > 0
    ? Math.round((stats.windowFinalized / stats.windowTotal) * 100)
    : 0;

  // De todo lo que alguna vez se dio por terminado, cuánto volvió. Mide si la
  // conversación quedó realmente resuelta.
  const everClosed = stats.finalized + stats.reopened;
  const reopenRate = everClosed > 0
    ? Math.round((stats.reopened / everClosed) * 1000) / 10
    : 0;

  const maxDaily  = Math.max(...stats.dailyMessages.map((d) => d.count), 1);
  const maxIntent = stats.intentBreakdown[0]?.count ?? 1;
  const maxProduct = stats.topProducts[0]?.count ?? 1;

  return (
    <div style={{ padding: "2rem", overflowY: "auto", height: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
        <h2 style={{ fontSize: "1.5rem", margin: 0 }}>Analíticas</h2>
        <button
          onClick={loadStats}
          style={{ background: "var(--primary)", color: "white", padding: "0.5rem 1.25rem", fontSize: "0.85rem" }}
        >
          Actualizar
        </button>
      </div>

      {/* KPI cards */}
      <div className="crm-analytics-grid">
        <div className="crm-stat-card">
          <div className="crm-stat-number">{stats.totalConversations}</div>
          <div className="crm-stat-label">Conversaciones totales</div>
        </div>
        <div className="crm-stat-card">
          <div className="crm-stat-number">{stats.totalMessages}</div>
          <div className="crm-stat-label">Mensajes totales</div>
        </div>
        <div className="crm-stat-card">
          <div className="crm-stat-number" style={{ color: "#15803d" }}>{stats.finalized}</div>
          <div className="crm-stat-label">Conversaciones finalizadas</div>
        </div>
        <div className="crm-stat-card">
          <div className="crm-stat-number" style={{ color: "#15803d" }}>{finalizationRate}%</div>
          <div className="crm-stat-label">Tasa de finalización · {WINDOW_DAYS} días</div>
        </div>
        <div className="crm-stat-card">
          <div className="crm-stat-number" style={{ color: "#1d4ed8" }}>{stats.openConvs}</div>
          <div className="crm-stat-label">Abiertas</div>
        </div>
        <div className="crm-stat-card">
          <div className="crm-stat-number" style={{ color: "#15803d" }}>{stats.activeToday}</div>
          <div className="crm-stat-label">Nuevas hoy</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: "1.5rem" }}>

        {/* Messages per day */}
        <div style={{ background: "white", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", padding: "1.5rem" }}>
          <h3 style={{ fontSize: "1rem", margin: "0 0 1.25rem 0" }}>Mensajes — últimos 7 días</h3>
          <BarChart
            rows={stats.dailyMessages.map((d) => ({
              label: d.date,
              value: d.count,
              max: maxDaily,
            }))}
          />
        </div>

        {/* Intent breakdown */}
        {stats.intentBreakdown.length > 0 && (
          <div style={{ background: "white", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", padding: "1.5rem" }}>
            <h3 style={{ fontSize: "1rem", margin: "0 0 1.25rem 0" }}>Intención del cliente</h3>
            <BarChart
              rows={stats.intentBreakdown.map((i) => ({
                label: INTENT_LABELS[i.intent] ?? i.intent,
                value: i.count,
                max: maxIntent,
              }))}
            />
          </div>
        )}

        {/* Top products */}
        {stats.topProducts.length > 0 && (
          <div style={{ background: "white", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", padding: "1.5rem" }}>
            <h3 style={{ fontSize: "1rem", margin: "0 0 1.25rem 0" }}>Productos más consultados</h3>
            <BarChart
              rows={stats.topProducts.map((p) => ({
                label: p.name,
                value: p.count,
                max: maxProduct,
              }))}
            />
          </div>
        )}

        {/* Estado de las conversaciones — reemplaza al embudo de ventas */}
        <div style={{ background: "white", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", padding: "1.5rem" }}>
          <h3 style={{ fontSize: "1rem", margin: "0 0 1.25rem 0" }}>Estado de las conversaciones</h3>
          <BarChart
            rows={[
              { label: "Total",         value: stats.totalConversations, max: stats.totalConversations },
              { label: "Finalizadas",   value: stats.finalized,          max: stats.totalConversations },
              { label: "Abiertas",      value: stats.openConvs,          max: stats.totalConversations },
              { label: "Reabiertas",    value: stats.reopened,           max: stats.totalConversations },
              { label: "Sin etiquetar", value: stats.unlabeled,          max: stats.totalConversations },
            ]}
          />
          <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "1rem", lineHeight: 1.6 }}>
            Finalizada = el vendedor la marcó como <strong>Cerrado</strong> en la bandeja.
            <br />
            Últimos {WINDOW_DAYS} días:{" "}
            <strong>{stats.windowFinalized}</strong> de <strong>{stats.windowTotal}</strong>{" "}
            conversaciones finalizadas (<strong>{finalizationRate}%</strong>).
          </p>
        </div>

        {/* Reaperturas: calidad de la finalización */}
        <div style={{ background: "white", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", padding: "1.5rem" }}>
          <h3 style={{ fontSize: "1rem", margin: "0 0 1.25rem 0" }}>Calidad del cierre</h3>
          <BarChart
            rows={[
              { label: "Cerradas y sin retorno", value: stats.finalized, max: Math.max(everClosed, 1) },
              { label: "Reabiertas",             value: stats.reopened,  max: Math.max(everClosed, 1) },
            ]}
          />
          <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "1rem", lineHeight: 1.6 }}>
            Tasa de reapertura: <strong>{reopenRate}%</strong>
            <br />
            De las {everClosed} conversaciones que se dieron por terminadas, {stats.reopened}{" "}
            volvieron porque el cliente escribió de nuevo. Entre más baja, mejor resolvió Ava.
          </p>
        </div>

        {/* Seguimiento del vendedor — informativo, no es el indicador del bot */}
        <div style={{ background: "white", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", padding: "1.5rem" }}>
          <h3 style={{ fontSize: "1rem", margin: "0 0 0.35rem 0" }}>Seguimiento del vendedor</h3>
          <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0 0 1.25rem 0" }}>
            Etiquetas comerciales para dar seguimiento. No miden el desempeño del bot.
          </p>
          <BarChart
            rows={[
              ...stats.followUp.map((f) => ({
                label: f.label,
                value: f.count,
                max: Math.max(...stats.followUp.map((x) => x.count), stats.botPaused, stats.salePending, 1),
              })),
              {
                label: "Interés detectado por Ava",
                value: stats.salePending,
                max: Math.max(...stats.followUp.map((x) => x.count), stats.botPaused, stats.salePending, 1),
              },
              {
                label: "Atendidas por un humano",
                value: stats.botPaused,
                max: Math.max(...stats.followUp.map((x) => x.count), stats.botPaused, stats.salePending, 1),
              },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
