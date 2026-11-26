import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeFakeSupabase, makeState, type FakeState } from "./helpers/fake-supabase";

let state: FakeState;
const order: string[] = [];

const h = vi.hoisted(() => ({
  generateResponse: vi.fn(),
  sendTextMessage: vi.fn(),
  sendImageMessage: vi.fn(),
  saveMessage: vi.fn(),
  getOrCreateConversation: vi.fn(),
  isMessageProcessed: vi.fn(),
  clientSend: vi.fn(),
  notifySale: vi.fn(async () => {}),
  notifyUnknown: vi.fn(async () => {}),
  notifyRep: vi.fn(async () => {}),
}));

vi.mock("../lib/supabase", () => ({ getSupabase: () => makeFakeSupabase(state) }));
vi.mock("../lib/ai", () => ({ generateResponse: h.generateResponse }));
vi.mock("../lib/notifications", () => ({
  notifyAdminOfSale: h.notifySale,
  notifyAdminOfUnknownQuery: h.notifyUnknown,
  notifyAdminOfRepresentativeRequest: h.notifyRep,
}));
vi.mock("../lib/whatsapp", () => ({
  extractMessageData: () => ({
    from: "5218441112222",
    messageId: "wamid.1",
    text: "Hola, ¿tienen lambrín?",
    contactName: "Cliente Prueba",
    timestamp: "1",
  }),
  sendTextMessage: h.sendTextMessage,
  sendImageMessage: h.sendImageMessage,
}));
vi.mock("../lib/database", () => ({
  getOrCreateConversation: h.getOrCreateConversation,
  saveMessage: h.saveMessage,
  getRecentMessages: vi.fn(async () => []),
  getActiveProducts: vi.fn(async () => []),
  getActiveFAQs: vi.fn(async () => []),
  getBusinessSettings: vi.fn(async () => ({})),
  getKnowledgeFragments: vi.fn(async () => []),
  isMessageProcessed: h.isMessageProcessed,
  updateConversationStatus: vi.fn(async () => {}),
}));

import { handleIncomingMessage } from "../lib/message-handler";
import { handleChannelMessage } from "../lib/channel-handler";
import { buildRedirectMessage } from "../lib/bot-switch";
import type { NormalizedMessage, ChannelClient } from "../lib/channels/types";

const REDIRECT = buildRedirectMessage("8445089882");
const GENERIC_ERROR = /problema procesando tu mensaje/;

const AI_OK = {
  message: "¡Claro! Sí tenemos lambrín.",
  intent: "interested",
  products_mentioned: [],
  customer_city: null,
  images_to_send: [],
};

