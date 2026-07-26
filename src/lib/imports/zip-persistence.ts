import { isMissingSchemaFieldError } from "@/lib/supabase-errors";
import type { Database } from "@/lib/database.types";
import { formatCount } from "@/lib/text-utils";
import {
  formatSize,
  normalizeCaseStatus,
  normalizeProcessType,
  type ReviewCandidate,
  type ZipCaseCandidate,
  type ZipFileEntry,
} from "@/lib/imports/zip-import";
import { normalizeFolderName } from "@/lib/folder-utils";

type ClientInsert = Database["public"]["Tables"]["clients"]["Insert"];
type ClientUpdate = Database["public"]["Tables"]["clients"]["Update"];
type CaseInsert = Database["public"]["Tables"]["cases"]["Insert"];
type DocumentInsert = Database["public"]["Tables"]["documents"]["Insert"];

type TableName = "clients" | "cases" | "documents" | "document_folders";
type DbError = { message: string; code?: string };
type DbResult<T = unknown> = { data?: T | null; error?: DbError | null };

type DbQuery = {
  insert: (payload: unknown) => DbQuery;
  update: (payload: unknown) => DbQuery;
  select: (columns?: string) => DbQuery;
  eq: (column: string, value: unknown) => DbQuery;
  is: (column: string, value: unknown) => DbQuery;
  limit: (n: number) => DbQuery;
  single: () => Promise<DbResult<{ id: string }>>;
  maybeSingle: () => Promise<DbResult<{ id: string }>>;
  then: <TResult1 = DbResult, TResult2 = never>(
    onfulfilled?: ((value: DbResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) => Promise<TResult1 | TResult2>;
};

type DbQueryArray = DbQuery & {
  then: (resolve: (v: { data: Array<{ id: string }>; error: DbError | null }) => void) => void;
};

type DbClient = {
  from: (table: TableName) => unknown;
};

function fromDb(db: DbClient, table: TableName): DbQuery {
  return db.from(table) as DbQuery;
}

type StorageBucket = {
  upload: (
    path: string,
    body: Blob,
    options?: Record<string, unknown>,
  ) => Promise<{ error: { message: string } | null }>;
  remove: (paths: string[]) => Promise<{ error: { message: string } | null }>;
};

export type PersistStatus = "success" | "partial" | "failed" | "skipped";

/**
 * Structured error detail for a single failed operation.
 * Surfaced in the UI as a collapsible "Ver detalle" panel.
 */
export interface OperationError {
  summary: string;
  stage: "client" | "case" | "document" | "storage";
  code?: string;
  detail?: string;
  action?: string;
}

export interface PersistZipCandidateParams {
  candidate: ReviewCandidate;
  db: DbClient;
  storageBucket: StorageBucket;
  sourceFileName: string;
  buildInitials: (name: string) => string;
  randomColor: () => string;
  now?: () => number;
  existingClientIdOverride?: string;
}

export interface PersistZipCandidateResult {
  folderName: string;
  status: PersistStatus;
  clientId?: string;
  clientAlreadyExisted?: boolean;
  documentsImported: number;
  documentsSkipped: number;
  error?: string;
  errorDetail?: OperationError;
  errors: string[];
  compensations: string[];
  caseIds: Array<{ id: string; title: string; caseNumber: string | null }>;
  documentIds: Array<{ id: string; name: string; storagePath: string; caseId: string | null }>;
  failedFiles: Array<{ name: string; path: string; error: string }>;
  warnings: string[];
}

const PENDING_PROCESS_TYPE = "Pendiente de clasificación";

function ensureSupabaseData<T>(
  data: T | null | undefined,
  error: { message: string } | null | undefined,
  action: string,
): T {
  if (error) throw new Error(`${action}: ${error.message}`);
  if (!data) throw new Error(`${action}: Supabase no devolvió datos.`);
  return data;
}

function safeProcessType(value?: string | null): string {
  return (
    normalizeProcessType(value) ??
    (value === PENDING_PROCESS_TYPE ? PENDING_PROCESS_TYPE : PENDING_PROCESS_TYPE)
  );
}

function safeNamePart(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 120);
}

function mimeTypeFor(ext: string): string {
  const map: Record<string, string> = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".doc": "application/msword",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".txt": "text/plain",
    ".rtf": "application/rtf",
  };
  return map[ext] ?? "application/octet-stream";
}

