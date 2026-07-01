import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAuthClient, supabase } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";

type Client = Database["public"]["Tables"]["clients"]["Row"];
type ClientInsert = Database["public"]["Tables"]["clients"]["Insert"];
type ClientUpdate = Database["public"]["Tables"]["clients"]["Update"];

const COLORS = [
  "oklch(0.74 0.12 80)", "oklch(0.55 0.13 235)", "oklch(0.62 0.14 155)",
  "oklch(0.62 0.18 25)", "oklch(0.55 0.13 290)", "oklch(0.34 0.09 255)",
];

export function useClients() {
  return useQuery({
    queryKey: ["clients"],
    queryFn: async () => {
      const db = await getAuthClient();
      const { data, error } = await db
        .from("clients")
        .select("*")
        .order("registered_at", { ascending: false });
      if (error) throw new Error(error.message);
      return data as Client[];
    },
  });
}

export function useClient(id: string) {
  return useQuery({
    queryKey: ["clients", id],
    queryFn: async () => {
      const db = await getAuthClient();
      const { data, error } = await db
        .from("clients")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw new Error(error.message);
      return data as Client;
    },
    enabled: !!id,
  });
}

export function useCreateClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ClientInsert) => {
      const words = (input.name ?? "").trim().split(/\s+/);
      const initials = words.length >= 2
        ? (words[0][0] + words[1][0]).toUpperCase()
        : (words[0] ?? "??").slice(0, 2).toUpperCase();
      const color = COLORS[Math.floor(Math.random() * COLORS.length)];

      const payload: ClientInsert = {
        name: input.name,
        dni: input.dni,
        phone: input.phone,
        process_type: input.process_type,
        status: input.status ?? "Activo",
        initials,
        color,
        email: input.email?.trim() || null,
        address: null,
        birthdate: null,
        civil_status: null,
      };

      const db = await getAuthClient();
      const { data, error } = await db
        .from("clients")
        .insert(payload)
        .select()
        .single();

      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["clients"] }),
  });
}

export function useUpdateClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: ClientUpdate }) => {
      const clean: ClientUpdate = {
        ...updates,
        email: updates.email?.trim() || null,
        address: updates.address?.trim() || null,
        birthdate: updates.birthdate || null,
        civil_status: updates.civil_status?.trim() || null,
      };

      const db = await getAuthClient();
      const { data, error } = await db
        .from("clients")
        .update(clean)
        .eq("id", id)
        .select()
        .single();

      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["clients", id] });
    },
  });
}
