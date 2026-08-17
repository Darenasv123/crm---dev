import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const isTestEnvironment = import.meta.env.MODE === "test";

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL?.trim() || (isTestEnvironment ? "http://127.0.0.1:54321" : "");

const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() || (isTestEnvironment ? "test-anon-key" : "");

if (!SUPABASE_URL) {
  throw new Error(
    "VITE_SUPABASE_URL no configurada. El build requiere un endpoint Supabase explícito.",
  );
}

if (!SUPABASE_ANON_KEY) {
  throw new Error(
    "VITE_SUPABASE_ANON_KEY no configurada. El build requiere una clave anon/publishable explícita.",
  );
}

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
  },
  global: {
    headers: {
      "x-client-info": "crm-juridico",
    },
  },
});

/**
 * Returns a Supabase client with the current session's access token
 * injected explicitly — required for RLS with new ECC JWT keys.
 */
export async function getAuthClient() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) return supabase;

  return createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    },
  });
}
