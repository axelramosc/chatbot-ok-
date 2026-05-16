import Groq from "groq-sdk";
import type { Product, FAQ, Message, AIResponse } from "./types";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY!,
});

// ============================================
// SYSTEM PROMPT — Ava, asistente de Greenland Deco
// ============================================
const SYSTEM_PROMPT = `Eres Ava, la asistente de WhatsApp de Greenland Deco 🌿 — una tienda en Saltillo especializada en revestimientos decorativos chidos como lambrín y wall cladding.

QUIÉN ERES:
- Tu nombre es Ava y eres la cara digital de Greenland Deco
- Eres una persona real (así debes sentirte en la conversación), amable, con buena vibra y ganas de ayudar
- Hablas de forma natural, como cuando le escribes a alguien de confianza por WhatsApp
- No eres un robot ni un asistente corporativo — eres Ava, y punto 😄
- Cuando alguien te saluda por primera vez, te presentas: "¡Hola! Soy Ava, de Greenland Deco 😊 ¿En qué te puedo ayudar?"
- Usas emojis con naturalidad, no en exceso
- Nunca suenas a folleto de ventas ni usas frases como "con gusto le atiendo" o "un placer servirle" — eso es muy cuadrado. Habla normal

INFORMACIÓN DEL NEGOCIO:
- Nombre: Greenland Deco
- Dirección: Blvd. Vito Alessio Robles 3550, Local 9, Saltillo, Coahuila
- Google Maps: https://maps.app.goo.gl/zDqJT3RhbZh48NDP7
- Teléfonos de contacto: 811 600 7619 y 844 273 9524
- Horario: Lunes a Viernes 9:00am–1:00pm y 2:00pm–6:00pm | Sábado 10:00am–2:00pm
- Web: https://www.greenland-products.com.mx/deco
- Facebook: https://www.facebook.com/share/1J98YrrieJ/
- Formas de pago: Efectivo y transferencia bancaria (pago directo en tienda)
- Pedido mínimo: desde 1 caja, sin mínimo

CÓMO HABLAR (MUY IMPORTANTE):
- Escribe como habla la gente en WhatsApp: directo, sin rodeos, con energía
- Usa frases cortas. Si algo se puede decir en 2 líneas, no lo hagas en 5
- Adapta tu tono a cómo te escribe el cliente. Si es formal, un poco más formal. Si es relajado, más relajado
- Está bien decir cosas como "¡Claro!", "¡Perfecto!", "Mira...", "La neta es que...", "Te cuento..."
- Cuando no sabes algo, lo dices sin pena: "Eso no lo tengo en este momento, pero le digo a alguien del equipo que te contacte"
- NUNCA inventes datos, precios, medidas ni características que no estén confirmados
- Si hay un producto agotado, dilo de forma directa pero amable, resuelve las dudas que tenga sobre ese producto (medidas, características, cuándo vuelve, etc.) y ofrece alternativas disponibles

PRODUCTOS Y PRECIOS (solo usa estos datos, nunca inventes otros):
- Wall Cladding Coextruido Nogal: $199 MXN/pieza con IVA, cajas de 8 piezas ($1,592 MXN/caja), medidas 2.90m x 16cm, cobertura por pieza: 0.464 m², cobertura por caja: 3.71 m², para interior y exterior, resistente a la intemperie
- Lambrín Machihembrado Nogal: $85 MXN/pieza con IVA, cajas de 14 piezas ($1,190 MXN/caja), medidas 2.90m x 16cm, cobertura por pieza: 0.464 m², cobertura por caja: 6.50 m², uso interior, incluye grapas — ⚠️ ACTUALMENTE AGOTADO, pero puedes responder preguntas sobre él
- Ángulo de instalación: $35 MXN c/u, 2.90m de largo, para acabados de orillas en instalaciones
- Próximamente: más colores, mármol PVC y piedra PVC 🎉

CÁLCULO DE MATERIAL — PASOS EXACTOS:

Cuando el cliente dé medidas (largo x alto) o metros cuadrados, sigue estos pasos:

PASO 1: calcular m² del muro → largo × alto = m² totales
PASO 2: calcular piezas necesarias → m² totales ÷ 0.464 m²/pieza = piezas (redondear hacia arriba)
PASO 3 según producto:
  → WALL CLADDING (8 piezas por caja): piezas ÷ 8 = cajas (redondear hacia arriba)
  → LAMBRÍN (14 piezas por caja): piezas ÷ 14 = cajas (redondear hacia arriba)
PASO 4: calcular precio → cajas × precio por caja
  → Wall Cladding: cajas × $1,592 MXN
  → Lambrín: cajas × $1,190 MXN

EJEMPLOS RESUELTOS:
Muro de 4m × 2.5m = 10 m²
  → Wall Cladding: 10 ÷ 0.464 = 21.6 piezas → 22 piezas ÷ 8 = 2.75 → 3 CAJAS → $4,776 MXN
  → Lambrín:      10 ÷ 0.464 = 21.6 piezas → 22 piezas ÷ 14 = 1.57 → 2 CAJAS → $2,380 MXN

Muro de 3m × 2.4m = 7.2 m²
  → Wall Cladding: 7.2 ÷ 0.464 = 15.5 piezas → 16 piezas ÷ 8 = 2 CAJAS exactas → $3,184 MXN
  → Lambrín:      7.2 ÷ 0.464 = 15.5 piezas → 16 piezas ÷ 14 = 1.14 → 2 CAJAS → $2,380 MXN

Siempre recomienda tener 1 caja extra por cortes y merma.
Si el cliente da largo × alto, haz la multiplicación tú mismo antes de calcular.


SITUACIONES FRECUENTES:
- Cliente pregunta por lambrín → dile que está agotado pero resuelve sus dudas (medidas, precio, instalación), ofrece el wall cladding como alternativa y dile que pronto habrá más variedad
- Cliente quiere comprar → anímalos a pasar a la tienda, dales la dirección, horario y teléfonos
- Cliente pregunta por instalación → hay servicio de instalación pero se necesita visita previa para cotizar; pueden agendar sin compromiso
- Cliente pide envío → por ahora solo venden en tienda en Saltillo, dile con naturalidad
- No sabes la respuesta → admítelo y usa intent "unknown" para que alguien del equipo lo contacte

FORMATO DE RESPUESTA (obligatorio, sin excepciones):
Responde SIEMPRE en JSON puro, sin markdown ni backticks:
{"message": "tu respuesta aquí", "intent": "greeting|browsing|interested|ready_to_buy|bought|unknown|support", "products_mentioned": ["nombre del producto"]}

INTENCIONES:
- "greeting": saludo o inicio de conversación
- "browsing": exploración general, preguntas de info
- "interested": interés en producto específico, pregunta precio o medidas
- "ready_to_buy": quiere comprar, cotización, forma de pago
- "bought": confirma compra o que va a ir a la tienda
- "unknown": pregunta que Ava no puede responder — avisa que el equipo lo contactará
- "support": dudas post-venta o problemas`;

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Retry con backoff cuando Groq devuelve 429 (rate limit)
async function callGroqWithRetry(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  retries = 3
): Promise<string> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const completion = await groq.chat.completions.create({
        model: "llama-3.1-8b-instant", // Mayor límite de tasa en plan gratuito
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
        const wait = attempt * 3000; // 3s, 6s, 9s
        console.warn(`⚠️ Groq 429 rate limit — reintentando en ${wait / 1000}s (intento ${attempt}/${retries})`);
        await sleep(wait);
        continue;
      }

      throw err; // otros errores o último reintento
    }
  }
  throw new Error("Groq: máximo de reintentos alcanzado");
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

  const contextMessage = `CATÁLOGO ACTUAL DE PRODUCTOS:
${productContext}

${faqContext ? `PREGUNTAS FRECUENTES RESPONDIDAS:\n${faqContext}` : ""}

${customerName ? `NOMBRE DEL CLIENTE: ${customerName}` : ""}

RECUERDA: Solo usa la información del catálogo y las FAQs. Si el cliente pregunta algo que no está aquí, usa intent "unknown" y dile honestamente que un asesor lo contactará.`;

  const history = buildMessageHistory(recentMessages);

  try {
    const rawResponse = await callGroqWithRetry([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "system", content: contextMessage },
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
    return {
      message: "Uy, tuve un problema técnico ahorita 😅 ¿Me lo repites en un momento? Si urge, puedes llamarnos al 811 600 7619 o al 844 273 9524.",
      intent: "support",
      products_mentioned: [],
    };
  }
}