function buildDocumentCaseMap(candidate: ReviewCandidate): Record<string, string> {
  if (candidate.documentCaseMap) return candidate.documentCaseMap;
  const map: Record<string, string> = {};
  for (const caseCandidate of candidate.caseCandidates ?? []) {
    for (const path of caseCandidate.documentPaths) map[path] = caseCandidate.id;
  }
  return map;
}

function activeFilesForCase(
  candidate: ReviewCandidate,
  caseCandidate: ZipCaseCandidate,
  documentCaseMap: Record<string, string>,
): ZipFileEntry[] {
  return candidate.files.filter(
    (file) =>
      file.data.byteLength > 0 &&
      !candidate.excludedFiles.has(file.zipPath) &&
      documentCaseMap[file.zipPath] === caseCandidate.id,
  );
}

function fallbackCases(candidate: ReviewCandidate): ZipCaseCandidate[] {
  if (candidate.caseCandidates) return candidate.caseCandidates;
  const activePaths = candidate.files.map((file) => file.zipPath);
  return [
    {
      id: "pending-1",
      title: "Expediente pendiente de clasificación",
      caseNumber: null,
      processType: PENDING_PROCESS_TYPE,
      matter: PENDING_PROCESS_TYPE,
      specialty: PENDING_PROCESS_TYPE,
      juzgado: "Por determinar",
      status: "pendiente_revision",
      origin: "importacion_zip_individual",
      originPath: candidate.folderPath,
      confidence: 0.35,
      warnings: ["No se detectó número de expediente."],
      documentPaths: activePaths,
      isProvisional: true,
    },
  ];
}

function prepareCasesForPersistence(candidate: ReviewCandidate): {
  caseCandidates: ZipCaseCandidate[];
  documentCaseMap: Record<string, string>;
} {
  const documentCaseMap = buildDocumentCaseMap(candidate);
  const caseCandidates = [...fallbackCases(candidate)];
  const activeFiles = candidate.files.filter(
    (file) => file.data.byteLength > 0 && !candidate.excludedFiles.has(file.zipPath),
  );
  if (!candidate.caseCandidates?.length && caseCandidates[0]) {
    for (const file of activeFiles) documentCaseMap[file.zipPath] = caseCandidates[0].id;
  }
  return { caseCandidates, documentCaseMap };
}

function provisionalExpediente(
  clientId: string,
  caseCandidate: ZipCaseCandidate,
  files: ZipFileEntry[],
): string {
  const seed = files[0]?.checksum?.slice(0, 8) || caseCandidate.id.replace(/[^a-zA-Z0-9]/g, "");
  return `PENDIENTE-${clientId.slice(0, 8)}-${seed || "REVISION"}`;
}

