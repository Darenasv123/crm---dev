/**
 * migration-tool.tsx
 *
 * Herramienta administrativa de migración de organización documental.
 * Solo visible y operable para Administrador con estado Activo.
 *
 * Fases implementadas:
 * - Control de acceso centralizado (canRunDocumentMigration)
 * - Activación segura (detección de esquema antes de operar)
 * - Dry-run puro (sin inserts/updates)
 * - Procesamiento por lotes con progreso
 * - Idempotencia
 * - Reintentos de fallidos
 * - Informes JSON y CSV (sin tokens ni URLs firmadas)
 * - Confirmación explícita antes de ejecutar
 */

import { useState, useCallback } from "react";
import {
  Loader2,
  FolderOpen,
  CheckCircle,
  AlertCircle,
  Download,
  Play,
  RotateCcw,
  ShieldAlert,
  DatabaseZap,
  Info,
} from "lucide-react";
import { Card } from "@/components/app-layout";
import { useAuth } from "@/hooks/use-auth";
import { resolveMigrationPermissions } from "@/lib/permissions";
import { buildDryRunPlan } from "@/lib/analyze-relative-paths";
import { migrateRelativePaths, checkMigrationSchemaAvailable } from "@/lib/migrate-relative-paths";
import { getAuthClient } from "@/lib/supabase";
import type { DryRunPlan } from "@/lib/analyze-relative-paths";
import type { MigrationReport, BatchProgress } from "@/lib/migrate-relative-paths";
import type { Database } from "@/lib/database.types";

type ClientRow = Pick<Database["public"]["Tables"]["clients"]["Row"], "id" | "name" | "dni">;

// ─── Tipos internos ───────────────────────────────────────────────────────────

type Scope = "all" | "specific";
type ToolStep =
  | "idle"
  | "checking_schema"
  | "scope"
  | "analyzing"
  | "preview"
  | "confirming"
  | "running"
  | "done";

const BATCH_SIZES = [25, 50, 100] as const;
type BatchSize = (typeof BATCH_SIZES)[number];

// ─── Export helpers ───────────────────────────────────────────────────────────

