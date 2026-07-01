import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ?? "https://pnqdgwpxcxngeueosmnh.supabase.co";
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBucWRnd3B4Y3huZ2V1ZW9zbW5oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3NDEwMTMsImV4cCI6MjA5ODMxNzAxM30._IQph5gAHaCwdOEDlG-uGmjiciZ1aJQxxCsQAk9GZiY";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
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
  const { data: { session } } = await supabase.auth.getSession();
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
