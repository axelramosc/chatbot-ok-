"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, useRef } from "react";
import { createClient } from "../../../lib/supabase-client";
import { ChatBubbleLeftRightIcon, QuestionMarkCircleIcon, PaperAirplaneIcon, TrashIcon } from "@heroicons/react/24/outline";
import { useToast } from "../../components/toast";

export default function KnowledgePage() {
  const [activeTab, setActiveTab] = useState<"faqs" | "free">("faqs");
  const [faqs, setFaqs] = useState<any[]>([]);
  const [fragments, setFragments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [newFragmentText, setNewFragmentText] = useState("");
  const [newFragmentTopic, setNewFragmentTopic] = useState("");
  const [savingFragment, setSavingFragment] = useState(false);
  const [savingFaq, setSavingFaq] = useState<string | null>(null);
  const [conflictState, setConflictState] = useState<{
    embedding: number[];
    candidates: Array<{
      source: "fragment" | "faq";
      id: string;
      topic: string | null;
      question: string | null;
      content: string;
      similarity: number;
      is_active: boolean;
    }>;
    decisions: Record<string, "keep" | "deactivate" | "delete">;
  } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const supabase = createClient();

  useEffect(() => {
    if (activeTab === "faqs") fetchFaqs();
    else fetchFragments();
  }, [activeTab]);

  // Sync controlled answer state when FAQs load — preserve any unsaved edits
  useEffect(() => {
    setAnswers((prev) => {
      const next = { ...prev };
      faqs.forEach((f) => {
        if (!(f.id in next)) next[f.id] = f.answer || "";
      });
      return next;
    });
  }, [faqs]);

  const fetchFaqs = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("faqs")
      .select("*")
      .order("is_active", { ascending: true })
      .order("created_at", { ascending: false });

    if (data) setFaqs(data);
    setLoading(false);
  };

  const fetchFragments = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("knowledge_fragments")
      .select("*")
      .order("created_at", { ascending: true });

    if (data) setFragments(data);
    setLoading(false);
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  };

  const handleUpdateFaq = async (id: string, isActive: boolean) => {
    setSavingFaq(id);
    const answer = answers[id] ?? "";
    const { error } = await supabase
      .from("faqs")
      .update({ answer, is_active: isActive })
      .eq("id", id);

    if (error) {
      toast("Error al guardar la respuesta.", "error");
    } else {
      toast(isActive ? "FAQ activada y guardada." : "Borrador guardado.", "success");
      fetchFaqs();
    }
    setSavingFaq(null);
  };

  const persistFragment = async (
    content: string,
    topic: string,
    embedding?: number[],
    decisions: Array<{ source: "fragment" | "faq"; id: string; action: "keep" | "deactivate" | "delete" }> = [],
    supersedesId: string | null = null,
  ) => {
    const res = await fetch("/api/knowledge/save-fragment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content,
        topic: topic || null,
        embedding,
        decisions,
        supersedesId,
      }),
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload?.detail || payload?.error || "save_failed");
    return payload;
  };

  const handleSendFragment = async (e: React.FormEvent) => {
    e.preventDefault();
    const content = newFragmentText.trim();
    if (!content) return;
    const topic = newFragmentTopic.trim();

    setSavingFragment(true);
    try {
      const res = await fetch("/api/knowledge/check-similar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, topic: topic || null }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.detail || payload?.error || "check_failed");

      const candidates = payload.candidates ?? [];
      if (candidates.length > 0) {
        const decisions: Record<string, "keep" | "deactivate" | "delete"> = {};
        for (const c of candidates) decisions[`${c.source}:${c.id}`] = "deactivate";
        setConflictState({ embedding: payload.embedding, candidates, decisions });
        setSavingFragment(false);
        return;
      }

      await persistFragment(content, topic, payload.embedding);
      toast("Ava ha aprendido la nueva información.", "success");
      setNewFragmentText("");
      setNewFragmentTopic("");
      await fetchFragments();
    } catch (err) {
      console.error(err);
      toast("Error al guardar la nota.", "error");
    } finally {
      setSavingFragment(false);
    }
  };

  const confirmConflictResolution = async () => {
    if (!conflictState) return;
    const content = newFragmentText.trim();
    const topic = newFragmentTopic.trim();
    setSavingFragment(true);
    try {
      const decisions = conflictState.candidates.map((c) => ({
        source: c.source,
        id: c.id,
        action: conflictState.decisions[`${c.source}:${c.id}`] ?? "keep",
      }));
      const firstDeactivatedFragment = conflictState.candidates.find(
        (c) => c.source === "fragment" && (conflictState.decisions[`${c.source}:${c.id}`] === "deactivate"),
      );
      await persistFragment(
        content,
        topic,
        conflictState.embedding,
        decisions,
        firstDeactivatedFragment?.id ?? null,
      );
      toast("Conocimiento actualizado y conflictos resueltos.", "success");
      setNewFragmentText("");
      setNewFragmentTopic("");
      setConflictState(null);
      await fetchFragments();
    } catch (err) {
      console.error(err);
      toast("Error al guardar la nota.", "error");
    } finally {
      setSavingFragment(false);
    }
  };

  const setDecision = (key: string, action: "keep" | "deactivate" | "delete") => {
    setConflictState((prev) => (prev ? { ...prev, decisions: { ...prev.decisions, [key]: action } } : prev));
  };

  const deactivateFragment = async (id: string) => {
    await supabase
      .from("knowledge_fragments")
      .update({ is_active: false })
      .eq("id", id);
    toast("Información archivada.", "info");
    fetchFragments();
  };

  return (
    <div style={{ padding: "2rem", overflowY: "auto", height: "100%", display: "flex", flexDirection: "column" }}>
      {conflictState && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setConflictState(null); }}
        >
          <div style={{
            background: "white", borderRadius: "12px", padding: "1.5rem",
            maxWidth: "720px", width: "92%", maxHeight: "85vh", overflowY: "auto",
            boxShadow: "0 10px 40px rgba(0,0,0,0.25)",
          }}>
            <h3 style={{ marginTop: 0, marginBottom: "0.5rem" }}>Posible información contradictoria</h3>
            <p style={{ color: "var(--text-muted)", marginTop: 0 }}>
              Encontramos {conflictState.candidates.length} entrada{conflictState.candidates.length === 1 ? "" : "s"} similar{conflictState.candidates.length === 1 ? "" : "es"} a lo que estás por enseñar. Decide qué hacer con cada una antes de guardar.
            </p>

            <div style={{ background: "#f8f9fa", padding: "0.75rem", borderRadius: "8px", marginBottom: "1rem", fontSize: "0.85rem" }}>
              <strong>Nuevo conocimiento:</strong>
              <p style={{ margin: "0.25rem 0 0 0" }}>{newFragmentText.trim()}</p>
              {newFragmentTopic.trim() && (
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>Tema: {newFragmentTopic.trim()}</div>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {conflictState.candidates.map((c) => {
                const key = `${c.source}:${c.id}`;
                const action = conflictState.decisions[key] ?? "keep";
                return (
                  <div key={key} style={{ border: "1px solid var(--border-color)", borderRadius: "8px", padding: "0.75rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                      <span style={{
                        fontSize: "0.7rem", padding: "2px 8px", borderRadius: "10px",
                        background: c.source === "faq" ? "#e0eaff" : "#dff5e3",
                        color: c.source === "faq" ? "#1d4ed8" : "#166534",
                      }}>
                        {c.source === "faq" ? "FAQ" : "Fragmento"}
                      </span>
                      <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                        Similitud: {(c.similarity * 100).toFixed(0)}%
                      </span>
                    </div>
                    {c.question && <p style={{ margin: "0 0 0.25rem 0", fontWeight: 600 }}>{c.question}</p>}
                    <p style={{ margin: 0, fontSize: "0.9rem" }}>{c.content}</p>
                    {c.topic && <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>Tema: {c.topic}</div>}

                    <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
                      {(["keep", "deactivate", "delete"] as const).map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => setDecision(key, opt)}
                          style={{
                            padding: "4px 10px", fontSize: "0.8rem", borderRadius: "6px",
                            border: "1px solid", borderColor: action === opt ? "var(--primary)" : "var(--border-color)",
                            background: action === opt ? "var(--primary)" : "white",
                            color: action === opt ? "white" : "var(--text-color)",
                          }}
                        >
                          {opt === "keep" && "Mantener activo"}
                          {opt === "deactivate" && "Desactivar (histórico)"}
                          {opt === "delete" && "Eliminar"}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end", marginTop: "1.25rem" }}>
              <button
                type="button"
                onClick={() => setConflictState(null)}
                style={{ background: "var(--text-muted)", color: "white" }}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmConflictResolution}
                disabled={savingFragment}
                style={{ background: "var(--primary)", color: "white" }}
              >
                {savingFragment ? "Guardando..." : "Guardar y aplicar"}
              </button>
            </div>
          </div>
        </div>
      )}
      <div style={{ marginBottom: "2rem" }}>
        <h2 style={{ fontSize: "1.8rem", margin: "0 0 1.5rem 0" }}>Entrenamiento de Ava</h2>

        <div style={{ display: "flex", gap: "1rem", borderBottom: "1px solid var(--border-color)", paddingBottom: "1rem" }}>
          <button
            onClick={() => setActiveTab("faqs")}
            style={{
              background: activeTab === "faqs" ? "var(--primary)" : "transparent",
              color: activeTab === "faqs" ? "white" : "var(--text-color)",
              border: "1px solid", borderColor: activeTab === "faqs" ? "var(--primary)" : "var(--border-color)",
              display: "flex", alignItems: "center", gap: "0.5rem",
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
              display: "flex", alignItems: "center", gap: "0.5rem",
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
                  border: `1px solid ${faq.is_active ? "var(--border-color)" : "#ffb3b3"}`,
                  boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "1rem" }}>
                    <h4 style={{ margin: 0, fontSize: "1.1rem" }}>{faq.question}</h4>
                    <span style={{ background: faq.is_active ? "var(--primary)" : "#dc3545", color: "white", padding: "2px 8px", borderRadius: "12px", fontSize: "0.75rem" }}>
                      {faq.is_active ? "Activa" : "Pendiente"}
                    </span>
                  </div>
                  <textarea
                    value={answers[faq.id] ?? faq.answer ?? ""}
                    placeholder="Escribe la respuesta aquí..."
                    onChange={(e) => setAnswers((prev) => ({ ...prev, [faq.id]: e.target.value }))}
                    style={{ width: "100%", minHeight: "80px", marginBottom: "1rem", padding: "0.75rem", border: "1px solid var(--border-color)", borderRadius: "8px" }}
                  />
                  <div style={{ display: "flex", gap: "1rem", justifyContent: "flex-end" }}>
                    <button
                      style={{ background: "var(--text-muted)" }}
                      disabled={savingFaq === faq.id}
                      onClick={() => handleUpdateFaq(faq.id, false)}
                    >
                      {savingFaq === faq.id ? "Guardando..." : "Guardar Borrador"}
                    </button>
                    <button
                      disabled={savingFaq === faq.id}
                      onClick={() => handleUpdateFaq(faq.id, true)}
                    >
                      {savingFaq === faq.id ? "Guardando..." : "Guardar y Activar"}
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

          <div style={{ flex: 1, overflowY: "auto", padding: "1rem", background: "#f8f9fa", borderRadius: "12px", marginBottom: "1rem", border: "1px solid var(--border-color)" }}>
            {loading ? <p>Cargando memoria...</p> : (
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                {fragments.length === 0 && (
                  <p style={{ textAlign: "center", color: "var(--text-muted)", margin: "2rem 0" }}>
                    Ava aún no tiene notas adicionales.
                  </p>
                )}
                {fragments.map((frag) => (
                  <div key={frag.id} style={{ alignSelf: "flex-end", maxWidth: "80%", opacity: frag.is_active ? 1 : 0.6 }}>
                    <div style={{
                      background: frag.is_active ? "var(--primary)" : "#e9ecef",
                      color: frag.is_active ? "white" : "var(--text-muted)",
                      padding: "1rem", borderRadius: "12px 12px 0 12px",
                      position: "relative",
                      textDecoration: frag.is_active ? "none" : "line-through",
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

          <form onSubmit={handleSendFragment} style={{ display: "flex", gap: "0.5rem", background: "white", padding: "1rem", borderRadius: "12px", border: "1px solid var(--border-color)", boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <input
                type="text"
                placeholder="Tema (Opcional, ej. 'Entregas', 'Stock Lambrin')..."
                value={newFragmentTopic}
                onChange={(e) => setNewFragmentTopic(e.target.value)}
                style={{ width: "100%", padding: "0.5rem", fontSize: "0.85rem", borderBottom: "1px solid #eee", borderRadius: 0, border: "none" }}
              />
              <textarea
                placeholder="Escríbele a Ava lo que quieres que aprenda..."
                value={newFragmentText}
                onChange={(e) => setNewFragmentText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
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
