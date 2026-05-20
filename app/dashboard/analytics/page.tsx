"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { createClient } from "../../../lib/supabase-client";

interface Stats {
  totalConversations: number;
  totalMessages: number;
  activeToday: number;
  salePending: number;
  attended: number;
  saleClosed: number;
  intentBreakdown: { intent: string; count: number }[];
  topProducts: { name: string; count: number }[];
  dailyMessages: { date: string; count: number }[];
}

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

    const [
      { data: convs },
      { data: msgs },
      { data: todayConvs },
      { data: recentMsgs },
    ] = await Promise.all([
      supabase.from("conversations").select("id, status, context"),
      supabase.from("messages").select("id, sender, created_at"),
      supabase.from("conversations").select("id").gte("created_at", todayISO),
      supabase.from("messages").select("created_at").gte("created_at", sevenDaysAgo),
    ]);

    const totalConversations = convs?.length ?? 0;
    const totalMessages      = msgs?.length ?? 0;
    const activeToday        = todayConvs?.length ?? 0;
    const salePending  = convs?.filter((c) => c.status === "sale_pending").length ?? 0;
    const attended     = convs?.filter((c) => c.status === "attended").length ?? 0;
    const saleClosed   = convs?.filter((c) => c.status === "sale_completed").length ?? 0;

    // Intent breakdown from conversations.context
    const intentMap: Record<string, number> = {};
    convs?.forEach((c) => {
      const intent = (c.context as any)?.last_intent;
      if (intent) intentMap[intent] = (intentMap[intent] || 0) + 1;
    });
    const intentBreakdown = Object.entries(intentMap)
      .map(([intent, count]) => ({ intent, count }))
      .sort((a, b) => b.count - a.count);

    // Top products from conversations.context
    const productMap: Record<string, number> = {};
    convs?.forEach((c) => {
      const prods = (c.context as any)?.products_interested as string[] | undefined;
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
    recentMsgs?.forEach((m) => {
      const label = new Date(m.created_at).toLocaleDateString("es-MX", { month: "short", day: "numeric" });
      if (label in dayMap) dayMap[label]++;
    });
    const dailyMessages = Object.entries(dayMap).map(([date, count]) => ({ date, count }));

    setStats({
      totalConversations,
      totalMessages,
      activeToday,
      salePending,
      attended,
      saleClosed,
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
          <div className="crm-stat-number" style={{ color: "#15803d" }}>{stats.activeToday}</div>
          <div className="crm-stat-label">Nuevas hoy</div>
        </div>
        <div className="crm-stat-card">
          <div className="crm-stat-number" style={{ color: "#1d4ed8" }}>{stats.salePending}</div>
          <div className="crm-stat-label">Ventas pendientes</div>
        </div>
        <div className="crm-stat-card">
          <div className="crm-stat-number" style={{ color: "#c2410c" }}>{stats.attended}</div>
          <div className="crm-stat-label">Con admin</div>
        </div>
        <div className="crm-stat-card">
          <div className="crm-stat-number" style={{ color: "#7e22ce" }}>{stats.saleClosed}</div>
          <div className="crm-stat-label">Ventas cerradas</div>
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

        {/* Conversion funnel */}
        <div style={{ background: "white", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", padding: "1.5rem" }}>
          <h3 style={{ fontSize: "1rem", margin: "0 0 1.25rem 0" }}>Embudo de conversión</h3>
          <BarChart
            rows={[
              { label: "Total conversaciones", value: stats.totalConversations, max: stats.totalConversations },
              { label: "Interés detectado", value: stats.salePending + stats.saleClosed + stats.attended, max: stats.totalConversations },
              { label: "Venta pendiente", value: stats.salePending, max: stats.totalConversations },
              { label: "Venta cerrada", value: stats.saleClosed, max: stats.totalConversations },
            ]}
          />
          {stats.totalConversations > 0 && (
            <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "1rem" }}>
              Tasa de cierre:{" "}
              <strong>{Math.round((stats.saleClosed / stats.totalConversations) * 100)}%</strong>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
