import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(join(root, dir))) {
    const rel = join(dir, e);
    if (statSync(join(root, rel)).isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

describe("S5: UI en texto plano", () => {
  it("el switch/banner no usa dangerouslySetInnerHTML ni innerHTML", () => {
    const src = read("app/components/bot-control.tsx");
    expect(src).not.toMatch(/dangerouslySetInnerHTML|innerHTML/);
  });
  it("ninguna parte del bot-switch invoca a la IA", () => {
    expect(read("lib/bot-switch.ts")).not.toMatch(/generateResponse|from "\.\/ai"|groq/i);
  });
});

describe("S6: ninguna llave privada en el bundle del cliente", () => {
  it("los archivos 'use client' no referencian SERVICE_ROLE ni lib/supabase (service role)", () => {
    const clientFiles = walk("app").filter((f) => /\.tsx?$/.test(f) && read(f).trimStart().startsWith('"use client"'));
    expect(clientFiles.length).toBeGreaterThan(0);
    for (const f of clientFiles) {
      const src = read(f);
      expect(src, f).not.toMatch(/SERVICE_ROLE/);
      expect(src, f).not.toMatch(/lib\/supabase["']/);
    }
  });
  it("el componente solo escribe vía /api/bot-control (nunca .update/.upsert/.insert a bot_control)", () => {
    const src = read("app/components/bot-control.tsx");
    expect(src).toContain('"/api/bot-control"');
    expect(src).not.toMatch(/\.(update|upsert|insert|delete)\(/);
  });
});

describe("S8: webhooks verifican la firma antes de procesar, ecos descartados", () => {
  it.each([
    ["app/api/webhook/route.ts", "verifyWebhookSignature", "handleIncomingMessage"],
    ["app/api/webhook/messenger/route.ts", "verifySignature", "handleChannelMessage"],
    ["app/api/webhook/instagram/route.ts", "verifySignature", "handleChannelMessage"],
  ])("%s", (file, verify, handler) => {
    const src = read(file);
    const post = src.slice(src.indexOf("export async function POST"));
    expect(post.indexOf(verify)).toBeGreaterThan(-1);
    expect(post.indexOf(verify)).toBeLessThan(post.indexOf(handler));
  });
  it("messenger e instagram descartan is_echo antes de llegar al handler", () => {
    expect(read("lib/channels/messenger.ts")).toMatch(/is_echo\) continue/);
    expect(read("lib/channels/instagram.ts")).toMatch(/is_echo\) continue/);
  });
  it("el interruptor corre después de guardar el entrante y antes de la IA en ambos handlers", () => {
    const wa = read("lib/message-handler.ts");
    expect(wa.indexOf('saveMessage(conversation.id, "user"')).toBeLessThan(wa.indexOf("getBotControl()"));
    expect(wa.indexOf("getBotControl()")).toBeLessThan(wa.indexOf("generateResponse("));
    const ch = read("lib/channel-handler.ts");
    expect(ch.indexOf('sender: "user"')).toBeLessThan(ch.indexOf("getBotControl()"));
    expect(ch.indexOf("getBotControl()")).toBeLessThan(ch.indexOf("generateResponse("));
  });
});

describe("A9: el flag no llega al prompt ni a Configuración", () => {
  it("bot_control no se menciona en ai.ts, database.ts ni dashboard/settings", () => {
    for (const f of ["lib/ai.ts", "lib/database.ts", "app/dashboard/settings/page.tsx"]) {
      expect(read(f), f).not.toMatch(/bot_control|bot-switch/);
    }
  });
});