async function createClient(params: PersistZipCandidateParams): Promise<string> {
  const { candidate, db, sourceFileName, buildInitials, randomColor } = params;
  const effectiveName = candidate.edits.proposedName ?? candidate.proposedName;
  const processType = safeProcessType(
    candidate.edits.processType ?? candidate.detected.processType,
  );
  const documentNumber =
    candidate.edits.ruc ??
    candidate.detected.ruc ??
    candidate.edits.dni ??
    candidate.detected.dni ??
    null;
  const documentType = (candidate.edits.ruc ?? candidate.detected.ruc) ? "RUC" : "DNI";
  const payload: ClientInsert = {
    name: effectiveName,
    dni: candidate.edits.dni ?? candidate.detected.dni ?? "00000000",
    document_number: documentNumber,
    document_type: documentType,
    phone: candidate.edits.phone ?? candidate.detected.phone ?? "000000000",
    whatsapp: candidate.edits.phone ?? candidate.detected.phone ?? null,
    email: candidate.edits.email ?? candidate.detected.email ?? null,
    address: candidate.edits.address ?? candidate.detected.address ?? null,
    process_type: processType,
    status: candidate.edits.status ?? candidate.detected.status ?? "Activo",
    initials: buildInitials(effectiveName),
    color: randomColor(),
    notes: [
      candidate.edits.observations ?? candidate.detected.observations,
      `Importado desde ZIP individual: ${sourceFileName}`,
    ]
      .filter(Boolean)
      .join("\n"),
  };
  let { data, error } = await fromDb(db, "clients").insert(payload).select("id").single();
  if (isMissingSchemaFieldError(error ?? null)) {
    const legacyPayload: ClientInsert = {
      name: payload.name,
      dni: payload.dni,
      phone: payload.phone,
      email: payload.email,
      process_type: payload.process_type,
      status: payload.status,
      initials: payload.initials,
      color: payload.color,
    };
    ({ data, error } = await fromDb(db, "clients").insert(legacyPayload).select("id").single());
  }
  return ensureSupabaseData<{ id: string }>(data, error, "Crear cliente").id;
}

async function updateExistingClient(candidate: ReviewCandidate, db: DbClient): Promise<string> {
  if (!candidate.existingClientId) throw new Error("No se seleccionó cliente existente.");
  const updates: ClientUpdate = {};
  if (candidate.edits.phone) updates.phone = candidate.edits.phone;
  if (candidate.edits.email) updates.email = candidate.edits.email;
  if (candidate.edits.address) updates.address = candidate.edits.address;
  if (candidate.edits.status) updates.status = candidate.edits.status;
  if (candidate.edits.observations) updates.notes = candidate.edits.observations;
  if (candidate.edits.processType)
    updates.process_type = safeProcessType(candidate.edits.processType);
  if (Object.keys(updates).length > 0) {
    const { error } = await fromDb(db, "clients")
      .update(updates)
      .eq("id", candidate.existingClientId);
    if (error) throw new Error(`Actualizar cliente: ${error.message}`);
  }
  return candidate.existingClientId;
}

function toLegacyCaseStatus(status: string): string {
  const map: Record<string, string> = {
    "Pendiente de clasificación": "Consulta",
    pendiente_revision: "Consulta",
    "En preparación": "Documentación",
    Presentado: "Demanda presentada",
    "En trámite": "En proceso",
    "En audiencia": "Audiencia",
    "En ejecución": "En proceso",
    Concluido: "Sentencia",
    Archivado: "Archivado",
  };
  return map[status] ?? "Consulta";
}

function buildCaseError(
  raw: DbError | null | undefined,
  expediente: string,
  caseTitle: string,
): OperationError {
  const code = raw?.code ?? "";
  const msg = raw?.message ?? "Error desconocido";
  if (code === "23514") {
    return {
      summary: `Falló la creación del expediente ${expediente}. El valor de estado no está permitido.`,
      stage: "case",
      code,
      detail: msg,
      action: "Aplica la migración 20260724120000 en Supabase y reintenta.",
    };
  }
  if (code === "23505") {
    return {
      summary: `Ya existe un expediente con el número ${expediente}.`,
      stage: "case",
      code,
      detail: msg,
      action: "El expediente ya existe. Puedes reutilizarlo o revisar la numeración.",
    };
  }
  if (code === "23502") {
    return {
      summary: `Falta un campo obligatorio al crear el expediente ${expediente}.`,
      stage: "case",
      code,
      detail: msg,
      action: "Revisa que el expediente tenga número, juzgado y tipo de proceso.",
    };
  }
  if (code === "42501" || code === "PGRST301") {
    return {
      summary: "Sin permisos para crear el expediente. Verifica que tu sesión esté activa.",
      stage: "case",
      code,
      detail: msg,
      action: "Recarga la página e inicia sesión nuevamente.",
    };
  }
  return {
    summary: `Falló la creación del expediente "${caseTitle}".`,
    stage: "case",
    code: code || undefined,
    detail: msg,
    action: "Revisa el detalle técnico y contacta al administrador si el error persiste.",
  };
}

