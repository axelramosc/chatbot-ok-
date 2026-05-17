import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _supabase: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (_supabase) return _supabase;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables"
    );
  }

  _supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      fetch: (url, options) => {
        // Asegurar que Next.js NUNCA guarde en caché las peticiones de Supabase
        // Next.js App Router es muy agresivo con el caché de fetch (incluso ignorando no-store).
        // Al agregar un timestamp, la URL cambia siempre y rompe el caché.
        const fetchUrl = typeof url === "string" ? url : url.toString();
        const urlObj = new URL(fetchUrl);
        urlObj.searchParams.append("_t", Date.now().toString());

        return fetch(urlObj.toString(), {
          ...options,
          cache: "no-store",
          next: { revalidate: 0 },
        });
      },
    },
  });

  return _supabase;
}
