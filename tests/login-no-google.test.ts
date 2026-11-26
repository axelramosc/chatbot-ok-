import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("login: sin Google (OAuth apagado en Supabase)", () => {
  const src = readFileSync(join(__dirname, "../app/login/page.tsx"), "utf8");
  it("no hay botón ni llamada de OAuth con Google", () => {
    expect(src).not.toMatch(/google/i);
    expect(src).not.toMatch(/signInWithOAuth/);
  });
  it("sigue el inicio de sesión con correo y contraseña", () => {
    expect(src).toMatch(/signInWithPassword/);
    expect(src).toContain("Entrar con correo");
  });
});
