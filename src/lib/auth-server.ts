import { createClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { requireServerEnv } from "./env-server";

function getSupabaseConfig() {
  const url = requireServerEnv("SUPABASE_URL");
  const anonKey = requireServerEnv("SUPABASE_ANON_KEY");
  return { url, anonKey };
}

/** Validates the Supabase JWT from the client session. */
export async function requireUser(accessToken: string): Promise<User> {
  const { url, anonKey } = getSupabaseConfig();
  const client = createClient<Database>(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const {
    data: { user },
    error,
  } = await client.auth.getUser(accessToken);
  if (error || !user) {
    throw new Error("Sesión inválida. Inicia sesión de nuevo.");
  }
  return user;
}