function exportJson(payload: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportCsv(rows: string[][], filename: string) {
  const escaped = rows.map((row) =>
    row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","),
  );
  const blob = new Blob([escaped.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function buildJsonReport(params: {
  userId: string | null;
  scope: Scope;
  selectedClientName: string;
  batchSize: BatchSize;
  plan: DryRunPlan | null;
  report: MigrationReport | null;
}) {
  const { userId, scope, selectedClientName, batchSize, plan, report } = params;
  // Never include tokens, signed URLs, or secrets
  return {
    date: new Date().toISOString(),
    user: userId ?? "unknown",
    scope: scope === "all" ? "Todos los clientes" : `Cliente: ${selectedClientName}`,
    batchSize,
    dryRun: plan
      ? {
          documentsAnalyzed: plan.documentsAnalyzed,
          documentsAlreadyMigrated: plan.documentsAlreadyMigrated,
          documentsPending: plan.documentsPendingMigration,
          documentsInvalid: plan.documentsInvalid,
          foldersToCreate: plan.totalUniqueFolderPaths,
          totalWarnings: plan.totalWarnings,
          totalErrors: plan.totalErrors,
        }
      : null,
    migration: report
      ? {
          documentsAnalyzed: report.documentsAnalyzed,
          documentsAlreadyMigrated: report.documentsAlreadyMigrated,
          documentsAssigned: report.documentsAssigned,
          foldersCreated: report.foldersCreated,
          foldersReused: report.foldersReused,
          failed: report.pending,
          errorCount: report.errors.length,
        }
      : null,
    documents:
      report?.items?.map((item) => ({
        documentId: item.documentId,
        name: item.documentName,
        relativePath: item.relativePath,
        targetFolder: item.targetFolderPath,
        status: item.status,
        error: item.error ?? null,
        warning: item.warning ?? null,
        migratedAt: item.migratedAt ?? null,
      })) ?? [],
    errors: report?.errors ?? [],
  };
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function MigrationTool() {
  const { profile, loading: authLoading } = useAuth();

  // ── Permisos (verificados en cada render) ──
  const permissions = resolveMigrationPermissions(profile?.role, profile?.status);

  // ── Estado de la herramienta ──
  const [step, setStep] = useState<ToolStep>("idle");
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [schemaReady, setSchemaReady] = useState(false);

  // ── Alcance ──
  const [scope, setScope] = useState<Scope>("all");
  const [batchSize, setBatchSize] = useState<BatchSize>(50);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loadingClients, setLoadingClients] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [clientSearch, setClientSearch] = useState<string>("");

  // ── Análisis ──
  const [plan, setPlan] = useState<DryRunPlan | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  // ── Ejecución ──
  const [report, setReport] = useState<MigrationReport | null>(null);
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const [execError, setExecError] = useState<string | null>(null);
  const [failedDocIds, setFailedDocIds] = useState<string[]>([]);

  // ── Confirmación ──
  const [confirmText, setConfirmText] = useState<string>("");
  const CONFIRM_PHRASE = "MIGRAR DOCUMENTOS";

  const selectedClient = clients.find((c) => c.id === selectedClientId);

  // ─── Paso 1: Verificar esquema ─────────────────────────────────────────────

  const handleCheckSchema = async () => {
    if (!permissions.canViewDocumentMigration) return;
    setStep("checking_schema");
    setSchemaError(null);
    try {
      const err = await checkMigrationSchemaAvailable();
      if (err) {
        setSchemaError(err);
        setStep("idle");
      } else {
        setSchemaReady(true);
        setStep("scope");
        // Pre-cargar clientes para la selección específica
        loadClients();
      }
    } catch (e) {
      setSchemaError(e instanceof Error ? e.message : "Error desconocido al verificar esquema.");
      setStep("idle");
    }
  };

  // ─── Cargar clientes (paginado simple — máx 200) ──────────────────────────

  async function loadClients() {
    if (!permissions.canViewDocumentMigration) return;
    setLoadingClients(true);
    try {
      const db = await getAuthClient();
      const { data, error } = await db
        .from("clients")
        .select("id, name, dni")
        .order("name")
        .limit(200);
      if (error) throw new Error(error.message);
      setClients((data ?? []) as ClientRow[]);
    } catch {
      // Silencioso — no bloquea el flujo
    } finally {
      setLoadingClients(false);
    }
  }

  const filteredClients = clientSearch
    ? clients.filter(
        (c) =>
          c.name.toLowerCase().includes(clientSearch.toLowerCase()) ||
          (c.dni ?? "").toLowerCase().includes(clientSearch.toLowerCase()),
      )
    : clients;

  // ─── Paso 2: Analizar (dry-run puro) ──────────────────────────────────────

  const handleAnalyze = useCallback(async () => {
    if (!permissions.canRunDocumentMigrationDryRun) return;
    if (scope === "specific" && !selectedClientId) return;

    setStep("analyzing");
    setPlan(null);
    setReport(null);
    setAnalyzeError(null);
    setProgress(null);
    setConfirmText("");

    try {
      const db = await getAuthClient();

      let docsQuery = db
        .from("documents")
        .select("id, client_id, relative_path, folder_id")
        .not("relative_path", "is", null);

      if (scope === "specific" && selectedClientId) {
        docsQuery = docsQuery.eq("client_id", selectedClientId) as typeof docsQuery;
      }

      const { data: docs, error: docsError } = await docsQuery;
      if (docsError) throw new Error(docsError.message);

      const allDocs = (docs ?? []) as Array<{
        id: string;
        client_id: string;
        relative_path: string | null;
        folder_id: string | null;
      }>;

      // Si es un cliente específico usamos un plan por cliente
      const clientId = scope === "specific" ? selectedClientId : "__all__";
      const result = buildDryRunPlan(clientId, allDocs);
      setPlan(result);
      setStep("preview");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error al analizar documentos.";
      // Manejo específico de esquema ausente
      if (
        msg.includes("does not exist") ||
        msg.includes("folder_id") ||
        msg.includes("document_folders")
      ) {
        setAnalyzeError(
          "La migración de base de datos aún no ha sido aplicada. Aplica supabase/migrations/20260725120000_document_folders.sql primero.",
        );
      } else {
        setAnalyzeError(msg);
      }
      setStep("scope");
    }
  }, [permissions.canRunDocumentMigrationDryRun, scope, selectedClientId]);

  // ─── Paso 3: Confirmar y ejecutar migración ───────────────────────────────

  const handleExecute = useCallback(
    async (retryIds?: string[]) => {
      if (!permissions.canRunDocumentMigration) return;

      setStep("running");
      setExecError(null);
      setProgress(null);
      setReport(null);

      try {
        const isRetry = retryIds && retryIds.length > 0;
        const clientId = scope === "specific" && selectedClientId ? selectedClientId : "__all__";

        // Para "todos los clientes", iterar por cliente usando los del plan
        if (scope === "all" || !selectedClientId) {
          // Obtener clientIds únicos del plan
          const clientIds = Array.from(
            new Set(plan?.items?.map((i) => i.clientId).filter(Boolean) ?? []),
          );

          const merged: MigrationReport = {
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
          const {
            data: { session },
          } = await db.auth.getSession();
          const userId = session?.user?.id ?? null;

          for (const cid of clientIds) {
            const retryForClient = isRetry
              ? retryIds.filter(
                  (id) => plan?.items?.find((i) => i.documentId === id)?.clientId === cid,
                )
              : undefined;

            const r = await migrateRelativePaths(cid, userId, {
              retryDocumentIds: retryForClient,
              batchSize,
              onBatchComplete: (p) => setProgress(p),
            });

            merged.documentsAnalyzed += r.documentsAnalyzed;
            merged.documentsAlreadyMigrated += r.documentsAlreadyMigrated;
            merged.documentsAssigned += r.documentsAssigned;
            merged.foldersCreated += r.foldersCreated;
            merged.foldersReused += r.foldersReused;
            merged.pending += r.pending;
            merged.errors.push(...r.errors);
            merged.items?.push(...(r.items ?? []));
          }

          setReport(merged);
          setFailedDocIds(merged.errors.map((e) => e.documentId));
        } else {
          const db = await getAuthClient();
          const {
            data: { session },
          } = await db.auth.getSession();
          const userId = session?.user?.id ?? null;

          const r = await migrateRelativePaths(clientId, userId, {
            retryDocumentIds: isRetry ? retryIds : undefined,
            batchSize,
            onBatchComplete: (p) => setProgress(p),
          });

          setReport(r);
          setFailedDocIds(r.errors.map((e) => e.documentId));
        }

        setStep("done");
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Error durante la migración.";
        if (
          msg.includes("does not exist") ||
          msg.includes("folder_id") ||
          msg.includes("document_folders")
        ) {
          setExecError(
            "La migración de base de datos aún no ha sido aplicada. Esta herramienta no puede ejecutarse hasta aplicar la migración SQL.",
          );
        } else if (msg.includes("JWT") || msg.includes("session") || msg.includes("auth")) {
          setExecError(
            "La sesión ha expirado. Por favor recarga la página e inicia sesión de nuevo.",
          );
        } else {
          setExecError(msg);
        }
        setStep("preview");
      }
    },
    [permissions.canRunDocumentMigration, scope, selectedClientId, plan, batchSize],
  );

  // ─── Descargas ─────────────────────────────────────────────────────────────

  function handleDownloadJson() {
    const payload = buildJsonReport({
      userId: profile?.id ?? null,
      scope,
      selectedClientName: selectedClient?.name ?? "Todos",
      batchSize,
      plan,
      report,
    });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    exportJson(payload, `migracion-documental-${ts}.json`);
  }

  function handleDownloadCsv() {
    if (!report?.items) return;
    const headers = [
      "client_id",
      "document_id",
      "original_name",
      "relative_path",
      "target_folder",
      "status",
      "error",
      "migrated_at",
    ];
    const rows = report.items.map((item) => [
      item.clientId ?? "",
      item.documentId,
      item.documentName,
      item.relativePath ?? "",
      item.targetFolderPath,
      item.status,
      item.error ?? "",
      item.migratedAt ?? "",
    ]);
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    exportCsv([headers, ...rows], `migracion-documental-${ts}.csv`);
  }

  function handleReset() {
    setStep("scope");
    setPlan(null);
    setReport(null);
    setProgress(null);
    setAnalyzeError(null);
    setExecError(null);
    setConfirmText("");
    setFailedDocIds([]);
  }

  // ─── Guardia de permisos ───────────────────────────────────────────────────

  if (authLoading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Verificando permisos…
      </div>
    );
  }

  if (!permissions.canViewDocumentMigration) {
    return null; // Personal no ve ni el contenedor
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  const isRunning = step === "running" || step === "analyzing" || step === "checking_schema";

  return (
    <Card className="p-6">
      {/* Header */}
      <div className="flex items-start gap-4 mb-6">
        <div className="grid h-12 w-12 place-items-center rounded-xl bg-primary/10 text-primary shrink-0">
          <FolderOpen className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold">Migración de organización documental</h3>
          <p className="text-xs text-muted-foreground max-w-xl mt-0.5">
            Organiza documentos existentes en carpetas y subcarpetas utilizando sus rutas relativas,
            sin mover los archivos originales.
          </p>
        </div>
      </div>

      {/* Estado inicial — activación explícita */}
      {step === "idle" && (
        <div className="space-y-4">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
            <DatabaseZap className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold text-amber-800 mb-1">Activación requerida</p>
              <p className="text-amber-700 text-xs">
                La migración de base de datos debe estar aplicada antes de ejecutar esta
                herramienta. Haz clic en <strong>Verificar disponibilidad</strong> para comprobar el
                esquema.
              </p>
            </div>
          </div>
          {schemaError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {schemaError}
            </div>
          )}
          <button
            onClick={handleCheckSchema}
            disabled={isRunning}
            className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 disabled:opacity-60 flex items-center gap-2"
          >
            {isRunning ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <DatabaseZap className="h-4 w-4" />
            )}
            Verificar disponibilidad
          </button>
        </div>
      )}

      {/* Paso 1 — Alcance */}
      {(step === "scope" ||
        step === "analyzing" ||
        step === "preview" ||
        step === "confirming" ||
        step === "running" ||
        step === "done") &&
        schemaReady && (
          <div className="space-y-5">
            {/* Selector de alcance */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(["all", "specific"] as Scope[]).map((s) => (
                <label
                  key={s}
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition ${
                    scope === s
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/40"
                  } ${isRunning ? "pointer-events-none opacity-60" : ""}`}
                >
                  <input
                    type="radio"
                    value={s}
                    checked={scope === s}
                    onChange={() => {
                      setScope(s);
                      setPlan(null);
                      setStep("scope");
                    }}
                    className="accent-primary"
                    disabled={isRunning}
                  />
                  <div>
                    <div className="text-sm font-semibold">
                      {s === "all" ? "Todos los clientes" : "Un cliente específico"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {s === "all"
                        ? "Procesa todos los documentos con relative_path"
                        : "Selecciona un cliente para analizar"}
                    </div>
                  </div>
                </label>
              ))}
            </div>

            {/* Selección de cliente */}
            {scope === "specific" && (
              <div className="space-y-2">
                <input
                  type="text"
                  placeholder="Buscar cliente por nombre o DNI…"
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                  disabled={isRunning}
                  className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/15"
                />
                {loadingClients ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                    <Loader2 className="h-3 w-3 animate-spin" /> Cargando clientes…
                  </div>
                ) : (
                  <div className="max-h-40 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                    {filteredClients.slice(0, 30).map((c) => (
                      <button
                        key={c.id}
                        onClick={() => setSelectedClientId(c.id)}
                        disabled={isRunning}
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-muted/40 transition ${
                          selectedClientId === c.id ? "bg-primary/5 font-semibold" : ""
                        }`}
                      >
                        {c.name}
                        {c.dni && (
                          <span className="ml-2 text-xs text-muted-foreground">{c.dni}</span>
                        )}
                      </button>
                    ))}
                    {filteredClients.length === 0 && (
                      <p className="py-3 px-3 text-xs text-muted-foreground">Sin resultados.</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Tamaño de lote */}
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-xs font-semibold text-muted-foreground">Tamaño de lote:</span>
              {BATCH_SIZES.map((s) => (
                <label key={s} className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    checked={batchSize === s}
                    onChange={() => setBatchSize(s)}
                    disabled={isRunning}
                    className="accent-primary"
                  />
                  <span className="text-sm">{s} docs</span>
                </label>
              ))}
            </div>

            {/* Botón Analizar */}
            {(step === "scope" || step === "preview") && (
              <div className="flex items-center gap-3">
                <button
                  onClick={handleAnalyze}
                  disabled={isRunning || (scope === "specific" && !selectedClientId)}
                  className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 disabled:opacity-60 flex items-center gap-2"
                >
                  {isRunning ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  Analizar documentos
                </button>
              </div>
            )}

            {analyzeError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {analyzeError}
              </div>
            )}
          </div>
        )}

      {/* Paso 2 — Vista previa del dry-run */}
      {(step === "preview" || step === "confirming") && plan && (
        <div className="mt-5 space-y-4">
          <div className="rounded-lg border border-border p-4">
            <div className="flex items-center gap-2 mb-3">
              <Info className="h-4 w-4 text-primary shrink-0" />
              <span className="text-sm font-semibold">
                Resumen — Análisis
                {scope === "specific" && selectedClient ? ` de ${selectedClient.name}` : " global"}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[
                { label: "Documentos analizados", value: plan.documentsAnalyzed, color: "" },
                {
                  label: "Ya migrados",
                  value: plan.documentsAlreadyMigrated,
                  color: "text-emerald-700",
                },
                {
                  label: "Pendientes de migrar",
                  value: plan.documentsPendingMigration,
                  color: "text-amber-700 font-bold",
                },
                { label: "Sin ruta asignada", value: plan.documentsWithoutPath, color: "" },
                { label: "En raíz (sin carpeta)", value: plan.documentsAtRoot, color: "" },
                {
                  label: "Rutas inválidas",
                  value: plan.documentsInvalid,
                  color: plan.documentsInvalid > 0 ? "text-red-600" : "",
                },
                {
                  label: "Carpetas por crear",
                  value: plan.totalUniqueFolderPaths,
                  color: "text-primary font-semibold",
                },
                {
                  label: "Advertencias",
                  value: plan.totalWarnings,
                  color: plan.totalWarnings > 0 ? "text-amber-600" : "",
                },
                {
                  label: "Errores detectados",
                  value: plan.totalErrors,
                  color: plan.totalErrors > 0 ? "text-red-600" : "",
                },
              ].map(({ label, value, color }) => (
                <div key={label} className="rounded-lg border border-border bg-muted/20 p-3">
                  <div className={`text-xl font-bold ${color}`}>{value}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">{label}</div>
                </div>
              ))}
            </div>

            {plan.documentsPendingMigration === 0 && (
              <div className="mt-3 flex items-center gap-2 text-sm text-emerald-700">
                <CheckCircle className="h-4 w-4" />
                No hay documentos pendientes de migrar.
              </div>
            )}

            {plan.documentsInvalid > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-red-600 font-medium">
                  Ver {plan.documentsInvalid} rutas inválidas
                </summary>
                <ul className="mt-2 max-h-32 overflow-y-auto space-y-1">
                  {plan.items
                    .filter((i) => i.action === "invalid")
                    .map((i) => (
                      <li key={i.documentId} className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{i.documentId}</span>:{" "}
                        {i.errors.join("; ")}
                      </li>
                    ))}
                </ul>
              </details>
            )}
          </div>

          {/* Aviso de seguridad */}
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 flex items-start gap-2">
            <ShieldAlert className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
            <div className="text-xs text-blue-700 space-y-0.5">
              <p className="font-semibold">Esta operación es segura:</p>
              <ul className="list-disc list-inside space-y-0.5 mt-1">
                <li>Ningún archivo físico será movido ni eliminado.</li>
                <li>No se modifican storage_path, original_name ni case_id.</li>
                <li>Solo se crean carpetas lógicas y se asigna folder_id.</li>
                <li>Es reversible cambiando folder_id a NULL.</li>
              </ul>
            </div>
          </div>

          {plan.documentsPendingMigration > 0 && step !== "confirming" && (
            <button
              onClick={() => setStep("confirming")}
              className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 flex items-center gap-2"
            >
              <Play className="h-4 w-4" /> Ejecutar migración
            </button>
          )}
        </div>
      )}

      {/* Paso 3 — Confirmación */}
      {step === "confirming" && plan && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 space-y-3">
          <p className="text-sm font-semibold text-amber-800">
            Confirmar ejecución — {plan.documentsPendingMigration} documentos ·{" "}
            {plan.totalUniqueFolderPaths} carpetas por crear
          </p>
          <p className="text-xs text-amber-700">
            Escribe <code className="font-mono bg-amber-100 px-1 rounded">{CONFIRM_PHRASE}</code>{" "}
            para confirmar:
          </p>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={CONFIRM_PHRASE}
            className="w-full h-9 px-3 rounded-lg border border-border bg-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/15"
          />
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                setStep("preview");
                setConfirmText("");
              }}
              className="h-9 px-4 rounded-lg border border-border text-sm font-medium hover:bg-muted/40"
            >
              Cancelar
            </button>
            <button
              onClick={() => void handleExecute()}
              disabled={confirmText !== CONFIRM_PHRASE || isRunning}
              className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 disabled:opacity-50 flex items-center gap-2"
            >
              <Play className="h-4 w-4" /> MIGRAR DOCUMENTOS
            </button>
          </div>
        </div>
      )}

      {/* Paso 4 — Progreso */}
      {step === "running" && progress && (
        <div className="mt-5 rounded-lg border border-border p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Loader2 className="h-4 w-4 animate-spin text-primary" /> Migrando…
          </div>
          <div className="w-full bg-muted rounded-full h-2">
            <div
              className="bg-primary h-2 rounded-full transition-all duration-300"
              style={{
                width: `${progress.totalDocuments > 0 ? Math.round((progress.processedDocuments / progress.totalDocuments) * 100) : 0}%`,
              }}
            />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-muted-foreground">
            <span>
              Lote {progress.currentBatch}/{progress.totalBatches}
            </span>
            <span>
              Procesados:{" "}
              <strong className="text-foreground">
                {progress.processedDocuments}/{progress.totalDocuments}
              </strong>
            </span>
            <span>
              Migrados: <strong className="text-emerald-700">{progress.migrated}</strong>
            </span>
            <span>
              Fallidos:{" "}
              <strong className={progress.failed > 0 ? "text-red-600" : "text-foreground"}>
                {progress.failed}
              </strong>
            </span>
          </div>
        </div>
      )}

      {execError && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {execError}
        </div>
      )}

      {/* Paso 5 — Resultado */}
      {step === "done" && report && (
        <div className="mt-5 space-y-4">
          <div className="rounded-lg border border-border p-4 space-y-3">
            <div className="flex items-center gap-2">
              {report.errors.length === 0 ? (
                <CheckCircle className="h-5 w-5 text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle className="h-5 w-5 text-amber-500 shrink-0" />
              )}
              <span className="text-sm font-semibold">
                {report.errors.length === 0
                  ? "Migración completada sin errores."
                  : `Migración completada — ${report.documentsAssigned} migrados, ${report.errors.length} requieren revisión.`}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Analizados", value: report.documentsAnalyzed },
                { label: "Migrados", value: report.documentsAssigned, color: "text-emerald-700" },
                { label: "Carpetas creadas", value: report.foldersCreated, color: "text-primary" },
                { label: "Carpetas reutilizadas", value: report.foldersReused },
                { label: "Ya migrados", value: report.documentsAlreadyMigrated },
                {
                  label: "Fallidos",
                  value: report.pending,
                  color: report.pending > 0 ? "text-red-600" : "",
                },
                {
                  label: "Errores",
                  value: report.errors.length,
                  color: report.errors.length > 0 ? "text-red-600" : "",
                },
              ].map(({ label, value, color = "" }) => (
                <div key={label} className="rounded-lg border border-border bg-muted/20 p-2.5">
                  <div className={`text-xl font-bold ${color}`}>{value}</div>
                  <div className="text-[11px] text-muted-foreground">{label}</div>
                </div>
              ))}
            </div>

            {report.errors.length > 0 && (
              <details>
                <summary className="cursor-pointer text-xs text-red-600 font-medium">
                  Ver {report.errors.length} errores
                </summary>
                <ul className="mt-2 max-h-40 overflow-y-auto space-y-1">
                  {report.errors.map((e, i) => (
                    <li key={i} className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{e.documentName}</span>:{" "}
                      {e.error}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          {/* Acciones post-migración */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleDownloadJson}
              className="h-8 px-3 rounded border border-border text-xs font-medium hover:bg-muted/40 flex items-center gap-1.5"
            >
              <Download className="h-3 w-3" /> Descargar JSON
            </button>
            <button
              onClick={handleDownloadCsv}
              className="h-8 px-3 rounded border border-border text-xs font-medium hover:bg-muted/40 flex items-center gap-1.5"
            >
              <Download className="h-3 w-3" /> Descargar CSV
            </button>
            {failedDocIds.length > 0 && (
              <button
                onClick={() => void handleExecute(failedDocIds)}
                disabled={isRunning}
                className="h-8 px-3 rounded border border-amber-300 text-amber-700 text-xs font-medium hover:bg-amber-50 flex items-center gap-1.5"
              >
                <RotateCcw className="h-3 w-3" /> Reintentar {failedDocIds.length} fallidos
              </button>
            )}
            <button
              onClick={handleReset}
              className="h-8 px-3 rounded border border-border text-xs font-medium hover:bg-muted/40 flex items-center gap-1.5"
            >
              Nueva análisis
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}
