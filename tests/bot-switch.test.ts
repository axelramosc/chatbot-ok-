import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeFakeSupabase, makeState, type FakeState } from "./helpers/fake-supabase";

let state: FakeState;
vi.mock("../lib/supabase", () => ({ getSupabase: () => makeFakeSupabase(state) }));

import {
  BOT_OFF_NOTICE_WINDOW_MS,
  buildRedirectMessage,
  getBotControl,
  sendBotOffRedirect,
  shouldSendRedirect,
} from "../lib/bot-switch";

beforeEach(() => {
  state = makeState();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("getBotControl (A8, S10: fail-closed)", () => {
  it("fila enabled=true → encendido", async () => {
    expect(await getBotControl()).toMatchObject({ enabled: true, failClosed: false });
  });
  it("fila enabled=false → apagado por orden explícita", async () => {
    state.botControl = { data: { enabled: false, redirect_phone: "8442739524" }, error: null };
    expect(await getBotControl()).toMatchObject({ enabled: false, failClosed: false });
  });
  it("error de lectura → apagado + log de error + teléfono constante", async () => {
    state.botControl = { data: null, error: { message: "relation does not exist" } };
    const r = await getBotControl();
    expect(r).toEqual({ enabled: false, redirectPhone: "8442739524", failClosed: true });
    expect(console.error).toHaveBeenCalled();
  });
  it("fila inexistente → apagado", async () => {
    state.botControl = { data: null, error: null };
    expect((await getBotControl()).enabled).toBe(false);
  });
  it("excepción al leer → apagado y NO lanza", async () => {
    state.botControlThrows = true;
    expect((await getBotControl()).enabled).toBe(false);
  });
  it.each([["true"], [1], [null], [undefined]])("enabled no booleano (%s) → apagado", async (v) => {
    state.botControl = { data: { enabled: v, redirect_phone: "8442739524" }, error: null };
    expect((await getBotControl()).enabled).toBe(false);
  });
  it("teléfono inválido en BD → usa el constante", async () => {
    state.botControl = { data: { enabled: false, redirect_phone: "<script>" }, error: null };
    expect((await getBotControl()).redirectPhone).toBe("8442739524");
  });
});

describe("buildRedirectMessage (S5: texto fijo)", () => {
  it("incluye 844 273 9524 y es idéntico en cada llamada", () => {
    const m = buildRedirectMessage("8442739524");
    expect(m).toContain("844 273 9524");
    expect(buildRedirectMessage("8442739524")).toBe(m);
  });
  it("no interpola datos arbitrarios: un teléfono malicioso cae al constante", () => {
    const m = buildRedirectMessage("<img src=x onerror=alert(1)>");
    expect(m).not.toContain("<img");
    expect(m).toContain("844 273 9524");
  });
  it("la función solo acepta teléfono (sin parámetros de cliente/contacto)", () => {
    expect(buildRedirectMessage.length).toBeLessThanOrEqual(1);
  });
});

describe("shouldSendRedirect (A4, S7)", () => {
  const now = Date.parse("2026-11-26T12:00:00Z");
  it("sin marca → envía", () => expect(shouldSendRedirect({}, now)).toBe(true));
  it("contexto nulo → envía", () => expect(shouldSendRedirect(null, now)).toBe(true));
  it("marca de hace 1 h → NO envía", () =>
    expect(shouldSendRedirect({ bot_off_notice_at: "2026-11-26T11:00:00Z" }, now)).toBe(false));
  it("marca de hace 5 h 59 min → NO envía", () =>
    expect(shouldSendRedirect({ bot_off_notice_at: new Date(now - BOT_OFF_NOTICE_WINDOW_MS + 60_000).toISOString() }, now)).toBe(false));
  it("marca de hace exactamente 6 h → envía", () =>
    expect(shouldSendRedirect({ bot_off_notice_at: new Date(now - BOT_OFF_NOTICE_WINDOW_MS).toISOString() }, now)).toBe(true));
  it("marca inválida o futura NO silencia al cliente", () => {
    expect(shouldSendRedirect({ bot_off_notice_at: "basura" }, now)).toBe(true);
    expect(shouldSendRedirect({ bot_off_notice_at: 123 }, now)).toBe(true);
    expect(shouldSendRedirect({ bot_off_notice_at: "2030-01-01T00:00:00Z" }, now)).toBe(true);
  });
});

describe("sendBotOffRedirect", () => {
  const base = () => ({
    conversationId: "c1",
    context: {} as Record<string, unknown>,
    redirectPhone: "8442739524",
    send: vi.fn(async () => true),
    saveBotMessage: vi.fn(async () => ({})),
    label: "test",
  });

  it("envía el aviso fijo, lo guarda como mensaje bot y reserva la marca", async () => {
    const p = base();
    expect(await sendBotOffRedirect(p)).toBe("sent");
    expect(p.send).toHaveBeenCalledWith(buildRedirectMessage("8442739524"));
    expect(p.saveBotMessage).toHaveBeenCalledWith("c1", buildRedirectMessage("8442739524"));
    expect(state.rpcCalls[0].fn).toBe("claim_bot_off_notice");
  });
  it("marca reciente en contexto → no envía y no toca la BD (A4)", async () => {
    const p = { ...base(), context: { bot_off_notice_at: new Date().toISOString() } };
    expect(await sendBotOffRedirect(p)).toBe("skipped");
    expect(p.send).not.toHaveBeenCalled();
    expect(state.rpcCalls).toHaveLength(0);
  });
  it("ráfaga concurrente: el claim atómico devuelve false → no envía (S7)", async () => {
    state.claim = { data: false, error: null };
    const p = base();
    expect(await sendBotOffRedirect(p)).toBe("skipped");
    expect(p.send).not.toHaveBeenCalled();
  });
  it("falla el anti-spam (RPC con error) → se envía igual (A8)", async () => {
    state.claim = { data: null, error: { message: "function does not exist" } };
    const p = base();
    expect(await sendBotOffRedirect(p)).toBe("sent");
    expect(p.send).toHaveBeenCalled();
  });
  it("el RPC lanza excepción → se envía igual y no lanza", async () => {
    state.claimThrows = true;
    const p = base();
    expect(await sendBotOffRedirect(p)).toBe("sent");
  });
  it("si el envío falla se libera la marca y no lanza", async () => {
    const p = { ...base(), send: vi.fn(async () => false) };
    expect(await sendBotOffRedirect(p)).toBe("failed");
    expect(state.rpcCalls.map((c) => c.fn)).toContain("release_bot_off_notice");
    expect(p.saveBotMessage).not.toHaveBeenCalled();
  });
  it("si send lanza excepción no se propaga (S10)", async () => {
    const p = { ...base(), send: vi.fn(async () => { throw new Error("net"); }) };
    await expect(sendBotOffRedirect(p)).resolves.toBe("failed");
  });
  it("si guardar en la bandeja falla igual cuenta como enviado y no lanza", async () => {
    const p = { ...base(), saveBotMessage: vi.fn(async () => { throw new Error("db"); }) };
    await expect(sendBotOffRedirect(p)).resolves.toBe("sent");
  });
  it("conversación fallback-id: envía sin tocar la BD", async () => {
    const p = { ...base(), conversationId: "fallback-id" };
    expect(await sendBotOffRedirect(p)).toBe("sent");
    expect(state.rpcCalls).toHaveLength(0);
    expect(p.saveBotMessage).not.toHaveBeenCalled();
  });
});
