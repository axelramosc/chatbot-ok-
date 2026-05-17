import { getSupabase } from "./supabase";
import type { Conversation, Message, Product, FAQ, SalesLead } from "./types";

// ============================================
// Conversation Operations
// ============================================

export async function getOrCreateConversation(
  phoneNumber: string,
  customerName?: string
): Promise<Conversation> {
  const supabase = getSupabase();

  // IMPORTANT: Use array query (NOT .single() or .maybeSingle()) because
  // those throw errors when 0 or >1 rows match, which causes fallthrough
  // to creating a DUPLICATE conversation — the root cause of the bot
  // not pausing when admin takes control.
  const { data: rows, error: fetchError } = await supabase
    .from("conversations")
    .select("*")
    .eq("phone_number", phoneNumber)
    .not("status", "eq", "closed")
    .order("updated_at", { ascending: false })
    .limit(1);

  if (fetchError) {
    console.error("❌ Error fetching conversation:", fetchError);
  }

  const existing = rows && rows.length > 0 ? rows[0] : null;

  if (existing) {
    console.log(`📋 Found existing conversation ${existing.id} with status: ${existing.status}`);
    // Update customer name if we have it now and didn't before
    if (customerName && !existing.customer_name) {
      await supabase
        .from("conversations")
        .update({ customer_name: customerName, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
      existing.customer_name = customerName;
    }
    return existing as Conversation;
  }

  console.log(`🆕 Creating new conversation for ${phoneNumber}`);

  // Create new conversation
  const { data: newConv, error } = await supabase
    .from("conversations")
    .insert({
      phone_number: phoneNumber,
      customer_name: customerName || null,
      status: "active",
    })
    .select()
    .single();

  // If INSERT failed due to unique constraint (race condition: another webhook
  // created it first), re-fetch the existing conversation.
  if (error) {
    console.warn(`⚠️ Insert failed (likely race condition): ${error.message}. Re-fetching...`);
    const { data: retryRows } = await supabase
      .from("conversations")
      .select("*")
      .eq("phone_number", phoneNumber)
      .not("status", "eq", "closed")
      .order("updated_at", { ascending: false })
      .limit(1);

    if (retryRows && retryRows.length > 0) {
      console.log(`📋 Found conversation on retry: ${retryRows[0].id} status: ${retryRows[0].status}`);
      return retryRows[0] as Conversation;
    }
    throw new Error(`Failed to create conversation: ${error.message}`);
  }
  return newConv as Conversation;
}

export async function updateConversationStatus(
  conversationId: string,
  status: Conversation["status"]
): Promise<void> {
  const supabase = getSupabase();
  await supabase
    .from("conversations")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", conversationId);
}

// ============================================
// Message Operations
// ============================================

export async function saveMessage(
  conversationId: string,
  sender: "user" | "bot",
  content: string,
  waMessageId?: string
): Promise<Message> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      sender,
      content,
      wa_message_id: waMessageId || null,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to save message: ${error.message}`);
  return data as Message;
}

export async function getRecentMessages(
  conversationId: string,
  limit: number = 10
): Promise<Message[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Failed to get messages: ${error.message}`);
  // Reverse so they're in chronological order
  return (data as Message[]).reverse();
}

export async function isMessageProcessed(waMessageId: string): Promise<boolean> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("messages")
    .select("id")
    .eq("wa_message_id", waMessageId)
    .limit(1)
    .single();

  return !!data;
}

// ============================================
// Product Operations
// ============================================

export async function getActiveProducts(): Promise<Product[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("is_active", true)
    .order("category", { ascending: true });

  if (error) throw new Error(`Failed to get products: ${error.message}`);
  return data as Product[];
}

export async function searchProducts(query: string): Promise<Product[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("is_active", true)
    .or(`name.ilike.%${query}%,description.ilike.%${query}%,category.ilike.%${query}%`);

  if (error) throw new Error(`Failed to search products: ${error.message}`);
  return data as Product[];
}

// ============================================
// FAQ Operations
// ============================================

export async function getActiveFAQs(): Promise<FAQ[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("faqs")
    .select("*")
    .eq("is_active", true)
    .order("priority", { ascending: false });

  if (error) throw new Error(`Failed to get FAQs: ${error.message}`);
  return data as FAQ[];
}

// ============================================
// Sales Lead Operations
// ============================================

export async function createSalesLead(
  conversationId: string,
  phoneNumber: string,
  customerName: string | null,
  productsInterested: string[],
  notes: string | null
): Promise<SalesLead> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("sales_leads")
    .insert({
      conversation_id: conversationId,
      phone_number: phoneNumber,
      customer_name: customerName,
      products_interested: productsInterested,
      notes,
      status: "pending",
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create sales lead: ${error.message}`);
  return data as SalesLead;
}

export async function updateSalesLeadStatus(
  leadId: string,
  status: SalesLead["status"],
  notified: boolean = false
): Promise<void> {
  const update: Record<string, unknown> = { status };
  if (notified) {
    update.admin_notified_at = new Date().toISOString();
  }

  const supabase = getSupabase();
  await supabase
    .from("sales_leads")
    .update(update)
    .eq("id", leadId);
}
