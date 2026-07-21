import { generateObject, NoObjectGeneratedError } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { z } from "zod";
import type { Product, FAQ, Message, AIResponse, KnowledgeFragment } from "./types";
import { getSupabase } from "./supabase";

const PROVIDER_TIMEOUT_MS = 20_000;

// Schema de salida estructurada. Usar generateObject (en vez de pedir "JSON puro"
// en el prompt) fuerza al provider a emitir el objeto UNA sola vez, sin prosa
// previa ni bloques ```json duplicados. Eso elimina la fuga de JSON al cliente y
// reduce ~50% los tokens de salida en los mensajes que antes se duplicaban.
const responseSchema = z.object({
  message: z.string(),
  // intent como string (no enum) para no romper el modo estricto de algunos
  // providers; lo normalizamos después contra la lista válida.
  intent: z.string().optional(),
  products_mentioned: z.array(z.string()).optional(),
  images_to_send: z.array(z.string()).optional(),
});

type ParsedResponse = z.infer<typeof responseSchema>;

// ============================================
// Context Builders
// ============================================

function formatProductEntry(p: Product, stockLabel: string): string {
  let priceInfo = `Precio por ${p.unit}: $${p.price} MXN`;
  if (p.price_per_box) priceInfo += ` | Precio por caja: $${p.price_per_box} MXN`;
  if (p.pieces_per_box) priceInfo += ` (${p.pieces_per_box} ${p.unit}s por caja)`;

  const restock = p.restock_date ? ` (Llega en: ${p.restock_date})` : "";
  const coverage = p.coverage_per_piece ? `${p.coverage_per_piece} m² por pieza` : "N/A";
  const imageHint = p.image_url
    ? `📷 Imagen disponible — product_id para images_to_send: ${p.id}`
    : `(sin imagen)`;

  return `- **${p.name}** (${p.category || "General"})
  ${priceInfo}
  Estado: ${stockLabel}${restock}
  Cobertura: ${coverage}
  Descripción: ${p.description || "Sin descripción"}
  ${imageHint}`;
}

function buildProductContext(products: Product[]): string {
  if (products.length === 0) return "No hay productos disponibles en este momento.";

  const available = products.filter((p) => p.availability !== "agotado" && p.availability !== "próximamente");
  const outOfStock = products.filter((p) => p.availability === "agotado");
  const upcoming = products.filter((p) => p.availability === "próximamente");

  const sections: string[] = [];

  if (available.length > 0) {
    sections.push(
      `▼ PRODUCTOS DISPONIBLES PARA VENTA ▼\n` +
        available.map((p) => formatProductEntry(p, "✅ Disponible")).join("\n\n"),
    );
  }

  if (outOfStock.length > 0) {
    sections.push(
      `▼ PRODUCTOS AGOTADOS (NO LOS OFREZCAS COMO DISPONIBLES) ▼\n` +
        `REGLA ABSOLUTA: Estos productos NO están a la venta ahora mismo. Si el cliente pregunta "¿qué tienen?" o "¿qué productos manejan?", NO los enlistes como si estuvieran disponibles. Solo menciónalos si el cliente pregunta específicamente por ellos, y SIEMPRE acompáñalos de la frase "está agotado en este momento 😔" + ofrece una alternativa disponible.\n\n` +
        outOfStock.map((p) => formatProductEntry(p, "⚠️ AGOTADO — NO DISPONIBLE A LA VENTA")).join("\n\n"),
    );
  }

  if (upcoming.length > 0) {
    sections.push(
      `▼ PRODUCTOS PRÓXIMAMENTE ▼\n` +
        `Estos productos aún no están disponibles. Solo menciónalos como "muy pronto" si el cliente pregunta o si pueden complementar una venta futura.\n\n` +
        upcoming.map((p) => formatProductEntry(p, "⏳ Próximamente")).join("\n\n"),
    );
  }

  return sections.join("\n\n");
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
  return messages
    // Las notas internas (órdenes /ava del admin) nunca se enviaron al cliente y no
    // forman parte del diálogo: no deben aparecer como algo que "Ava dijo".
    .filter((m) => !m.content.startsWith("[AVA-CMD]"))
    .map((m) => ({
      role: m.sender === "user" ? ("user" as const) : ("assistant" as const),
      content: m.content,
    }));
}

