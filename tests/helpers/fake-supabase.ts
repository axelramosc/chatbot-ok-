import { vi } from "vitest";

type Result = { data: unknown; error: { message: string; code?: string } | null };

export interface FakeState {
  /** Resultado de SELECT sobre bot_control (o lanza si throws=true). */
  botControl: Result;
  botControlThrows: boolean;
  /** Resultado de rpc("claim_bot_off_notice"). */
  claim: Result;
  claimThrows: boolean;
  /** Resultado genérico de las demás tablas. */
  conversationStatus: string;
  calls: { table: string; op: string; args: unknown[] }[];
  rpcCalls: { fn: string; args: unknown }[];
  upsertResult: Result;
}

export function makeState(): FakeState {
  return {
    botControl: { data: { enabled: true, redirect_phone: "8445089882" }, error: null },
    botControlThrows: false,
    claim: { data: true, error: null },
    claimThrows: false,
    conversationStatus: "active",
    calls: [],
    rpcCalls: [],
    upsertResult: { data: null, error: null },
  };
}

function chain(state: FakeState, table: string, result: (single?: boolean) => Result) {
  const c: any = new Proxy(function () {}, {
    get(_t, prop: string) {
      if (prop === "then") return (res: (v: Result) => unknown) => res(result());
      if (prop === "single" || prop === "maybeSingle") return () => Promise.resolve(result(true));
      return (...args: unknown[]) => {
        state.calls.push({ table, op: prop, args });
        return c;
      };
    },
  });
  return c;
}

export function makeFakeSupabase(state: FakeState) {
  return {
    from(table: string) {
      return chain(state, table, (single) => {
        if (table === "bot_control") {
          // Se consulta de forma perezosa: la excepción ocurre al "await".
          if (state.botControlThrows) throw new Error("boom");
          return state.botControl;
        }
        if (table === "conversations") {
          // .single() → fila con estado; await directo → lista (la usa el cron)
          return { data: single ? { status: state.conversationStatus } : [], error: null };
        }
        if (table === "messages") return { data: null, error: null }; // dedupe: no existe
        return { data: [], error: null };
      });
    },
    rpc: vi.fn(async (fn: string, args: unknown) => {
      state.rpcCalls.push({ fn, args });
      if (fn === "claim_bot_off_notice") {
        if (state.claimThrows) throw new Error("rpc boom");
        return state.claim;
      }
      return { data: null, error: null };
    }),
  };
}
