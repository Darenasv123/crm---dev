/**
 * migrate-relative-paths.ts
 * Local-only utility to migrate documents.relative_path → document_folders.
 *
 * IMPORTANT: This NEVER runs against the remote Supabase automatically.
 * It must be called explicitly by an admin user from within the app.
 *
 * Algorithm (idempotent):
 * 1. Read all documents for the given clientId that have relative_path != NULL and folder_id == NULL.
 * 2. For each document, split relative_path into path segments.
 * 3. Walk the segment chain, creating missing folders and reusing existing ones.
 * 4. Assign folder_id to the document.
 * 5. Preserve storage_path, original_name, content_hash unchanged.
 * 6. Can run multiple times — already migrated documents are skipped.
 * 7. Generates a report.
 */

import { getAuthClient } from "@/lib/supabase";
import { normalizeFolderName } from "@/lib/folder-utils";
import type { Database } from "@/lib/database.types";

type DocumentFolder = Database["public"]["Tables"]["document_folders"]["Row"];

export interface MigrationReport {
  documentsAnalyzed: number;
  documentsAlreadyMigrated: number;
  documentsAssigned: number;
  foldersCreated: number;
  foldersReused: number;
  errors: Array<{ documentId: string; documentName: string; error: string }>;
  pending: number;
}

interface FolderCache {
  // key: "clientId:parentId_or_null:normalizedName"
  [key: string]: string; // → folderId
}

function cacheKey(clientId: string, parentId: string | null, normalizedName: string): string {
  return `${clientId}:${parentId ?? "__root__"}:${normalizedName}`;
}

/**
 * Ensures a folder exists (creates if missing, reuses if present).
 * Returns the folder id.
 */
async function ensureFolder(
  clientId: string,
  parentId: string | null,
  name: string,
  createdBy: string | null,
  cache: FolderCache,
  stats: { foldersCreated: number; foldersReused: number },
): Promise<string> {
  const normalized = normalizeFolderName(name);
  const key = cacheKey(clientId, parentId, normalized);

  if (cache[key]) {
    stats.foldersReused++;
    return cache[key];
  }

  const db = await getAuthClient();

  // Try to find existing folder
  let query = db
    .from("document_folders")
    .select("id")
    .eq("client_id", clientId)
    .eq("normalized_name", normalized);
  if (parentId) {
    query = query.eq("parent_id", parentId);
  } else {
    query = query.is("parent_id", null);
  }
  const { data: existing } = await query.limit(1);

  if (existing && existing.length > 0) {
    const id = (existing[0] as DocumentFolder).id;
    cache[key] = id;
    stats.foldersReused++;
    return id;
  }

  // Create the folder
  const { data: created, error } = await db
    .from("document_folders")
    .insert({
      client_id: clientId,
      parent_id: parentId ?? null,
      name: name.trim(),
      normalized_name: normalized,
      created_by: createdBy ?? null,
    })
    .select("id")
    .single();

  if (error) {
    // Race condition: another process created it first
    if (error.code === "23505") {
      const { data: raceResult } = await query.limit(1);
      if (raceResult && raceResult.length > 0) {
        const id = (raceResult[0] as DocumentFolder).id;
        cache[key] = id;
        stats.foldersReused++;
        return id;
      }
    }
    throw new Error(`No se pudo crear carpeta "${name}": ${error.message}`);
  }

  if (!created) throw new Error(`No se creó la carpeta "${name}".`);
  cache[key] = created.id;
  stats.foldersCreated++;
  return created.id;
}

/**
 * Migrates relative_path for all documents of a client.
 * Returns a MigrationReport.
 */
export async function migrateRelativePaths(
  clientId: string,
  userId: string | null,
): Promise<MigrationReport> {
  const report: MigrationReport = {
    documentsAnalyzed: 0,
    documentsAlreadyMigrated: 0,
    documentsAssigned: 0,
    foldersCreated: 0,
    foldersReused: 0,
    errors: [],
    pending: 0,
  };

  const db = await getAuthClient();

  // Fetch documents with relative_path that haven't been migrated yet
  const { data: docs, error: docsError } = await db
    .from("documents")
    .select("id, name, relative_path, folder_id")
    .eq("client_id", clientId)
    .not("relative_path", "is", null);

  if (docsError) throw new Error(`Error al leer documentos: ${docsError.message}`);

  const allDocs = docs ?? [];
  report.documentsAnalyzed = allDocs.length;

  // Count already migrated
  const alreadyMigrated = allDocs.filter((d) => d.folder_id !== null);
  report.documentsAlreadyMigrated = alreadyMigrated.length;

  // Work on unmigrated docs only
  const toMigrate = allDocs.filter((d) => d.folder_id === null && d.relative_path);

  const folderCache: FolderCache = {};
  const folderStats = { foldersCreated: 0, foldersReused: 0 };

  for (const doc of toMigrate) {
    const relativePath = doc.relative_path!;
    // Split relative_path into segments; last segment is the file name
    const parts = relativePath.split("/").filter(Boolean);
    const folderSegments = parts.slice(0, -1); // everything except the filename

    if (folderSegments.length === 0) {
      // File is at the root of the client folder — stays with folder_id = NULL
      report.documentsAlreadyMigrated++;
      continue;
    }

    try {
      let currentParentId: string | null = null;
      for (const segment of folderSegments) {
        currentParentId = await ensureFolder(
          clientId,
          currentParentId,
          segment,
          userId,
          folderCache,
          folderStats,
        );
      }

      // Assign folder_id to the document
      const { error: updateError } = await db
        .from("documents")
        .update({ folder_id: currentParentId })
        .eq("id", doc.id);

      if (updateError) {
        report.errors.push({
          documentId: doc.id,
          documentName: doc.name,
          error: updateError.message,
        });
        report.pending++;
      } else {
        report.documentsAssigned++;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error desconocido";
      report.errors.push({ documentId: doc.id, documentName: doc.name, error: message });
      report.pending++;
    }
  }

  report.foldersCreated = folderStats.foldersCreated;
  report.foldersReused = folderStats.foldersReused;

  return report;
}
