/**
 * migrate-relative-paths.ts
 *
 * Motor de migración: relative_path → document_folders.folder_id.
 *
 * INVARIANTES:
 * - Nunca corre automáticamente. Se invoca explícitamente desde la UI por un Administrador.
 * - No usa service_role.
 * - No mueve archivos físicos en Storage.
 * - No modifica storage_path, original_name, content_hash, case_id.
 * - Idempotente: ejecutar varias veces no crea duplicados.
 * - Procesa por lotes; cada lote puede fallar parcialmente sin detener los demás.
 * - Retorna siempre un MigrationReport detallado.
 */

import { getAuthClient } from "@/lib/supabase";
import { normalizeFolderName } from "@/lib/folder-utils";
import { analyzeDocumentPath } from "@/lib/analyze-relative-paths";
import type { DocumentInput } from "@/lib/analyze-relative-paths";
import type { Database } from "@/lib/database.types";

type DocumentFolder = Database["public"]["Tables"]["document_folders"]["Row"];

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type DocumentMigrationStatus = "pending" | "migrated" | "skipped" | "failed" | "warning";

export interface DocumentMigrationResult {
  documentId: string;
  documentName: string;
  clientId?: string;
  relativePath: string | null;
  targetFolderPath: string;
  status: DocumentMigrationStatus;
  error?: string;
  warning?: string;
  migratedAt?: string;
}

export interface MigrationReport {
  documentsAnalyzed: number;
  documentsAlreadyMigrated: number;
  documentsAssigned: number;
  foldersCreated: number;
  foldersReused: number;
  errors: Array<{ documentId: string; documentName: string; error: string }>;
  pending: number;
  /** Detalles por documento — para informe JSON/CSV completo. */
  items?: DocumentMigrationResult[];
}

export interface BatchMigrationOptions {
  /** IDs de documentos específicos a (re)intentar. Si vacío, procesa todos los pendientes. */
  retryDocumentIds?: string[];
  /** Callback opcional para reportar progreso lote a lote. */
  onBatchComplete?: (progress: BatchProgress) => void;
  /** Tamaño del lote. Default: 50. */
  batchSize?: number;
}

export interface BatchProgress {
  totalDocuments: number;
  processedDocuments: number;
  migrated: number;
  skipped: number;
  failed: number;
  currentBatch: number;
  totalBatches: number;
}

// ─── Caché de carpetas ────────────────────────────────────────────────────────

interface FolderCache {
  [key: string]: string; // → folderId
}

function cacheKey(clientId: string, parentId: string | null, normalizedName: string): string {
  return `${clientId}:${parentId ?? "__root__"}:${normalizedName}`;
}

/**
 * Garantiza que existe una carpeta (la crea si no existe, la reutiliza si ya existe).
 * Maneja condiciones de carrera con el código 23505.
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

  // Buscar carpeta existente
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

  // Crear carpeta nueva
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
    // Condición de carrera: otro proceso creó la carpeta primero
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

// ─── Función principal ────────────────────────────────────────────────────────

/**
 * Migra los documentos de un cliente desde relative_path → folder_id.
 * Procesa por lotes (batchSize, default 50).
 * Es idempotente: documentos ya migrados se omiten.
 * Si se proporcionan retryDocumentIds, solo procesa esos documentos.
 *
 * No modifica: storage_path, original_name, content_hash, case_id.
 * No mueve objetos de Storage.
 */
