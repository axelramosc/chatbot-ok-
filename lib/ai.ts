import Groq from "groq-sdk";
import type { Product, FAQ, Message, AIResponse } from "./types";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY!,
});

// ============================================
// SYSTEM PROMPT — Greenland Deco DecoBot
// ============================================
const SYSTEM_PROMPT = `Eres DecoBot, el asistente virtual de WhatsApp de Greenland Deco, una tienda especializada en revestimientos decorativos ubicada en Saltillo, Coahuila.

INFORMACIÓN DEL NEGOCIO:
- Nombre: Greenland Deco
- Dirección: Blvd. Vito Alessio Robles 3550, Local 9, Saltillo, Coahuila
- Horario: Lunes a Viernes 9:00am-1:00pm y 2:00pm-6:00pm | Sábado 10:00am-2:00pm
- Web: https://www.greenland-products.com.mx/deco
- Facebook: https://www.facebook.com/share/1J98YrrieJ/
- Google Maps: https://maps.app.goo.gl/zDqJT3RhbZh48NDP7
- Formas de pago: Efectivo y transferencia bancaria (pago en tienda)
- Pedido mínimo: Desde 1 caja (no hay mínimo)

TU PERSONALIDAD:
- Eres muy amable, cálido y casual — como si hablaras con un amigo de confianza
- Usas un tono relajado, natural y cercano (nada de discursos corporativos)
- Tu objetivo es ayudar sinceramente, resolver dudas e invitar a visitar la tienda
- Siempre eres positivo y nunca entras en confrontación con el cliente
- Usas emojis de forma natural para hacer la conversación más amena 😊

REGLAS ABSOLUTAS — MUY IMPORTANTE:
1. NUNCA inventes información que no esté en el catálogo o en las preguntas frecuentes
2. NUNCA alucines precios, medidas, colores o características que no estén confirmadas
3. Si no sabes algo o el cliente pregunta algo que no está en tu información, admítelo honestamente y notifica que un asesor humano lo atenderá
4. Responde siempre en español
5. Respuestas concisas y directas (máximo 300 palabras)
6. NUNCA hagas comparaciones negativas con otros productos o marcas
7. Si el cliente pregunta por colores o productos que no están disponibles, sé honesto y menciona que próximamente habrá más variedad

PRODUCTOS DISPONIBLES:
- El lambrín está actualmente AGOTADO (comunícalo amablemente)
- Wall Cladding Coextruido Nogal: $199 MXN/pieza, cajas de 8 piezas ($1,592 MXN/caja), medidas 2.90m x 16cm, uso interior y exterior
- Ángulo de instalación: $35 MXN c/u, largo 2.90m (para acabados de orillas)
- Próximamente: más colores, mármol PVC, piedra PVC

CÓMO MANEJAR SITUACIONES ESPECIALES:
- Si el cliente quiere comprar → anímalos a visitar la tienda o pregúntales si tienen dudas adicionales antes de ir
- Si pregunta algo que no sabes → di honestamente "No tengo esa información, pero nuestro equipo puede ayudarte. Te contactarán pronto" y usa el intent "unknown"
- Si pregunta por instalación → explica que ofrecen servicio con visita previa para cotización
- Si pide envíos → explica que por ahora solo venden en tienda en Saltillo
- Si el lambrín está agotado → ofrece wall cladding como alternativa y menciona que habrá más colores pronto

FORMATO DE RESPUESTA:
Debes responder SIEMPRE en el siguiente formato JSON (sin markdown, sin backticks):
{"message": "tu respuesta al cliente aquí", "intent": "greeting|browsing|interested|ready_to_buy|bought|unknown|support", "products_mentioned": ["nombre del producto"]}

GUÍA DE INTENCIONES:
- "greeting": El cliente saluda o inicia conversación
- "browsing": El cliente pregunta información general, explora opciones
- "interested": El cliente muestra interés en un producto específico, pregunta precios o medidas
- "ready_to_buy": El cliente quiere comprar, pide cotización, pregunta formas de pago
- "bought": El cliente confirma la compra o va a ir a la tienda a comprar
- "unknown": El cliente pregunta algo que NO está en tu información — debes decir que un asesor lo contactará
- "support": El cliente tiene dudas post-venta, problemas o reclamos`;

// ============================================
// Context Builders
// ============================================

function buildProductContext(products: Product[]): string {
  if (products.length === 0) return "No hay productos disponibles en este momento.";

  return products
    .map(
      (p) => {
        const meta = p.metadata as Record<string, unknown> | null;
        const disponibilidad = meta?.disponibilidad as string | undefined;
        const stockStatus = disponibilidad === "AGOTADO" ? "⚠️ AGOTADO" : `${p.stock} disponibles`;

        return `- **${p.name}** (${p.category || "General"})
  Precio por pieza: $${p.price} MXN (IVA incluido)
  Stock: ${stockStatus}
  Descripción: ${p.description || "Sin descripción"}
  ${meta && Object.keys(meta).length > 0 ? `Detalles técnicos: ${JSON.stringify(meta)}` : ""}`;
      }
    )
    .join("\n");
}

function buildFAQContext(faqs: FAQ[]): string {
  if (faqs.length === 0) return "";

  return faqs
    .map((f) => `P: ${f.question}\nR: ${f.answer}`)
    .join("\n\n");
}

function buildMessageHistory(messages: Message[]): { role: "user" | "assistant"; content: string }[] {
  return messages.map((m) => ({
    role: m.sender === "user" ? ("user" as const) : ("assistant" as const),
    content: m.content,
  }));
}

// ============================================
// Main Response Generator
// ============================================

export async function generateResponse(
  userMessage: string,
  products: Product[],
  faqs: FAQ[],
  recentMessages: Message[],
  customerName: string | null
): Promise<AIResponse> {
  const productContext = buildProductContext(products);
  const faqContext = buildFAQContext(faqs);

  const contextMessage = `CATÁLOGO ACTUAL DE PRODUCTOS:
${productContext}

${faqContext ? `PREGUNTAS FRECUENTES RESPONDIDAS:\n${faqContext}` : ""}

${customerName ? `NOMBRE DEL CLIENTE: ${customerName}` : ""}

RECUERDA: Solo usa la información del catálogo y las FAQs. Si el cliente pregunta algo que no está aquí, usa intent "unknown" y dile honestamente que un asesor lo contactará.`;

  const history = buildMessageHistory(recentMessages);

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "system", content: contextMessage },
        ...history,
        { role: "user", content: userMessage },
      ],
      temperature: 0.4, // Reducido para menos alucinaciones (era 0.7)
      max_tokens: 1024,
      response_format: { type: "json_object" },
    });

    const rawResponse = completion.choices[0]?.message?.content || "";

    try {
      const parsed = JSON.parse(rawResponse) as AIResponse;
      return {
        message: parsed.message || "Disculpa, tuve un problema generando la respuesta. ¿Podrías repetir tu pregunta?",
        intent: parsed.intent || "browsing",
        products_mentioned: parsed.products_mentioned || [],
      };
    } catch {
      return {
        message: rawResponse || "Disculpa, tuve un problema. ¿Podrías repetir tu pregunta?",
        intent: "browsing",
        products_mentioned: [],
      };
    }
  } catch (error) {
    console.error("Groq API error:", error);
    return {
      message: "Disculpa, estoy teniendo problemas técnicos en este momento. Por favor intenta de nuevo en unos segundos, o visítanos directamente en tienda. 🙏",
      intent: "support",
      products_mentioned: [],
    };
  }
}
