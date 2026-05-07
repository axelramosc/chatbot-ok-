import Groq from "groq-sdk";
import type { Product, FAQ, Message, AIResponse } from "./types";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY!,
});

const SYSTEM_PROMPT = `Eres un asesor de ventas profesional, amigable y conocedor de productos de decoración y revestimiento exterior. Trabajas para una empresa que vende lambrín y wall cladding coextruido de alta calidad.

TU PERSONALIDAD:
- Eres cálido, profesional y entusiasta sobre los productos
- Respondes de forma concisa pero completa (máximo 300 palabras)
- Usas un tono conversacional pero profesional
- Nunca inventas información — solo usas los datos del catálogo proporcionado
- Si no sabes algo, lo dices honestamente y ofreces conectar con un asesor humano

TUS RESPONSABILIDADES:
1. Responder preguntas sobre productos (materiales, precios, especificaciones, colores, medidas)
2. Responder preguntas frecuentes sobre instalación, garantía, envíos, etc.
3. Guiar al cliente hacia una compra de forma natural, sin ser agresivo
4. Detectar cuando el cliente está listo para comprar y ofrecer conectarlo con un asesor

REGLAS IMPORTANTES:
- Los precios SIEMPRE se muestran en pesos mexicanos (MXN)
- Si el cliente pregunta por algo que no está en el catálogo, sugiere alternativas disponibles
- Si el cliente quiere comprar o pide cotización formal, indica que un asesor se comunicará con él
- Usa emojis con moderación para hacer la conversación más amigable
- Responde en español siempre

FORMATO DE RESPUESTA:
Debes responder SIEMPRE en el siguiente formato JSON (sin markdown, sin backticks):
{"message": "tu respuesta al cliente aquí", "intent": "greeting|browsing|interested|ready_to_buy|bought|support", "products_mentioned": ["nombre del producto 1"]}

GUÍA DE INTENCIONES:
- "greeting": El cliente saluda o inicia conversación
- "browsing": El cliente pregunta información general, explora opciones
- "interested": El cliente muestra interés en un producto específico, pregunta precios, disponibilidad
- "ready_to_buy": El cliente quiere comprar, pide cotización, pregunta formas de pago, da datos de envío
- "bought": El cliente confirma la compra
- "support": El cliente tiene dudas post-venta, problemas, reclamos`;

function buildProductContext(products: Product[]): string {
  if (products.length === 0) return "No hay productos disponibles en este momento.";

  return products
    .map(
      (p) =>
        `- **${p.name}** (${p.category || "General"})
  Precio: $${p.price} MXN
  Descripción: ${p.description || "Sin descripción"}
  Stock: ${p.stock > 0 ? `${p.stock} disponibles` : "Agotado"}
  ${p.metadata && Object.keys(p.metadata).length > 0 ? `Detalles: ${JSON.stringify(p.metadata)}` : ""}`
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

export async function generateResponse(
  userMessage: string,
  products: Product[],
  faqs: FAQ[],
  recentMessages: Message[],
  customerName: string | null
): Promise<AIResponse> {
  const productContext = buildProductContext(products);
  const faqContext = buildFAQContext(faqs);

  const contextMessage = `CATÁLOGO DE PRODUCTOS DISPONIBLES:
${productContext}

${faqContext ? `PREGUNTAS FRECUENTES:\n${faqContext}` : ""}

${customerName ? `NOMBRE DEL CLIENTE: ${customerName}` : ""}`;

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
      temperature: 0.7,
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
      // If JSON parsing fails, return the raw text
      return {
        message: rawResponse || "Disculpa, tuve un problema. ¿Podrías repetir tu pregunta?",
        intent: "browsing",
        products_mentioned: [],
      };
    }
  } catch (error) {
    console.error("Groq API error:", error);
    return {
      message: "Disculpa, estoy teniendo problemas técnicos en este momento. Por favor intenta de nuevo en unos segundos. 🙏",
      intent: "support",
      products_mentioned: [],
    };
  }
}