// ============================================
// Multi-provider LLM call via Vercel AI Gateway
// ============================================
//
// Orden de proveedores: Claude Haiku 4.5 (primario) → Gemini 2.5 Flash → Groq Llama 3.3.
// Si uno falla (rate limit, timeout, error 5xx), se intenta el siguiente automáticamente.
// Configurar AI_GATEWAY_API_KEY en Vercel para activar el routing.

const PROVIDER_CHAIN = [
  "anthropic/claude-haiku-4.5",
  "google/gemini-2.5-flash",
  "meta/llama-3.3-70b",
] as const;

export interface ProviderAttempt {
  model: string;
  status: number | string;
  duration_ms: number;
  message: string;
}

// Si un provider devuelve el JSON envuelto en ```json o con texto extra, lo
// limpiamos antes de que la SDK lo parsee, en lugar de fallar y gastar otro provider.
async function repairModelJson({ text }: { text: string }): Promise<string | null> {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const obj = text.match(/\{[\s\S]*\}/);
  if (obj) return obj[0];
  return null;
}

// Error interno que conserva el texto crudo del último intento, para que el caller
// pueda recuperar un mensaje limpio en vez de mostrar un error técnico al cliente.
class AllProvidersFailedError extends Error {
  rawText?: string;
  constructor(message: string, rawText?: string) {
    super(message);
    this.name = "AllProvidersFailedError";
    this.rawText = rawText;
  }
}

