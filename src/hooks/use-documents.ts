import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAuthClient, supabase } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";
import { isMissingSchemaFieldError } from "@/lib/supabase-errors";
import { invalidateCrmQueries } from "@/lib/query-invalidation";

type Document = Database["public"]["Tables"]["documents"]["Row"];
type DocumentUpdate = Database["public"]["Tables"]["documents"]["Update"];

export const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_DOCUMENT_EXTENSIONS = new Set([
  "pdf",
  "doc",
  "docx",
  "jpg",
  "jpeg",
  "png",
  "xlsx",
  "xls",
]);

export function validateDocumentFile(file: Pick<File, "name" | "size" | "type">) {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!file.name.trim()) throw new Error("El archivo debe tener un nombre válido.");
  if (!ALLOWED_DOCUMENT_EXTENSIONS.has(extension)) {
    throw new Error("Formato no permitido. Usa PDF, DOC, DOCX, JPG, PNG, XLS o XLSX.");
  }
  if (file.size <= 0) throw new Error("El archivo está vacío.");
  if (file.size > MAX_DOCUMENT_SIZE_BYTES) throw new Error("El archivo supera el límite de 10 MB.");
}

export interface DocumentWithClient extends Document {
  clients: { name: string } | null;
  cases: { expediente: string; process_type: string } | null;
}

export function useDocuments(typeFilter?: string) {
  return useQuery({
    queryKey: ["documents", typeFilter ?? "all"],
    queryFn: async () => {
      const db = await getAuthClient();
      let query = db
        .from("documents")
        .select("*, clients(name), cases(expediente, process_type)")
        .order("uploaded_at", { ascending: false });

      if (typeFilter && typeFilter !== "all") {
        query = query.eq("type", typeFilter);
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return data as DocumentWithClient[];
    },
  });
}

export function useCaseDocumentCounts(caseIds: string[]) {
  const normalizedCaseIds = Array.from(new Set(caseIds.filter(Boolean))).sort();
  return useQuery({
    queryKey: ["documents", "case-counts", normalizedCaseIds.join(",")],
    queryFn: async () => {
      if (normalizedCaseIds.length === 0) return {} as Record<string, number>;
      const db = await getAuthClient();
      const { data, error } = await db
        .from("documents")
        .select("case_id")
        .in("case_id", normalizedCaseIds);
      if (error) throw new Error(error.message);
      return (data ?? []).reduce<Record<string, number>>((acc, row) => {
        if (row.case_id) acc[row.case_id] = (acc[row.case_id] ?? 0) + 1;
        return acc;
      }, {});
    },
    enabled: normalizedCaseIds.length > 0,
    staleTime: 1000 * 30,
  });
}

export function useUploadDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      file,
      type,
      clientId,
      caseId,
    }: {
      file: File;
      type: string;
      clientId?: string;
      caseId?: string;
    }) => {
      validateDocumentFile(file);
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${Date.now()}_${safeName}`;

      // Use the base supabase client for storage (uses auth session automatically)
      const { error: uploadError } = await supabase.storage
        .from("documents")
        .upload(path, file, { upsert: false });
      if (uploadError) throw new Error(uploadError.message);

      const size =
        file.size < 1024 * 1024
          ? `${Math.round(file.size / 1024)} KB`
          : `${(file.size / (1024 * 1024)).toFixed(1)} MB`;

      const db = await getAuthClient();
      const metadata = {
        name: file.name,
        original_name: file.name,
        display_name: file.name,
        type,
        document_type: type,
        mime_type: file.type || null,
        size,
        file_size: file.size,
        storage_path: path,
        source_type: "manual_upload",
        source_provider: "supabase_storage",
        processing_status: "pending",
        verification_status: "pending",
        client_id: clientId ?? null,
        case_id: caseId ?? null,
      } as const;

      let { data, error } = await db
        .from("documents")
        .insert(metadata)
        .select("*, clients(name), cases(expediente, process_type)")
        .single();

      if (isMissingSchemaFieldError(error)) {
        ({ data, error } = await db
          .from("documents")
          .insert({
            name: metadata.name,
            type: metadata.type,
            size: metadata.size,
            storage_path: metadata.storage_path,
            client_id: metadata.client_id,
            case_id: metadata.case_id,
          })
          .select("*, clients(name), cases(expediente, process_type)")
          .single());
      }

      if (error) {
        await supabase.storage.from("documents").remove([path]);
        throw new Error(error.message);
      }

      if (!data) {
        await supabase.storage.from("documents").remove([path]);
        throw new Error("Supabase no devolvió el registro del documento subido.");
      }

      return data as DocumentWithClient;
    },
    onSuccess: (data) =>
      invalidateCrmQueries(qc, { clientId: data.client_id, caseId: data.case_id }),
  });
}

export function useDeleteDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, storagePath }: { id: string; storagePath: string }) => {
      await supabase.storage.from("documents").remove([storagePath]);
      const db = await getAuthClient();
      const { error } = await db.from("documents").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => invalidateCrmQueries(qc),
  });
}

export function useUpdateDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: DocumentUpdate }) => {
      const db = await getAuthClient();
      let { data, error } = await db
        .from("documents")
        .update(updates)
        .eq("id", id)
        .select("*, clients(name), cases(expediente, process_type)")
        .single();

      if (isMissingSchemaFieldError(error)) {
        const legacyUpdates: DocumentUpdate = {
          ...(updates.name !== undefined && { name: updates.name }),
          ...(updates.type !== undefined && { type: updates.type }),
          ...(updates.size !== undefined && { size: updates.size }),
          ...(updates.storage_path !== undefined && { storage_path: updates.storage_path }),
          ...(updates.client_id !== undefined && { client_id: updates.client_id }),
          ...(updates.case_id !== undefined && { case_id: updates.case_id }),
        };
        ({ data, error } = await db
          .from("documents")
          .update(legacyUpdates)
          .eq("id", id)
          .select("*, clients(name), cases(expediente, process_type)")
          .single());
      }

      if (error) throw new Error(error.message);
      return data as DocumentWithClient;
    },
    onSuccess: (data) =>
      invalidateCrmQueries(qc, { clientId: data.client_id, caseId: data.case_id }),
  });
}

export function useSignedUrl(storagePath: string | null) {
  return useQuery({
    queryKey: ["signed_url", storagePath],
    queryFn: async () => {
      if (!storagePath) return null;
      const { data, error } = await supabase.storage
        .from("documents")
        .createSignedUrl(storagePath, 300);
      if (error) throw new Error(error.message);
      return data.signedUrl;
    },
    enabled: !!storagePath,
    staleTime: 240_000,
  });
}
