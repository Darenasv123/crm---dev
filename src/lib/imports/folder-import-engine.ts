/**
 * folder-import-engine.ts
 * Orchestrates the actual Supabase writes for bulk folder imports.
 * Depends on folder-import.ts for types and pure analysis functions.
 */
import type { Json } from "@/lib/database.types";
import { getAuthClient, supabase } from "@/lib/supabase";
import { isMissingSchemaFieldError } from "@/lib/supabase-errors";
import { buildClientInitials } from "@/lib/client-validation";
import { sha256 } from "@/lib/imports/zip-import";
import { normalizeFolderName } from "@/lib/folder-utils";
import {
  sanitizeStoragePath,
  type ClientEntry,
  type DocumentEntry,
  type ImportStats,
} from "@/lib/imports/folder-import";

// ─── Constants ────────────────────────────────────────────────────────────────

const COLORS = [
  "oklch(0.74 0.12 80)",
  "oklch(0.55 0.13 235)",
  "oklch(0.62 0.14 155)",
  "oklch(0.62 0.18 25)",
  "oklch(0.55 0.13 290)",
  "oklch(0.34 0.09 255)",
];

const UPLOAD_CONCURRENCY = 3;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ImportResult {
  importJobId: string | null;
  stats: ImportStats;
  /** Final list of client entries with updated statuses */
  clients: ClientEntry[];
}

export interface RunImportParams {
  rootName: string;
  clients: ClientEntry[];
  onProgress: (stats: ImportStats) => void;
}

// ─── Concurrency pool ─────────────────────────────────────────────────────────