async function createCase(
  db: DbClient,
  clientId: string,
  caseCandidate: ZipCaseCandidate,
  files: ZipFileEntry[],
): Promise<string> {
  const expediente =
    caseCandidate.caseNumber ?? provisionalExpediente(clientId, caseCandidate, files);
  const processType = safeProcessType(caseCandidate.processType);
  const newStatus = normalizeCaseStatus(caseCandidate.status);
  const payload: CaseInsert = {
    client_id: clientId,
    expediente,
    case_number: caseCandidate.caseNumber,
    case_name: caseCandidate.title,
    case_type: processType,
    case_stage: caseCandidate.isProvisional ? "pendiente_revision" : null,
    court: caseCandidate.juzgado || "Por determinar",
    juzgado: caseCandidate.juzgado || "Por determinar",
    process_type: processType,
    status: newStatus,
    priority: "Media",
    demandante: caseCandidate.demandante ?? null,
    demandado: caseCandidate.demandado ?? null,
    current_status_description: caseCandidate.isProvisional ? "pendiente_revision" : null,
    internal_code: caseCandidate.isProvisional ? expediente : null,
  };
  let lastError: DbError | null | undefined = undefined;
  let { data, error } = await fromDb(db, "cases").insert(payload).select("id").single();
  if (error) lastError = error;
  if (isMissingSchemaFieldError(error ?? null)) {
    const legacyPayload: CaseInsert = {
      client_id: payload.client_id,
      expediente: payload.expediente,
      juzgado: payload.juzgado,
      process_type: payload.process_type,
      status: toLegacyCaseStatus(newStatus),
      priority: payload.priority,
      demandante: payload.demandante,
      demandado: payload.demandado,
    };
    ({ data, error } = await fromDb(db, "cases").insert(legacyPayload).select("id").single());
    if (error) lastError = error;
  }
  if (error?.code === "23514") {
    const legacyStatusPayload: CaseInsert = {
      client_id: payload.client_id,
      expediente: payload.expediente,
      case_number: payload.case_number,
      case_name: payload.case_name,
      case_type: payload.case_type,
      case_stage: payload.case_stage,
      court: payload.court,
      juzgado: payload.juzgado,
      process_type: payload.process_type,
      status: toLegacyCaseStatus(newStatus),
      priority: payload.priority,
      demandante: payload.demandante,
      demandado: payload.demandado,
      current_status_description: payload.current_status_description,
      internal_code: payload.internal_code,
    };
    ({ data, error } = await fromDb(db, "cases").insert(legacyStatusPayload).select("id").single());
    if (error) lastError = error;
  }
  const finalError = error ?? (!data ? lastError : null);
  if (finalError) {
    const structured = buildCaseError(finalError, expediente, caseCandidate.title);
    const thrown = new Error(structured.summary);
    (thrown as Error & { operationError?: OperationError }).operationError = structured;
    throw thrown;
  }
  if (!data) {
    const structured = buildCaseError(
      { message: "Supabase no devolvió el id del expediente creado.", code: "PGRST000" },
      expediente,
      caseCandidate.title,
    );
    const thrown = new Error(structured.summary);
    (thrown as Error & { operationError?: OperationError }).operationError = structured;
    throw thrown;
  }
  return data.id;
}

// ─── Folder resolution for ZIP imports ───────────────────────────────────────
//
// Centralizes the create-or-reuse algorithm also used in folder-import-engine.ts.
// The same normalized name + parent_id uniqueness is respected here.

