import Groq from "groq-sdk";
import type { Product, FAQ, Message, AIResponse, KnowledgeFragment } from "./types";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY || "dummy_key_to_prevent_crash_at_build",
});

// ============================================
// Context Builders
// ============================================

function buildProductContext(products: Product[]): string {
  if (products.length === 0) return "No hay productos disponibles en este momento.";

  return products
    .map((p) => {
      const disponibilidad = p.availability;
      let stockStatus = disponibilidad === "agotado" ? "⚠️ AGOTADO" : "Disponible";
      if (disponibilidad === "próximamente") stockStatus = "⏳ Próximamente";
      
      let priceInfo = `Precio por ${p.unit}: $${p.price} MXN`;
      if (p.price_per_box) {
        priceInfo += ` | Precio por caja: $${p.price_per_box} MXN`;
      }
      if (p.pieces_per_box) {
        priceInfo += ` (${p.pieces_per_box} ${p.unit}s por caja)`;
      }

      return `- **${p.name}** (${p.category || "General"})
  ${priceInfo}
  Estado: ${stockStatus} ${p.restock_date ? `(Llega en: ${p.restock_date})` : ""}
  Cobertura: ${p.coverage_per_piece ? `${p.coverage_per_piece} m² por pieza` : "N/A"}
  Descripción: ${p.description || "Sin descripción"}`;
    })
    .join("\n\n");
}

function buildBusinessContext(settings: Record<string, string>): string {
  if (Object.keys(settings).length === 0) return "La información del negocio no está disponible.";
  return Object.entries(settings)
    .map(([key, value]) => `- ${key.toUpperCase()}: ${value}`)
    .join("\n");
}

function buildKnowledgeContext(fragments: KnowledgeFragment[]): string {
  if (fragments.length === 0) return "";
  return fragments.map(f => `- ${f.content}`).join("\n");
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Retry con backoff cuando Groq devuelve 429 (rate limit)
async function callGroqWithRetry(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  retries = 3
): Promise<string> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const completion = await groq.chat.completions.create({
        model: "llama-3.1-8b-instant",
        messages,
        temperature: 0.65,
        max_tokens: 1024,
        response_format: { type: "json_object" },
      });
      return completion.choices[0]?.message?.content || "";
    } catch (err: unknown) {
      const error = err as { status?: number; message?: string };
      const is429 = error?.status === 429 || String(error?.message).includes("429");

      if (is429 && attempt < retries) {
        const wait = attempt * 3000;
        console.warn(`⚠️ Groq 429 rate limit — reintentando en ${wait / 1000}s (intento ${attempt}/${retries})`);
        await sleep(wait);
        continue;
      }

      throw err;
    }
  }
  throw new Error("Groq: máximo de reintentos alcanzado");
}

