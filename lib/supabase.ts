import { createClient, SupabaseClient } from "@supabase/supabase-js";

// NOTE: No usamos singleton para evitar que el cliente quede "pegado" a credenciales
// o estado obsoleto entre requests en el entorno serverless de Vercel/Next.js.
export function getSupabase(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables"
    );
  }

  // IMPORTANTE: NO agregar parámetros extra (_t, etc.) a la URL de PostgREST.
  // PostgREST rechaza parámetros de query desconocidos con HTTP 400.
  // Para evitar el caché de Next.js App Router, basta con cache: "no-store"
  // + export const dynamic = "force-dynamic" en las rutas de la API.
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      fetch: (url, options) => {
        return fetch(url, {
          ...options,
          cache: "no-store",
        });
      },
    },
  });
}
