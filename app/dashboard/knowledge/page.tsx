"use client";

import { useEffect, useState } from "react";
import { createClient } from "../../../lib/supabase-client";

export default function KnowledgePage() {
  const [faqs, setFaqs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    fetchFaqs();
  }, []);

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

  const handleUpdateFaq = async (id: string, answer: string, isActive: boolean) => {
    await supabase
      .from("faqs")
      .update({ answer, is_active: isActive })
      .eq("id", id);
    
    fetchFaqs(); // reload
  };

  return (
    <div style={{ padding: "2rem", overflowY: "auto", height: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
        <h2>Entrenamiento de Ava (Knowledge Base)</h2>
        <button onClick={fetchFaqs}>Actualizar</button>
      </div>

      <p style={{ color: "var(--text-muted)", marginBottom: "2rem" }}>
        Aquí aparecen las preguntas frecuentes y las dudas nuevas que Ava ha detectado. 
        Responde a las preguntas pendientes (en rojo) para que Ava las aprenda automáticamente.
      </p>

      {loading ? (
        <div>Cargando conocimiento...</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {faqs.map((faq) => (
            <div key={faq.id} style={{ 
              background: "white", 
              padding: "1.5rem", 
              borderRadius: "8px", 
              border: `1px solid ${faq.is_active ? 'var(--border-color)' : '#ffb3b3'}`,
              boxShadow: "0 1px 3px rgba(0,0,0,0.05)"
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "1rem" }}>
                <h4 style={{ margin: 0, fontSize: "1.1rem" }}>{faq.question}</h4>
                <span style={{ 
                  background: faq.is_active ? 'var(--primary)' : '#dc3545',
                  color: 'white',
                  padding: '2px 8px',
                  borderRadius: '12px',
                  fontSize: '0.75rem'
                }}>
                  {faq.is_active ? 'Activa' : 'Pendiente'}
                </span>
              </div>
              
              <textarea 
                defaultValue={faq.answer || ""}
                placeholder="Escribe la respuesta aquí..."
                style={{ width: "100%", minHeight: "80px", marginBottom: "1rem" }}
                id={`answer-${faq.id}`}
              />
              
              <div style={{ display: "flex", gap: "1rem", justifyContent: "flex-end" }}>
                <button 
                  style={{ background: "var(--text-muted)" }}
                  onClick={() => handleUpdateFaq(faq.id, (document.getElementById(`answer-${faq.id}`) as HTMLTextAreaElement).value, false)}
                >
                  Guardar Borrador
                </button>
                <button 
                  onClick={() => handleUpdateFaq(faq.id, (document.getElementById(`answer-${faq.id}`) as HTMLTextAreaElement).value, true)}
                >
                  Guardar y Activar
                </button>
              </div>
            </div>
          ))}
          {faqs.length === 0 && <div>No hay preguntas registradas.</div>}
        </div>
      )}
    </div>
  );
}
