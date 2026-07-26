/**
 * use-document-folders.ts
 * TanStack Query hooks for managing document_folders.
 *
 * Operations:
 * - useClientFolders(clientId)         — all folders for a client
 * - useChildFolders(parentId, clientId) — direct children of a folder
 * - useCreateFolder()                   — create root or child folder
 * - useRenameFolder()                   — rename (no storage move)
 * - useDeleteFolder()                   — delete only if empty
 * - useFolderHasContent(folderId)       — check documents + subfolders
 * - useMoveDocument()                   — move a doc to a folder (or null = root)
 * - useMoveDocuments()                  — move multiple docs at once
 * - useFolderDocuments(folderId)        — documents inside a folder
 * - useUnclassifiedDocuments(clientId)  — documents with folder_id = NULL
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAuthClient } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";
import { normalizeFolderName, validateFolderName, wouldCreateCycle } from "@/lib/folder-utils";
import { invalidateCrmQueries } from "@/lib/query-invalidation";

type DocumentFolder = Database["public"]["Tables"]["document_folders"]["Row"];
type Document = Database["public"]["Tables"]["documents"]["Row"];

// ─── Query keys ───────────────────────────────────────────────────────────────

export const folderKeys = {
  all: ["document_folders"] as const,
  byClient: (clientId: string) => ["document_folders", "client", clientId] as const,
  children: (parentId: string) => ["document_folders", "children", parentId] as const,
  hasContent: (folderId: string) => ["document_folders", "has_content", folderId] as const,
  documents: (folderId: string) => ["documents", "by_folder", folderId] as const,
  unclassified: (clientId: string) => ["documents", "unclassified", clientId] as const,
};

// ─── useClientFolders ─────────────────────────────────────────────────────────

export function useClientFolders(clientId: string | undefined) {
  return useQuery({
    queryKey: folderKeys.byClient(clientId ?? ""),
    queryFn: async (): Promise<DocumentFolder[]> => {
      if (!clientId) return [];
      const db = await getAuthClient();
      const { data, error } = await db
        .from("document_folders")
        .select("*")
        .eq("client_id", clientId)
        .order("name");
      if (error) throw new Error(error.message);
      return (data ?? []) as DocumentFolder[];
    },
    enabled: !!clientId,
    staleTime: 1000 * 30,
  });
}

// ─── useChildFolders ──────────────────────────────────────────────────────────

export function useChildFolders(parentId: string | null, clientId: string | undefined) {
  return useQuery({
    queryKey: parentId ? folderKeys.children(parentId) : folderKeys.byClient(clientId ?? ""),
    queryFn: async (): Promise<DocumentFolder[]> => {
      if (!clientId) return [];
      const db = await getAuthClient();
      let query = db.from("document_folders").select("*").eq("client_id", clientId).order("name");
      if (parentId) {
        query = query.eq("parent_id", parentId);
      } else {
        query = query.is("parent_id", null);
      }
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return (data ?? []) as DocumentFolder[];
    },
    enabled: !!clientId,
    staleTime: 1000 * 30,
  });
}

// ─── useCreateFolder ──────────────────────────────────────────────────────────

interface CreateFolderParams {
  clientId: string;
  parentId: string | null;
  name: string;
}

export function useCreateFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      clientId,
      parentId,
      name,
    }: CreateFolderParams): Promise<DocumentFolder> => {
      const validationError = validateFolderName(name);
      if (validationError) throw new Error(validationError);

      const normalizedName = normalizeFolderName(name);

      // Check for duplicate
      const db = await getAuthClient();
      let dupQuery = db
        .from("document_folders")
        .select("id")
        .eq("client_id", clientId)
        .eq("normalized_name", normalizedName);
      if (parentId) {
        dupQuery = dupQuery.eq("parent_id", parentId);
      } else {
        dupQuery = dupQuery.is("parent_id", null);
      }
      const { data: existing } = await dupQuery.limit(1);
      if (existing && existing.length > 0) {
        throw new Error(`Ya existe una carpeta con el nombre "${name}" en esta ubicación.`);
      }

      // Validate parent belongs to same client
      if (parentId) {
        const { data: parentFolder, error: parentError } = await db
          .from("document_folders")
          .select("id, client_id")
          .eq("id", parentId)
          .single();
        if (parentError || !parentFolder) throw new Error("La carpeta padre no existe.");
        if (parentFolder.client_id !== clientId) {
          throw new Error("La carpeta padre pertenece a un cliente diferente.");
        }
      }

      const {
        data: { session },
      } = await (await getAuthClient()).auth.getSession();

      const { data, error } = await db
        .from("document_folders")
        .insert({
          client_id: clientId,
          parent_id: parentId ?? null,
          name: name.trim(),
          normalized_name: normalizedName,
          created_by: session?.user?.id ?? null,
        })
        .select("*")
        .single();

      if (error) {
        if (error.code === "23505") {
          throw new Error(`Ya existe una carpeta con el nombre "${name}" en esta ubicación.`);
        }
        throw new Error(error.message);
      }
      if (!data) throw new Error("No se pudo crear la carpeta.");
      return data as DocumentFolder;
    },
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: folderKeys.byClient(variables.clientId) });
      if (variables.parentId) {
        void qc.invalidateQueries({
          queryKey: folderKeys.children(variables.parentId),
        });
      }
    },
  });
}

// ─── useRenameFolder ──────────────────────────────────────────────────────────

interface RenameFolderParams {
  folderId: string;
  clientId: string;
  newName: string;
  currentParentId: string | null;
}

export function useRenameFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      folderId,
      clientId,
      newName,
      currentParentId,
    }: RenameFolderParams): Promise<DocumentFolder> => {
      const validationError = validateFolderName(newName);
      if (validationError) throw new Error(validationError);

      const normalizedName = normalizeFolderName(newName);

      // Check for duplicate under same parent (excluding itself)
      const db = await getAuthClient();
      let dupQuery = db
        .from("document_folders")
        .select("id")
        .eq("client_id", clientId)
        .eq("normalized_name", normalizedName)
        .neq("id", folderId);
      if (currentParentId) {
        dupQuery = dupQuery.eq("parent_id", currentParentId);
      } else {
        dupQuery = dupQuery.is("parent_id", null);
      }
      const { data: existing } = await dupQuery.limit(1);
      if (existing && existing.length > 0) {
        throw new Error(`Ya existe otra carpeta con el nombre "${newName}" en esta ubicación.`);
      }

      const { data, error } = await db
        .from("document_folders")
        .update({ name: newName.trim(), normalized_name: normalizedName })
        .eq("id", folderId)
        .select("*")
        .single();

      if (error) {
        if (error.code === "23505") {
          throw new Error(`Ya existe otra carpeta con el nombre "${newName}" en esta ubicación.`);
        }
        throw new Error(error.message);
      }
      if (!data) throw new Error("No se pudo renombrar la carpeta.");
      return data as DocumentFolder;
    },
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: folderKeys.byClient(variables.clientId) });
      if (variables.currentParentId) {
        void qc.invalidateQueries({
          queryKey: folderKeys.children(variables.currentParentId),
        });
      }
    },
  });
}

// ─── useFolderHasContent ──────────────────────────────────────────────────────

export function useFolderHasContent(folderId: string | undefined) {
  return useQuery({
    queryKey: folderKeys.hasContent(folderId ?? ""),
    queryFn: async (): Promise<{ hasDocuments: boolean; hasSubfolders: boolean }> => {
      if (!folderId) return { hasDocuments: false, hasSubfolders: false };
      const db = await getAuthClient();

      const [docsResult, subfoldersResult] = await Promise.all([
        db.from("documents").select("id", { count: "exact", head: true }).eq("folder_id", folderId),
        db
          .from("document_folders")
          .select("id", { count: "exact", head: true })
          .eq("parent_id", folderId),
      ]);

      return {
        hasDocuments: (docsResult.count ?? 0) > 0,
        hasSubfolders: (subfoldersResult.count ?? 0) > 0,
      };
    },
    enabled: !!folderId,
    staleTime: 1000 * 10,
  });
}

// ─── useDeleteFolder ──────────────────────────────────────────────────────────

interface DeleteFolderParams {
  folderId: string;
  clientId: string;
}

export function useDeleteFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ folderId }: DeleteFolderParams): Promise<void> => {
      const db = await getAuthClient();

      // Verify folder is empty before deleting
      const [docsResult, subfoldersResult] = await Promise.all([
        db.from("documents").select("id", { count: "exact", head: true }).eq("folder_id", folderId),
        db
          .from("document_folders")
          .select("id", { count: "exact", head: true })
          .eq("parent_id", folderId),
      ]);

      if ((docsResult.count ?? 0) > 0) {
        throw new Error(
          "No se puede eliminar la carpeta porque contiene documentos. Mueve o elimina los documentos primero.",
        );
      }
      if ((subfoldersResult.count ?? 0) > 0) {
        throw new Error(
          "No se puede eliminar la carpeta porque contiene subcarpetas. Elimina las subcarpetas primero.",
        );
      }

      const { error } = await db.from("document_folders").delete().eq("id", folderId);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: folderKeys.byClient(variables.clientId) });
      void qc.invalidateQueries({ queryKey: folderKeys.hasContent(variables.folderId) });
    },
  });
}

// ─── useMoveDocument ─────────────────────────────────────────────────────────

interface MoveDocumentParams {
  documentId: string;
  targetFolderId: string | null; // null = move to root
  clientId: string;
}

export function useMoveDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      documentId,
      targetFolderId,
      clientId,
    }: MoveDocumentParams): Promise<void> => {
      // Validate target folder belongs to same client
      if (targetFolderId) {
        const db = await getAuthClient();
        const { data: folder } = await db
          .from("document_folders")
          .select("id, client_id")
          .eq("id", targetFolderId)
          .single();
        if (!folder) throw new Error("La carpeta destino no existe.");
        if (folder.client_id !== clientId) {
          throw new Error("La carpeta destino pertenece a un cliente diferente.");
        }
      }

      const db = await getAuthClient();
      const { error } = await db
        .from("documents")
        .update({ folder_id: targetFolderId ?? null })
        .eq("id", documentId);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: ["documents"] });
      void qc.invalidateQueries({
        queryKey: folderKeys.unclassified(variables.clientId),
      });
      if (variables.targetFolderId) {
        void qc.invalidateQueries({
          queryKey: folderKeys.documents(variables.targetFolderId),
        });
        void qc.invalidateQueries({
          queryKey: folderKeys.hasContent(variables.targetFolderId),
        });
      }
      invalidateCrmQueries(qc, { clientId: variables.clientId });
    },
  });
}

// ─── useMoveDocuments (bulk) ─────────────────────────────────────────────────

interface MoveDocumentsParams {
  documentIds: string[];
  targetFolderId: string | null;
  clientId: string;
}

export function useMoveDocuments() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      documentIds,
      targetFolderId,
      clientId,
    }: MoveDocumentsParams): Promise<void> => {
      if (documentIds.length === 0) return;

      if (targetFolderId) {
        const db = await getAuthClient();
        const { data: folder } = await db
          .from("document_folders")
          .select("id, client_id")
          .eq("id", targetFolderId)
          .single();
        if (!folder) throw new Error("La carpeta destino no existe.");
        if (folder.client_id !== clientId) {
          throw new Error("La carpeta destino pertenece a un cliente diferente.");
        }
      }

      const db = await getAuthClient();
      const { error } = await db
        .from("documents")
        .update({ folder_id: targetFolderId ?? null })
        .in("id", documentIds);
      if (error) throw new Error(error.message);
    },
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: ["documents"] });
      void qc.invalidateQueries({
        queryKey: folderKeys.unclassified(variables.clientId),
      });
      if (variables.targetFolderId) {
        void qc.invalidateQueries({
          queryKey: folderKeys.documents(variables.targetFolderId),
        });
        void qc.invalidateQueries({
          queryKey: folderKeys.hasContent(variables.targetFolderId),
        });
      }
      invalidateCrmQueries(qc, { clientId: variables.clientId });
    },
  });
}

// ─── useFolderDocuments ───────────────────────────────────────────────────────

export function useFolderDocuments(folderId: string | undefined) {
  return useQuery({
    queryKey: folderKeys.documents(folderId ?? ""),
    queryFn: async (): Promise<Document[]> => {
      if (!folderId) return [];
      const db = await getAuthClient();
      const { data, error } = await db
        .from("documents")
        .select("*")
        .eq("folder_id", folderId)
        .order("uploaded_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as Document[];
    },
    enabled: !!folderId,
    staleTime: 1000 * 30,
  });
}

// ─── useUnclassifiedDocuments ─────────────────────────────────────────────────

export function useUnclassifiedDocuments(clientId: string | undefined) {
  return useQuery({
    queryKey: folderKeys.unclassified(clientId ?? ""),
    queryFn: async (): Promise<Document[]> => {
      if (!clientId) return [];
      const db = await getAuthClient();
      const { data, error } = await db
        .from("documents")
        .select("*")
        .eq("client_id", clientId)
        .is("folder_id", null)
        .order("uploaded_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as Document[];
    },
    enabled: !!clientId,
    staleTime: 1000 * 30,
  });
}

// ─── useFolderDocumentCounts ──────────────────────────────────────────────────

/** Returns a map of { folderId → count of direct documents } for a set of folder IDs. */
export function useFolderDocumentCounts(folderIds: string[]) {
  const normalized = Array.from(new Set(folderIds.filter(Boolean))).sort();
  return useQuery({
    queryKey: ["document_folders", "counts", normalized.join(",")],
    queryFn: async (): Promise<Record<string, number>> => {
      if (normalized.length === 0) return {};
      const db = await getAuthClient();
      const { data, error } = await db
        .from("documents")
        .select("folder_id")
        .in("folder_id", normalized);
      if (error) throw new Error(error.message);
      return (data ?? []).reduce<Record<string, number>>((acc, row) => {
        if (row.folder_id) acc[row.folder_id] = (acc[row.folder_id] ?? 0) + 1;
        return acc;
      }, {});
    },
    enabled: normalized.length > 0,
    staleTime: 1000 * 30,
  });
}

// ─── useWouldCreateCycle ──────────────────────────────────────────────────────

export function useWouldCreateCycle(
  folderId: string | undefined,
  proposedParentId: string | undefined,
  clientId: string | undefined,
): boolean {
  const { data: allFolders = [] } = useClientFolders(clientId);
  if (!folderId || !proposedParentId) return false;
  return wouldCreateCycle(folderId, proposedParentId, allFolders);
}
