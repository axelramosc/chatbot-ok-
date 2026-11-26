import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * S11 (integración real): /api/ava-command deja la conversación en status='active'
 * (reactiva el bot POR CONVERSACIÓN). Con el bot apagado GLOBALMENTE, el siguiente mensaje
 * entrante del cliente debe seguir bloqueado: ni Groq ni respuesta de IA, solo la redirección.
 * Se usa un Supabase en memoria con estado (conversations / messages / bot_control).
 */

interface Row { [k: string]: unknown }
const store = vi.hoisted(() => ({
  conversations: [] as Row[],
  messages: [] as Row[],
  botControl: { id: 1, enabled: false, redirect_phone: "8445089882" } as Row,
}));

const h = vi.hoisted(() => ({
  generateResponse: vi.fn(),
  sendTextMessage: vi.fn(),
  clientSend: vi.fn(),
  routeAdminReply: vi.fn(),
  getOrCreateConversation: vi.fn(),
  getUser: vi.fn(),
}));

function fakeSupabase() {
  return {
    rpc: async (fn: string, args: { p_conversation_id: string }) => {
      if (fn !== "claim_bot_off_notice") return { data: null, error: null };
      const row = store.conversations.find((c) => c.id === args.p_conversation_id);
      if (!row) return { data: true, error: null };
      const ctx = (row.context as Row) ?? {};
      if (ctx.bot_off_notice_at) return { data: false, error: null };
      row.context = { ...ctx, bot_off_notice_at: new Date().toISOString() };
      return { data: true, error: null };
    },
    from(table: string) {
      let op: "select" | "update" | "insert" = "select";
      let payload: Row = {};
      const filters: [string, unknown][] = [];
      const rows = () => {
        const src = table === "conversations" ? store.conversations : table === "messages" ? store.messages : [];
        return src.filter((r) => filters.every(([c, v]) => r[c] === v));
      };
      const run = (single: boolean) => {
        if (table === "bot_control") return { data: single ? store.botControl : [store.botControl], error: null };
        if (op === "insert") {
          store.messages.push({ ...payload });
          return { data: null, error: null };
        }
        if (op === "update") {
          rows().forEach((r) => Object.assign(r, payload));
          return { data: null, error: null };
        }
        if (table === "messages" && single) return { data: null, error: null }; // dedupe: nunca visto
        return { data: single ? (rows()[0] ?? null) : rows(), error: null };
      };
      const b: Record<string, unknown> = {
        select: () => b,
        update: (p: Row) => { op = "update"; payload = p; return b; },
        insert: (p: Row) => { op = "insert"; payload = p; return b; },
        eq: (c: string, v: unknown) => { filters.push([c, v]); return b; },
        not: () => b, order: () => b, limit: () => b,
        single: () => Promise.resolve(run(true)),
        maybeSingle: () => Promise.resolve(run(true)),
        then: (res: (v: unknown) => unknown) => res(run(false)),
      };
      return b;
    },
  };
}

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ auth: { getUser: h.getUser } }) }));
vi.mock("../lib/supabase", () => ({ getSupabase: () => fakeSupabase() }));
vi.mock("../lib/ai", () => ({ generateResponse: h.generateResponse }));
vi.mock("../lib/channel-router", () => ({ routeAdminReply: h.routeAdminReply, routeAdminImage: vi.fn(async () => true) }));
vi.mock("../lib/notifications", () => ({
  notifyAdminOfSale: vi.fn(), notifyAdminOfUnknownQuery: vi.fn(), notifyAdminOfRepresentativeRequest: vi.fn(),
}));
vi.mock("../lib/whatsapp", () => ({
  extractMessageData: () => ({ from: "5218441112222", messageId: "wamid.S11", text: "¿siguen ahí?", contactName: "Cliente", timestamp: "1" }),
  sendTextMessage: h.sendTextMessage,
  sendImageMessage: vi.fn(async () => true),
}));
vi.mock("../lib/database", () => ({
  getOrCreateConversation: h.getOrCreateConversation,
  saveMessage: async (conversationId: string, sender: string, content: string) => {
    store.messages.push({ conversation_id: conversationId, sender, content });
    return {};
  },
  getRecentMessages: vi.fn(async () => []),
  getActiveProducts: vi.fn(async () => []),
  getActiveFAQs: vi.fn(async () => []),
  getBusinessSettings: vi.fn(async () => ({})),
  getKnowledgeFragments: vi.fn(async () => []),
  isMessageProcessed: vi.fn(async () => false),
  updateConversationStatus: vi.fn(async () => {}),
}));

