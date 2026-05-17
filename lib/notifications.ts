import { sendTextMessage } from "./whatsapp";
import { createSalesLead, updateSalesLeadStatus, getBusinessSettings } from "./database";

// Tu número personal de WhatsApp para recibir alertas (Fallback fallback si la DB falla)
const FALLBACK_ADMIN_NUMBER = process.env.ADMIN_WHATSAPP_NUMBER || "";

async function getAdminNumbers(): Promise<string[]> {
  try {
    const settings = await getBusinessSettings();
    if (settings && settings["sales_agent_numbers"]) {
      return settings["sales_agent_numbers"].split(",").map((n: string) => n.trim()).filter((n: string) => n.length > 0);
    }
  } catch (error) {
    console.error("Error fetching sales_agent_numbers from DB, using fallback", error);
  }
  return FALLBACK_ADMIN_NUMBER ? [FALLBACK_ADMIN_NUMBER] : [];
}

// ============================================
// Notificación de Venta / Cliente Potencial
// ============================================

interface SaleNotificationData {
  conversationId: string;
  phoneNumber: string;
  customerName: string | null;
  productsInterested: string[];
  conversationSummary: string;
}

export async function notifyAdminOfSale(data: SaleNotificationData): Promise<void> {
  const numbers = await getAdminNumbers();
  if (numbers.length === 0) {
    console.error("No admin numbers configured to receive sale notification");
    return;
  }

  try {
    // Registrar el lead en la base de datos
    const lead = await createSalesLead(
      data.conversationId,
      data.phoneNumber,
      data.customerName,
      data.productsInterested,
      data.conversationSummary
    );

    // Mensaje de alerta al admin
    const message =
      `🛒 *¡Cliente listo para comprar!*\n\n` +
      `👤 *Cliente:* ${data.customerName || "No proporcionó nombre"}\n` +
      `📱 *WhatsApp:* +${data.phoneNumber}\n` +
      `📦 *Productos de interés:* ${data.productsInterested.join(", ") || "No especificado"}\n\n` +
      `💬 *Resumen de la conversación:*\n${data.conversationSummary.substring(0, 400)}\n\n` +
      `⚡ Te recomiendo contactarlo pronto para cerrar la venta.`;

    let anySent = false;
    for (const num of numbers) {
      const sent = await sendTextMessage(num, message);
      if (sent) anySent = true;
    }

    if (anySent) {
      await updateSalesLeadStatus(lead.id, "notified", true);
      console.log(`✅ Admins notified of sale lead ${lead.id}`);
    } else {
      console.error(`❌ Failed to notify any admin of sale lead ${lead.id}`);
    }
  } catch (error) {
    console.error("Error notifying admin of sale:", error);
  }
}

// ============================================
// Notificación de Consulta Sin Respuesta
// ============================================

interface UnknownQueryData {
  conversationId: string;
  phoneNumber: string;
  customerName: string | null;
  question: string;
  conversationSummary: string;
}

export async function notifyAdminOfUnknownQuery(data: UnknownQueryData): Promise<void> {
  const numbers = await getAdminNumbers();
  if (numbers.length === 0) {
    console.error("No admin numbers configured to receive unknown query notification");
    return;
  }

  try {
    const message =
      `❓ *Consulta sin respuesta — Atención requerida*\n\n` +
      `👤 *Cliente:* ${data.customerName || "No proporcionó nombre"}\n` +
      `📱 *WhatsApp:* +${data.phoneNumber}\n\n` +
      `🗨️ *Pregunta que no pude responder:*\n"${data.question}"\n\n` +
      `💬 *Contexto de la conversación:*\n${data.conversationSummary.substring(0, 300)}\n\n` +
      `👆 Este cliente necesita atención personal. ¡Contáctalo cuando puedas!`;

    for (const num of numbers) {
      await sendTextMessage(num, message);
    }
    console.log(`✅ Admins notified of unknown query from ${data.phoneNumber}`);
  } catch (error) {
    console.error("Error notifying admin of unknown query:", error);
  }
}