async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results: T[] = [];
  let index = 0;

  async function worker(): Promise<void> {
    while (index < tasks.length) {
      const current = index++;
      results[current] = await tasks[current]();
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ─── Client creation ──────────────────────────────────────────────────────────

async function createImportedClient(name: string, createdBy: string): Promise<string> {
  const db = await getAuthClient();
  const initials = buildClientInitials(name);
  const color = COLORS[Math.floor(Math.random() * COLORS.length)];

  // After migration 20260724000000, dni/phone/process_type are nullable.
  // We never store fake sentinel values — fields are left NULL for staff to complete.
  const fullPayload = {
    name: name.trim(),
    initials,
    color,
    dni: null as string | null,
    document_type: "Otro" as string,
    document_number: null as string | null,
    phone: null as string | null,
    process_type: null as string | null,
    status: "En espera",
    notes: "Importado masivamente — datos pendientes de completar",
    created_by: createdBy,
  };

  const { data, error } = await db.from("clients").insert(fullPayload).select("id").single();

  if (isMissingSchemaFieldError(error)) {
    // Pre-migration fallback: schema still has NOT NULL on dni/phone/process_type.
    // In this case we cannot safely insert without fake data, so we surface the error
    // to the user instead of silently writing false values.
    throw new Error(
      `La migración 20260724000000 aún no se ha aplicado a esta base de datos. ` +
        `Aplica la migración antes de usar la importación masiva.`,
    );
  }

  if (error) throw new Error(error.message);
  if (!data?.id) throw new Error("Supabase did not return client id after insert");
  return data.id;
}

// ─── Document pre-fetch ───────────────────────────────────────────────────────

interface ExistingDocInfo {
  relative_path: string | null;
  original_name: string | null;
  content_hash: string | null;
  storage_path: string;
}

async function fetchExistingDocs(clientId: string): Promise<ExistingDocInfo[]> {
  const db = await getAuthClient();
  const { data, error } = await db
    .from("documents")
    .select("relative_path, original_name, content_hash, storage_path")
    .eq("client_id", clientId);
  if (error) return []; // non-fatal: proceed without duplicate check
  return (data ?? []) as ExistingDocInfo[];
}

// ─── Error message helpers ────────────────────────────────────────────────────

/**
 * Maps Supabase/PostgreSQL error codes and messages to human-readable Spanish
 * messages suitable for non-technical administrative staff.
 *
 * Error code reference:
 *   23505 — UNIQUE violation (documento ya existe para este cliente y ruta)
 *   23502 — NOT NULL violation (campo obligatorio faltante en la inserción)
 *   42501 — insufficient_privilege (RLS bloqueó la operación)
 *   42P01 — undefined_table (tabla no existe en el esquema)
 *   PGRST204 — schema cache miss (migración no aplicada o caché desactualizada)
 *   PGRST301 — anon no autenticado intentó acceder a recurso protegido
 */
function buildUserFriendlyError(error: { code?: string; message?: string }): string {
  const code = error.code ?? "";
  const msg = error.message ?? "";

  // Unique constraint violation — documento duplicado
  if (code === "23505")
    return "Este documento ya existe en la misma ruta para este cliente. Se omitirá.";

  // NOT NULL violation — payload incompleto
  if (code === "23502")
    return "Falta un campo obligatorio al registrar el documento. Contacta al administrador.";

  // RLS / permisos insuficientes
  if (code === "42501" || code === "PGRST301")
    return "Sin permisos para realizar esta operación. Verifica que tu sesión sigue activa y que tu cuenta está activa.";

  // Tabla inexistente — la migración no se aplicó
  if (code === "42P01")
    return "La tabla requerida no existe en la base de datos. Es posible que falte aplicar una migración.";

  // Caché de esquema desactualizada — migración aplicada pero Supabase no la detectó aún
  if (code === "PGRST204")
    return "La base de datos no reconoce los campos nuevos. Aplica la migración 20260724000000 y espera unos segundos para que el caché se actualice.";

  // Sesión expirada o JWT inválido
  if (
    msg.includes("JWT") ||
    msg.includes("session") ||
    msg.includes("auth") ||
    msg.includes("token")
  )
    return "Tu sesión ha expirado. Por favor recarga la página e inicia sesión de nuevo.";

  // Bucket inexistente en Storage
  if (msg.includes("Bucket not found") || msg.includes("bucket"))
    return "El bucket de almacenamiento 'documents' no existe. Contacta al administrador para crearlo en Supabase Storage.";

  // Archivo demasiado grande para Storage
  if (
    msg.includes("exceeded") ||
    msg.includes("too large") ||
    msg.includes("size") ||
    msg.includes("payload too large")
  )
    return "El archivo supera el límite de tamaño permitido (10 MB). Omite este archivo o comprimelo antes de importar.";

  // Error genérico de Storage
  if (msg.includes("storage") || msg.includes("Storage"))
    return "Error al subir el archivo al almacenamiento. Verifica la conexión e intenta de nuevo.";

  // Error de conexión de red
  if (
    msg.includes("network") ||
    msg.includes("fetch") ||
    msg.includes("ECONNREFUSED") ||
    msg.includes("Failed to fetch")
  )
    return "Error de conexión. Verifica tu conexión a internet e intenta de nuevo.";

  // Error desconocido — mostrar el mensaje técnico para que el admin pueda reportarlo
  return msg
    ? `Error al registrar el documento: ${msg}`
    : "Error desconocido al registrar el documento. Intenta de nuevo o contacta al administrador.";
}

// ─── Document upload ──────────────────────────────────────────────────────────

async function formatFileSize(bytes: number): Promise<string> {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// ─── Folder resolution cache ──────────────────────────────────────────────────

/** In-memory cache per import run: "clientId:parentId:normalizedName" → folderId */
type FolderCacheMap = Map<string, string>;

function folderCacheKey(clientId: string, parentId: string | null, normalizedName: string): string {
  return `${clientId}:${parentId ?? "__root__"}:${normalizedName}`;
}

/**
 * Ensures a document_folders row exists for the given segment.
 * Reutilizes existing folders. Creates only when absent.
 * Returns the folder id.
 */
async function ensureImportFolder(
  clientId: string,
  parentId: string | null,
  segmentName: string,
  createdBy: string,
  cache: FolderCacheMap,
): Promise<string> {
  const normalized = normalizeFolderName(segmentName);
  const key = folderCacheKey(clientId, parentId, normalized);
  const cached = cache.get(key);
  if (cached) return cached;

  const db = await getAuthClient();
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
    const id = (existing[0] as { id: string }).id;
    cache.set(key, id);
    return id;
  }

  const { data: created, error } = await db
    .from("document_folders")
    .insert({
      client_id: clientId,
      parent_id: parentId ?? null,
      name: segmentName.trim(),
      normalized_name: normalized,
      created_by: createdBy,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      // Race condition — query again
      const { data: raceResult } = await query.limit(1);
      if (raceResult && raceResult.length > 0) {
        const id = (raceResult[0] as { id: string }).id;
        cache.set(key, id);
        return id;
      }
    }
    // Non-fatal: continue without folder assignment
    throw new Error(`ensureImportFolder: ${error.message}`);
  }
  if (!created) throw new Error(`ensureImportFolder: no data returned`);
  cache.set(key, created.id);
  return created.id;
}

/**
 * Resolves the folder_id for a document based on its relative path within the client folder.
 * e.g. relPathWithinClient = "Resoluciones/2024/res01.pdf" → folder for "Resoluciones/2024"
 * Returns null if there are no folder segments (file at client root).
 */
async function resolveFolderIdForPath(
  relPathWithinClient: string,
  clientId: string,
  createdBy: string,
  cache: FolderCacheMap,
): Promise<string | null> {
  const parts = relPathWithinClient.split("/").filter(Boolean);
  const folderSegments = parts.slice(0, -1); // drop the filename
  if (folderSegments.length === 0) return null;

  let currentParentId: string | null = null;
  for (const segment of folderSegments) {
    try {
      currentParentId = await ensureImportFolder(
        clientId,
        currentParentId,
        segment,
        createdBy,
        cache,
      );
    } catch {
      // Non-fatal: if folder creation fails, fall back to no folder assignment
      return null;
    }
  }
  return currentParentId;
}

async function uploadDocument(
  entry: DocumentEntry,
  clientId: string,
  createdBy: string,
  existingDocs: ExistingDocInfo[],
  folderCache: FolderCacheMap,
  onDocDone: (status: "done" | "duplicate_skipped" | "failed", msg?: string) => void,
): Promise<void> {
  // 1. Build the relative path within the client folder (segments after the client name)
  //    e.g. "JUAN PÉREZ/Resoluciones/res01.pdf" → "Resoluciones/res01.pdf"
  const segments = entry.relativePath.split("/");
  const relPathWithinClient = segments.slice(1).join("/") || entry.originalName;

  // 2. Check duplicate by relative_path (primary dedup key — handles same filename in
  //    different subdirectories correctly, unlike original_name alone).
  const pathDup = existingDocs.some((d) => d.relative_path === relPathWithinClient);
  if (pathDup) {
    entry.status = "duplicate_skipped";
    onDocDone("duplicate_skipped");
    return;
  }

  // 3. Compute SHA-256 for content-based dedup (secondary key)
  let contentHash: string | undefined;
  try {
    if (typeof crypto !== "undefined" && crypto.subtle) {
      const buf = await entry.file.arrayBuffer();
      contentHash = await sha256(buf);
      const hashDup = existingDocs.some((d) => d.content_hash && d.content_hash === contentHash);
      if (hashDup) {
        entry.status = "duplicate_skipped";
        entry.checksum = contentHash;
        onDocDone("duplicate_skipped");
        return;
      }
    }
  } catch {
    // SHA-256 unavailable — skip content-hash dedup, proceed
  }

  // 4. Build storage path from the relative path (sanitized)
  const storagePath = `${clientId}/${sanitizeStoragePath(relPathWithinClient)}`;
  entry.storagePath = storagePath;

  // 4b. Resolve folder_id for the logical folder hierarchy
  const folderId = await resolveFolderIdForPath(
    relPathWithinClient,
    clientId,
    createdBy,
    folderCache,
  );

  // 5. Upload to Storage
  const { error: uploadError } = await supabase.storage
    .from("documents")
    .upload(storagePath, entry.file, { upsert: false });

  if (uploadError) {
    entry.status = "failed";
    entry.errorMessage = uploadError.message;
    onDocDone("failed", uploadError.message);
    return;
  }

  // 6. Build size string
  const sizeStr = await formatFileSize(entry.file.size);

  // 7. Insert into documents table
  const db = await getAuthClient();
  const docPayload = {
    name: entry.originalName,
    original_name: entry.originalName,
    display_name: entry.originalName,
    relative_path: relPathWithinClient,
    content_hash: contentHash ?? null,
    folder_id: folderId ?? null,
    type: "Importado",
    document_type: "Importado",
    size: sizeStr,
    file_size: entry.file.size,
    storage_path: storagePath,
    client_id: clientId,
    source_type: "bulk_import",
    source_provider: "local_folder",
    processing_status: "pending",
    verification_status: "pending",
    checksum: contentHash ?? null,
    created_by: createdBy,
    mime_type: entry.file.type || null,
  };

  let { error: insertError } = await db.from("documents").insert(docPayload);

  if (isMissingSchemaFieldError(insertError)) {
    // Legacy schema fallback — columns added by migration 20260724000000 may not exist yet
    const legacyDoc = {
      name: docPayload.name,
      original_name: docPayload.original_name,
      display_name: docPayload.display_name,
      type: docPayload.type,
      document_type: docPayload.document_type,
      size: docPayload.size,
      file_size: docPayload.file_size,
      storage_path: docPayload.storage_path,
      client_id: docPayload.client_id,
      source_type: docPayload.source_type,
      source_provider: docPayload.source_provider,
      processing_status: docPayload.processing_status,
      verification_status: docPayload.verification_status,
      created_by: docPayload.created_by,
      mime_type: docPayload.mime_type,
    };
    ({ error: insertError } = await db.from("documents").insert(legacyDoc));
  }

  if (insertError) {
    // Unique constraint violation: document already exists (idempotency guard via
    // index documents_client_relative_path_unique from migration 20260724000000).
    if (insertError.code === "23505") {
      try {
        await supabase.storage.from("documents").remove([storagePath]);
      } catch {
        // best-effort cleanup of the duplicate upload
      }
      entry.status = "duplicate_skipped";
      onDocDone("duplicate_skipped");
      return;
    }

    // Any other insert error: remove orphaned Storage file
    try {
      await supabase.storage.from("documents").remove([storagePath]);
    } catch {
      // best-effort cleanup
    }
    entry.status = "failed";
    entry.errorMessage = buildUserFriendlyError(insertError);
    onDocDone("failed", entry.errorMessage);
    return;
  }

  entry.status = "done";
  entry.checksum = contentHash;
  onDocDone("done");
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

export async function runImport(params: RunImportParams): Promise<ImportResult> {
  const { rootName, clients, onProgress } = params;

  // Validate session
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) {
    throw new Error("No hay sesión activa. Por favor inicia sesión antes de importar.");
  }
  const userId = session.user.id;

  const stats: ImportStats = {
    totalClients: clients.length,
    totalDocuments: clients.reduce(
      (s, c) => s + c.documents.filter((d) => d.status === "pending").length,
      0,
    ),
    clientsCreated: 0,
    clientsAssociated: 0,
    clientsSkipped: 0,
    clientsFailed: 0,
    documentsUploaded: 0,
    documentsDuplicateSkipped: 0,
    documentsInvalid: 0,
    documentsFailed: 0,
    currentClientName: "",
    processed: 0,
  };

  // Pre-count invalids
  for (const client of clients) {
    for (const doc of client.documents) {
      if (["invalid_format", "invalid_empty", "invalid_size"].includes(doc.status)) {
        stats.documentsInvalid++;
      }
    }
  }

  // Create import_job record
  let importJobId: string | null = null;
  try {
    const db = await getAuthClient();
    const jobPayload = {
      name: `Importación carpeta — ${rootName} — ${new Date().toLocaleString("es-PE")}`,
      provider: "local_folder",
      status: "processing",
      total_folders: clients.length,
      total_documents: stats.totalDocuments,
      detected_clients: clients.length,
      created_by: userId,
      started_at: new Date().toISOString(),
      configuration: {
        rootName,
        totalClients: clients.length,
        totalDocuments: stats.totalDocuments,
      } as Json,
    };
    const { data: jobData } = await db.from("import_jobs").insert(jobPayload).select("id").single();
    importJobId = jobData?.id ?? null;
  } catch {
    // Non-fatal: continue without job tracking
  }

  // Process clients sequentially
  for (const client of clients) {
    stats.currentClientName = client.folderName;
    onProgress({ ...stats });

    // Determine resolution
    const skip =
      client.status === "excluded" ||
      client.duplicateResolution === "skip" ||
      client.status === "empty";

    if (skip) {
      client.status = client.status === "empty" ? "empty" : "excluded";
      stats.clientsSkipped++;
      onProgress({ ...stats });
      continue;
    }

    // Resolve client ID
    let clientId: string | null = null;

    const useExisting =
      client.status === "duplicate_exact" && client.duplicateResolution === "use_existing";

    if (useExisting && client.existingClientId) {
      clientId = client.existingClientId;
      client.createdClientId = clientId;
      stats.clientsAssociated++;
    } else {
      // Create new client (covers 'new', 'duplicate_approximate', 'create_new' resolution)
      try {
        clientId = await createImportedClient(client.folderName, userId);
        client.createdClientId = clientId;
        client.status = "done";
        stats.clientsCreated++;
      } catch (err) {
        client.status = "failed";
        client.errorMessage = err instanceof Error ? err.message : "Error al crear cliente";
        stats.clientsFailed++;
        onProgress({ ...stats });
        continue;
      }
    }

    // Fetch existing documents for this client
    const existingDocs = await fetchExistingDocs(clientId);

    // Per-client folder cache for this import run
    const folderCache: FolderCacheMap = new Map();

    // Build upload tasks for valid pending documents
    const pendingDocs = client.documents.filter((d) => d.status === "pending");

    const tasks = pendingDocs.map((doc) => async () => {
      await uploadDocument(doc, clientId!, userId, existingDocs, folderCache, (status, msg) => {
        if (status === "done") stats.documentsUploaded++;
        else if (status === "duplicate_skipped") stats.documentsDuplicateSkipped++;
        else if (status === "failed") stats.documentsFailed++;
        stats.processed++;
        onProgress({ ...stats });
        if (msg) doc.errorMessage = msg;
      });
    });

    await runWithConcurrency(tasks, UPLOAD_CONCURRENCY);
  }

  // Finalize import_job
  if (importJobId) {
    try {
      const db = await getAuthClient();
      const hasFailed = stats.clientsFailed > 0 || stats.documentsFailed > 0;
      const hasSuccess =
        stats.clientsCreated > 0 || stats.clientsAssociated > 0 || stats.documentsUploaded > 0;
      const finalStatus = hasFailed ? (hasSuccess ? "partially_completed" : "failed") : "completed";

      await db
        .from("import_jobs")
        .update({
          status: finalStatus,
          processed_documents: stats.documentsUploaded,
          failed_documents: stats.documentsFailed,
          progress_percentage: 100,
          completed_at: new Date().toISOString(),
        })
        .eq("id", importJobId);
    } catch {
      // Non-fatal
    }
  }

  return { importJobId, stats, clients };
}

/** Re-runs only the failed DocumentEntries */
export async function retryFailedDocuments(
  clients: ClientEntry[],
  onProgress: (stats: ImportStats) => void,
): Promise<ImportResult> {
  const retryClients = clients
    .filter((c) => c.createdClientId && c.documents.some((d) => d.status === "failed"))
    .map((c) => ({
      ...c,
      // Reset failed docs to pending for retry
      documents: c.documents.map((d) =>
        d.status === "failed" ? { ...d, status: "pending" as const } : d,
      ),
      // Keep same client id — don't re-create
      status: "done" as const,
      duplicateResolution: "use_existing" as const,
      existingClientId: c.createdClientId,
    }));

  const rootName = "reintento";
  return runImport({ rootName, clients: retryClients, onProgress });
}
