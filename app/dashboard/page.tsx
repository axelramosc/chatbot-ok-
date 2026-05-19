"use client";

import { useEffect, useState, useRef } from "react";
import { createClient } from "../../lib/supabase-client";
import { ChevronLeft, Send, MessageSquare } from "lucide-react";

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
};

const getStatus = (s: string) =>
  STATUS_MAP[s] ?? { bg: "#f4f4f5", color: "#71717a", label: s };

export default function InboxPage() {
  const [conversations, setConversations] = useState<any[]>([]);
  const [selectedConv, setSelectedConv] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const supabase = createClient();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchConversations();
    const id = setInterval(() => {
      fetchConversations();
      if (selectedConv) fetchMessages(selectedConv.id, true);
    }, 3000);
    return () => clearInterval(id);
  }, [selectedConv]);

  const fetchConversations = async () => {
    const { data } = await supabase
      .from("conversations")
      .select("*")
      .order("updated_at", { ascending: false });
    if (data) setConversations(data);
  };

  const fetchMessages = async (convId: string, silent = false) => {
    const { data } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", convId)
      .order("created_at", { ascending: true });
    if (data) {
      setMessages((prev) => {
        if (silent && prev.length > 0 && data.length > prev.length)
          setTimeout(scrollToBottom, 100);
        return data;
      });
      if (!silent) setTimeout(scrollToBottom, 100);
    }
  };

  const handleSelectConv = (conv: any) => {
    setSelectedConv(conv);
    fetchMessages(conv.id);
    setShowChat(true);
  };

  const handleBack = () => setShowChat(false);

  const scrollToBottom = () =>
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !selectedConv) return;

    setSending(true);
    const content = inputText.trim();
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
      await fetch("/api/send-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: selectedConv.id,
          phone_number: selectedConv.phone_number,
          content,
        }),
      });
    } catch {
      alert("Error al enviar el mensaje.");
      setInputText(content);
    } finally {
      setSending(false);
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
    if (error) alert("Error al reactivar el bot.");
  };

  return (
    <div className="flex h-full w-full">

      {/* ── Conversation list ── */}
      <div className={`crm-conversations-panel ${showChat ? "crm-panel-hidden" : ""}`}>
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
            {conversations.length}
          </span>
        </div>

        {conversations.map((conv) => {
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
                <span
                  className="crm-conv-badge"
                  style={{ background: st.bg, color: st.color }}
                >
                  {st.label}
                </span>
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
                <button className="crm-back-btn" onClick={handleBack}>
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

            {/* Status bar — always visible */}
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
              {selectedConv.status !== "active" && (
                <button onClick={handleReactivateBot} className="crm-reactivate-btn">
                  Reactivar Ava
                </button>
              )}
            </div>

            {/* Messages */}
            <div className="crm-chat-messages">
              {messages.map((msg) => {
                const isAdmin = msg.sender === "bot" && msg.content.startsWith("[ADMIN]");
                const isBot   = msg.sender === "bot" && !isAdmin;
                const isUser  = msg.sender === "user";
                const displayContent = isAdmin
                  ? msg.content.replace("[ADMIN] ", "")
                  : msg.content;
                const bubbleClass = isUser
                  ? "crm-msg-user"
                  : isAdmin
                  ? "crm-msg-admin"
                  : "crm-msg-bot";
                const senderLabel = isAdmin ? "Admin" : isBot ? "Ava" : "Cliente";
                const senderColor = isAdmin ? "#c2410c" : isBot ? "#1565C0" : "#15803d";

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
              <form onSubmit={handleSendMessage} className="crm-chat-input-form">
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="Escribe un mensaje..."
                  disabled={sending}
                  className="crm-chat-input-field"
                />
                <button
                  type="submit"
                  disabled={!inputText.trim() || sending}
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
