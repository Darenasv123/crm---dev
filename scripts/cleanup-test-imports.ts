import { createClient } from "@supabase/supabase-js";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const BACKUP_ROOT = join(ROOT, ".local-backups");
const REPORT_PATH = join(ROOT, "docs", "current-state", "TEST_IMPORT_CLEANUP_REPORT.md");
const BUCKET = "documents";
const IMPORT_CLIENT_NOTE_PREFIXES = [
  "Importado desde Google Drive ZIP:",
  "Importado desde ZIP individual:",
];
const IMPORT_SOURCE_PROVIDERS = new Set(["google_drive_zip", "google_drive_zip_individual"]);
const IMPORT_SOURCE_TYPES = new Set(["zip_import", "zip_import_individual"]);

type Row = Record<string, unknown>;
type TableName =
  | "clients"
  | "cases"
  | "documents"
  | "payments"
  | "payment_records"
  | "agenda_events"
  | "client_reports"
  | "case_parties"
  | "case_events"
  | "case_tasks"
  | "document_extractions"
  | "ai_analysis_runs"
  | "ai_findings"
  | "source_references"
  | "import_jobs"
  | "import_folders";

type DeleteTarget = {
  table: TableName;
  id: string;
  reason: string;
  row: Row;
};

type Conflict = {
  entity: string;
  id: string;
  reason: string;
  row: Row;
};

type CleanupPlan = {
  generatedAt: string;
  mode: "dry-run";
  backupDir: string;
  reportPath: string;
  totals: Record<string, number>;
  deleteTargets: Record<string, DeleteTarget[]>;
  storagePaths: string[];
  doubtful: Conflict[];
  conflicts: Conflict[];
  before: Record<string, number>;
  reasons: Record<string, string[]>;
};