function conv(overrides: Record<string, unknown> = {}) {
  return {
    id: "conv-1",
    phone_number: "5218441112222",
    customer_name: "Cliente Prueba",
    status: "active",
    context: {},
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function setOff() {
  state.botControl = { data: { enabled: false, redirect_phone: "8445089882" }, error: null };
}

beforeEach(() => {
  state = makeState();
  order.length = 0;
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  h.isMessageProcessed.mockResolvedValue(false);
  h.getOrCreateConversation.mockResolvedValue(conv());
  h.generateResponse.mockResolvedValue(AI_OK);
  h.sendTextMessage.mockResolvedValue(true);
  h.sendImageMessage.mockResolvedValue(true);
  h.clientSend.mockResolvedValue(true);
  h.notifySale.mockResolvedValue(undefined);
  h.saveMessage.mockImplementation(async (_c: string, sender: string, content: string) => {
    order.push(`save:${sender}:${content.slice(0, 12)}`);
    return {};
  });
});

const payload = {} as never;

describe("WhatsApp — message-handler", () => {
  it("A1: encendido → flujo idéntico: llama a la IA y envía su respuesta", async () => {
    await handleIncomingMessage(payload);
    expect(h.generateResponse).toHaveBeenCalledTimes(1);
    expect(h.sendTextMessage).toHaveBeenCalledWith("5218441112222", AI_OK.message);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("A2/A3/S5: apagado → redirección fija, sin IA, y el mensaje del cliente se guardó ANTES", async () => {
    setOff();
    await handleIncomingMessage(payload);
    expect(h.generateResponse).not.toHaveBeenCalled();
    expect(h.sendTextMessage).toHaveBeenCalledTimes(1);
    expect(h.sendTextMessage).toHaveBeenCalledWith("5218441112222", REDIRECT);
    expect(REDIRECT).toContain("844 508 9882");
    // Orden: primero el entrante (user), luego el aviso (bot).
    expect(order[0]).toMatch(/^save:user:/);
    expect(order[1]).toMatch(/^save:bot:/);
  });

  it("A4/S7: marca reciente → NO repite el aviso; sigue sin llamar a la IA", async () => {
    setOff();
    h.getOrCreateConversation.mockResolvedValue(conv({ context: { bot_off_notice_at: new Date().toISOString(), customer_city: "Saltillo" } }));
    await handleIncomingMessage(payload);
    expect(h.sendTextMessage).not.toHaveBeenCalled();
    expect(h.generateResponse).not.toHaveBeenCalled();
    expect(order).toHaveLength(1); // solo el entrante
  });

  it("A4: marca de hace más de 6 h → vuelve a avisar", async () => {
    setOff();
    h.getOrCreateConversation.mockResolvedValue(conv({ context: { bot_off_notice_at: new Date(Date.now() - 7 * 3600_000).toISOString() } }));
    await handleIncomingMessage(payload);
    expect(h.sendTextMessage).toHaveBeenCalledWith("5218441112222", REDIRECT);
  });

  it("A7: tras reencender, el siguiente mensaje vuelve a pasar por la IA", async () => {
    setOff();
    await handleIncomingMessage(payload);
    expect(h.generateResponse).not.toHaveBeenCalled();
    state.botControl = { data: { enabled: true, redirect_phone: "8445089882" }, error: null };
    h.getOrCreateConversation.mockResolvedValue(conv({ context: { bot_off_notice_at: new Date().toISOString() } }));
    await handleIncomingMessage(payload);
    expect(h.generateResponse).toHaveBeenCalledTimes(1);
  });

  it("A8/S10: no se puede leer bot_control → FAIL-CLOSED: redirección, sin IA", async () => {
    state.botControl = { data: null, error: { message: "permission denied" } };
    await handleIncomingMessage(payload);
    expect(h.generateResponse).not.toHaveBeenCalled();
    expect(h.sendTextMessage).toHaveBeenCalledWith("5218441112222", REDIRECT);
    expect(console.error).toHaveBeenCalled();
  });

  it("A8: apagado + falla el anti-spam (RPC) → se envía la redirección igual", async () => {
    setOff();
    state.claim = { data: null, error: { message: "boom" } };
    await handleIncomingMessage(payload);
    expect(h.sendTextMessage).toHaveBeenCalledWith("5218441112222", REDIRECT);
    expect(h.generateResponse).not.toHaveBeenCalled();
  });

  it("S10: apagado + falla el envío → NO se manda el mensaje genérico de error", async () => {
    setOff();
    h.sendTextMessage.mockRejectedValue(new Error("meta down"));
    await handleIncomingMessage(payload);
    expect(h.sendTextMessage).toHaveBeenCalledTimes(1);
    expect(h.sendTextMessage).not.toHaveBeenCalledWith(expect.anything(), expect.stringMatching(GENERIC_ERROR));
  });

  it("S10: catch externo con bot apagado → silencio (no hay mensaje genérico)", async () => {
    // El bot estaba encendido al entrar y se apaga antes de que corra el catch.
    h.generateResponse.mockImplementation(async () => {
      setOff();
      throw new Error("groq failed");
    });
    await handleIncomingMessage(payload);
    expect(h.sendTextMessage).not.toHaveBeenCalled();
  });

  it("regresión: encendido y la IA falla → sigue enviando el mensaje genérico de siempre", async () => {
    h.generateResponse.mockRejectedValue(new Error("groq failed"));
    await handleIncomingMessage(payload);
    expect(h.sendTextMessage).toHaveBeenCalledWith("5218441112222", expect.stringMatching(GENERIC_ERROR));
  });

  it("S11: conversación en 'active' (p. ej. tras /ava) con el bot apagado sigue bloqueada", async () => {
    setOff();
    h.getOrCreateConversation.mockResolvedValue(conv({ status: "active" }));
    state.conversationStatus = "active";
    await handleIncomingMessage(payload);
    expect(h.generateResponse).not.toHaveBeenCalled();
  });

  describe("R1: el bot se apaga MIENTRAS la IA genera", () => {
    const AI_SALE = { ...AI_OK, intent: "ready_to_buy", products_mentioned: ["p1"], images_to_send: ["p1"] };

    it("se descarta la respuesta de la IA (no se guarda ni se envía, sin imágenes ni notificaciones) y solo sale la redirección", async () => {
      h.generateResponse.mockImplementation(async () => {
        setOff();
        return AI_SALE;
      });
      await handleIncomingMessage(payload);
      expect(h.generateResponse).toHaveBeenCalledTimes(1);
      expect(h.sendTextMessage).toHaveBeenCalledTimes(1);
      expect(h.sendTextMessage).toHaveBeenCalledWith("5218441112222", REDIRECT);
      expect(h.sendTextMessage).not.toHaveBeenCalledWith(expect.anything(), AI_OK.message);
      expect(h.sendImageMessage).not.toHaveBeenCalled();
      expect(h.notifySale).not.toHaveBeenCalled();
      expect(h.notifyUnknown).not.toHaveBeenCalled();
      expect(h.notifyRep).not.toHaveBeenCalled();
      // solo se guardó el entrante y el aviso; jamás el texto de la IA
      expect(order.some((o) => o.includes(AI_OK.message.slice(0, 12)))).toBe(false);
      expect(order.filter((o) => o.startsWith("save:bot:"))).toHaveLength(1);
      // y no se tocó el estado de la conversación por intención de venta
      expect(state.calls.some((c) => c.table === "conversations" && c.op === "update" && JSON.stringify(c.args).includes("last_intent"))).toBe(false);
    });

    it("fail-closed: si tras la IA ya no se puede leer bot_control → mismo descarte", async () => {
      h.generateResponse.mockImplementation(async () => {
        state.botControl = { data: null, error: { message: "db down" } };
        return AI_SALE;
      });
      await handleIncomingMessage(payload);
      expect(h.sendTextMessage).toHaveBeenCalledTimes(1);
      expect(h.sendTextMessage).toHaveBeenCalledWith("5218441112222", REDIRECT);
      expect(h.sendImageMessage).not.toHaveBeenCalled();
      expect(h.notifySale).not.toHaveBeenCalled();
    });

    it("anti-spam: si ya se avisó dentro de 6 h, tras descartar la IA no se repite el aviso", async () => {
      h.getOrCreateConversation.mockResolvedValue(conv({ context: { bot_off_notice_at: new Date().toISOString() } }));
      h.generateResponse.mockImplementation(async () => {
        setOff();
        return AI_SALE;
      });
      await handleIncomingMessage(payload);
      expect(h.sendTextMessage).not.toHaveBeenCalled();
      expect(h.sendImageMessage).not.toHaveBeenCalled();
    });

    it("regresión: si el bot sigue encendido tras la IA, todo sale como siempre (respuesta + notificación)", async () => {
      h.generateResponse.mockResolvedValue(AI_SALE);
      await handleIncomingMessage(payload);
      expect(h.sendTextMessage).toHaveBeenCalledWith("5218441112222", AI_OK.message);
      expect(h.notifySale).toHaveBeenCalledTimes(1);
    });
  });
});

describe.each(["messenger", "instagram"] as const)("%s — channel-handler", (channel) => {
  const msg: NormalizedMessage = {
    senderId: "PSID123",
    messageId: "mid.1",
    text: "Hola, ¿precio del piso?",
    contactName: "Cliente",
    channel,
  };
  const client = () => ({ name: channel, sendMessage: h.clientSend } as unknown as ChannelClient);

  it("A1: encendido → llama a la IA y envía su respuesta", async () => {
    await handleChannelMessage(msg, client());
    expect(h.generateResponse).toHaveBeenCalledTimes(1);
    expect(h.clientSend).toHaveBeenCalledWith("PSID123", AI_OK.message);
  });

  it("A2/A3: apagado → redirección por el mismo canal, sin IA; entrante guardado", async () => {
    setOff();
    await handleChannelMessage(msg, client());
    expect(h.generateResponse).not.toHaveBeenCalled();
    expect(h.clientSend).toHaveBeenCalledTimes(1);
    expect(h.clientSend).toHaveBeenCalledWith("PSID123", REDIRECT);
    // el entrante se inserta directo en messages (user) antes de avisar
    const insertedUser = state.calls.find((c) => c.table === "messages" && c.op === "insert");
    expect(insertedUser).toBeTruthy();
    expect(order.some((o) => o.startsWith("save:bot:"))).toBe(true);
  });

  it("A4: aviso reciente → no se repite", async () => {
    setOff();
    h.getOrCreateConversation.mockResolvedValue(conv({ context: { bot_off_notice_at: new Date().toISOString() } }));
    await handleChannelMessage(msg, client());
    expect(h.clientSend).not.toHaveBeenCalled();
  });

  it("A8: sin poder leer bot_control → fail-closed", async () => {
    state.botControlThrows = true;
    await handleChannelMessage(msg, client());
    expect(h.generateResponse).not.toHaveBeenCalled();
    expect(h.clientSend).toHaveBeenCalledWith("PSID123", REDIRECT);
  });

  it("S10: apagado + el canal falla al enviar → sin mensaje genérico de error", async () => {
    setOff();
    h.clientSend.mockRejectedValue(new Error("graph down"));
    await handleChannelMessage(msg, client());
    expect(h.clientSend).toHaveBeenCalledTimes(1);
    expect(h.clientSend).not.toHaveBeenCalledWith(expect.anything(), expect.stringMatching(GENERIC_ERROR));
  });

  it("S10: catch externo con el bot apagado → silencio", async () => {
    h.generateResponse.mockImplementation(async () => {
      setOff();
      throw new Error("groq failed");
    });
    await handleChannelMessage(msg, client());
    expect(h.clientSend).not.toHaveBeenCalled();
  });

  it("regresión: encendido y la IA falla → mensaje genérico como siempre", async () => {
    h.generateResponse.mockRejectedValue(new Error("groq failed"));
    await handleChannelMessage(msg, client());
    expect(h.clientSend).toHaveBeenCalledWith("PSID123", expect.stringMatching(GENERIC_ERROR));
  });

  describe("R1: el bot se apaga MIENTRAS la IA genera", () => {
    const AI_SALE = { ...AI_OK, intent: "ready_to_buy", products_mentioned: ["p1"], images_to_send: ["p1"] };

    it("se descarta la respuesta de la IA y solo sale la redirección (sin imágenes ni notificaciones)", async () => {
      const sendImage = vi.fn(async () => true);
      const c = { name: channel, sendMessage: h.clientSend, sendImage } as unknown as ChannelClient;
      h.generateResponse.mockImplementation(async () => {
        setOff();
        return AI_SALE;
      });
      await handleChannelMessage(msg, c);
      expect(h.generateResponse).toHaveBeenCalledTimes(1);
      expect(h.clientSend).toHaveBeenCalledTimes(1);
      expect(h.clientSend).toHaveBeenCalledWith("PSID123", REDIRECT);
      expect(h.clientSend).not.toHaveBeenCalledWith(expect.anything(), AI_OK.message);
      expect(sendImage).not.toHaveBeenCalled();
      expect(h.notifySale).not.toHaveBeenCalled();
      expect(order.some((o) => o.includes(AI_OK.message.slice(0, 12)))).toBe(false);
      expect(order.filter((o) => o.startsWith("save:bot:"))).toHaveLength(1);
    });

    it("fail-closed: tras la IA ya no se puede leer bot_control → mismo descarte", async () => {
      h.generateResponse.mockImplementation(async () => {
        state.botControlThrows = true;
        return AI_SALE;
      });
      await handleChannelMessage(msg, client());
      expect(h.clientSend).toHaveBeenCalledTimes(1);
      expect(h.clientSend).toHaveBeenCalledWith("PSID123", REDIRECT);
      expect(h.notifySale).not.toHaveBeenCalled();
    });

    it("anti-spam: aviso reciente → tras descartar la IA no se repite", async () => {
      h.getOrCreateConversation.mockResolvedValue(conv({ context: { bot_off_notice_at: new Date().toISOString() } }));
      h.generateResponse.mockImplementation(async () => {
        setOff();
        return AI_SALE;
      });
      await handleChannelMessage(msg, client());
      expect(h.clientSend).not.toHaveBeenCalled();
    });

    it("regresión: encendido tras la IA → respuesta y notificación como siempre", async () => {
      h.generateResponse.mockResolvedValue(AI_SALE);
      await handleChannelMessage(msg, client());
      expect(h.clientSend).toHaveBeenCalledWith("PSID123", AI_OK.message);
      expect(h.notifySale).toHaveBeenCalledTimes(1);
    });
  });
});
