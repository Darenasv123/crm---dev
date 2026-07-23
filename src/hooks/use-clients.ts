import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAuthClient } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";
import { isMissingSchemaFieldError } from "@/lib/supabase-errors";
import { invalidateCrmQueries } from "@/lib/query-invalidation";

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
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ClientInsert) => {
      const words = (input.name ?? "").trim().split(/\s+/);
      const initials =
        words.length >= 2
          ? (words[0][0] + words[1][0]).toUpperCase()
          : (words[0] ?? "??").slice(0, 2).toUpperCase();
      const color = COLORS[Math.floor(Math.random() * COLORS.length)];

      const payload: ClientInsert = {
        name: input.name,
        dni: input.dni,
        document_type: input.document_type ?? "DNI",
        document_number: input.document_number?.trim() || input.dni || null,
        phone: input.phone,
        whatsapp: input.whatsapp?.trim() || input.phone || null,
        occupation: input.occupation?.trim() || null,
        notes: input.notes?.trim() || null,
        process_type: input.process_type,
        status: input.status ?? "Activo",
        initials,
        color,
        email: input.email?.trim() || null,
        address: input.address?.trim() || null,
        birthdate: null,
        civil_status: null,
      };

      const db = await getAuthClient();
      let { data, error } = await db.from("clients").insert(payload).select().single();

      if (isMissingSchemaFieldError(error)) {
        const legacyPayload: ClientInsert = {
          name: payload.name,
          dni: payload.dni,
          phone: payload.phone,
          process_type: payload.process_type,
          status: payload.status,
          initials: payload.initials,
          color: payload.color,
          email: payload.email,
          address: payload.address,
          birthdate: payload.birthdate,
          civil_status: payload.civil_status,
        };
        ({ data, error } = await db.from("clients").insert(legacyPayload).select().single());
      }

      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: (data) => invalidateCrmQueries(qc, { clientId: data?.id }),
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
        document_number: updates.document_number?.trim() || null,
        whatsapp: updates.whatsapp?.trim() || null,
        occupation: updates.occupation?.trim() || null,
        notes: updates.notes?.trim() || null,
      };

      const db = await getAuthClient();
      let { data, error } = await db.from("clients").update(clean).eq("id", id).select().single();

      if (isMissingSchemaFieldError(error)) {
        const legacyUpdates: ClientUpdate = {
          ...(clean.name !== undefined && { name: clean.name }),
          ...(clean.initials !== undefined && { initials: clean.initials }),
          ...(clean.color !== undefined && { color: clean.color }),
          ...(clean.dni !== undefined && { dni: clean.dni }),
          ...(clean.phone !== undefined && { phone: clean.phone }),
          ...(clean.email !== undefined && { email: clean.email }),
          ...(clean.address !== undefined && { address: clean.address }),
          ...(clean.birthdate !== undefined && { birthdate: clean.birthdate }),
          ...(clean.civil_status !== undefined && { civil_status: clean.civil_status }),
          ...(clean.process_type !== undefined && { process_type: clean.process_type }),
          ...(clean.status !== undefined && { status: clean.status }),
        };
        ({ data, error } = await db
          .from("clients")
          .update(legacyUpdates)
          .eq("id", id)
          .select()
          .single());
      }

      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: (_data, { id }) => invalidateCrmQueries(qc, { clientId: id }),
  });
}

export function useDeleteClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const db = await getAuthClient();
      const { error } = await db.from("clients").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_data, id) => invalidateCrmQueries(qc, { clientId: id }),
  });
}