/** In-memory cache per import run: "clientId:parentId_or_null:normalizedName" → folderId */
type ZipFolderCacheMap = Map<string, string>;

function zipFolderCacheKey(
  clientId: string,
  parentId: string | null,
  normalizedName: string,
): string {
  return `${clientId}:${parentId ?? "__root__"}:${normalizedName}`;
}

/**
 * Ensures a document_folders row exists for the given segment.
 * Reuses existing folders (idempotent). Creates only when absent.
 * Handles race conditions via 23505 retry-and-re-query.
 */
async function ensureZipFolder(
  db: DbClient,
  clientId: string,
  parentId: string | null,
  segmentName: string,
  createdBy: string | null,
  cache: ZipFolderCacheMap,
): Promise<string> {
  const normalized = normalizeFolderName(segmentName);
  const key = zipFolderCacheKey(clientId, parentId, normalized);
  const cached = cache.get(key);
  if (cached) return cached;

  // Query existing — must handle null parentId with .is() instead of .eq()
  async function queryExisting(): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      let chain = fromDb(db, "document_folders")
        .select("id")
        .eq("client_id", clientId)
        .eq("normalized_name", normalized) as DbQueryArray;
      if (parentId) {
        chain = (chain as unknown as DbQuery).eq("parent_id", parentId) as DbQueryArray;
      } else {
        chain = (chain as unknown as DbQuery).is("parent_id", null) as DbQueryArray;
      }
      (chain as unknown as DbQuery).limit(1).then(
        (res) => {
          const rows = (res as { data: Array<{ id: string }> | null }).data;
          resolve(rows && rows.length > 0 ? rows[0].id : null);
        },
        () => resolve(null),
      );
    });
  }

  const existingId = await queryExisting();
  if (existingId) {
    cache.set(key, existingId);
    return existingId;
  }

  const { data: created, error: createError } = await fromDb(db, "document_folders")
    .insert({
      client_id: clientId,
      parent_id: parentId ?? null,
      name: segmentName.trim(),
      normalized_name: normalized,
      created_by: createdBy ?? null,
    })
    .select("id")
    .single();

  if (createError) {
    if (createError.code === "23505") {
      const raceId = await queryExisting();
      if (raceId) {
        cache.set(key, raceId);
        return raceId;
      }
    }
    throw new Error(`ensureZipFolder "${segmentName}": ${createError.message}`);
  }
  if (!created) throw new Error(`ensureZipFolder "${segmentName}": no data returned`);
  cache.set(key, created.id);
  return created.id;
}

/**
 * Resolves the folder_id for a ZIP document based on its path within the client folder.
 * e.g. zipPath = "CLIENTE/Proceso de alimentos/Demanda/demanda.pdf"
 *      clientFolderPath = "CLIENTE"
 * → folder id for "Proceso de alimentos/Demanda" (two levels deep)
 * Returns null for files at the client root (no folder segments).
 */
async function resolveZipFolderIdForPath(
  db: DbClient,
  zipPath: string,
  clientFolderPath: string,
  clientId: string,
  createdBy: string | null,
  cache: ZipFolderCacheMap,
): Promise<string | null> {
  const prefix = clientFolderPath ? `${clientFolderPath}/` : "";
  const relPath = prefix && zipPath.startsWith(prefix) ? zipPath.slice(prefix.length) : zipPath;
  const parts = relPath.split("/").filter(Boolean);
  const folderSegments = parts.slice(0, -1); // drop the filename
  if (folderSegments.length === 0) return null;

  let currentParentId: string | null = null;
  for (const segment of folderSegments) {
    try {
      currentParentId = await ensureZipFolder(
        db,
        clientId,
        currentParentId,
        segment,
        createdBy,
        cache,
      );
    } catch {
      return null; // non-fatal: fall back to no folder assignment
    }
  }
  return currentParentId;
}

