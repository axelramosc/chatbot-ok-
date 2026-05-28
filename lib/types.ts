// ============================================
// WhatsApp Webhook Types
// ============================================
export interface WhatsAppWebhookPayload {
  object: string;
  entry: WhatsAppEntry[];
}

export interface WhatsAppEntry {
  id: string;
  changes: WhatsAppChange[];
}

export interface WhatsAppChange {
  value: {
    messaging_product: string;
    metadata: {
      display_phone_number: string;
      phone_number_id: string;
    };
    contacts?: WhatsAppContact[];
    messages?: WhatsAppMessage[];
    statuses?: WhatsAppStatus[];
  };
  field: string;
}

export interface WhatsAppContact {
  profile: {
    name: string;
  };
  wa_id: string;
}

export interface WhatsAppMessage {
  from: string;
  id: string;
  timestamp: string;
  text?: {
    body: string;
  };
  type: string;
}

export interface WhatsAppStatus {
  id: string;
  status: string;
  timestamp: string;
  recipient_id: string;
}

// ============================================
// Channel Types
// ============================================
export type ChannelName = 'whatsapp' | 'messenger' | 'instagram';

// ============================================
// Database Types
// ============================================
export interface Product {
  id: string;
  name: string;
  description: string | null;
  price: number;
  category: string | null;
  stock: number;
  image_url: string | null;
  is_active: boolean;
  metadata: Record<string, unknown>;
  unit: string;
  price_per_box: number | null;
  pieces_per_box: number | null;
  coverage_per_piece: number | null;
  availability: "disponible" | "agotado" | "próximamente";
  restock_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeFragment {
  id: string;
  content: string;
  topic: string | null;
  is_active: boolean;
  supersedes_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface FAQ {
  id: string;
  question: string;
  answer: string;
  category: string | null;
  priority: number;
  is_active: boolean;
  created_at: string;
}

export type CustomerStatus =
  | "venta"
  | "avisar_restock"
  | "cotizacion"
  | "cerrado"
  | "distribuidor";

export interface Conversation {
  id: string;
  phone_number: string;
  customer_name: string | null;
  status: "active" | "sale_pending" | "sale_completed" | "closed" | "attended";
  customer_status: CustomerStatus | null;
  context: Record<string, unknown>;
  channel?: string;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  wa_message_id: string | null;
  channel_message_id?: string | null;
  sender: "user" | "bot";
  content: string;
  message_type: string;
  created_at: string;
}

export interface SalesLead {
  id: string;
  conversation_id: string;
  phone_number: string;
  customer_name: string | null;
  products_interested: string[];
  status: "pending" | "notified" | "attended" | "completed" | "cancelled";
  notes: string | null;
  admin_notified_at: string | null;
  created_at: string;
}

// ============================================
// AI Types
// ============================================
export interface AIResponse {
  message: string;
  intent: "browsing" | "interested" | "ready_to_buy" | "bought" | "support" | "greeting" | "unknown";
  products_mentioned: string[];
}

export interface ConversationContext {
  conversation: Conversation;
  recentMessages: Message[];
  products: Product[];
  faqs: FAQ[];
  customerName: string | null;
}
