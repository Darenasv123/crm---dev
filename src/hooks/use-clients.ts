import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getAuthClient } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";
import { invalidateCrmQueries } from "@/lib/query-invalidation";
import { requestClientDriveFolderSync } from "@/lib/google-drive-sync-client";

type Client = Database["public"]["Tables"]["clients"]["Row"];
type ClientInsert = Database["public"]["Tables"]["clients"]["Insert"];
type ClientUpdate = Database["public"]["Tables"]["clients"]["Update"];
type QueryOptions = { enabled?: boolean };

const COLORS = [
  "oklch(0.74 0.12 80)",
  "oklch(0.55 0.13 235)",
  "oklch(0.62 0.14 155)",
  "oklch(0.62 0.18 25)",
  "oklch(0.55 0.13 290)",
  "oklch(0.34 0.09 255)",
];

export function useClients(options: QueryOptions = {}) {
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
    enabled: options.enabled ?? true,
  });
}

export function useClient(id: string) {
  return useQuery({
    queryKey: ["clients", id],
    queryFn: async () => {
      const db = await getAuthClient();
      const { data, error } = await db.from("clients").select("*").eq("id", id).single();
      if (error) throw new Error(error.message);
      return data as Client;
    },
    enabled: !!id,
  });
}

export function useCreateClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ClientInsert) => {
      const words = input.name.trim().split(/\s+/);
      const initials =
        words.length >= 2
          ? `${words[0][0]}${words[1][0]}`.toUpperCase()
          : (words[0] ?? "CL").slice(0, 2).toUpperCase();
      const payload: ClientInsert = {
        name: input.name.trim(),
        phone: input.phone?.trim() || null,
        email: input.email?.trim().toLowerCase() || null,
        status: input.status ?? "Activo",
        initials,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
      };
      const db = await getAuthClient();
      const { data, error } = await db.from("clients").insert(payload).select().single();
      if (error) throw new Error(error.message);

      // Fase 8D: pedir la carpeta de Drive del Cliente. Va DESPUÉS de que la
      // creación haya terminado bien y deliberadamente sin `await` sobre su
      // resultado ni propagación de errores: Google Drive es una integración
      // secundaria y jamás puede hacer fallar la creación de un Cliente. Si
      // no está configurado, el servidor responde con un no-op silencioso.
      void requestClientDriveFolderSync(data.id);

      return data;
    },
    onSuccess: (data) => invalidateCrmQueries(queryClient, { clientId: data?.id }),
  });
}

export function useUpdateClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: ClientUpdate }) => {
      const clean: ClientUpdate = {
        ...updates,
        ...(updates.phone !== undefined && { phone: updates.phone?.trim() || null }),
        ...(updates.email !== undefined && {
          email: updates.email?.trim().toLowerCase() || null,
        }),
      };
      const db = await getAuthClient();
      const { data, error } = await db.from("clients").update(clean).eq("id", id).select().single();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: (_data, { id }) => invalidateCrmQueries(queryClient, { clientId: id }),
  });
}

export function useDeleteClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const db = await getAuthClient();
      const { error } = await db.from("clients").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_data, id) => invalidateCrmQueries(queryClient, { clientId: id }),
  });
}