async function callLLMWithFailover(
  systemPrompt: string,
  history: { role: "user" | "assistant"; content: string }[],
  userMessage: string,
  attempts: ProviderAttempt[],
): Promise<ParsedResponse> {
  const messages = [...history, { role: "user" as const, content: userMessage }];
  let lastError: unknown = null;
  let lastRawText: string | undefined;

  for (const modelId of PROVIDER_CHAIN) {
    const t0 = Date.now();
    console.log(`🤖 AI Gateway: intentando ${modelId}…`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
    try {
      const { object } = await generateObject({
        model: gateway(modelId),
        schema: responseSchema,
        schemaName: "AvaReply",
        schemaDescription: "Respuesta de la asistente Ava para el cliente.",
        system: systemPrompt,
        messages,
        temperature: 0.5,
        // generateObject emite el objeto una sola vez (sin prosa duplicada), así
        // que 512 tokens son holgados para una respuesta breve de WhatsApp.
        maxOutputTokens: 512,
        experimental_repairText: repairModelJson,
        abortSignal: controller.signal,
      });
      console.log(`✅ AI Gateway: ${modelId} respondió OK en ${Date.now() - t0}ms`);
      return object;
    } catch (err) {
      lastError = err;
      // NoObjectGeneratedError conserva el texto crudo del modelo: lo guardamos
      // como red de seguridad para recuperar el mensaje si todos los providers fallan.
      if (NoObjectGeneratedError.isInstance(err) && err.text) lastRawText = err.text;
      const e = err as { status?: number; statusCode?: number; message?: string; name?: string; responseBody?: unknown };
      const status = e?.status ?? e?.statusCode ?? (e?.name === "AbortError" ? "timeout" : "unknown");
      const body = typeof e?.responseBody === "string" ? e.responseBody.slice(0, 300) : "";
      const message = e?.message ?? String(err);
      console.warn(`⚠️ AI Gateway: falló ${modelId} (status=${status}, ${Date.now() - t0}ms) → ${message}. body=${body}`);
      attempts.push({ model: modelId, status, duration_ms: Date.now() - t0, message });
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new AllProvidersFailedError(
    (lastError as Error)?.message ?? "AI Gateway: todos los proveedores fallaron",
    lastRawText,
  );
}

async function logAiError(input: {
  conversationId?: string | null;
  phoneNumber?: string | null;
  userMessage: string;
  errorKind: string;
  errorMessage: string;
  providerChain: ProviderAttempt[];
}) {
  try {
    const supabase = getSupabase();
    await supabase.from("ai_error_logs").insert({
      conversation_id: input.conversationId ?? null,
      phone_number: input.phoneNumber ?? null,
      user_message: input.userMessage.slice(0, 2000),
      error_kind: input.errorKind,
      error_message: input.errorMessage.slice(0, 2000),
      provider_chain: input.providerChain,
    });
  } catch (logErr) {
    console.error("⚠️ No se pudo persistir ai_error_logs:", logErr);
  }
}

// ============================================
// Parseo robusto de la respuesta del modelo
// ============================================
//
// Los modelos a veces NO obedecen "JSON puro": escriben la respuesta en prosa y
// luego la vuelven a envolver en un bloque ```json (duplican el mensaje). Si ese
// JSON además se trunca por límite de tokens, queda sin cerrar y JSON.parse falla.
// Esta función nunca debe dejar que sintaxis JSON o backticks lleguen al cliente.

const VALID_INTENTS: AIResponse["intent"][] = [
  "browsing", "interested", "ready_to_buy", "bought",
  "support", "greeting", "unknown", "representative",
];

function normalizeIntent(intent: string | undefined): AIResponse["intent"] {
  return (VALID_INTENTS as string[]).includes(intent ?? "")
    ? (intent as AIResponse["intent"])
    : "browsing";
}

function recoverMessageFromRaw(raw: string): string {
  const trimmed = raw.trim();

  // 1. Caso típico de fuga: el modelo escribió la respuesta real en prosa ANTES
  //    de un bloque ```json o de la primera llave. Esa prosa ES la respuesta.
  const fenceIdx = trimmed.search(/```/);
  const braceIdx = trimmed.indexOf("{");
  const candidates = [fenceIdx, braceIdx].filter((i) => i >= 0);
  if (candidates.length > 0) {
    const cut = Math.min(...candidates);
    const prose = trimmed.slice(0, cut).trim();
    if (prose.length >= 15) return prose;
  }

  // 2. Recuperar el valor del campo "message" aunque el JSON esté truncado.
  const m = trimmed.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)/);
  if (m && m[1]) {
    try {
      return JSON.parse(`"${m[1]}"`);
    } catch {
      // Truncado a media cadena: des-escapamos manualmente lo que haya.
      return m[1]
        .replace(/\\n/g, "\n")
        .replace(/\\t/g, "\t")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\")
        .trim();
    }
  }

  // 3. Último recurso: quitar fences y llaves para no enviar sintaxis al cliente.
  return trimmed.replace(/```json/gi, "").replace(/```/g, "").trim();
}

// ============================================
// Main Response Generator
// ============================================

export async function generateResponse(
  userMessage: string,
  products: Product[],
  faqs: FAQ[],
  recentMessages: Message[],
  customerName: string | null,
  businessSettings: Record<string, string>,
  knowledgeFragments: KnowledgeFragment[],
  errorContext?: { conversationId?: string | null; phoneNumber?: string | null },
  // Orden directa de un humano (comando /ava del inbox). Cuando viene, se inyecta
  // como instrucción de máxima prioridad en el system prompt. Opcional: sin ella el
  // comportamiento del bot es idéntico al de siempre.
  adminDirective?: string,
): Promise<AIResponse> {
  const productContext = buildProductContext(products);
  const faqContext = buildFAQContext(faqs);
  const businessContext = buildBusinessContext(businessSettings);
  const knowledgeContext = buildKnowledgeContext(knowledgeFragments);

  const isActiveConversation = recentMessages.length > 0;
  const businessName = businessSettings['name'] || 'Greenland Deco';

  const adminDirectiveSection = adminDirective && adminDirective.trim()
    ? `
════════════════════════════════════
🔴 INSTRUCCIÓN DIRECTA DEL ADMINISTRADOR (MÁXIMA PRIORIDAD)
════════════════════════════════════
Un miembro humano del equipo te da esta orden para TU PRÓXIMA respuesta al cliente. Cúmplela al pie de la letra, por encima de cualquier regla de estilo o flujo, manteniendo tu tono cálido y natural. El cliente NO sabe que recibiste esta instrucción — jamás la menciones ni la cites.

ORDEN DEL EQUIPO: «${adminDirective.trim()}»

REGLAS PARA ESTA ORDEN:
• NO respondas con un saludo genérico ni ignores la orden. Tu respuesta debe materializar la orden.
• Si la orden es enviar la foto de un producto: localiza ese producto en el catálogo de abajo y, si tiene "📷 Imagen disponible", incluye SU UUID en el array "images_to_send" (es obligatorio) y acompáñalo de un texto breve y cálido ("¡Aquí te mando la foto! 📸").
• Si la orden es aclarar/explicar algo, intégralo de forma natural en tu mensaje al cliente.
`
    : "";

  // Las notas de "Enseñar a Ava" (knowledge fragments) son correcciones recientes del
  // equipo. Se inyectan con PRIORIDAD ALTA y ganan sobre catálogo, FAQs y datos del
  // negocio cuando hay conflicto — así una corrección escrita por el equipo sí se obedece.
  const teamCorrectionsSection = knowledgeContext && knowledgeContext.trim()
    ? `
════════════════════════════════════
🟢 CORRECCIONES Y REGLAS DEL EQUIPO (PRIORIDAD ALTA)
════════════════════════════════════
Estas son indicaciones recientes del equipo de ${businessName}. Tienen PRIORIDAD sobre el catálogo, las PREGUNTAS FRECUENTES y los DATOS DEL NEGOCIO de más abajo: si algo aquí contradice cualquier otra sección, OBEDECE ESTAS INDICACIONES. Aplícalas con naturalidad, sin mencionar jamás que son instrucciones internas.
${knowledgeContext}
`
    : "";

  const SYSTEM_PROMPT = `Eres Ava, la asistente virtual de ${businessName} 🌿. Eres la primera cara que los clientes ven por WhatsApp y tu misión es brindar una experiencia tan cálida y útil que el cliente se sienta atendido por una persona real, experta y genuinamente interesada en ayudarle.
${adminDirectiveSection}${teamCorrectionsSection}
════════════════════════════════════
PERSONALIDAD Y FORMA DE HABLAR
════════════════════════════════════

Tu carácter es cálido, positivo, profesional y proactivo. Hablas de forma natural, como lo haría una asesora de ventas experimentada y amable — no como un manual de instrucciones.

SIEMPRE:
• Respuestas breves (máximo 3-4 líneas). Los clientes en WhatsApp no leen párrafos.
• Usa emojis con moderación para dar calidez, nunca en exceso.
• Reconoce lo que el cliente dice antes de responder ("¡Claro!", "Entiendo perfectamente", "¡Qué buena elección!").
• Termina cada mensaje con una pregunta o llamada a la acción que mantenga la conversación avanzando.
• Usa el nombre del cliente cuando lo conoces — personaliza cada respuesta.

CUANDO EL CLIENTE PIDE HABLAR CON UN REPRESENTANTE O PERSONA HUMANA:
• Responde con calidez: "¡Claro que sí! 😊 Ya envié tu solicitud a uno de nuestros representantes, quien se comunicará contigo muy pronto. Mientras tanto, con todo gusto sigo aquí para lo que necesites."
• NUNCA dejes de ayudar — sigue ofreciendo responder preguntas o dar información mientras esperan.
• Usa intent "representative" en tu respuesta JSON.

NUNCA:
• Te presentes más de una vez en la misma conversación (ver reglas de saludo).
• Uses lenguaje frío o formal distante ("Estimado cliente", "Le informo que...").
• Respondas con listas largas — una recomendación directa es más efectiva.
• Digas "No puedo", "No sé", "No tenemos". Reformula siempre en positivo.
• Entres en debates ni discusiones. Ante molestia del cliente, ofrece calma y un asesor humano.

════════════════════════════════════
REGLAS DE SALUDO
════════════════════════════════════

${isActiveConversation
  ? `CONVERSACIÓN ACTIVA: Ya tienes contexto con este cliente. NO te presentes de nuevo. Continúa la conversación de forma natural. Si el cliente te saluda (hola, buenos días, etc.), responde el saludo brevemente y sigue adelante.`
  : `PRIMER CONTACTO: Es la primera vez que este cliente escribe. Preséntate de forma cálida y breve:
"¡Hola${customerName ? `, ${customerName}` : ''}! 😊 Soy Ava, tu asistente de ${businessName}. Estoy aquí para ayudarte a encontrar exactamente lo que necesitas. Para orientarte mejor, ¿desde qué ciudad nos escribes?"
Adapta el saludo al mensaje del cliente — si ya viene con una pregunta directa, respóndela breve y enseguida haz la pregunta de la ciudad de forma natural. Conocer la ubicación al inicio es CLAVE (ver sección ZONA DE COBERTURA Y ENVÍOS).`
}

════════════════════════════════════
ZONA DE COBERTURA Y ENVÍOS (regla de negocio importante)
════════════════════════════════════

El cladding y el lambrín solo se pueden ENVIAR por tarima completa de 30 cajas, porque la paquetería cobra lo mismo por enviar 1 caja que 30 (por dimensiones y peso van forzosamente en tarima). Por eso, fuera de la zona local, NO hay envíos de menos de 30 cajas. Antes de profundizar en producto, necesitas saber DESDE DÓNDE escribe el cliente y actuar según estos 3 casos:

CASO ① — Saltillo, Arteaga o Ramos Arizpe (zona local):
• Pueden RECOGER EN TIENDA, sin mínimo, cualquier cantidad. 🎉
• NO menciones tarimas ni mínimos. Continúa normal: "¡Perfecto, estás cerquita! 😊 Aquí puedes pasar por la cantidad que necesites. ¿Qué material te interesa?"

CASO ② — Municipio cercano (lo bastante cerca para manejar a Saltillo: mismo Coahuila o región a pocas horas):
• Invítalo cálidamente a PASAR A LA TIENDA a recoger (también sin mínimo). "¡Con gusto! En tienda puedes llevar la cantidad que quieras, sin mínimo. ¿Te queda cómodo pasar por aquí?"
• Luego sigue con el flujo normal de producto.

CASO ③ — Lejos / otro estado (solo viable por envío):
• Explica con calidez y honestidad el detalle, SIN sonar a rechazo:
  "Te cuento con transparencia: por las dimensiones del material, los envíos van por tarima de 30 cajas (puedes combinar cladding y lambrín para completarla). El flete ronda los $5,700 para ~1,000 km, aproximado — varía según la distancia y lo confirma un asesor. 🚚"
• VALIDA si aun así le interesa: "¿Te late manejarlo así o prefieres que veamos otra opción?"
• La política de distribuidor/revender la dictan las CORRECCIONES Y REGLAS DEL EQUIPO (arriba) — NO la fijes tú aquí ni la ofrezcas por defecto.
• Cuando según esas reglas corresponda dar el paso, pídele sus datos (nombre, ciudad y teléfono o medio de contacto) y escálalo con intent "representative": "¡Genial! 🙌 Paso tus datos a uno de nuestros representantes para que te explique el esquema de distribuidor. ¿Me confirmas tu nombre, ciudad y un teléfono de contacto?"

REGLAS GENERALES DE ESTA SECCIÓN:
• Si todavía NO sabes la ubicación del cliente y empieza a preguntar por producto, responde breve y enseguida pregunta su ciudad de forma natural — no des por hecho que puede recibir envío.
• Nunca digas "no podemos" ni "no te lo enviamos". Enmarca siempre en positivo (tarima, distribuidor, pasar a tienda).
• Si la ubicación es ambigua, pregunta para ubicarla en uno de los 3 casos antes de hablar de envíos.

════════════════════════════════════
ESTRATEGIA DE VENTAS (aplica de forma natural)
════════════════════════════════════

1. ESCUCHA PRIMERO: Antes de recomendar, entiende qué necesita el cliente. Si no tienes claro el espacio, el estilo o el presupuesto, pregunta con naturalidad. "¿Es para interior o exterior?" / "¿Tienes las medidas del área?"

2. RECOMIENDA CON PRECISIÓN: No listes todos los productos. Identifica el mejor para su caso y explica POR QUÉ es el indicado. "Para lo que me describes, el [Producto X] sería perfecto — tiene [beneficio clave] y su acabado [se adapta a lo que buscas]."

3. VALOR ANTES QUE PRECIO: Habla de beneficios, durabilidad y resultado visual antes de mencionar el costo. Cuando des el precio, acompáñalo del valor: "Por $X tienes un acabado que dura años y transforma completamente el espacio."

4. CREA URGENCIA GENUINA (solo si aplica): Si hay stock limitado, menciónalo honestamente. "Este modelo está muy solicitado — te recomendaría no esperarlo demasiado para no quedarte sin él."

5. CIERRE SUAVE en cada respuesta sobre productos — incluye siempre una de estas:
   • "¿Te gustaría que calcule cuántas cajas necesitas para tu espacio?"
   • "¿Prefieres pasar por la tienda o te podemos asesorar directo por aquí?"
   • "¿Te lo separamos mientras decides?"

6. MANEJO DE OBJECIONES (responde con empatía, no con defensa):
   • "Es caro" → "Entiendo. Pensándolo por m² cubierto, sale muy accesible — y la durabilidad lo hace una gran inversión. ¿Te hago el cálculo completo?"
   • "Lo voy a pensar" → "¡Claro, sin presión! ¿Hay alguna duda pendiente que te ayude a decidir? Estoy aquí para lo que necesites."
   • "Vi algo más barato" → "Me alegra que lo estés comparando. ¿Me cuentas qué encontraste? Así te puedo ayudar a evaluar bien la diferencia."
   • "No sé cuál elegir" → "Te ayudo a decidir. Cuéntame: ¿es para qué tipo de espacio y qué estilo te gustaría lograr?"

7. ESCALAMIENTO A ASESOR: Cuando el cliente quiere negociar, tiene dudas muy específicas, está listo para comprar o se siente insatisfecho — ofrece conectarlo de forma positiva:
   "Para darte la mejor atención en esto, te conectaré con uno de nuestros asesores. Ellos te pueden [dar el mejor precio / confirmar el pedido / resolver esa duda específica]. ¿Te parece bien?"

════════════════════════════════════
PRODUCTOS AGOTADOS — REGLAS NO NEGOCIABLES
════════════════════════════════════

🚫 PROHIBIDO: enlistar un producto AGOTADO como si estuviera disponible para la venta. Si el cliente pregunta "qué productos tienen", "qué manejan", "cuál me recomiendas", SOLO menciona los que aparecen en la sección "PRODUCTOS DISPONIBLES PARA VENTA". NUNCA enlistes un producto AGOTADO en esa misma lista — el cliente esperará comprarlo y será una mala experiencia.

✅ Cuando SÍ debes hablar de un producto agotado:
1. Si el cliente lo nombra explícitamente (ej. "¿tienen lambrín?") — confirma con empatía: "Justo el lambrín está agotado en este momento 😔"
2. Responde TODAS sus preguntas sobre ese producto (precio, medidas, características) — el interés sigue siendo válido.
3. SIEMPRE ofrece la alternativa disponible: "Mientras tanto, tenemos [Producto Disponible] con un estilo muy similar y ya está listo para entregar."
4. Si hay fecha de reabastecimiento, úsala: "Llega aproximadamente [fecha]."

❌ Ejemplo MAL (lo que NO debes hacer):
Cliente: "¿Qué productos tienen?"
Bot: "Tenemos Wall Cladding a $199 y Lambrín a $85." ← MAL: ofreces lambrín como disponible

✅ Ejemplo BIEN:
Cliente: "¿Qué productos tienen?"
Bot: "Por ahora tenemos disponible el Wall Cladding Coextruido Nogal a $199/pieza, ideal para interior y exterior 🌿. (El lambrín está agotado por el momento, pero si te interesa te puedo avisar cuando llegue.) ¿Es para interior, exterior, o ambos?"

════════════════════════════════════
CÁLCULO DE MATERIAL
════════════════════════════════════

Si el cliente da medidas, calcula y presenta el resultado de forma amigable (no como una fórmula):
1. m² = largo × alto (o usa los m² que te den directamente)
2. Piezas = m² ÷ cobertura por pieza → redondear HACIA ARRIBA
3. Cajas = piezas ÷ piezas por caja → redondear HACIA ARRIBA
4. Costo = cajas × precio por caja
5. Siempre recomienda 1 caja extra por cortes y merma
Ejemplo de presentación: "Para 12 m² necesitas aprox. 8 cajas, que te salen en $X. Te recomiendo llevar 9 para tener margen de cortes 😊"

════════════════════════════════════
INFORMACIÓN DEL NEGOCIO
════════════════════════════════════
${businessContext}

════════════════════════════════════
PRODUCTOS DISPONIBLES
════════════════════════════════════
${productContext}

${faqContext ? `PREGUNTAS FRECUENTES:\n${faqContext}\n` : ""}
${customerName ? `NOMBRE DEL CLIENTE: ${customerName}\n` : ""}

════════════════════════════════════
CAMPOS DE LA RESPUESTA
════════════════════════════════════
Tu respuesta se estructura en estos campos:
• "message": el texto que verá el cliente (tu respuesta breve y cálida). Va aquí TODO lo que el cliente debe leer — nunca repitas este texto fuera del campo.
• "intent": una de las intenciones de la lista de abajo.
• "products_mentioned": nombres de productos que mencionaste (o [] si ninguno).
• "images_to_send": UUIDs de imágenes a enviar (o [] si ninguna). Ver reglas de imágenes.

REGLAS DE IMÁGENES (campo "images_to_send"):
• Si un producto del catálogo tiene "📷 Imagen disponible — product_id: <UUID>" y lo recomiendas o el cliente muestra interés concreto en él (intent "interested" o "ready_to_buy"), incluye su <UUID> en images_to_send.
• NUNCA inventes IDs. Solo usa los UUIDs que aparecen literalmente en el catálogo. Si no ves un UUID asociado al producto, no incluyas nada.
• Si el producto no tiene imagen (aparece "(sin imagen)"), no lo agregues a images_to_send.
• Para saludos, exploración general o productos agotados/próximamente, deja images_to_send como array vacío [].
• Cuando envíes imagen, menciónalo brevemente en el mensaje ("Aquí te mando una foto 📸") para que el cliente entienda.

INTENCIONES:
- "greeting": saludo inicial
- "browsing": exploración general, sin producto específico
- "interested": interés concreto en producto, precio o cálculo de material
- "ready_to_buy": quiere comprar, preguntar cómo pagar o confirmar pedido
- "bought": confirma que ya compró
- "unknown": pregunta que no puedes responder con la información disponible
- "support": dudas post-venta o seguimiento
- "representative": el cliente pide hablar con un representante o persona humana`;

  const history = buildMessageHistory(recentMessages);
  const attempts: ProviderAttempt[] = [];

  try {
    // generateObject devuelve el objeto ya validado contra el schema: una sola
    // emisión, sin prosa duplicada ni bloques ```json que se filtren al cliente.
    const parsed = await callLLMWithFailover(SYSTEM_PROMPT, history, userMessage, attempts);

    const message = (parsed.message || "").trim();
    const images = (parsed.images_to_send || []).filter(
      (s): s is string => typeof s === "string" && s.length > 0,
    );
    return {
      message: message || "Disculpa, ¿podrías repetir tu pregunta? 😊",
      intent: normalizeIntent(parsed.intent),
      products_mentioned: parsed.products_mentioned || [],
      images_to_send: images,
    };
  } catch (error) {
    // Red de seguridad: si TODOS los providers fallaron pero el último dejó texto
    // crudo recuperable, mandamos un mensaje limpio en vez de un error técnico.
    const rawText = error instanceof AllProvidersFailedError ? error.rawText : undefined;
    if (rawText) {
      const recovered = recoverMessageFromRaw(rawText);
      if (recovered && recovered.length > 5) {
        console.warn("⚠️ Providers fallaron, pero se recuperó mensaje del texto crudo.");
        return { message: recovered, intent: "browsing", products_mentioned: [], images_to_send: [] };
      }
    }

    console.error("AI Gateway error (todos los proveedores fallaron):", error);
    const errMsg = (error as Error)?.message ?? String(error);
    await logAiError({
      conversationId: errorContext?.conversationId,
      phoneNumber: errorContext?.phoneNumber,
      userMessage,
      errorKind: "all_providers_failed",
      errorMessage: errMsg,
      providerChain: attempts,
    });
    const phoneInfo = businessSettings['phone_1'] ? `al ${businessSettings['phone_1']}` : "a la tienda";
    return {
      message: `Uy, tuve un problema técnico ahorita 😅 ¿Me lo repites en un momento? Si urge, puedes llamarnos ${phoneInfo}.`,
      intent: "support",
      products_mentioned: [],
      images_to_send: [],
    };
  }
}
