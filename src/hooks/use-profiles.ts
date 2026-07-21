import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAuthClient } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { registerStaffFn } from "@/lib/profiles.functions";
import type { Database } from "@/lib/database.types";

type ProfileUpdate = Partial<
  Pick<
    Database["public"]["Tables"]["profiles"]["Row"],
    "full_name" | "phone" | "role" | "status" | "initials"
  >
>;

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type QueryOptions = { enabled?: boolean };

export function useProfiles(options: QueryOptions = {}) {
  return useQuery({
    queryKey: ["profiles"],
    queryFn: async () => {
      const db = await getAuthClient();
      const { data, error } = await db.from("profiles").select("*").order("full_name");
      if (error) throw new Error(error.message);
      return data as Profile[];
    },
    enabled: options.enabled ?? true,
  });
}

export function useRegisterStaff() {
  const qc = useQueryClient();
  const { session } = useAuth();

  return useMutation({
    mutationFn: async ({
      email,
      password,
      fullName,
      role,
      phone,
    }: {
      email: string;
      password: string;
      fullName: string;
      role: "Administrador" | "Personal";
      phone?: string;
    }) => {
      const accessToken = session?.access_token;
      if (!accessToken) throw new Error("Sesión expirada. Inicia sesión de nuevo.");

      return registerStaffFn({
        data: { accessToken, email, password, fullName, role, phone },
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["profiles"] }),
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: ProfileUpdate }) => {
      const db = await getAuthClient();
      const { data, error } = await db
        .from("profiles")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["profiles"] }),
  });
}