function loadDotEnv() {
  const envPath = join(ROOT, ".env");
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const raw = trimmed.slice(eq + 1).trim();
    if (!key || process.env[key]) continue;
    process.env[key] = raw.replace(/^['"]|['"]$/g, "");
  }
}

function arg(name: string) {
  return process.argv.includes(name);
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function idOf(row: Row): string {
  const id = asString(row.id);
  if (!id) throw new Error("Fila sin id en resultado de Supabase.");
  return id;
}

function includesAny(value: unknown, terms: string[]): boolean {
  const text = asString(value)?.toLowerCase() ?? "";
  return terms.some((term) => text.includes(term.toLowerCase()));
}

function hasImportClientNote(client: Row): boolean {
  const notes = asString(client.notes) ?? "";
  return IMPORT_CLIENT_NOTE_PREFIXES.some((prefix) => notes.startsWith(prefix));
}

function isImportDocument(doc: Row): boolean {
  const provider = asString(doc.source_provider);
  const sourceType = asString(doc.source_type);
  const externalUrl = asString(doc.external_url);
  const externalFileId = asString(doc.external_file_id);
  const externalFolderId = asString(doc.external_folder_id);
  return (
    (provider ? IMPORT_SOURCE_PROVIDERS.has(provider) : false) ||
    (sourceType ? IMPORT_SOURCE_TYPES.has(sourceType) : false) ||
    (externalUrl?.startsWith("zip://") ?? false) ||
    includesAny(externalFileId, [".zip", "A-EXPEDIENTES DE CLIENTES", "YLLA NEGRON YENI"]) ||
    includesAny(externalFolderId, [".zip", "A-EXPEDIENTES DE CLIENTES", "YLLA NEGRON YENI"])
  );
}

function isImportCase(
  caseRow: Row,
  importedDocumentCaseIds: Set<string>,
  importedClientIds: Set<string>,
) {
  const caseId = idOf(caseRow);
  const clientId = asString(caseRow.client_id);
  return (
    importedDocumentCaseIds.has(caseId) ||
    (clientId ? importedClientIds.has(clientId) : false) ||
    includesAny(caseRow.internal_code, ["PENDIENTE-"]) ||
    includesAny(caseRow.case_stage, ["pendiente_revision"])
  );
}

function groupBy<T extends Row>(rows: T[], key: string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const value = asString(row[key]);
    if (!value) continue;
    if (!map.has(value)) map.set(value, []);
    map.get(value)!.push(row);
  }
  return map;
}

function addTarget(plan: CleanupPlan, table: TableName, row: Row, reason: string) {
  const id = idOf(row);
  const list = plan.deleteTargets[table] ?? [];
  if (!list.some((item) => item.id === id)) list.push({ table, id, reason, row });
  plan.deleteTargets[table] = list;
  plan.reasons[`${table}:${id}`] = [...(plan.reasons[`${table}:${id}`] ?? []), reason];
}

async function fetchAll(
  supabase: ReturnType<typeof createClient>,
  table: TableName,
): Promise<Row[]> {
  const { data, error } = await supabase.from(table).select("*");
  if (error) {
    if (["42P01", "PGRST205"].includes(error.code ?? "")) return [];
    throw new Error(`No se pudo leer ${table}: ${error.message}`);
  }
  return (data ?? []) as Row[];
}

async function buildPlan(): Promise<CleanupPlan> {
  loadDotEnv();
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error(
      "Faltan SUPABASE_URL/VITE_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY para consultar y limpiar con seguridad.",
    );
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const tables: TableName[] = [
    "clients",
    "cases",
    "documents",
    "payments",
    "payment_records",
    "agenda_events",
    "client_reports",
    "case_parties",
    "case_events",
    "case_tasks",
    "document_extractions",
    "ai_analysis_runs",
    "ai_findings",
    "source_references",
    "import_jobs",
    "import_folders",
  ];
  const rows = Object.fromEntries(
    await Promise.all(tables.map(async (table) => [table, await fetchAll(supabase, table)])),
  ) as Record<TableName, Row[]>;

  const backupDir = join(BACKUP_ROOT, `import-cleanup-${timestamp()}`);
  const plan: CleanupPlan = {
    generatedAt: new Date().toISOString(),
    mode: "dry-run",
    backupDir,
    reportPath: REPORT_PATH,
    totals: {},
    deleteTargets: {},
    storagePaths: [],
    doubtful: [],
    conflicts: [],
    before: Object.fromEntries(tables.map((table) => [table, rows[table].length])),
    reasons: {},
  };

  const importDocuments = rows.documents.filter(isImportDocument);
  const importedDocumentIds = new Set(importDocuments.map(idOf));
  const importedDocumentCaseIds = new Set(
    importDocuments.map((doc) => asString(doc.case_id)).filter(Boolean) as string[],
  );
  const importedDocumentClientIds = new Set(
    importDocuments.map((doc) => asString(doc.client_id)).filter(Boolean) as string[],
  );

  const noteClients = rows.clients.filter(hasImportClientNote);
  const importedClientIds = new Set([...noteClients.map(idOf), ...importedDocumentClientIds]);
  const docsByClient = groupBy(rows.documents, "client_id");
  const docsByCase = groupBy(rows.documents, "case_id");

  for (const doc of importDocuments)
    addTarget(plan, "documents", doc, "documento con origen ZIP de importacion");

  const candidateCases = rows.cases.filter((caseRow) =>
    isImportCase(caseRow, importedDocumentCaseIds, importedClientIds),
  );
  const caseIdsToDelete = new Set<string>();
  for (const caseRow of candidateCases) {
    const caseId = idOf(caseRow);
    const docs = docsByCase.get(caseId) ?? [];
    const nonImportDocs = docs.filter((doc) => !importedDocumentIds.has(idOf(doc)));
    if (nonImportDocs.length > 0) {
      plan.conflicts.push({
        entity: "cases",
        id: caseId,
        reason: "expediente tiene documentos no originados por importacion ZIP",
        row: caseRow,
      });
      continue;
    }
    addTarget(plan, "cases", caseRow, "expediente asociado a cliente/documentos ZIP de prueba");
    caseIdsToDelete.add(caseId);
  }

  const clientIdsToDelete = new Set<string>();
  for (const client of rows.clients.filter((row) => importedClientIds.has(idOf(row)))) {
    const clientId = idOf(client);
    const docs = docsByClient.get(clientId) ?? [];
    const nonImportDocs = docs.filter((doc) => !importedDocumentIds.has(idOf(doc)));
    const clientCases = rows.cases.filter((caseRow) => asString(caseRow.client_id) === clientId);
    const nonDeleteCases = clientCases.filter((caseRow) => !caseIdsToDelete.has(idOf(caseRow)));
    const relatedPayments = rows.payments.filter(
      (row) =>
        asString(row.client_id) === clientId ||
        (asString(row.case_id) ? caseIdsToDelete.has(asString(row.case_id)!) : false),
    );
    const relatedAgenda = rows.agenda_events.filter(
      (row) =>
        asString(row.client_id) === clientId ||
        (asString(row.case_id) ? caseIdsToDelete.has(asString(row.case_id)!) : false),
    );
    const relatedReports = rows.client_reports.filter(
      (row) =>
        asString(row.client_id) === clientId ||
        (asString(row.case_id) ? caseIdsToDelete.has(asString(row.case_id)!) : false),
    );
    if (
      nonImportDocs.length ||
      nonDeleteCases.length ||
      relatedPayments.length ||
      relatedAgenda.length ||
      relatedReports.length
    ) {
      plan.conflicts.push({
        entity: "clients",
        id: clientId,
        reason: `relaciones no clasificadas como ZIP: docs=${nonImportDocs.length}, cases=${nonDeleteCases.length}, payments=${relatedPayments.length}, agenda=${relatedAgenda.length}, reports=${relatedReports.length}`,
        row: client,
      });
      continue;
    }
    addTarget(
      plan,
      "clients",
      client,
      hasImportClientNote(client)
        ? "cliente con nota de importacion ZIP"
        : "cliente vinculado solo a documentos ZIP",
    );
    clientIdsToDelete.add(clientId);
  }

  const addIfReferenced = (table: TableName, predicate: (row: Row) => boolean, reason: string) => {
    for (const row of rows[table].filter(predicate)) addTarget(plan, table, row, reason);
  };

  const paymentIds = new Set(
    rows.payments
      .filter(
        (row) =>
          clientIdsToDelete.has(asString(row.client_id) ?? "") ||
          caseIdsToDelete.has(asString(row.case_id) ?? ""),
      )
      .map(idOf),
  );
  addIfReferenced(
    "payment_records",
    (row) => paymentIds.has(asString(row.payment_id) ?? ""),
    "registro de pago asociado a pago ZIP de prueba",
  );
  addIfReferenced(
    "payments",
    (row) => paymentIds.has(idOf(row)),
    "pago asociado a cliente/expediente ZIP de prueba",
  );
  addIfReferenced(
    "agenda_events",
    (row) =>
      clientIdsToDelete.has(asString(row.client_id) ?? "") ||
      caseIdsToDelete.has(asString(row.case_id) ?? ""),
    "evento asociado a cliente/expediente ZIP de prueba",
  );
  addIfReferenced(
    "client_reports",
    (row) =>
      clientIdsToDelete.has(asString(row.client_id) ?? "") ||
      caseIdsToDelete.has(asString(row.case_id) ?? ""),
    "reporte asociado a cliente/expediente ZIP de prueba",
  );
  addIfReferenced(
    "case_parties",
    (row) => caseIdsToDelete.has(asString(row.case_id) ?? ""),
    "parte asociada a expediente ZIP de prueba",
  );
  addIfReferenced(
    "case_events",
    (row) =>
      caseIdsToDelete.has(asString(row.case_id) ?? "") ||
      importedDocumentIds.has(asString(row.document_id) ?? ""),
    "actuacion asociada a expediente/documento ZIP de prueba",
  );
  addIfReferenced(
    "case_tasks",
    (row) =>
      caseIdsToDelete.has(asString(row.case_id) ?? "") ||
      clientIdsToDelete.has(asString(row.client_id) ?? ""),
    "tarea asociada a cliente/expediente ZIP de prueba",
  );
  addIfReferenced(
    "document_extractions",
    (row) => importedDocumentIds.has(asString(row.document_id) ?? ""),
    "extraccion asociada a documento ZIP de prueba",
  );
  addIfReferenced(
    "source_references",
    (row) => importedDocumentIds.has(asString(row.document_id) ?? ""),
    "referencia asociada a documento ZIP de prueba",
  );
  addIfReferenced(
    "ai_analysis_runs",
    (row) =>
      importedDocumentIds.has(asString(row.document_id) ?? "") ||
      caseIdsToDelete.has(asString(row.case_id) ?? ""),
    "analisis IA asociado a documento/expediente ZIP de prueba",
  );
  addIfReferenced(
    "ai_findings",
    (row) =>
      importedDocumentIds.has(asString(row.document_id) ?? "") ||
      caseIdsToDelete.has(asString(row.case_id) ?? "") ||
      clientIdsToDelete.has(asString(row.client_id) ?? ""),
    "hallazgo IA asociado a importacion ZIP de prueba",
  );

  const importJobIds = new Set<string>();
  for (const folder of rows.import_folders) {
    if (
      clientIdsToDelete.has(asString(folder.detected_client_id) ?? "") ||
      caseIdsToDelete.has(asString(folder.detected_case_id) ?? "")
    ) {
      addTarget(
        plan,
        "import_folders",
        folder,
        "carpeta de job asociada a cliente/expediente ZIP de prueba",
      );
      const jobId = asString(folder.import_job_id);
      if (jobId) importJobIds.add(jobId);
    }
  }
  for (const job of rows.import_jobs) {
    if (
      importJobIds.has(idOf(job)) ||
      includesAny(job.provider, ["google", "zip"]) ||
      includesAny(job.name, ["zip", "drive"])
    ) {
      plan.doubtful.push({
        entity: "import_jobs",
        id: idOf(job),
        reason: "job potencialmente relacionado; no se elimina automaticamente sin relacion exacta",
        row: job,
      });
    }
  }

  plan.storagePaths = Array.from(
    new Set(importDocuments.map((doc) => asString(doc.storage_path)).filter(Boolean) as string[]),
  );
  for (const [table, targets] of Object.entries(plan.deleteTargets))
    plan.totals[table] = targets.length;
  plan.totals.storageObjects = plan.storagePaths.length;
  plan.totals.conflicts = plan.conflicts.length;
  plan.totals.doubtful = plan.doubtful.length;

  mkdirSync(backupDir, { recursive: true });
  writeFileSync(join(backupDir, "cleanup-plan.json"), JSON.stringify(plan, null, 2));
  writeFileSync(
    join(backupDir, "backup-metadata.json"),
    JSON.stringify(
      {
        generatedAt: plan.generatedAt,
        deleteTargets: plan.deleteTargets,
        storagePaths: plan.storagePaths,
      },
      null,
      2,
    ),
  );
  writeFileSync(REPORT_PATH, renderReport(plan));
  return plan;
}

function compactValue(value: unknown) {
  const text = asString(value);
  if (!text) return null;
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

function targetMetadata(target: DeleteTarget) {
  const fields = [
    "name",
    "full_name",
    "title",
    "internal_code",
    "storage_path",
    "checksum",
    "hash",
    "source_provider",
    "source_type",
    "external_file_id",
    "external_folder_id",
    "external_url",
    "created_at",
    "updated_at",
  ];
  const parts = fields
    .map((field) => {
      const value = compactValue(target.row[field]);
      return value ? `${field}=${JSON.stringify(value)}` : null;
    })
    .filter(Boolean);
  return parts.length ? ` (${parts.join("; ")})` : "";
}

function renderReport(plan: CleanupPlan, execution?: Row) {
  const lines: string[] = [];
  lines.push("# Test Import Cleanup Report", "");
  lines.push(`Generated: ${plan.generatedAt}`, `Backup dir: ${plan.backupDir}`, "");
  lines.push("## Antes", "");
  for (const [table, count] of Object.entries(plan.before)) lines.push(`- ${table}: ${count}`);
  lines.push("", "## Dry-run delete targets", "");
  for (const [table, targets] of Object.entries(plan.deleteTargets)) {
    lines.push(`### ${table} (${targets.length})`, "");
    for (const target of targets)
      lines.push(`- ${target.id}: ${target.reason}${targetMetadata(target)}`);
    lines.push("");
  }
  lines.push("## Storage", "");
  for (const path of plan.storagePaths) lines.push(`- ${path}`);
  if (plan.storagePaths.length === 0) lines.push("- none");
  lines.push("", "## Conflicts", "");
  for (const conflict of plan.conflicts)
    lines.push(`- ${conflict.entity} ${conflict.id}: ${conflict.reason}`);
  if (plan.conflicts.length === 0) lines.push("- none");
  lines.push("", "## Doubtful not deleted", "");
  for (const item of plan.doubtful) lines.push(`- ${item.entity} ${item.id}: ${item.reason}`);
  if (plan.doubtful.length === 0) lines.push("- none");
  if (execution) {
    lines.push("", "## Execution", "", "```json", JSON.stringify(execution, null, 2), "```");
  }
  lines.push("");
  return lines.join("\n");
}

function latestPlanPath() {
  if (!existsSync(BACKUP_ROOT)) return null;
  const dirs = readdirSync(BACKUP_ROOT)
    .filter((name) => name.startsWith("import-cleanup-"))
    .sort();
  const latest = dirs.at(-1);
  return latest ? join(BACKUP_ROOT, latest, "cleanup-plan.json") : null;
}

async function executePlan(planPath: string) {
  loadDotEnv();
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY para ejecutar limpieza.");
  const plan = JSON.parse(readFileSync(planPath, "utf8")) as CleanupPlan;
  if (plan.conflicts.length > 0)
    throw new Error(`Ejecucion bloqueada: dry-run tiene ${plan.conflicts.length} conflicto(s).`);
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const execution: Row = {
    startedAt: new Date().toISOString(),
    deleted: {},
    storageDeleted: [],
    storageErrors: [],
    errors: [],
  };

  const deleteOrder: TableName[] = [
    "payment_records",
    "client_reports",
    "case_tasks",
    "case_events",
    "case_parties",
    "source_references",
    "ai_findings",
    "ai_analysis_runs",
    "document_extractions",
    "payments",
    "agenda_events",
    "import_folders",
    "documents",
    "cases",
    "clients",
  ];
  for (const table of deleteOrder) {
    const targets = plan.deleteTargets[table] ?? [];
    const deleted: string[] = [];
    for (const target of targets) {
      const { error } = await supabase.from(table).delete().eq("id", target.id);
      if (error)
        (execution.errors as unknown[]).push({ table, id: target.id, error: error.message });
      else deleted.push(target.id);
    }
    (execution.deleted as Record<string, string[]>)[table] = deleted;
  }

  for (const path of plan.storagePaths) {
    const { error } = await supabase.storage.from(BUCKET).remove([path]);
    if (error) (execution.storageErrors as unknown[]).push({ path, error: error.message });
    else (execution.storageDeleted as string[]).push(path);
  }
  execution.finishedAt = new Date().toISOString();
  writeFileSync(join(plan.backupDir, "execution-result.json"), JSON.stringify(execution, null, 2));
  writeFileSync(REPORT_PATH, renderReport(plan, execution));
  return execution;
}

if (!arg("--dry-run") && !arg("--execute")) {
  console.error("Uso: npm run cleanup:test-imports -- --dry-run | --execute [--plan path]");
  process.exit(1);
}

if (arg("--dry-run")) {
  const plan = await buildPlan();
  console.log(
    JSON.stringify(
      {
        reportPath: plan.reportPath,
        backupDir: plan.backupDir,
        totals: plan.totals,
        conflicts: plan.conflicts.length,
        doubtful: plan.doubtful.length,
      },
      null,
      2,
    ),
  );
} else {
  const planArgIndex = process.argv.indexOf("--plan");
  const planPath = planArgIndex >= 0 ? process.argv[planArgIndex + 1] : latestPlanPath();
  if (!planPath) throw new Error("No existe cleanup-plan.json previo. Ejecuta primero --dry-run.");
  const result = await executePlan(planPath);
  console.log(JSON.stringify(result, null, 2));
}