export async function migrateRelativePaths(
  clientId: string,
  userId: string | null,
  options: BatchMigrationOptions = {},
): Promise<MigrationReport> {
  const { retryDocumentIds, onBatchComplete, batchSize = 50 } = options;

  const report: MigrationReport = {
    documentsAnalyzed: 0,
    documentsAlreadyMigrated: 0,
    documentsAssigned: 0,
    foldersCreated: 0,
    foldersReused: 0,
    errors: [],
    pending: 0,
    items: [],
  };

  const db = await getAuthClient();

  // Leer documentos del cliente con relative_path
  const docsQuery = db
    .from("documents")
    .select("id, name, relative_path, folder_id")
    .eq("client_id", clientId)
    .not("relative_path", "is", null);

  const { data: docs, error: docsError } = await docsQuery;
  if (docsError) throw new Error(`Error al leer documentos: ${docsError.message}`);

  const allDocs = (docs ?? []) as Array<{
    id: string;
    name: string;
    relative_path: string | null;
    folder_id: string | null;
  }>;

  report.documentsAnalyzed = allDocs.length;

  // Filtrar: si hay retryDocumentIds, solo procesar esos
  const workingSet = retryDocumentIds
    ? allDocs.filter((d) => retryDocumentIds.includes(d.id))
    : allDocs;

  // Analizar cada documento (puro, sin tocar Supabase)
  const docInputs: DocumentInput[] = workingSet.map((d) => ({
    id: d.id,
    client_id: clientId,
    relative_path: d.relative_path,
    folder_id: d.folder_id,
  }));

  const analyzed = docInputs.map((di) =>
    analyzeDocumentPath({
      documentId: di.id,
      clientId: di.client_id,
      relativePath: di.relative_path,
      folderId: di.folder_id,
    }),
  );

  // Contar ya migrados
  report.documentsAlreadyMigrated = analyzed.filter(
    (a) => a.action === "skip_already_migrated" || a.action === "skip_root",
  ).length;

  // Documentos a procesar
  const toMigrate = analyzed.filter((a) => a.action === "migrate");
  const toSkipNow = analyzed.filter((a) => a.action !== "migrate" && a.action !== "invalid");
  const invalid = analyzed.filter((a) => a.action === "invalid");

  // Registrar inválidos como errores
  for (const item of invalid) {
    const doc = workingSet.find((d) => d.id === item.documentId);
    report.errors.push({
      documentId: item.documentId,
      documentName: doc?.name ?? item.documentId,
      error: item.errors.join("; "),
    });
    report.pending++;
    report.items?.push({
      documentId: item.documentId,
      documentName: doc?.name ?? item.documentId,
      clientId,
      relativePath: item.originalRelativePath,
      targetFolderPath: item.targetFolderPath,
      status: "failed",
      error: item.errors.join("; "),
    });
  }

  // Registrar omitidos (ya migrados, raíz, sin ruta)
  for (const item of toSkipNow) {
    const doc = workingSet.find((d) => d.id === item.documentId);
    report.items?.push({
      documentId: item.documentId,
      documentName: doc?.name ?? item.documentId,
      clientId,
      relativePath: item.originalRelativePath,
      targetFolderPath: "",
      status: "skipped",
    });
  }

  // Procesar por lotes
  const totalBatches = Math.ceil(toMigrate.length / batchSize);
  const folderCache: FolderCache = {};
  const folderStats = { foldersCreated: 0, foldersReused: 0 };

  for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
    const batch = toMigrate.slice(batchIdx * batchSize, (batchIdx + 1) * batchSize);

    for (const item of batch) {
      const doc = workingSet.find((d) => d.id === item.documentId);
      const docName = doc?.name ?? item.documentId;

      try {
        // Crear o reutilizar carpetas en la jerarquía
        let currentParentId: string | null = null;
        for (const segment of item.folderSegments) {
          currentParentId = await ensureFolder(
            clientId,
            currentParentId,
            segment,
            userId,
            folderCache,
            folderStats,
          );
        }

        // Asignar folder_id al documento (solo actualiza folder_id, nunca otros campos)
        const { error: updateError } = await db
          .from("documents")
          .update({ folder_id: currentParentId })
          .eq("id", item.documentId);

        if (updateError) {
          report.errors.push({
            documentId: item.documentId,
            documentName: docName,
            error: updateError.message,
          });
          report.pending++;
          report.items?.push({
            documentId: item.documentId,
            documentName: docName,
            clientId,
            relativePath: item.originalRelativePath,
            targetFolderPath: item.targetFolderPath,
            status: "failed",
            error: updateError.message,
          });
        } else {
          report.documentsAssigned++;
          report.items?.push({
            documentId: item.documentId,
            documentName: docName,
            clientId,
            relativePath: item.originalRelativePath,
            targetFolderPath: item.targetFolderPath,
            status: "migrated",
            migratedAt: new Date().toISOString(),
            warning: item.warnings.length > 0 ? item.warnings.join("; ") : undefined,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Error desconocido";
        report.errors.push({ documentId: item.documentId, documentName: docName, error: message });
        report.pending++;
        report.items?.push({
          documentId: item.documentId,
          documentName: docName,
          clientId,
          relativePath: item.originalRelativePath,
          targetFolderPath: item.targetFolderPath,
          status: "failed",
          error: message,
        });
      }
    }

    // Progreso por lote
    onBatchComplete?.({
      totalDocuments: toMigrate.length,
      processedDocuments: Math.min((batchIdx + 1) * batchSize, toMigrate.length),
      migrated: report.documentsAssigned,
      skipped: report.documentsAlreadyMigrated,
      failed: report.pending,
      currentBatch: batchIdx + 1,
      totalBatches,
    });
  }

  report.foldersCreated = folderStats.foldersCreated;
  report.foldersReused = folderStats.foldersReused;

  return report;
}

// ─── Verificación de esquema ──────────────────────────────────────────────────

/**
 * Comprueba si la migración SQL ya fue aplicada verificando que las tablas/columnas existen.
 * Retorna null si está disponible, o un mensaje de error descriptivo.
 *
 * Distingue los siguientes casos:
 *   - Tabla inexistente (42P01 / PGRST200 / "does not exist")
 *   - Columna inexistente (42703 / "column" / "folder_id")
 *   - Permiso denegado / RLS (42501 / "permission denied" / "insufficient privilege")
 *   - Sesión vencida (JWT / "session" / "auth")
 *   - Conexión fallida (network / "fetch" / "ECONNREFUSED" / "Failed to fetch")
 *   - Error desconocido
 *
 * Nunca inserta, actualiza ni elimina datos.
 */
export async function checkMigrationSchemaAvailable(): Promise<string | null> {
  try {
    const db = await getAuthClient();

    // ── Verificar sesión activa ──────────────────────────────────────────────
    const { data: sessionData, error: sessionError } = await db.auth.getSession();
    if (sessionError || !sessionData?.session) {
      return "Tu sesión venció o no está activa. Inicia sesión nuevamente para usar esta herramienta.";
    }

    // ── Verificar que document_folders existe ────────────────────────────────
    const { error } = await db.from("document_folders").select("id").limit(0);

    if (error) {
      const code = error.code ?? "";
      const msg = (error.message ?? "").toLowerCase();

      // Tabla inexistente
      if (
        code === "42P01" ||
        code === "PGRST200" ||
        msg.includes("does not exist") ||
        msg.includes("undefined_table") ||
        (msg.includes("relation") && msg.includes("does not exist"))
      ) {
        return "La migración de base de datos aún no ha sido aplicada. Ejecuta supabase/migrations/20260725120000_document_folders.sql antes de usar esta herramienta.";
      }

      // Permiso denegado o RLS
      if (
        code === "42501" ||
        msg.includes("permission denied") ||
        msg.includes("insufficient privilege") ||
        msg.includes("rls") ||
        msg.includes("row-level security")
      ) {
        return "No tienes permisos para verificar el esquema. Contacta al administrador de la base de datos.";
      }

      // Sesión vencida detectada en la respuesta (JWT expirado a nivel de PostgREST)
      if (
        code === "PGRST301" ||
        msg.includes("jwt") ||
        msg.includes("expired") ||
        msg.includes("invalid token") ||
        msg.includes("session")
      ) {
        return "Tu sesión venció. Recarga la página e inicia sesión nuevamente.";
      }

      // Error de conexión
      if (
        msg.includes("fetch") ||
        msg.includes("network") ||
        msg.includes("econnrefused") ||
        msg.includes("failed to fetch") ||
        msg.includes("enotfound")
      ) {
        return "No se pudo conectar con Supabase. Verifica tu conexión a Internet e inténtalo de nuevo.";
      }

      // Error desconocido
      return `Error al verificar el esquema (${code || "sin código"}): ${error.message}`;
    }

    // ── Verificar que documents.folder_id existe ─────────────────────────────
    const { error: docError } = await db.from("documents").select("folder_id").limit(0);

    if (docError) {
      const code = docError.code ?? "";
      const msg = (docError.message ?? "").toLowerCase();

      // Columna inexistente
      if (
        code === "42703" ||
        msg.includes("column") ||
        msg.includes("folder_id") ||
        msg.includes("does not exist")
      ) {
        return "La columna folder_id no existe en la tabla documents. Ejecuta la migración pendiente (20260725120000_document_folders.sql).";
      }

      // Permiso denegado
      if (
        code === "42501" ||
        msg.includes("permission denied") ||
        msg.includes("insufficient privilege")
      ) {
        return "No tienes permisos para verificar la columna folder_id en documents.";
      }

      return `Error al verificar columna folder_id: ${docError.message}`;
    }

    return null; // Esquema disponible ✓
  } catch (err) {
    const msg = err instanceof Error ? err.message.toLowerCase() : "";

    if (msg.includes("fetch") || msg.includes("network") || msg.includes("failed to fetch")) {
      return "No se pudo conectar con Supabase. Verifica tu conexión a Internet e inténtalo de nuevo.";
    }

    if (msg.includes("jwt") || msg.includes("session") || msg.includes("auth")) {
      return "Tu sesión venció. Recarga la página e inicia sesión nuevamente.";
    }

    return err instanceof Error
      ? `Error al verificar esquema: ${err.message}`
      : "Error desconocido al verificar el esquema de base de datos.";
  }
}