// ─── Document dedup and insertion ─────────────────────────────────────────────

/**
 * Checks if a document with the same content (checksum) already exists
 * at the same logical path within the same client.
 *
 * Deduplication rule:
 * - client_id + checksum + relative_path → duplicate
 * - client_id + checksum + different relative_path → NOT a duplicate
 * - same path + different checksum → NOT a duplicate
 * - different client → NOT a duplicate
 *
 * This prevents:
 * - Duplicating the exact same file in the same location
 * - Creating orphans if reinvoked
 *
 * Allows:
 * - Same file in different logical paths
 * - Same name with different content
 * - Same content in different clients
 */
async function documentAlreadyExists(
  db: DbClient,
  clientId: string,
  checksum: string,
  relativePath: string | null,
): Promise<boolean> {
  // Query: client_id + checksum + relative_path
  let query = fromDb(db, "documents")
    .select("id")
    .eq("client_id", clientId)
    .eq("checksum", checksum) as DbQuery;

  if (relativePath) {
    query = query.eq("relative_path", relativePath);
  }

  const { data, error } = await query.maybeSingle();

  if (error && !isMissingSchemaFieldError(error ?? null))
    throw new Error(`Verificar duplicado: ${error.message}`);

  return Boolean(data?.id);
}

async function insertDocument(
  db: DbClient,
  clientId: string,
  caseId: string | null,
  folderId: string | null,
  docFile: ZipFileEntry,
  storagePath: string,
  relativePath: string | null,
): Promise<string> {
  const payload: DocumentInsert = {
    name: docFile.name,
    original_name: docFile.name,
    display_name: docFile.name,
    type: docFile.docType,
    document_type: docFile.docType,
    size: formatSize(docFile.size),
    file_size: docFile.size,
    mime_type: mimeTypeFor(docFile.ext),
    storage_path: storagePath,
    client_id: clientId,
    case_id: caseId,
    folder_id: folderId ?? null,
    checksum: docFile.checksum || null,
    content_hash: docFile.checksum || null,
    relative_path: relativePath ?? null,
    source_type: "zip_import_individual",
    source_provider: "google_drive_zip_individual",
    external_file_id: docFile.zipPath,
    external_folder_id: docFile.folderPath,
    external_url: `zip://${encodeURIComponent(docFile.zipPath)}`,
    processing_status: docFile.extractionStatus === "ocr_required" ? "ocr_required" : "pending",
    verification_status: "pending",
  };
  let { data, error } = await fromDb(db, "documents").insert(payload).select("id").single();
  if (isMissingSchemaFieldError(error ?? null)) {
    const legacyPayload: DocumentInsert = {
      name: payload.name,
      type: payload.type,
      size: payload.size,
      storage_path: payload.storage_path,
      client_id: payload.client_id,
      case_id: payload.case_id,
    };
    ({ data, error } = await fromDb(db, "documents").insert(legacyPayload).select("id").single());
  }
  return ensureSupabaseData<{ id: string }>(data, error, `Registrar documento ${docFile.name}`).id;
}

