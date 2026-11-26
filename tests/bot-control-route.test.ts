import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getUser: vi.fn(),
  upsert: vi.fn(),
  from: vi.fn(),
  createServerClient: vi.fn(),
  getSupabase: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: (...a: unknown[]) => {
    h.createServerClient(...a);
    return { auth: { getUser: h.getUser } };
  },
}));
vi.mock("../lib/supabase", () => ({
  getSupabase: () => {
    h.getSupabase();
    return { from: h.from };
  },
}));

import { POST } from "../app/api/bot-control/route";
import * as route from "../app/api/bot-control/route";

function req(body: unknown, init: { headers?: Record<string, string>; raw?: string } = {}) {
  return new Request("https://crm.example.com/api/bot-control", {
    method: "POST",
    headers: { "content-type": "application/json", host: "crm.example.com", ...init.headers },
    body: init.raw ?? JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  h.getUser.mockResolvedValue({ data: { user: { id: "user-uuid-1" } } });
  h.upsert.mockResolvedValue({ error: null });
  h.from.mockReturnValue({ upsert: h.upsert });
});

describe("S1: auth y validación", () => {
  it("sin sesión → 401 sin leer ni escribir bot_control", async () => {
    h.getUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(req({ enabled: false }));
    expect(res.status).toBe(401);
    expect(h.getSupabase).not.toHaveBeenCalled();
    expect(h.from).not.toHaveBeenCalled();
  });

  it("la sesión se verifica con la anon key, nunca con la service role", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    await POST(req({ enabled: true }));
    expect(h.createServerClient.mock.calls[0][1]).toBe("anon-key");
    expect(JSON.stringify(h.createServerClient.mock.calls)).not.toContain("service-role-secret");
  });

  it.each([
    ["enabled faltante", {}],
    ['enabled string "false"', { enabled: "false" }],
    ["enabled número", { enabled: 0 }],
    ["enabled null", { enabled: null }],
    ["arreglo", []],
    ["null", null],
  ])("body inválido (%s) → 400 sin tocar la BD", async (_n, body) => {
    const res = await POST(req(body));
    expect(res.status).toBe(400);
    expect(h.from).not.toHaveBeenCalled();
  });

  it("JSON inválido → 400", async () => {
    const res = await POST(req(null, { raw: "{no json" }));
    expect(res.status).toBe(400);
    expect(h.from).not.toHaveBeenCalled();
  });

  it("Content-Type distinto de application/json → 400", async () => {
    const res = await POST(req({ enabled: false }, { headers: { "content-type": "text/plain" } }));
    expect(res.status).toBe(400);
    expect(h.from).not.toHaveBeenCalled();
  });

  it("Origin de otro sitio (CSRF) → 403 sin siquiera consultar la sesión", async () => {
    const res = await POST(req({ enabled: false }, { headers: { origin: "https://evil.example" } }));
    expect(res.status).toBe(403);
    expect(h.getUser).not.toHaveBeenCalled();
    expect(h.from).not.toHaveBeenCalled();
  });

  it("Sec-Fetch-Site: cross-site → 403", async () => {
    const res = await POST(req({ enabled: false }, { headers: { "sec-fetch-site": "cross-site" } }));
    expect(res.status).toBe(403);
  });

  it("mismo Origin → pasa", async () => {
    const res = await POST(req({ enabled: false }, { headers: { origin: "https://crm.example.com" } }));
    expect(res.status).toBe(200);
  });

  it("solo expone POST (GET/PUT/DELETE no existen → 405 de Next)", () => {
    expect(Object.keys(route).filter((k) => ["GET", "PUT", "PATCH", "DELETE"].includes(k))).toEqual([]);
  });
});

describe("S2: integridad de campos y auditoría", () => {
  it.each(["redirect_phone", "updated_by", "id", "updated_at"])("rechaza %s enviado por el cliente (400)", async (field) => {
    const res = await POST(req({ enabled: false, [field]: "x" }));
    expect(res.status).toBe(400);
    expect(h.from).not.toHaveBeenCalled();
  });

  it("escribe solo id/enabled/updated_at/updated_by y updated_by = user.id de la sesión", async () => {
    const res = await POST(req({ enabled: false }));
    expect(res.status).toBe(200);
    expect(h.from).toHaveBeenCalledWith("bot_control");
    const [row, opts] = h.upsert.mock.calls[0];
    expect(Object.keys(row).sort()).toEqual(["enabled", "id", "updated_at", "updated_by"]);
    expect(row).toMatchObject({ id: 1, enabled: false, updated_by: "user-uuid-1" });
    expect(row).not.toHaveProperty("redirect_phone");
    expect(opts).toEqual({ onConflict: "id" });
  });

  it("emite log estructurado de auditoría con user.id, estado y timestamp", async () => {
    await POST(req({ enabled: true }));
    const logged = (console.log as unknown as { mock: { calls: string[][] } }).mock.calls
      .map((c) => c[0])
      .find((l) => typeof l === "string" && l.includes("bot_control_change"));
    const parsed = JSON.parse(logged as string);
    expect(parsed).toMatchObject({ event: "bot_control_change", user_id: "user-uuid-1", enabled: true });
    expect(Date.parse(parsed.at)).not.toBeNaN();
  });
});

describe("S6: sin fuga de errores internos", () => {
  it("error de Postgres → 500 genérico, sin detalles", async () => {
    h.upsert.mockResolvedValue({ error: { code: "42P01", message: 'relation "bot_control" does not exist' } });
    const res = await POST(req({ enabled: false }));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toMatch(/bot_control|42P01|relation/);
    expect(JSON.parse(text)).toEqual({ error: "Internal server error" });
  });

  it("excepción inesperada → 500 genérico", async () => {
    h.upsert.mockRejectedValue(new Error("secret stack"));
    const res = await POST(req({ enabled: false }));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("secret");
  });
});