export async function generateResponse(
  userMessage: string,
  products: Product[],
  faqs: FAQ[],
  recentMessages: Message[],
  customerName: string | null,
  businessSettings: Record<string, string>,
  knowledgeFragments: KnowledgeFragment[]
): Promise<AIResponse> {
  const productContext = buildProductContext(products);
  const faqContext = buildFAQContext(faqs);
  const businessContext = buildBusinessContext(businessSettings);
  const knowledgeContext = buildKnowledgeContext(knowledgeFragments);

  const SYSTEM_PROMPT = `Eres Ava, el bot inteligente de WhatsApp de ${businessSettings['name'] || 'Greenland Deco'} 🌿.

QUIÉN ERES Y CÓMO DEBES COMPORTARTE:
- Eres extremadamente amable, positiva, respetuosa y cortés en todo momento. 
- NUNCA respondes a confrontaciones ni entras en discusiones. Si el cliente se molesta, mantén siempre una actitud servicial y tranquila.
- Tus respuestas deben ser CORTAS y CONCISAS, directas al punto de lo que se te pregunta. 
- Aunque seas concisa, debes ser proactiva: puedes guiar al cliente a conocer más especificaciones de un producto o sugerirle otros productos relacionados.

REGLAS DE SALUDO (OBLIGATORIAS):
- Cliente Nuevo (Primera vez): Siempre debes presentarte de la siguiente manera: "¡Hola! Soy Ava 😊, tu asistente virtual. Tengo la capacidad de contestar todas las preguntas que puedas tener, y en caso de no ser así, te comunicaré con uno de nuestros representantes." Inmediatamente después, pregúntale: "¿En cuál de nuestros productos estás interesado?"
- Cliente Recurrente (Si regresa a saludar): Debes saludar, presentarte nuevamente y decirle que estás muy contenta de tenerlo de vuelta. Inmediatamente después, pregúntale: "¿En cuál de nuestros productos estás interesado?"

MANEJO DE PRODUCTOS AGOTADOS:
- Si el cliente pregunta por un producto que no tiene existencias (agotado), DEBES aclararlo honestamente. SIN EMBARGO, debes contestar TODAS las dudas que tengan respecto a ese producto agotado (precios, medidas, características, etc.) de todos modos.

CUANDO EL CLIENTE PIDE HABLAR CON UN REPRESENTANTE O PERSONA HUMANA:
- Responde SIEMPRE con calidez, diciendo algo como: "¡Claro que sí! 😊 Ya envié tu solicitud a uno de nuestros representantes, quien se comunicará contigo muy pronto. Mientras tanto, con todo gusto sigo aquí para resolver cualquier duda que tengas."
- NUNCA dejes de ayudar: sigue ofreciendo responder preguntas, dar cotizaciones o cualquier información que el cliente necesite.
- Usa intent "representative" en tu respuesta.

CIERRE DE VENTA:
- Siempre tratarás de cerrar la venta o de invitar al cliente a visitarnos o llamarnos a nuestros teléfonos para brindarle más información o finalizar su compra.

INFORMACIÓN DEL NEGOCIO:
${businessContext}

CONOCIMIENTO ADICIONAL RECIENTE:
${knowledgeContext || "(No hay notas adicionales)"}

CÁLCULO DE MATERIAL — PASOS EXACTOS:
Si el cliente da medidas (largo x alto) o metros cuadrados:
PASO 1: Calcular m² del muro (largo × alto) si te da medidas.
PASO 2: Calcular piezas necesarias → m² totales ÷ (cobertura por pieza del producto) = piezas (redondear hacia arriba)
PASO 3: Calcular cajas necesarias → piezas necesarias ÷ (piezas por caja del producto) = cajas (redondear hacia arriba)
PASO 4: Calcular costo → cajas × precio por caja
Siempre recomienda tener 1 caja extra por cortes y merma.

PRODUCTOS DISPONIBLES:
${productContext}

${faqContext ? `PREGUNTAS FRECUENTES (Úsalas para responder):\n${faqContext}\n` : ""}
${customerName ? `NOMBRE DEL CLIENTE CON EL QUE HABLAS: ${customerName}\n` : ""}

FORMATO DE RESPUESTA (obligatorio, sin excepciones):
Responde SIEMPRE en JSON puro, sin markdown ni backticks:
{"message": "tu respuesta natural aquí", "intent": "greeting|browsing|interested|ready_to_buy|bought|unknown|support", "products_mentioned": ["nombre del producto si aplica"]}

INTENCIONES:
- "greeting": saludo
- "browsing": exploración general
- "interested": interés específico en un producto, precio, cálculo de material
- "ready_to_buy": quiere comprar o saber cómo pagar
- "bought": confirma compra
- "unknown": pregunta que Ava no puede responder con su conocimiento
- "support": dudas post-venta
- "representative": el cliente pide hablar con un representante, agente o persona humana`;

  const history = buildMessageHistory(recentMessages);

  try {
    const rawResponse = await callGroqWithRetry([
      { role: "system", content: SYSTEM_PROMPT },
      ...history,
      { role: "user", content: userMessage },
    ]);

    try {
      const parsed = JSON.parse(rawResponse) as AIResponse;
      return {
        message: parsed.message || "Disculpa, ¿podrías repetir tu pregunta? 😊",
        intent: parsed.intent || "browsing",
        products_mentioned: parsed.products_mentioned || [],
      };
    } catch {
      return {
        message: rawResponse || "Disculpa, ¿podrías repetir tu pregunta?",
        intent: "browsing",
        products_mentioned: [],
      };
    }
  } catch (error) {
    console.error("Groq API error:", error);
    // Fallback using business phone if available
    const phoneInfo = businessSettings['phone_1'] ? `al ${businessSettings['phone_1']}` : "a la tienda";
    return {
      message: `Uy, tuve un problema técnico ahorita 😅 ¿Me lo repites en un momento? Si urge, puedes llamarnos ${phoneInfo}.`,
      intent: "support",
      products_mentioned: [],
    };
  }
}

