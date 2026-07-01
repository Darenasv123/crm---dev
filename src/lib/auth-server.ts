import { createClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { readServerEnv } from "./env-server";

function getSupabaseConfig() {
  const url =
    readServerEnv("SUPABASE_URL") ||
    "https://pnqdgwpxcxngeueosmnh.supabase.co";
  const anonKey =
    readServerEnv("SUPABASE_ANON_KEY") ||
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBucWRnd3B4Y3huZ2V1ZW9zbW5oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3NDEwMTMsImV4cCI6MjA5ODMxNzAxM30._IQph5gAHaCwdOEDlG-uGmjiciZ1aJQxxCsQAk9GZiY";
  return { url, anonKey };
}

/** Validates the Supabase JWT from the client session. */
export async function requireUser(accessToken: string): Promise<User> {
  const { url, anonKey } = getSupabaseConfig();
  const client = createClient<Database>(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: { user }, error } = await client.auth.getUser(accessToken);
  if (error || !user) {
    throw new Error("Sesión inválida. Inicia sesión de nuevo.");
  }
  return user;
}