import { POST as avaCommand } from "../app/api/ava-command/route";
import { handleIncomingMessage } from "../lib/message-handler";
import { handleChannelMessage } from "../lib/channel-handler";
import { buildRedirectMessage } from "../lib/bot-switch";
import type { ChannelClient } from "../lib/channels/types";

const REDIRECT = buildRedirectMessage("8445089882");

function avaRequest(conversationId: string) {
  return new Request("https://crm/api/ava-command", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ conversation_id: conversationId, instruction: "aclara que se refiere al piso" }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  store.messages.length = 0;
  store.conversations.length = 0;
  store.botControl = { id: 1, enabled: false, redirect_phone: "8445089882" };
  h.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  h.generateResponse.mockResolvedValue({ message: "Respuesta de Ava", intent: "interested", products_mentioned: [], customer_city: null, images_to_send: [] });
  h.sendTextMessage.mockResolvedValue(true);
  h.clientSend.mockResolvedValue(true);
  h.routeAdminReply.mockResolvedValue(true);
  h.getOrCreateConversation.mockImplementation(async (phone: string) => store.conversations.find((c) => c.phone_number === phone));
});

describe("S11: /ava con el bot apagado NO reactiva a Ava para el siguiente mensaje", () => {
  it.each([
    ["WhatsApp", "5218441112222", "5218441112222"],
    ["Messenger", "fb_psid_PSID9", "PSID9"],
  ])("%s", async (name, phone, senderId) => {
    // Conversación pausada por un humano (attended); el equipo usa /ava → queda 'active'.
    store.conversations.push({ id: "c-s11", phone_number: phone, customer_name: "Cliente", status: "attended", channel: name === "WhatsApp" ? "whatsapp" : "messenger", context: { customer_city: "Saltillo" } });

    const res = await avaCommand(avaRequest("c-s11"));
    expect(res.status).toBe(200);
    expect(store.conversations[0].status).toBe("active"); // /ava reactivó la conversación (comportamiento existente)
    expect(h.generateResponse).toHaveBeenCalledTimes(1); // la orden del equipo SÍ la ejecuta (acción humana, A6)

    // El cliente responde → el interruptor global manda.
    if (name === "WhatsApp") {
      await handleIncomingMessage({} as never);
      expect(h.sendTextMessage).toHaveBeenCalledTimes(1);
      expect(h.sendTextMessage).toHaveBeenCalledWith("5218441112222", REDIRECT);
    } else {
      const client = { name: "messenger", sendMessage: h.clientSend } as unknown as ChannelClient;
      await handleChannelMessage({ senderId, messageId: "mid.S11", text: "¿siguen ahí?", contactName: "Cliente", channel: "messenger" }, client);
      expect(h.clientSend).toHaveBeenCalledTimes(1);
      expect(h.clientSend).toHaveBeenCalledWith(senderId, REDIRECT);
    }
    // Ava NO volvió a generar: la única llamada a la IA fue la de la orden /ava.
    expect(h.generateResponse).toHaveBeenCalledTimes(1);
    // Un segundo mensaje dentro de 6 h no repite el aviso.
    if (name === "WhatsApp") {
      await handleIncomingMessage({} as never);
      expect(h.sendTextMessage).toHaveBeenCalledTimes(1);
    }
    expect(h.generateResponse).toHaveBeenCalledTimes(1);
    // El mensaje del cliente quedó guardado en la bandeja (A3).
    expect(store.messages.some((m) => m.sender === "user" || m.channel_message_id === "mid.S11")).toBe(true);
  });

  it("control: con el bot ENCENDIDO el mismo siguiente mensaje sí lo contesta Ava", async () => {
    store.botControl = { id: 1, enabled: true, redirect_phone: "8445089882" };
    store.conversations.push({ id: "c-s11b", phone_number: "5218441112222", customer_name: "Cliente", status: "attended", channel: "whatsapp", context: {} });
    await avaCommand(avaRequest("c-s11b"));
    h.generateResponse.mockClear();
    await handleIncomingMessage({} as never);
    expect(h.generateResponse).toHaveBeenCalledTimes(1);
    expect(h.sendTextMessage).toHaveBeenCalledWith("5218441112222", "Respuesta de Ava");
  });
});
