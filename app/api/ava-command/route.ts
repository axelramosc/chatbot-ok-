import { NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabase } from "../../../lib/supabase";
import { routeAdminReply, routeAdminImage } from "../../../lib/channel-router";
import { generateResponse } from "../../../lib/ai";
import {
  getRecentMessages,
  getActiveProducts,
  getActiveFAQs,
  getBusinessSettings,
  getKnowledgeFragments,
  saveMessage,
} from "../../../lib/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Comando /ava del inbox.
 *
 * Un humano del equipo le da una orden a Ava (aclarar a qué se refiere el cliente,
 * o mandar una foto). Ava genera y envía SU respuesta al cliente al instante usando
 * la orden como instrucción de máxima prioridad.
 *
 * Diferencias clave con send-message / send-message-v2:
 *  - NO pausa el bot. Al contrario: asegura que la conversación quede "active" para
 *    que Ava siga manejándola.
 *  - La orden se guarda como NOTA INTERNA ([AVA-CMD]) visible solo en el inbox; nunca
 *    se rutea a ningún canal, así que el cliente jamás la ve.
 */
export async function POST(request: Request) {
  // Auth: solo admin con sesión válida.
  const cookieStore = await cookies();
  const sessionClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) { return cookieStore.get(name)?.value; },
        set(_name: string, _value: string, _options: CookieOptions) {},
        remove(_name: string, _options: CookieOptions) {},
      },
    }
  );

  const { data: { user } } = await sessionClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const conversation_id: string | undefined = body?.conversation_id;
    const instruction: string = (body?.instruction ?? "").toString().trim();
    const image_url: string | undefined =
      typeof body?.image_url === "string" && body.image_url.trim() ? body.image_url.trim() : undefined;

    if (!conversation_id || !instruction) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const supabase = getSupabase();

    // 1. Carga la conversación (canal, teléfono, nombre, estado).
    const { data: conv, error: convError } = await supabase
      .from("conversations")
      .select("id, phone_number, channel, customer_name, status, context")
      .eq("id", conversation_id)
      .single();

    if (convError || !conv) {
      console.error("❌ /ava: conversación no encontrada:", convError);
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    // 2. Guarda la orden como NOTA INTERNA. Nunca se envía a ningún canal.
    //    Se guarda primero para que quede registro aunque la IA falle después.
    try {
      await supabase.from("messages").insert({
        conversation_id,
        sender: "bot",
        content: `[AVA-CMD] ${instruction}`,
        message_type: "internal_note",
        wa_message_id: `ava-cmd-${Date.now()}`,
      });
    } catch (e) {
      console.warn("⚠️ /ava: no se pudo guardar la nota interna:", e);
    }

    // 3. Asegura que el bot quede activo (la idea de /ava es que Ava siga manejando).
    if (conv.status !== "active") {
      await supabase
        .from("conversations")
        .update({ status: "active", updated_at: new Date().toISOString() })
        .eq("id", conversation_id)
        .then(({ error }) => { if (error) console.warn("⚠️ /ava: no se pudo reactivar el bot:", error); });
    }

    // 4. Contexto para la IA (mismo set que usa el flujo normal del bot).
    const [recentMessages, products, faqs, businessSettings, knowledgeFragments] = await Promise.all([
      getRecentMessages(conversation_id, 10).catch((e) => { console.warn("Error fetching recent messages:", e); return []; }),
      getActiveProducts().catch((e) => { console.warn("Error fetching products:", e); return []; }),
      getActiveFAQs().catch((e) => { console.warn("Error fetching FAQs:", e); return []; }),
      getBusinessSettings().catch((e) => { console.warn("Error fetching business settings:", e); return {}; }),
      getKnowledgeFragments().catch((e) => { console.warn("Error fetching knowledge:", e); return []; }),
    ]);

    // El turno final que ve el modelo DEBE ser la orden del equipo, no el último
    // mensaje del cliente (que podría ser un simple "Hola" y haría que Ava solo salude
    // ignorando la orden). Se marca explícitamente como interna para que no la trate
    // como si la hubiera escrito el cliente ni la mencione en su respuesta.
    const directiveTurn =
      `⚙️ ORDEN INTERNA DEL EQUIPO (NO la escribió el cliente y el cliente NO la ve). ` +
      `Ejecútala AHORA en tu respuesta al cliente, por encima de cualquier saludo o flujo: «${instruction}». ` +
      `Si la orden implica mandar la foto de un producto, es OBLIGATORIO incluir su UUID en "images_to_send".`;

    // 5. Genera la respuesta de Ava con la orden como directiva de máxima prioridad.
    const aiResponse = await generateResponse(
      directiveTurn,
      products as never,
      faqs as never,
      recentMessages as never,
      (conv.customer_name as string) || null,
      businessSettings as Record<string, string>,
      knowledgeFragments as never,
      { conversationId: conversation_id, phoneNumber: conv.phone_number as string },
      instruction,
    );

    // 6. Guarda la respuesta como mensaje normal de Ava (se mostrará como "Ava").
    try {
      await saveMessage(conversation_id, "bot", aiResponse.message);
    } catch (e) {
      console.warn("⚠️ /ava: no se pudo guardar la respuesta de Ava:", e);
    }

    // 7. Envía el texto al cliente por el canal correcto.
    const sent = await routeAdminReply(conversation_id, aiResponse.message);
    if (!sent) {
      console.error("❌ /ava: falló el envío del mensaje al cliente.");
    }

    // 8. Imágenes de catálogo que la IA pidió (validadas contra el catálogo cargado).
    try {
      const ids = aiResponse.images_to_send ?? [];
      if (ids.length > 0) {
        const byId = new Map((products as { id: string; image_url?: string | null }[]).map((p) => [p.id, p]));
        for (const id of ids.slice(0, 3)) {
          const prod = byId.get(id);
          if (!prod || !prod.image_url) {
            console.log(`📷 /ava: producto ${id} sin imagen o inexistente — se omite.`);
            continue;
          }
          const ok = await routeAdminImage(conversation_id, prod.image_url);
          if (!ok) console.warn(`📷 /ava: falló envío de imagen del producto ${id}.`);
        }
      }
    } catch (e) {
      console.warn("⚠️ /ava: error no crítico enviando imágenes de catálogo:", e);
    }

    // 9. Imagen adjunta manual (Fase 2). Se envía tal cual al cliente.
    if (image_url) {
      const ok = await routeAdminImage(conversation_id, image_url);
      if (!ok) console.warn("📷 /ava: falló envío de la imagen manual.");
    }

    return NextResponse.json({ success: true, message: aiResponse.message });
  } catch (error) {
    console.error("ava-command error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
