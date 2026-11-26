import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeFakeSupabase, makeState, type FakeState } from "./helpers/fake-supabase";

let state: FakeState;
const send = vi.hoisted(() => vi.fn(async () => true));

vi.mock("../lib/supabase", () => ({ getSupabase: () => makeFakeSupabase(state) }));
vi.mock("../lib/whatsapp", () => ({ sendTextMessage: send }));
vi.mock("../lib/database", () => ({ getBusinessSettings: vi.fn(async () => ({})) }));

import { GET } from "../app/api/cron/follow-up/route";

const auth = () => new Request("https://x/api/cron/follow-up", { headers: { authorization: "Bearer s3cret" } });

beforeEach(() => {
  state = makeState();
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  process.env.CRON_SECRET = "s3cret";
});

describe("cron follow-up (A5, S9)", () => {
  it("apagado → { skipped: 'bot_off' }, no envía y no toca conversaciones", async () => {
    state.botControl = { data: { enabled: false, redirect_phone: "8445089882" }, error: null };
    const res = await GET(auth());
    expect(await res.json()).toEqual({ skipped: "bot_off" });
    expect(send).not.toHaveBeenCalled();
    expect(state.calls.filter((c) => c.table === "conversations")).toHaveLength(0);
  });

  it("fail-closed: no se puede leer bot_control → también se salta", async () => {
    state.botControl = { data: null, error: { message: "down" } };
    const res = await GET(auth());
    expect(await res.json()).toEqual({ skipped: "bot_off" });
    expect(send).not.toHaveBeenCalled();
  });

  it("sigue exigiendo CRON_SECRET (401 sin él) antes de leer nada", async () => {
    const res = await GET(new Request("https://x/api/cron/follow-up"));
    expect(res.status).toBe(401);
    expect(state.calls).toHaveLength(0);
  });

  it("encendido → comportamiento de siempre (consulta sale_pending)", async () => {
    const res = await GET(auth());
    expect(state.calls.some((c) => c.table === "conversations" && c.op === "select")).toBe(true);
    expect(await res.json()).not.toHaveProperty("skipped");
  });
});
