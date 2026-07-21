import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { readServerEnv } from "./env-server";
import { requireUser } from "./auth-server";

/**
 * Returns a Supabase Admin client using the service_role key.
 * This client bypasses RLS and can create users without sending
 * confirmation emails — safe because it only runs server-side.
 */
function getAdminClient() {
  const url = readServerEnv("SUPABASE_URL") || "https://pnqdgwpxcxngeueosmnh.supabase.co";
  const serviceKey = readServerEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (!serviceKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY no configurada. Agrégala en .env y como Wrangler secret.",
    );
  }

  return createClient<Database>(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

const registerStaffSchema = z.object({
  accessToken: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(1),
  role: z.enum(["Administrador", "Personal"]),
  phone: z.string().optional(),
});

/**
 * Creates a new staff user via the Supabase Admin API.
 * - No confirmation email is sent (email_confirm: true skips it).
 * - Only authenticated Administrators can call this.
 */
export const registerStaffFn = createServerFn({ method: "POST" })
  .validator(registerStaffSchema)
  .handler(async ({ data }) => {
    // 1. Verify the caller is authenticated
    const caller = await requireUser(data.accessToken);

    // 2. Verify the caller is an Administrator
    const admin = getAdminClient();
    const { data: callerProfile, error: profileError } = await admin
      .from("profiles")
      .select("role")
      .eq("id", caller.id)
      .single();

    if (profileError || !callerProfile) {
      throw new Error(
        `No se pudo verificar el rol del usuario (${profileError?.message ?? "perfil no encontrado"}).`,
      );
    }

    if (callerProfile.role !== "Administrador") {
      throw new Error("Solo los administradores pueden registrar personal.");
    }

    // 3. Compute initials
    const words = data.fullName.trim().split(/\s+/);
    const initials =
      words.length >= 2
        ? (words[0][0] + words[1][0]).toUpperCase()
        : words[0].slice(0, 2).toUpperCase();

    // 4. Create user via Admin API — email_confirm: true = no email sent
    const { data: created, error } = await admin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true, // marks email as confirmed, no email sent
      user_metadata: {
        full_name: data.fullName,
        initials,
        role: data.role,
        phone: data.phone ?? "",
      },
    });

    if (error) throw new Error(error.message);
    if (!created.user) throw new Error("No se pudo crear el usuario.");

    // 5. Upsert profile with the correct role (trigger may have already created it)
    await admin.from("profiles").upsert({
      id: created.user.id,
      full_name: data.fullName,
      email: data.email,
      initials,
      role: data.role,
      phone: data.phone ?? null,
      status: "Activo",
    });

    return { userId: created.user.id };
  });
