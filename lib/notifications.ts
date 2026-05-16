import { sendTextMessage } from "./whatsapp";
import { createSalesLead, updateSalesLeadStatus } from "./database";

// Tu número personal de WhatsApp para recibir alertas
const ADMIN_WHATSAPP_NUMBER = process.env.ADMIN_WHATSAPP_NUMBER || "";

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
  if (!ADMIN_WHATSAPP_NUMBER) {
    console.error("ADMIN_WHATSAPP_NUMBER not configured");
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

    const sent = await sendTextMessage(ADMIN_WHATSAPP_NUMBER, message);

    if (sent) {
      await updateSalesLeadStatus(lead.id, "notified", true);
      console.log(`✅ Admin notified of sale lead ${lead.id}`);
    } else {
      console.error(`❌ Failed to notify admin of sale lead ${lead.id}`);
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
  if (!ADMIN_WHATSAPP_NUMBER) {
    console.error("ADMIN_WHATSAPP_NUMBER not configured");
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

    const sent = await sendTextMessage(ADMIN_WHATSAPP_NUMBER, message);

    if (sent) {
      console.log(`✅ Admin notified of unknown query from ${data.phoneNumber}`);
    } else {
      console.error(`❌ Failed to notify admin of unknown query from ${data.phoneNumber}`);
    }
  } catch (error) {
    console.error("Error notifying admin of unknown query:", error);
  }
}
