import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAuthClient, supabase } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";

type ProfileUpdate = Partial<Pick<Database["public"]["Tables"]["profiles"]["Row"], "full_name" | "phone" | "role" | "status" | "initials">>;

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

export function useProfiles() {
  return useQuery({
    queryKey: ["profiles"],
    queryFn: async () => {
      const db = await getAuthClient();
      const { data, error } = await db
        .from("profiles")
        .select("*")
        .order("full_name");
      if (error) throw new Error(error.message);
      return data as Profile[];
    },
  });
}

export function useRegisterStaff() {  const qc = useQueryClient();
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
      const words = fullName.trim().split(/\s+/);
      const initials =
        words.length >= 2
          ? (words[0][0] + words[1][0]).toUpperCase()
          : words[0].slice(0, 2).toUpperCase();

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName, initials, role, phone: phone ?? "" },
        },
      });
      if (error) throw new Error(error.message);

      if (data.user && role === "Administrador") {
        const db = await getAuthClient();
        await db
          .from("profiles")
          .update({ role: "Administrador", full_name: fullName, initials, phone: phone ?? null })
          .eq("id", data.user.id);
      }

      return data;
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
