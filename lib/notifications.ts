import { sendTextMessage, sendTemplateMessage } from "./whatsapp";
import { createSalesLead, updateSalesLeadStatus } from "./database";

const ADMIN_WHATSAPP_NUMBER = process.env.ADMIN_WHATSAPP_NUMBER || "";
const NOTIFICATION_TEMPLATE_NAME = process.env.NOTIFICATION_TEMPLATE_NAME || "";

interface NotificationData {
  conversationId: string;
  phoneNumber: string;
  customerName: string | null;
  productsInterested: string[];
  conversationSummary: string;
}

export async function notifyAdminOfSale(data: NotificationData): Promise<void> {
  if (!ADMIN_WHATSAPP_NUMBER) {
    console.error("ADMIN_WHATSAPP_NUMBER not configured");
    return;
  }

  try {
    // Create the sales lead in the database
    const lead = await createSalesLead(
      data.conversationId,
      data.phoneNumber,
      data.customerName,
      data.productsInterested,
      data.conversationSummary
    );

    // Try sending template message first (works outside 24h window)
    if (NOTIFICATION_TEMPLATE_NAME) {
      const templateSent = await sendTemplateMessage(
        ADMIN_WHATSAPP_NUMBER,
        NOTIFICATION_TEMPLATE_NAME,
        [
          data.customerName || "Cliente",
          data.phoneNumber,
          data.productsInterested.join(", ") || "No especificado",
          data.conversationSummary.substring(0, 200),
        ]
      );

      if (templateSent) {
        await updateSalesLeadStatus(lead.id, "notified", true);
        console.log(`Admin notified via template for lead ${lead.id}`);
        return;
      }
    }

    // Fallback: send as regular text (only works within 24h window)
    const textMessage = `🛒 *Nueva Venta Potencial*\n\n` +
      `👤 *Cliente:* ${data.customerName || "No proporcionado"}\n` +
      `📱 *Teléfono:* ${data.phoneNumber}\n` +
      `📦 *Productos:* ${data.productsInterested.join(", ") || "No especificado"}\n\n` +
      `💬 *Resumen:*\n${data.conversationSummary.substring(0, 300)}\n\n` +
      `⏰ Este cliente necesita atención personalizada.`;

    const textSent = await sendTextMessage(ADMIN_WHATSAPP_NUMBER, textMessage);

    if (textSent) {
      await updateSalesLeadStatus(lead.id, "notified", true);
      console.log(`Admin notified via text for lead ${lead.id}`);
    } else {
      console.error(`Failed to notify admin for lead ${lead.id}`);
    }
  } catch (error) {
    console.error("Error notifying admin:", error);
  }
}
