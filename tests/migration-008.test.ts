import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";

/**
 * Prueba la migración 008 sobre Postgres real (PGlite, en memoria) emulando los roles de
 * Supabase. NUNCA toca una base remota. Cubre S3 (RLS), S7 (claim atómico) y A10 (reversa).
 */
const MIGRATION = readFileSync(join(__dirname, "../supabase/migrations/008_bot_control.sql"), "utf8");
const ROLLBACK = readFileSync(join(__dirname, "../supabase/rollbacks/008_bot_control_down.sql"), "utf8");
const M009 = readFileSync(join(__dirname, "../supabase/migrations/009_bot_control_phone.sql"), "utf8");
const R009 = readFileSync(join(__dirname, "../supabase/rollbacks/009_bot_control_phone_down.sql"), "utf8");

const CONV = "11111111-1111-1111-1111-111111111111";

async function freshDb() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
    create publication supabase_realtime;
    create table conversations (id uuid primary key, context jsonb default '{}'::jsonb);
    insert into conversations (id, context) values ('${CONV}', '{"customer_city":"Saltillo","products_interested":["a"]}');
  `);
  await db.exec(MIGRATION);
  return db;
}

async function as<T>(db: PGlite, role: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${role}`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}

describe("migración 008", () => {
  let db: PGlite;
  beforeEach(async () => {
    db = await freshDb();
  });

  it("A10: es idempotente (se puede aplicar dos veces) y arranca ENCENDIDA", async () => {
    await db.exec(MIGRATION);
    const r = await db.query<{ enabled: boolean; redirect_phone: string }>("select enabled, redirect_phone from bot_control");
    expect(r.rows).toEqual([{ enabled: true, redirect_phone: "8442739524" }]);
  });

  it("solo puede existir la fila id=1", async () => {
    await expect(db.exec("insert into bot_control (id) values (2)")).rejects.toThrow();
  });

  it("S3: anon no tiene ningún acceso", async () => {
    for (const sql of [
      "select * from bot_control",
      "insert into bot_control (id) values (1)",
      "update bot_control set enabled = false",
      "delete from bot_control",
    ]) {
      await expect(as(db, "anon", () => db.exec(sql)), sql).rejects.toThrow(/permission denied/);
    }
  });

  it("S3: authenticated solo puede SELECT", async () => {
    const rows = await as(db, "authenticated", () => db.query("select enabled from bot_control"));
    expect(rows.rows).toHaveLength(1);
    for (const sql of [
      "update bot_control set redirect_phone = '5555555555'",
      "update bot_control set enabled = false",
      "delete from bot_control",
      "insert into bot_control (id) values (1) on conflict (id) do update set enabled = false",
    ]) {
      await expect(as(db, "authenticated", () => db.exec(sql)), sql).rejects.toThrow(/permission denied/);
    }
    const after = await db.query<{ enabled: boolean }>("select enabled from bot_control");
    expect(after.rows[0].enabled).toBe(true);
  });

  it("S3: aun si alguien concediera privilegios por error, RLS (sin política de escritura) bloquea", async () => {
    await db.exec("grant update, delete, insert on bot_control to authenticated");
    await as(db, "authenticated", async () => {
      expect((await db.query("update bot_control set enabled = false returning id")).rows).toHaveLength(0);
      expect((await db.query("delete from bot_control returning id")).rows).toHaveLength(0);
      await expect(db.exec("insert into bot_control (id, enabled) values (1, false)")).rejects.toThrow();
    });
    const r = await db.query<{ enabled: boolean; redirect_phone: string }>("select enabled, redirect_phone from bot_control");
    expect(r.rows).toEqual([{ enabled: true, redirect_phone: "8442739524" }]);
  });

  it("S2/S3: service_role sí puede escribir (único camino: /api/bot-control)", async () => {
    await as(db, "service_role", () => db.exec("update bot_control set enabled = false, updated_by = 'u1'"));
    const r = await db.query<{ enabled: boolean; updated_by: string }>("select enabled, updated_by from bot_control");
    expect(r.rows[0]).toEqual({ enabled: false, updated_by: "u1" });
  });

  it("realtime: bot_control queda publicada", async () => {
    const r = await db.query("select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='bot_control'");
    expect(r.rows).toHaveLength(1);
  });

  describe("claim_bot_off_notice (S7)", () => {
    const claim = async (role = "service_role") =>
      (await as(db, role, () => db.query<{ claim_bot_off_notice: boolean }>(`select claim_bot_off_notice('${CONV}')`))).rows[0].claim_bot_off_notice;
    const ctx = async () => (await db.query<{ context: Record<string, unknown> }>(`select context from conversations where id='${CONV}'`)).rows[0].context;

    it("primer aviso true; el segundo dentro de 6 h false; preserva las demás llaves", async () => {
      expect(await claim()).toBe(true);
      expect(await claim()).toBe(false);
      const c = await ctx();
      expect(c.customer_city).toBe("Saltillo");
      expect(c.products_interested).toEqual(["a"]);
      expect(typeof c.bot_off_notice_at).toBe("string");
      expect(Number.isNaN(Date.parse(c.bot_off_notice_at as string))).toBe(false);
    });

    it("ráfaga concurrente: exactamente UNA solicitud gana la reserva", async () => {
      const results = await Promise.all([claim(), claim(), claim(), claim()]);
      expect(results.filter(Boolean)).toHaveLength(1);
    });

    it("pasadas 6 h permite reenviar", async () => {
      await claim();
      await db.exec(`update conversations set context = jsonb_set(context, '{bot_off_notice_at}', to_jsonb((now() - interval '6 hours 1 minute')::text)) where id='${CONV}'`);
      expect(await claim()).toBe(true);
    });

    it("dentro de 5 h 59 min NO reenvía", async () => {
      await db.exec(`update conversations set context = jsonb_set(context, '{bot_off_notice_at}', to_jsonb((now() - interval '5 hours 59 minutes')::text)) where id='${CONV}'`);
      expect(await claim()).toBe(false);
    });

    it("marca inválida o futura no silencia al cliente", async () => {
      await db.exec(`update conversations set context = context || '{"bot_off_notice_at":"basura"}' where id='${CONV}'`);
      expect(await claim()).toBe(true);
      await db.exec(`update conversations set context = jsonb_set(context, '{bot_off_notice_at}', to_jsonb((now() + interval '3 days')::text)) where id='${CONV}'`);
      expect(await claim()).toBe(true);
    });

    it("context nulo o no-objeto se normaliza sin perder el aviso", async () => {
      await db.exec(`update conversations set context = null where id='${CONV}'`);
      expect(await claim()).toBe(true);
      await db.exec(`update conversations set context = '[1,2]'::jsonb where id='${CONV}'`);
      expect(await claim()).toBe(true);
    });

    it("conversación inexistente → true (se avisa igual)", async () => {
      const r = await db.query<{ claim_bot_off_notice: boolean }>("select claim_bot_off_notice('22222222-2222-2222-2222-222222222222')");
      expect(r.rows[0].claim_bot_off_notice).toBe(true);
    });

    it("release_bot_off_notice borra solo la marca", async () => {
      await claim();
      await as(db, "service_role", () => db.exec(`select release_bot_off_notice('${CONV}')`));
      const c = await ctx();
      expect(c).not.toHaveProperty("bot_off_notice_at");
      expect(c.customer_city).toBe("Saltillo");
      expect(await claim()).toBe(true);
    });

    it("anon y authenticated NO pueden ejecutar las funciones (PostgREST rpc)", async () => {
      for (const role of ["anon", "authenticated"]) {
        await expect(claim(role), role).rejects.toThrow(/permission denied/);
        await expect(as(db, role, () => db.exec(`select release_bot_off_notice('${CONV}')`)), role).rejects.toThrow(/permission denied/);
      }
    });
  });

  it("A10: la reversa elimina todo y la migración se puede volver a aplicar", async () => {
    await db.exec(ROLLBACK);
    await expect(db.exec("select * from bot_control")).rejects.toThrow();
    await expect(db.exec(`select claim_bot_off_notice('${CONV}')`)).rejects.toThrow();
    const pub = await db.query("select 1 from pg_publication_tables where tablename='bot_control'");
    expect(pub.rows).toHaveLength(0);
    // la reversa es idempotente y no toca el resto del esquema
    await db.exec(ROLLBACK);
    expect((await db.query("select count(*)::int as n from conversations")).rows[0]).toEqual({ n: 1 });
    await db.exec(MIGRATION);
    expect((await db.query("select count(*)::int as n from bot_control")).rows[0]).toEqual({ n: 1 });
  });

  describe("migración 009 (nuevo teléfono)", () => {
    const phone = async () => (await db.query<{ redirect_phone: string }>("select redirect_phone from bot_control")).rows[0].redirect_phone;

    it("cambia la fila existente al teléfono nuevo y deja el default nuevo; es idempotente", async () => {
      expect(await phone()).toBe("8442739524");
      await db.exec(M009);
      expect(await phone()).toBe("8445089882");
      await db.exec(M009);
      expect(await phone()).toBe("8445089882");
      await db.exec("delete from bot_control");
      await db.exec("insert into bot_control (id) values (1)");
      expect(await phone()).toBe("8445089882"); // default nuevo
    });

    it("no pisa un teléfono puesto a mano", async () => {
      await db.exec("update bot_control set redirect_phone = '5551234567'");
      await db.exec(M009);
      expect(await phone()).toBe("5551234567");
    });

    it("no cambia enabled (el bot sigue como estaba)", async () => {
      await db.exec("update bot_control set enabled = false");
      await db.exec(M009);
      const r = await db.query<{ enabled: boolean }>("select enabled from bot_control");
      expect(r.rows[0].enabled).toBe(false);
    });

    it("la reversa devuelve el teléfono anterior", async () => {
      await db.exec(M009);
      await db.exec(R009);
      expect(await phone()).toBe("8442739524");
    });
  });
});
