import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAuthClient, supabase } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";
import { isMissingSchemaFieldError } from "@/lib/supabase-errors";

type Document = Database["public"]["Tables"]["documents"]["Row"];

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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["documents"] }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["documents"] }),
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
