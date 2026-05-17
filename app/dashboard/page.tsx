"use client";

import { useEffect, useState, useRef } from "react";
import { createClient } from "../../lib/supabase-client";

export default function InboxPage() {
  const [conversations, setConversations] = useState<any[]>([]);
  const [selectedConv, setSelectedConv] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  const supabase = createClient();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchConversations();
    
    // Polling ("mini pulso") cada 3 segundos
    const intervalId = setInterval(() => {
      fetchConversations();
      if (selectedConv) {
        fetchMessages(selectedConv.id, true);
      }
    }, 3000);

    return () => clearInterval(intervalId);
  }, [selectedConv]);

  const fetchConversations = async () => {
    const { data } = await supabase
      .from("conversations")
      .select("*")
      .order("updated_at", { ascending: false });
    
    if (data) {
      setConversations(data);
    }
  };

  const fetchMessages = async (convId: string, silent = false) => {
    const { data } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", convId)
      .order("created_at", { ascending: true });
      
    if (data) {
      setMessages(prev => {
        // Solo hacer scroll si hay mensajes nuevos y no es el primer render
        if (silent && prev.length > 0 && data.length > prev.length) {
          setTimeout(scrollToBottom, 100);
        }
        return data;
      });
      if (!silent) {
        setTimeout(scrollToBottom, 100);
      }
    }
  };

  const handleSelectConv = (conv: any) => {
    setSelectedConv(conv);
    fetchMessages(conv.id);
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !selectedConv) return;

    setSending(true);
    const content = inputText.trim();
    setInputText("");

    // Update conversation status to attended locally
    const updatedConv = { ...selectedConv, status: 'attended' };
    setSelectedConv(updatedConv);
    setConversations(prev => prev.map(c => c.id === updatedConv.id ? updatedConv : c));

    // Optimistic message update
    const optimisticMsg = {
      id: `temp-${Date.now()}`,
      conversation_id: selectedConv.id,
      sender: "bot",
      content: `[ADMIN] ${content}`,
      created_at: new Date().toISOString()
    };
    setMessages(prev => [...prev, optimisticMsg]);
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
    } catch (error) {
      console.error("Error sending message:", error);
      alert("Error al enviar el mensaje.");
      setInputText(content); // restore text on error
    } finally {
      setSending(false);
    }
  };

  const handleReactivateBot = async () => {
    if (!selectedConv) return;
    
    // Update local state immediately
    const updatedConv = { ...selectedConv, status: 'active' };
    setSelectedConv(updatedConv);
    setConversations(prev => prev.map(c => c.id === updatedConv.id ? updatedConv : c));

    // Update in DB
    const { error } = await supabase
      .from("conversations")
      .update({ status: 'active' })
      .eq("id", selectedConv.id);
      
    if (error) {
      console.error("Error reactivating bot:", error);
      alert("Error al reactivar el bot.");
    }
  };

  return (
    <div className="flex h-full w-full">
      {/* Listado de conversaciones */}
      <div style={{ width: "300px", borderRight: "1px solid var(--border-color)", background: "white", overflowY: "auto" }}>
        <div className="p-4" style={{ borderBottom: "1px solid var(--border-color)" }}>
          <h3 style={{ margin: 0 }}>Conversaciones</h3>
        </div>
        
        {conversations.map((conv) => (
          <div 
            key={conv.id} 
            onClick={() => handleSelectConv(conv)}
            style={{ 
              padding: "1rem", 
              borderBottom: "1px solid var(--border-color)",
              cursor: "pointer",
              background: selectedConv?.id === conv.id ? "var(--chat-bg)" : "white"
            }}
          >
            <div style={{ fontWeight: "bold", marginBottom: "4px" }}>
              {conv.customer_name ? `${conv.customer_name} (${conv.phone_number})` : conv.phone_number}
            </div>
            <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", display: "flex", justifyContent: "space-between" }}>
              <span>{new Date(conv.updated_at).toLocaleDateString()}</span>
              <span style={{ 
                background: conv.status === 'active' ? 'var(--primary)' : 'var(--text-muted)',
                color: 'white',
                padding: '2px 6px',
                borderRadius: '10px',
                fontSize: '0.7rem'
              }}>
                {conv.status}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Área de chat */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "var(--chat-bg)" }}>
        {selectedConv ? (
          <>
            {/* Cabecera del chat */}
            <div style={{ padding: "1rem 1.5rem", background: "white", borderBottom: "1px solid var(--border-color)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <h3 style={{ margin: 0 }}>
                  {selectedConv.customer_name ? `${selectedConv.customer_name} (${selectedConv.phone_number})` : selectedConv.phone_number}
                </h3>
                <div style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                  ID: {selectedConv.id.split('-')[0]}... | Estado: {selectedConv.status}
                </div>
              </div>
              
              {selectedConv.status !== 'active' && (
                <button 
                  onClick={handleReactivateBot}
                  style={{ padding: "0.5rem 1rem", fontSize: "0.85rem", background: "#4FC3F7", color: "white", border: "none", borderRadius: "5px", cursor: "pointer" }}
                >
                  Reactivar Bot (Ava)
                </button>
              )}
            </div>

            {/* Mensajes */}
            <div style={{ flex: 1, overflowY: "auto", padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
              {messages.map((msg) => {
                const isBot = msg.sender === "bot";
                return (
                  <div key={msg.id} style={{ 
                    alignSelf: isBot ? "flex-start" : "flex-end",
                    background: isBot ? "var(--chat-bubble-bot)" : "var(--chat-bubble-user)",
                    padding: "0.75rem 1rem",
                    borderRadius: "8px",
                    maxWidth: "70%",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.1)"
                  }}>
                    <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{msg.content}</div>
                    <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textAlign: "right", marginTop: "4px" }}>
                      {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Input para enviar mensaje */}
            <div style={{ padding: "1rem 1.5rem", background: "white", borderTop: "1px solid var(--border-color)" }}>
              <form onSubmit={handleSendMessage} style={{ display: "flex", gap: "0.5rem" }}>
                <input 
                  type="text" 
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="Escribe un mensaje para tomar el control..."
                  disabled={sending}
                  style={{ flex: 1, padding: "0.75rem", borderRadius: "20px", border: "1px solid var(--border-color)" }}
                />
                <button 
                  type="submit" 
                  disabled={!inputText.trim() || sending}
                  style={{ borderRadius: "20px", padding: "0.75rem 1.5rem" }}
                >
                  {sending ? "..." : "Enviar"}
                </button>
              </form>
            </div>
          </>
        ) : (
          <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center", color: "var(--text-muted)" }}>
            Selecciona una conversación para ver el historial
          </div>
        )}
      </div>
    </div>
  );
}