export async function persistZipCandidate(
  params: PersistZipCandidateParams,
): Promise<PersistZipCandidateResult> {
  const { candidate, db, storageBucket, now = () => Date.now(), existingClientIdOverride } = params;
  const errors: string[] = [];
  const compensations: string[] = [];
  const caseIds: PersistZipCandidateResult["caseIds"] = [];
  const documentIds: PersistZipCandidateResult["documentIds"] = [];
  const failedFiles: PersistZipCandidateResult["failedFiles"] = [];
  const warnings = [...candidate.warnings];
  let documentsImported = 0;
  let documentsSkipped = 0;
  let clientId: string | undefined;
  let clientAlreadyExisted = false;
  let firstErrorDetail: OperationError | undefined;

  // ── Client stage ─────────────────────────────────────────────────────────────
  if (existingClientIdOverride) {
    clientId = existingClientIdOverride;
    clientAlreadyExisted = true;
  } else {
    try {
      const action =
        candidate.duplicates.length > 0
          ? (candidate.duplicateAction ?? "create_new")
          : "create_new";
      if (action === "skip") {
        return {
          folderName: candidate.folderName,
          status: "skipped",
          documentsImported: 0,
          documentsSkipped: 0,
          errors,
          compensations,
          caseIds,
          documentIds,
          failedFiles,
          warnings,
        };
      }
      clientId =
        action === "create_new"
          ? await createClient(params)
          : await updateExistingClient(candidate, db);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error desconocido";
      return {
        folderName: candidate.folderName,
        status: "failed",
        error: msg,
        errorDetail: {
          summary: msg,
          stage: "client",
          code: (err as { operationError?: OperationError }).operationError?.code,
          detail: msg,
          action: "Verifica los datos del cliente e intenta nuevamente.",
        },
        documentsImported: 0,
        documentsSkipped: 0,
        errors: [msg],
        compensations,
        caseIds,
        documentIds,
        failedFiles,
        warnings,
      };
    }
  }

  if (!clientId) {
    const msg = "No se pudo determinar el cliente para importar documentos.";
    return {
      folderName: candidate.folderName,
      status: "failed",
      error: msg,
      errorDetail: { summary: msg, stage: "client", action: "Reinicia la importación." },
      documentsImported: 0,
      documentsSkipped: 0,
      errors: [msg],
      compensations,
      caseIds,
      documentIds,
      failedFiles,
      warnings,
    };
  }

  const persistedClientId = clientId;
  const { documentCaseMap, caseCandidates } = prepareCasesForPersistence(candidate);
  const activeFiles = candidate.files.filter(
    (file) => file.data.byteLength > 0 && !candidate.excludedFiles.has(file.zipPath),
  );

  // Per-import folder cache — shared across all documents of this candidate
  const folderCache: ZipFolderCacheMap = new Map<string, string>();

  // Retrieve the session userId for folder created_by (best-effort)
  let sessionUserId: string | null = null;
  try {
    const dbTyped = db as unknown as {
      auth?: { getSession: () => Promise<{ data: { session: { user: { id: string } } | null } }> };
    };
    if (dbTyped.auth?.getSession) {
      const {
        data: { session },
      } = await dbTyped.auth.getSession();
      sessionUserId = session?.user?.id ?? null;
    }
  } catch {
    /* non-fatal */
  }

  // ── Helper: persist a list of documents for a given caseId (or null) ────────

  async function persistDocuments(
    filesToPersist: ZipFileEntry[],
    caseId: string | null,
  ): Promise<void> {
    for (const docFile of filesToPersist) {
      // Dedup by checksum + relative_path
      if (docFile.checksum) {
        // Calculate relative_path: remove client folder path prefix
        const prefix = candidate.folderPath ? `${candidate.folderPath}/` : "";
        const relativePath =
          prefix && docFile.zipPath.startsWith(prefix)
            ? docFile.zipPath.slice(prefix.length)
            : docFile.zipPath;

        let isDup = false;
        try {
          isDup = await documentAlreadyExists(
            db,
            persistedClientId,
            docFile.checksum,
            relativePath,
          );
        } catch {
          // non-fatal: proceed
        }
        if (isDup) {
          documentsSkipped++;
          continue;
        }
      }

      // Resolve folder_id from ZIP path structure
      const folderId = await resolveZipFolderIdForPath(
        db,
        docFile.zipPath,
        candidate.folderPath,
        persistedClientId,
        sessionUserId,
        folderCache,
      );

      // Calculate relative_path: remove client folder path prefix
      const prefix = candidate.folderPath ? `${candidate.folderPath}/` : "";
      const relativePath =
        prefix && docFile.zipPath.startsWith(prefix)
          ? docFile.zipPath.slice(prefix.length)
          : docFile.zipPath;

      // Upload to Storage
      const safeName = safeNamePart(docFile.name);
      const storagePath = `${persistedClientId}/${now()}_${safeName}`;
      const blob = new Blob([docFile.data], { type: mimeTypeFor(docFile.ext) });
      const { error: uploadErr } = await storageBucket.upload(storagePath, blob, {
        contentType: mimeTypeFor(docFile.ext),
      });

      if (uploadErr) {
        const msg = uploadErr.message;
        errors.push(msg);
        if (!firstErrorDetail) firstErrorDetail = { summary: msg, stage: "storage", detail: msg };
        failedFiles.push({ name: docFile.name, path: docFile.zipPath, error: msg });
        continue;
      }

      // Insert document record
      let documentId: string;
      try {
        documentId = await insertDocument(
          db,
          persistedClientId,
          caseId,
          folderId,
          docFile,
          storagePath,
          relativePath,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error desconocido";
        errors.push(msg);
        if (!firstErrorDetail) firstErrorDetail = { summary: msg, stage: "document", detail: msg };
        failedFiles.push({ name: docFile.name, path: docFile.zipPath, error: msg });
        // Compensate Storage upload
        try {
          await storageBucket.remove([storagePath]);
          compensations.push(`Storage revertido: ${storagePath}`);
        } catch {
          // best-effort
        }
        continue;
      }

      documentsImported++;
      documentIds.push({
        id: documentId,
        name: docFile.name,
        storagePath,
        caseId: caseId ?? null,
      });
    }
  }

  // ── Unclassified documents (caseId = null) ────────────────────────────────

  const unclassifiedFiles = activeFiles.filter(
    (f) => documentCaseMap[f.zipPath] === "__unclassified",
  );
  if (unclassifiedFiles.length > 0) {
    await persistDocuments(unclassifiedFiles, null);
  }

  // ── Case stage + Document stage ──────────────────────────────────────────────

  for (const caseCandidate of caseCandidates) {
    const caseFiles = activeFilesForCase(candidate, caseCandidate, documentCaseMap);
    if (caseFiles.length === 0) continue;

    let caseId: string | null = null;
    try {
      caseId = await createCase(db, persistedClientId, caseCandidate, caseFiles);
      caseIds.push({
        id: caseId,
        title: caseCandidate.title,
        caseNumber: caseCandidate.caseNumber,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error desconocido";
      const opErr =
        (err as Error & { operationError?: OperationError }).operationError ??
        buildCaseError(
          { message: msg },
          caseCandidate.caseNumber ?? caseCandidate.id,
          caseCandidate.title,
        );
      if (!firstErrorDetail) firstErrorDetail = opErr;
      errors.push(msg);
      for (const f of caseFiles) {
        failedFiles.push({ name: f.name, path: f.zipPath, error: msg });
      }
      continue; // proceed with other cases
    }

    const filesForCase = caseFiles;

    await persistDocuments(filesForCase, caseId);
  }

  // ── Determine final status ────────────────────────────────────────────────────

  const hasErrors = errors.length > 0;
  const hasSuccess = documentsImported > 0 || caseIds.length > 0;
  let finalStatus: PersistStatus;

  if (!hasErrors && !hasSuccess && documentsSkipped > 0) {
    // All documents were duplicates — treat as success
    finalStatus = "success";
  } else if (!hasErrors) {
    finalStatus = "success";
  } else if (hasSuccess) {
    finalStatus = "partial";
  } else {
    finalStatus = "partial"; // client was created but all docs/cases failed
  }

  return {
    folderName: candidate.folderName,
    status: finalStatus,
    clientId: persistedClientId,
    clientAlreadyExisted,
    documentsImported,
    documentsSkipped,
    error: firstErrorDetail?.summary,
    errorDetail: firstErrorDetail,
    errors,
    compensations,
    caseIds,
    documentIds,
    failedFiles,
    warnings,
  };
}
