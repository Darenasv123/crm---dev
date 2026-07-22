import { isMissingSchemaFieldError } from "@/lib/supabase-errors";
import type { Database } from "@/lib/database.types";
import {
  formatSize,
  normalizeCaseStatus,
  normalizeProcessType,
  type ReviewCandidate,
  type ZipCaseCandidate,
  type ZipFileEntry,
} from "@/lib/imports/zip-import";

type ClientInsert = Database["public"]["Tables"]["clients"]["Insert"];
type ClientUpdate = Database["public"]["Tables"]["clients"]["Update"];
type CaseInsert = Database["public"]["Tables"]["cases"]["Insert"];
type DocumentInsert = Database["public"]["Tables"]["documents"]["Insert"];

type TableName = "clients" | "cases" | "documents";
type DbError = { message: string; code?: string };
type DbResult<T = unknown> = { data?: T | null; error?: DbError | null };

type DbQuery = {
  insert: (payload: unknown) => DbQuery;
  update: (payload: unknown) => DbQuery;
  select: (columns?: string) => DbQuery;
  eq: (column: string, value: unknown) => DbQuery;
  single: () => Promise<DbResult<{ id: string }>>;
  maybeSingle: () => Promise<DbResult<{ id: string }>>;
  then: <TResult1 = DbResult, TResult2 = never>(
    onfulfilled?: ((value: DbResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) => Promise<TResult1 | TResult2>;
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

export interface PersistZipCandidateParams {
  candidate: ReviewCandidate;
  db: DbClient;
  storageBucket: StorageBucket;
  sourceFileName: string;
  buildInitials: (name: string) => string;
  randomColor: () => string;
  now?: () => number;
}

export interface PersistZipCandidateResult {
  folderName: string;
  status: PersistStatus;
  clientId?: string;
  documentsImported: number;
  documentsSkipped: number;
  error?: string;
  errors: string[];
  compensations: string[];
  caseIds: Array<{ id: string; title: string; caseNumber: string | null }>;
  documentIds: Array<{ id: string; name: string; storagePath: string; caseId: string }>;
  failedFiles: Array<{ name: string; path: string; error: string }>;
  warnings: string[];
}

const PENDING_PROCESS_TYPE = "Pendiente de clasificacion";

function ensureSupabaseData<T>(
  data: T | null | undefined,
  error: { message: string } | null | undefined,
  action: string,
): T {
  if (error) throw new Error(`${action}: ${error.message}`);
  if (!data) throw new Error(`${action}: Supabase no devolvio datos.`);
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
  if (candidate.caseCandidates?.length) return candidate.caseCandidates;
  const activePaths = candidate.files.map((file) => file.zipPath);
  return [
    {
      id: "pending-1",
      title: "Expediente pendiente de clasificacion",
      caseNumber: null,
      processType: PENDING_PROCESS_TYPE,
      matter: PENDING_PROCESS_TYPE,
      specialty: PENDING_PROCESS_TYPE,
      juzgado: "Por determinar",
      status: "pendiente_revision",
      origin: "importacion_zip_individual",
      originPath: candidate.folderPath,
      confidence: 0.35,
      warnings: ["No se detecto numero de expediente."],
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

  const unclassified = activeFiles.filter(
    (file) => !documentCaseMap[file.zipPath] || documentCaseMap[file.zipPath] === "__unclassified",
  );
  if (unclassified.length > 0) {
    const provisional: ZipCaseCandidate = {
      id: "pending-unclassified",
      title: "Expediente pendiente de clasificacion",
      caseNumber: null,
      processType: PENDING_PROCESS_TYPE,
      matter: PENDING_PROCESS_TYPE,
      specialty: PENDING_PROCESS_TYPE,
      juzgado: "Por determinar",
      status: "pendiente_revision",
      origin: "importacion_zip_individual",
      originPath: candidate.folderPath,
      confidence: 0.3,
      warnings: ["Documentos dejados sin clasificar durante la revision."],
      documentPaths: unclassified.map((file) => file.zipPath),
      isProvisional: true,
    };
    caseCandidates.push(provisional);
    for (const file of unclassified) documentCaseMap[file.zipPath] = provisional.id;
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
  if (!candidate.existingClientId) throw new Error("No se selecciono cliente existente.");
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

async function createCase(
  db: DbClient,
  clientId: string,
  caseCandidate: ZipCaseCandidate,
  files: ZipFileEntry[],
): Promise<string> {
  const expediente =
    caseCandidate.caseNumber ?? provisionalExpediente(clientId, caseCandidate, files);
  const processType = safeProcessType(caseCandidate.processType);
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
    status: normalizeCaseStatus(caseCandidate.status),
    priority: "Media",
    demandante: caseCandidate.demandante ?? null,
    demandado: caseCandidate.demandado ?? null,
    current_status_description: caseCandidate.isProvisional ? "pendiente_revision" : null,
    internal_code: caseCandidate.isProvisional ? expediente : null,
  };

  let { data, error } = await fromDb(db, "cases").insert(payload).select("id").single();
  if (isMissingSchemaFieldError(error ?? null)) {
    const legacyPayload: CaseInsert = {
      client_id: payload.client_id,
      expediente: payload.expediente,
      juzgado: payload.juzgado,
      process_type: payload.process_type,
      status: payload.status,
      priority: payload.priority,
      demandante: payload.demandante,
      demandado: payload.demandado,
    };
    ({ data, error } = await fromDb(db, "cases").insert(legacyPayload).select("id").single());
  }
  return ensureSupabaseData<{ id: string }>(data, error, `Crear expediente ${caseCandidate.title}`)
    .id;
}

async function documentAlreadyExists(
  db: DbClient,
  clientId: string,
  checksum: string,
): Promise<boolean> {
  const { data, error } = await fromDb(db, "documents")
    .select("id")
    .eq("client_id", clientId)
    .eq("checksum", checksum)
    .maybeSingle();
  if (error && !isMissingSchemaFieldError(error ?? null))
    throw new Error(`Verificar duplicado: ${error.message}`);
  return Boolean(data?.id);
}

async function insertDocument(
  db: DbClient,
  clientId: string,
  caseId: string,
  docFile: ZipFileEntry,
  storagePath: string,
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
    checksum: docFile.checksum || null,
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
  const { candidate, db, storageBucket, now = () => Date.now() } = params;
  const errors: string[] = [];
  const compensations: string[] = [];
  const caseIds: PersistZipCandidateResult["caseIds"] = [];
  const documentIds: PersistZipCandidateResult["documentIds"] = [];
  const failedFiles: PersistZipCandidateResult["failedFiles"] = [];
  const warnings = [...candidate.warnings];
  let documentsImported = 0;
  let documentsSkipped = 0;
  let clientId: string | undefined;

  try {
    const action =
      candidate.duplicates.length > 0 ? (candidate.duplicateAction ?? "create_new") : "create_new";
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

  const { documentCaseMap, caseCandidates } = prepareCasesForPersistence(candidate);

  for (const caseCandidate of caseCandidates) {
    const files = activeFilesForCase(candidate, caseCandidate, documentCaseMap);
    if (files.length === 0) continue;

    let caseId: string;
    try {
      caseId = await createCase(db, clientId, caseCandidate, files);
      caseIds.push({
        id: caseId,
        title: caseCandidate.title,
        caseNumber: caseCandidate.caseNumber,
      });
    } catch (err) {
      errors.push(err instanceof Error ? err.message : "Error creando expediente");
      continue;
    }

    for (const docFile of files) {
      if (docFile.checksum && (await documentAlreadyExists(db, clientId, docFile.checksum))) {
        documentsSkipped++;
        continue;
      }

      const storagePath = `${clientId}/${now()}_${safeNamePart(docFile.name)}`;
      let uploaded = false;
      try {
        const blob = new Blob([docFile.data], { type: mimeTypeFor(docFile.ext) });
        const { error: uploadError } = await storageBucket.upload(storagePath, blob, {
          upsert: false,
          contentType: mimeTypeFor(docFile.ext),
        });
        if (uploadError) throw new Error(`Subir ${docFile.name}: ${uploadError.message}`);
        uploaded = true;
        const documentId = await insertDocument(db, clientId, caseId, docFile, storagePath);
        documentIds.push({ id: documentId, name: docFile.name, storagePath, caseId });
        documentsImported++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : `Error importando ${docFile.name}`;
        errors.push(msg);
        failedFiles.push({ name: docFile.name, path: docFile.zipPath, error: msg });
        if (uploaded) {
          const { error: removeError } = await storageBucket.remove([storagePath]);
          if (removeError)
            compensations.push(`No se pudo retirar ${storagePath}: ${removeError.message}`);
          else compensations.push(`Storage revertido: ${storagePath}`);
        }
      }
    }
  }

  const status: PersistStatus =
    errors.length === 0 ? "success" : documentsImported > 0 ? "partial" : "failed";
  return {
    folderName: candidate.folderName,
    status,
    clientId,
    documentsImported,
    documentsSkipped,
    error: errors[0],
    errors,
    compensations,
    caseIds,
    documentIds,
    failedFiles,
    warnings,
  };
}
