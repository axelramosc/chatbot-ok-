"use client";

import { useEffect, useState, useRef } from "react";
import { createClient } from "../../lib/supabase-client";
import { ChevronLeft, Send, MessageSquare, Paperclip, X } from "lucide-react";
import { useToast } from "../components/toast";

const getInitials = (name: string, phone: string) => {
  if (name) {
    const parts = name.trim().split(" ");
    return parts.length > 1
      ? `${parts[0][0]}${parts[1][0]}`.toUpperCase()
      : parts[0].slice(0, 2).toUpperCase();
  }
  return phone.slice(-2);
};

const STATUS_MAP: Record<string, { bg: string; color: string; label: string }> = {
  active:       { bg: "#dcfce7", color: "#15803d", label: "Bot activo" },
  attended:     { bg: "#fff7ed", color: "#c2410c", label: "Admin" },
  sale_pending: { bg: "#eff6ff", color: "#1d4ed8", label: "Venta pendiente" },
  sale_completed: { bg: "#f0fdf4", color: "#166534", label: "Venta cerrada" },
  closed:       { bg: "#f4f4f5", color: "#71717a", label: "Cerrado" },
};

const CHANNEL_MAP: Record<string, { label: string; color: string; bg: string }> = {
  whatsapp:  { label: "WhatsApp",  color: "#166534", bg: "#dcfce7" },
  messenger: { label: "Messenger", color: "#1d4ed8", bg: "#dbeafe" },
  instagram: { label: "Instagram", color: "#9d174d", bg: "#fce7f3" },
};

// Manual customer status set by staff. Persistent; the bot never overwrites it.
const CUSTOMER_STATUS_OPTIONS: Array<{
  value: "venta" | "avisar_restock" | "cotizacion" | "cerrado" | "distribuidor" | "reabierto";
  label: string;
  bg: string;
  color: string;
  border: string;
  // auto: status set automatically by the system, not manually selectable by staff.
  auto?: boolean;
}> = [
  { value: "venta",          label: "Venta",            bg: "#dcfce7", color: "#15803d", border: "#86efac" },
  { value: "avisar_restock", label: "Avisar restock",   bg: "#fef3c7", color: "#a16207", border: "#fde68a" },
  { value: "cotizacion",     label: "Cotización",       bg: "#dbeafe", color: "#1d4ed8", border: "#bfdbfe" },
  { value: "cerrado",        label: "Cerrado",          bg: "#e4e4e7", color: "#3f3f46", border: "#d4d4d8" },
  { value: "distribuidor",   label: "Distribuidor",     bg: "#ede9fe", color: "#6d28d9", border: "#ddd6fe" },
  { value: "reabierto",      label: "Reabierto",        bg: "#ffedd5", color: "#c2410c", border: "#fed7aa", auto: true },
];

const customerStatusMeta = (value: string | null | undefined) =>
  CUSTOMER_STATUS_OPTIONS.find((o) => o.value === value);

const getStatus = (s: string) =>
  STATUS_MAP[s] ?? { bg: "#f4f4f5", color: "#71717a", label: s };

