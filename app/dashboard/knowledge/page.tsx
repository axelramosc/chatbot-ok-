"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, useRef } from "react";
import { createClient } from "../../../lib/supabase-client";
import { ChatBubbleLeftRightIcon, QuestionMarkCircleIcon, PaperAirplaneIcon, TrashIcon } from "@heroicons/react/24/outline";

export default function KnowledgePage() {
  const [activeTab, setActiveTab] = useState<"faqs" | "free">("faqs");
  const [faqs, setFaqs] = useState<any[]>([]);
  const [fragments, setFragments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newFragmentText, setNewFragmentText] = useState("");
  const [newFragmentTopic, setNewFragmentTopic] = useState("");
  const [savingFragment, setSavingFragment] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const supabase = createClient();

  useEffect(() => {
    if (activeTab === "faqs") fetchFaqs();
    else fetchFragments();
  }, [activeTab]);

  const fetchFaqs = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("faqs")
      .select("*")
      .order("is_active", { ascending: true }) // pending first
      .order("created_at", { ascending: false });
      
    if (data) setFaqs(data);
    setLoading(false);
  };

  const fetchFragments = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("knowledge_fragments")
      .select("*")
      .order("created_at", { ascending: true }); // older first like a chat
      
    if (data) setFragments(data);
    setLoading(false);
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  };

  const handleUpdateFaq = async (id: string, answer: string, isActive: boolean) => {
    await supabase
      .from("faqs")
      .update({ answer, is_active: isActive })
      .eq("id", id);
    fetchFaqs();
  };

  const handleSendFragment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFragmentText.trim()) return;

    setSavingFragment(true);
    
    // Deactivate previous fragment if topic is provided
    if (newFragmentTopic.trim()) {
      await supabase
        .from("knowledge_fragments")
        .update({ is_active: false })
        .eq("topic", newFragmentTopic.trim())
        .eq("is_active", true);
    }

    await supabase
      .from("knowledge_fragments")
      .insert({
        content: newFragmentText.trim(),
        topic: newFragmentTopic.trim() || null,
        is_active: true
      });

    setNewFragmentText("");
    setNewFragmentTopic("");
    await fetchFragments();
    setSavingFragment(false);
  };

  const deactivateFragment = async (id: string) => {
    await supabase
      .from("knowledge_fragments")
      .update({ is_active: false })
      .eq("id", id);
    fetchFragments();
  };

  return (
    <div style={{ padding: "2rem", overflowY: "auto", height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ marginBottom: "2rem" }}>
        <h2 style={{ fontSize: "1.8rem", margin: "0 0 1.5rem 0" }}>Entrenamiento de Ava</h2>
        
        <div style={{ display: "flex", gap: "1rem", borderBottom: "1px solid var(--border-color)", paddingBottom: "1rem" }}>
          <button 
            onClick={() => setActiveTab("faqs")}
            style={{ 
              background: activeTab === "faqs" ? "var(--primary)" : "transparent",
              color: activeTab === "faqs" ? "white" : "var(--text-color)",
              border: "1px solid", borderColor: activeTab === "faqs" ? "var(--primary)" : "var(--border-color)",
              display: "flex", alignItems: "center", gap: "0.5rem"
            }}
          >
            <QuestionMarkCircleIcon style={{ width: "18px" }} />
            Preguntas Frecuentes
          </button>
          <button 
            onClick={() => setActiveTab("free")}
            style={{ 
              background: activeTab === "free" ? "var(--primary)" : "transparent",
              color: activeTab === "free" ? "white" : "var(--text-color)",
              border: "1px solid", borderColor: activeTab === "free" ? "var(--primary)" : "var(--border-color)",
              display: "flex", alignItems: "center", gap: "0.5rem"
            }}
          >
            <ChatBubbleLeftRightIcon style={{ width: "18px" }} />
            Enseñar a Ava (Chat)
          </button>
        </div>
      </div>

      {activeTab === "faqs" && (
        <div style={{ flex: 1 }}>
          <p style={{ color: "var(--text-muted)", marginBottom: "2rem" }}>
            Responde a las preguntas pendientes (en rojo) que los clientes han hecho, para que Ava las aprenda.
          </p>
          {loading ? <div>Cargando...</div> : (
            <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              {faqs.map((faq) => (
                <div key={faq.id} style={{ 
                  background: "white", padding: "1.5rem", borderRadius: "8px", 
                  border: `1px solid ${faq.is_active ? 'var(--border-color)' : '#ffb3b3'}`,
                  boxShadow: "0 1px 3px rgba(0,0,0,0.05)"
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "1rem" }}>
                    <h4 style={{ margin: 0, fontSize: "1.1rem" }}>{faq.question}</h4>
                    <span style={{ background: faq.is_active ? 'var(--primary)' : '#dc3545', color: 'white', padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem' }}>
                      {faq.is_active ? 'Activa' : 'Pendiente'}
                    </span>
                  </div>
                  <textarea 
                    defaultValue={faq.answer || ""} placeholder="Escribe la respuesta aquí..."
                    style={{ width: "100%", minHeight: "80px", marginBottom: "1rem" }} id={`answer-${faq.id}`}
                  />
                  <div style={{ display: "flex", gap: "1rem", justifyContent: "flex-end" }}>
                    <button style={{ background: "var(--text-muted)" }} onClick={() => handleUpdateFaq(faq.id, (document.getElementById(`answer-${faq.id}`) as HTMLTextAreaElement).value, false)}>
                      Guardar Borrador
                    </button>
                    <button onClick={() => handleUpdateFaq(faq.id, (document.getElementById(`answer-${faq.id}`) as HTMLTextAreaElement).value, true)}>
                      Guardar y Activar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "free" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", maxWidth: "800px" }}>
          <p style={{ color: "var(--text-muted)", marginBottom: "1rem" }}>
            Platícale a Ava nueva información (ej. "Los pedidos grandes de lambrín tardan 5 días"). Si agregas un "Tema", Ava descartará automáticamente la información vieja sobre ese mismo tema.
          </p>
          
          {/* Chat History */}
          <div style={{ flex: 1, overflowY: "auto", padding: "1rem", background: "#f8f9fa", borderRadius: "12px", marginBottom: "1rem", border: "1px solid var(--border-color)" }}>
            {loading ? <p>Cargando memoria...</p> : (
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                {fragments.length === 0 && <p style={{ textAlign: "center", color: "var(--text-muted)", margin: "2rem 0" }}>Ava aún no tiene notas adicionales.</p>}
                
                {fragments.map(frag => (
                  <div key={frag.id} style={{ 
                    alignSelf: "flex-end", maxWidth: "80%",
                    opacity: frag.is_active ? 1 : 0.6,
                  }}>
                    <div style={{
                      background: frag.is_active ? "var(--primary)" : "#e9ecef",
                      color: frag.is_active ? "white" : "var(--text-muted)",
                      padding: "1rem", borderRadius: "12px 12px 0 12px",
                      position: "relative",
                      textDecoration: frag.is_active ? "none" : "line-through"
                    }}>
                      <p style={{ margin: 0 }}>{frag.content}</p>
                      
                      {frag.topic && (
                        <div style={{ fontSize: "0.7rem", marginTop: "0.5rem", opacity: 0.8 }}>
                          Tema: {frag.topic}
                        </div>
                      )}
                      
                      {frag.is_active && (
                        <button 
                          onClick={() => deactivateFragment(frag.id)}
                          style={{ position: "absolute", top: "-10px", right: "-10px", background: "#dc3545", color: "white", padding: "4px", borderRadius: "50%", width: "24px", height: "24px", display: "flex", alignItems: "center", justifyContent: "center" }}
                          title="Olvidar esta información"
                        >
                          <TrashIcon style={{ width: "14px" }} />
                        </button>
                      )}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", textAlign: "right", marginTop: "4px" }}>
                      {new Date(frag.created_at).toLocaleString()} {frag.is_active ? "" : "(Archivado)"}
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          {/* Input Form */}
          <form onSubmit={handleSendFragment} style={{ display: "flex", gap: "0.5rem", background: "white", padding: "1rem", borderRadius: "12px", border: "1px solid var(--border-color)", boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <input 
                type="text" 
                placeholder="Tema (Opcional, ej. 'Entregas', 'Stock Lambrin')..." 
                value={newFragmentTopic}
                onChange={e => setNewFragmentTopic(e.target.value)}
                style={{ width: "100%", padding: "0.5rem", fontSize: "0.85rem", borderBottom: "1px solid #eee", borderRadius: 0, border: "none" }}
              />
              <textarea 
                placeholder="Escríbele a Ava lo que quieres que aprenda..."
                value={newFragmentText}
                onChange={e => setNewFragmentText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendFragment(e);
                  }
                }}
                style={{ width: "100%", border: "none", resize: "none", outline: "none", minHeight: "50px", padding: "0.5rem" }}
              />
            </div>
            <button 
              type="submit" 
              disabled={savingFragment || !newFragmentText.trim()}
              style={{ background: "var(--primary)", color: "white", padding: "0 1.5rem", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              <PaperAirplaneIcon style={{ width: "24px" }} />
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
