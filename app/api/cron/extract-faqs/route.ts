import { NextResponse } from "next/server";
import { getSupabase } from "../../../../lib/supabase";
import Groq from "groq-sdk";

export async function GET(request: Request) {
  // Verificación de seguridad para Cron Job (Vercel manda un header específico)
  // En local, podemos saltarlo si no hay header, pero en prod es importante.
  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY || "dummy_key_to_prevent_crash_at_build" });

  try {
    // 1. Obtener mensajes de las últimas 24 horas del usuario
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    const supabase = getSupabase();
    const { data: messages, error } = await supabase
      .from("messages")
      .select("content")
      .eq("sender", "user")
      .gte("created_at", twentyFourHoursAgo);

    if (error || !messages || messages.length === 0) {
      return NextResponse.json({ message: "No recent messages found." });
    }

    const messageTexts = messages.map(m => m.content).join("\n");

    // 2. Extraer dudas con Groq AI
    const prompt = `
    A continuación hay una lista de mensajes recibidos de clientes en las últimas 24 horas para una tienda de diseño y acabados interiores (Greenland Deco).
    Tu tarea es analizar los mensajes y extraer un máximo de 5 "Preguntas Frecuentes" o dudas que los clientes tienen, pero que parecen no estar cubiertas en respuestas típicas. 
    Formula las dudas como preguntas claras.
    
    Mensajes:
    ${messageTexts}
    
    Devuelve ÚNICAMENTE un array de strings en formato JSON con las preguntas extraídas. Ejemplo: ["¿Tienen envío a todo el país?", "¿Qué medios de pago aceptan?"].
    Si no hay preguntas relevantes, devuelve [].
    `;

    const chatCompletion = await groq.chat.completions.create({
      messages: [{ role: "system", content: prompt }],
      model: "llama-3.3-70b-versatile",
      temperature: 0.1,
      response_format: { type: "json_object" }
    });

    let extractedFaqs: string[] = [];
    try {
      const result = JSON.parse(chatCompletion.choices[0]?.message?.content || "{}");
      // Manejar el formato de la respuesta, buscando algún array de strings.
      extractedFaqs = Object.values(result).find(val => Array.isArray(val)) as string[] || [];
    } catch (e) {
      console.error("Error parsing Groq response", e);
    }

    if (extractedFaqs.length === 0) {
      return NextResponse.json({ message: "No new FAQs extracted." });
    }

    // 3. Insertar las FAQs en la BD con is_active=false
    const faqsToInsert = extractedFaqs.map(q => ({
      question: q,
      answer: "",
      is_active: false,
      priority: 0,
      category: "automático"
    }));

    // Usamos upsert o ignoramos duplicados si es necesario. Por ahora insertamos.
    await supabase.from("faqs").insert(faqsToInsert);

    return NextResponse.json({ message: "Successfully extracted and inserted new FAQs", count: faqsToInsert.length });
  } catch (err: any) {
    console.error("Cron Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