export default function InboxPage() {
  const [conversations, setConversations] = useState<any[]>([]);
  const [selectedConv, setSelectedConv] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  // Imagen adjunta manual para enviar vía Ava (/ava). Se sube primero y se manda al confirmar.
  const [pendingImage, setPendingImage] = useState<{ url: string; name: string } | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showChat, setShowChat] = useState(false);
  const [search, setSearch] = useState("");
  const toast = useToast();
  const supabase = createClient();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const selectedConvRef = useRef<any>(null);

  // Keep ref in sync so realtime callbacks see current value
  useEffect(() => {
    selectedConvRef.current = selectedConv;
  }, [selectedConv]);

  // Initial load + Realtime subscriptions
  useEffect(() => {
    fetchConversations();

    // Subscribe to all conversation changes
    const convChannel = supabase
      .channel("realtime:conversations")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations" },
        () => { fetchConversations(); }
      )
      .subscribe();

    return () => { supabase.removeChannel(convChannel); };
  }, []);

  // Subscribe to messages for the selected conversation
  useEffect(() => {
    if (!selectedConv) return;

    fetchMessages(selectedConv.id);

    const msgChannel = supabase
      .channel(`realtime:messages:${selectedConv.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${selectedConv.id}`,
        },
        (payload) => {
          setMessages((prev) => {
            // Avoid duplicate if optimistic message already added
            if (prev.some((m) => m.id === payload.new.id)) return prev;
            // Replace matching temp message if content matches
            const tempIdx = prev.findIndex(
              (m) => m.id.startsWith("temp-") && m.content === payload.new.content
            );
            if (tempIdx !== -1) {
              const next = [...prev];
              next[tempIdx] = payload.new;
              return next;
            }
            return [...prev, payload.new];
          });
          setTimeout(scrollToBottom, 100);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(msgChannel); };
  }, [selectedConv?.id]);

  const fetchConversations = async () => {
    const { data } = await supabase
      .from("conversations")
      .select("*")
      .order("updated_at", { ascending: false });
    if (data) setConversations(data);
  };

  const fetchMessages = async (convId: string) => {
    const { data } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", convId)
      .order("created_at", { ascending: true });
    if (data) {
      setMessages(data);
      setTimeout(scrollToBottom, 100);
    }
  };

  const handleSelectConv = (conv: any) => {
    setSelectedConv(conv);
    setShowChat(true);
  };

  const scrollToBottom = () =>
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });

  // Sube una imagen adjunta para enviarla luego vía Ava (/ava). Queda "pendiente"
  // hasta que el usuario confirme el envío con el botón/Enter.
  const handlePickImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = ""; // permite re-seleccionar el mismo archivo
    if (!file || !selectedConv) return;

    if (file.size > 4 * 1024 * 1024) {
      toast("La imagen no puede pesar más de 4 MB.", "error");
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast("Formato no soportado. Usa JPEG, PNG o WEBP.", "error");
      return;
    }

    setUploadingImage(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("conversationId", selectedConv.id);
      const res = await fetch("/api/ava-command/upload", { method: "POST", body: form });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.imageUrl) {
        throw new Error(payload?.detail || payload?.error || "upload_failed");
      }
      setPendingImage({ url: payload.imageUrl, name: file.name });
      toast("Imagen lista. Se enviará al cliente vía Ava.", "success");
    } catch {
      toast("No se pudo subir la imagen.", "error");
    } finally {
      setUploadingImage(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedConv) return;

    const content = inputText.trim();
    const hasImage = !!pendingImage;
    const isAvaCmd = /^\/ava(\s|$)/i.test(content);

    if (!content && !hasImage) return; // nada que enviar

    setSending(true);

    // ── Comando /ava o envío de imagen vía Ava ── orden interna; el cliente NUNCA la ve.
    // No pausa el bot: Ava genera y manda su respuesta al instante.
    if (hasImage || isAvaCmd) {
      // La instrucción es el texto que el equipo escribió. En una foto adjunta puede ir
      // vacía: Ava NO ve la imagen, así que sin texto manda un mensaje neutro sin inventar
      // qué es. Con texto, ese texto es la base obligatoria del mensaje.
      const instruction = isAvaCmd ? content.replace(/^\/ava\s*/i, "").trim() : content;
      if (!instruction && !hasImage) {
        toast("Escribe una instrucción después de /ava, p. ej. /ava manda la foto del Nogal.", "error");
        setSending(false);
        return;
      }
      const imageUrl = pendingImage?.url;
      setInputText("");
      setPendingImage(null);

      // El bot sigue activo (a diferencia de un mensaje normal).
      const activeConv = { ...selectedConv, status: "active" };
      setSelectedConv(activeConv);
      setConversations((prev) => prev.map((c) => (c.id === activeConv.id ? activeConv : c)));

      // Nota interna optimista (debe coincidir con la que arma el backend).
      const noteContent = imageUrl
        ? (instruction ? `[AVA-CMD] 📷 ${instruction}` : `[AVA-CMD] 📷 Foto adjunta enviada al cliente`)
        : `[AVA-CMD] ${instruction}`;
      const optimisticNote = {
        id: `temp-${Date.now()}`,
        conversation_id: selectedConv.id,
        sender: "bot",
        content: noteContent,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, optimisticNote]);
      setTimeout(scrollToBottom, 100);

      try {
        const res = await fetch("/api/ava-command", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversation_id: selectedConv.id, instruction, image_url: imageUrl }),
        });
        if (!res.ok) {
          toast("Ava no pudo procesar la orden.", "error");
          setInputText(content);
        }
      } catch {
        toast("Ava no pudo procesar la orden.", "error");
        setInputText(content);
      } finally {
        setSending(false);
      }
      return;
    }

    setInputText("");

    const updatedConv = { ...selectedConv, status: "attended" };
    setSelectedConv(updatedConv);
    setConversations((prev) =>
      prev.map((c) => (c.id === updatedConv.id ? updatedConv : c))
    );

    const optimisticMsg = {
      id: `temp-${Date.now()}`,
      conversation_id: selectedConv.id,
      sender: "bot",
      content: `[ADMIN] ${content}`,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticMsg]);
    setTimeout(scrollToBottom, 100);

    try {
      const res = await fetch("/api/send-message-v2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: selectedConv.id,
          content,
        }),
      });
      if (!res.ok) {
        toast("Error al enviar el mensaje.", "error");
        setInputText(content);
      }
    } catch {
      toast("Error al enviar el mensaje.", "error");
      setInputText(content);
    } finally {
      setSending(false);
    }
  };

  const handleChangeCustomerStatus = async (
    value: "venta" | "avisar_restock" | "cotizacion" | "cerrado" | "distribuidor" | "reabierto" | "",
  ) => {
    if (!selectedConv) return;
    const nextValue = value === "" ? null : value;
    const updatedConv = { ...selectedConv, customer_status: nextValue };
    setSelectedConv(updatedConv);
    setConversations((prev) =>
      prev.map((c) => (c.id === updatedConv.id ? updatedConv : c)),
    );
    const { error } = await supabase
      .from("conversations")
      .update({ customer_status: nextValue })
      .eq("id", selectedConv.id);
    if (error) {
      toast("No se pudo actualizar el estatus del cliente.", "error");
    } else {
      toast(nextValue ? "Estatus del cliente actualizado." : "Estatus del cliente eliminado.", "success");
    }
  };

  const handleReactivateBot = async () => {
    if (!selectedConv) return;
    const updatedConv = { ...selectedConv, status: "active" };
    setSelectedConv(updatedConv);
    setConversations((prev) =>
      prev.map((c) => (c.id === updatedConv.id ? updatedConv : c))
    );
    const { error } = await supabase
      .from("conversations")
      .update({ status: "active" })
      .eq("id", selectedConv.id);
    if (error) {
      toast("Error al reactivar Ava.", "error");
    } else {
      toast("Ava reactivada con éxito.", "success");
    }
  };

  // KPI calculations
  const kpi = {
    total: conversations.length,
    active: conversations.filter((c) => c.status === "active").length,
    pending: conversations.filter((c) => c.status === "sale_pending").length,
    attended: conversations.filter((c) => c.status === "attended").length,
  };

  const filtered = conversations.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (c.customer_name || "").toLowerCase().includes(q) ||
      c.phone_number.includes(q)
    );
  });

  return (
    <div className="flex h-full w-full">

      {/* ── Conversation list ── */}
      <div className={`crm-conversations-panel ${showChat ? "crm-panel-hidden" : ""}`}>

        {/* Header */}
        <div style={{
          padding: "1rem 1.25rem",
          borderBottom: "1px solid var(--border-color)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "white",
        }}>
          <h3 style={{ fontSize: "0.9375rem", margin: 0 }}>Conversaciones</h3>
          <span style={{
            fontSize: "0.72rem",
            background: "var(--primary-100)",
            color: "var(--primary)",
            borderRadius: "var(--radius-xl)",
            padding: "0.2rem 0.625rem",
            fontWeight: 700,
          }}>
            {filtered.length}
          </span>
        </div>

        {/* KPI strip */}
        <div className="crm-kpi-strip">
          <div className="crm-kpi-card">
            <div className="crm-kpi-number">{kpi.total}</div>
            <div className="crm-kpi-label">Total</div>
          </div>
          <div className="crm-kpi-card">
            <div className="crm-kpi-number" style={{ color: "#15803d" }}>{kpi.active}</div>
            <div className="crm-kpi-label">Ava activa</div>
          </div>
          <div className="crm-kpi-card">
            <div className="crm-kpi-number" style={{ color: "#1d4ed8" }}>{kpi.pending}</div>
            <div className="crm-kpi-label">Venta pend.</div>
          </div>
          <div className="crm-kpi-card">
            <div className="crm-kpi-number" style={{ color: "#c2410c" }}>{kpi.attended}</div>
            <div className="crm-kpi-label">Admin</div>
          </div>
        </div>

        {/* Search */}
        <div className="crm-search-bar">
          <input
            type="text"
            className="crm-search-input"
            placeholder="Buscar por nombre o teléfono..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* List */}
        {filtered.map((conv) => {
          const st = getStatus(conv.status);
          return (
            <div
              key={conv.id}
              className={`crm-conv-item ${selectedConv?.id === conv.id ? "crm-conv-selected" : ""}`}
              onClick={() => handleSelectConv(conv)}
            >
              <div className="crm-conv-avatar">
                {getInitials(conv.customer_name, conv.phone_number)}
              </div>
              <div className="crm-conv-content">
                <div className="crm-conv-header">
                  <span className="crm-conv-name">
                    {conv.customer_name || conv.phone_number}
                  </span>
                  <span className="crm-conv-time">
                    {new Date(conv.updated_at).toLocaleDateString("es-MX", {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </div>
                {conv.customer_name && (
                  <div className="crm-conv-phone">{conv.phone_number}</div>
                )}
                <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
                  <span
                    className="crm-conv-badge"
                    style={{ background: st.bg, color: st.color }}
                  >
                    {st.label}
                  </span>
                  {conv.channel && conv.channel !== "whatsapp" && (() => {
                    const ch = CHANNEL_MAP[conv.channel] ?? { label: conv.channel, color: "#71717a", bg: "#f4f4f5" };
                    return (
                      <span
                        className="crm-conv-badge"
                        style={{ background: ch.bg, color: ch.color }}
                      >
                        {ch.label}
                      </span>
                    );
                  })()}
                  {(() => {
                    const meta = customerStatusMeta(conv.customer_status);
                    if (!meta) return null;
                    return (
                      <span
                        className="crm-conv-badge"
                        style={{ background: meta.bg, color: meta.color }}
                      >
                        {meta.label}
                      </span>
                    );
                  })()}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Chat area ── */}
      <div className={`crm-chat-area ${!showChat ? "crm-panel-hidden" : ""}`}>
        {selectedConv ? (
          <>
            {/* Header */}
            <div className="crm-chat-header">
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", minWidth: 0 }}>
                <button className="crm-back-btn" onClick={() => setShowChat(false)}>
                  <ChevronLeft size={20} />
                </button>
                <div
                  className="crm-conv-avatar"
                  style={{ width: 40, height: 40, fontSize: "0.8rem" }}
                >
                  {getInitials(selectedConv.customer_name, selectedConv.phone_number)}
                </div>
                <div style={{ minWidth: 0 }}>
                  <h3 style={{
                    margin: 0,
                    fontSize: "0.9375rem",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}>
                    {selectedConv.customer_name || selectedConv.phone_number}
                  </h3>
                  {selectedConv.customer_name && (
                    <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "1px" }}>
                      {selectedConv.phone_number}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Status bar */}
            <div className="crm-status-bar" data-status={selectedConv.status}>
              <div className="crm-status-indicator">
                <div className="crm-status-dot" />
                <span className="crm-status-text">
                  {selectedConv.status === "active"
                    ? "Ava está activa"
                    : selectedConv.status === "attended"
                    ? "Admin en control — Ava pausada"
                    : selectedConv.status === "sale_pending"
                    ? "Venta pendiente"
                    : selectedConv.status}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                {(() => {
                  const meta = customerStatusMeta(selectedConv.customer_status);
                  return (
                    <select
                      value={selectedConv.customer_status ?? ""}
                      onChange={(e) => handleChangeCustomerStatus(e.target.value as any)}
                      title="Estatus del cliente (manual)"
                      style={{
                        padding: "0.35rem 0.6rem",
                        borderRadius: "999px",
                        border: `1px solid ${meta?.border ?? "var(--border-color)"}`,
                        background: meta?.bg ?? "white",
                        color: meta?.color ?? "var(--text-muted)",
                        fontSize: "0.78rem",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      <option value="">Sin estatus</option>
                      {CUSTOMER_STATUS_OPTIONS
                        // Auto statuses (e.g. "Reabierto") are set by the system, not
                        // chosen by staff. Only show one if it's the current value so the
                        // dropdown renders its label correctly and staff can switch away.
                        .filter((opt) => !opt.auto || opt.value === selectedConv.customer_status)
                        .map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                    </select>
                  );
                })()}
                {selectedConv.status !== "active" && (
                  <button onClick={handleReactivateBot} className="crm-reactivate-btn">
                    Reactivar Ava
                  </button>
                )}
              </div>
            </div>

            {/* Messages */}
            <div className="crm-chat-messages">
              {messages.map((msg) => {
                const isAvaCmd = msg.sender === "bot" && msg.content.startsWith("[AVA-CMD]");
                const isAdmin = msg.sender === "bot" && msg.content.startsWith("[ADMIN]");
                const isBot   = msg.sender === "bot" && !isAdmin && !isAvaCmd;
                const isUser  = msg.sender === "user";
                const displayContent = isAvaCmd
                  ? msg.content.replace("[AVA-CMD] ", "")
                  : isAdmin
                  ? msg.content.replace("[ADMIN] ", "")
                  : msg.content;
                const bubbleClass = isUser
                  ? "crm-msg-user"
                  : isAvaCmd
                  ? "crm-msg-note"
                  : isAdmin
                  ? "crm-msg-admin"
                  : "crm-msg-bot";
                const senderLabel = isAvaCmd ? "🔒 Orden a Ava" : isAdmin ? "Admin" : isBot ? "Ava" : "Cliente";
                const senderColor = isAvaCmd ? "#7c3aed" : isAdmin ? "#c2410c" : isBot ? "#1565C0" : "#15803d";

                return (
                  <div key={msg.id} className={`crm-msg-bubble ${bubbleClass}`}>
                    <div className="crm-msg-sender" style={{ color: senderColor }}>
                      {senderLabel}
                    </div>
                    <div>{displayContent}</div>
                    <div className="crm-msg-time">
                      {new Date(msg.created_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Input bar */}
            <div className="crm-chat-input-bar">
              {/* Preview de imagen adjunta (se enviará vía Ava). */}
              {pendingImage && (
                <div className="crm-ava-attachment">
                  <img src={pendingImage.url} alt={pendingImage.name} className="crm-ava-attachment-thumb" />
                  <span className="crm-ava-attachment-name">
                    🔒 Se enviará vía Ava: {pendingImage.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPendingImage(null)}
                    className="crm-ava-attachment-remove"
                    title="Quitar imagen"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}
              <form onSubmit={handleSendMessage} className="crm-chat-input-form">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handlePickImage}
                  style={{ display: "none" }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={sending || uploadingImage}
                  className="crm-chat-attach-btn"
                  title="Adjuntar foto para enviar vía Ava"
                >
                  {uploadingImage ? "…" : <Paperclip size={16} />}
                </button>
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder={pendingImage
                    ? "Mensaje opcional para la foto… (Enviar para mandarla vía Ava)"
                    : "Escribe un mensaje… o /ava para darle una orden privada a Ava"}
                  disabled={sending}
                  className="crm-chat-input-field"
                />
                <button
                  type="submit"
                  disabled={(!inputText.trim() && !pendingImage) || sending}
                  className="crm-chat-send-btn"
                >
                  {sending ? "..." : <Send size={15} />}
                </button>
              </form>
            </div>
          </>
        ) : (
          <div className="crm-empty-state">
            <div className="crm-empty-icon">
              <MessageSquare size={26} color="var(--primary)" />
            </div>
            <p style={{ fontSize: "0.9375rem", fontWeight: 500 }}>
              Selecciona una conversación
            </p>
            <p style={{ fontSize: "0.825rem" }}>
              Elige un contacto de la lista para ver el historial
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
