/**
 * folder-import.tsx
 * Modal wizard for bulk folder import (webkitdirectory).
 * Steps: idle → analyzing → preview → importing → done
 */
import { useRef, useState, useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  X,
  FolderOpen,
  Upload,
  AlertCircle,
  CheckCircle2,
  Loader2,
  ChevronDown,
  ChevronRight,
  FileText,
  Eye,
  EyeOff,
  RefreshCw,
  Search,
  Filter,
} from "lucide-react";
import { Card } from "@/components/app-layout";
import { Progress } from "@/components/ui/progress";
import { invalidateCrmQueries } from "@/lib/query-invalidation";
import { useClients } from "@/hooks/use-clients";
import {
  analyzeFiles,
  detectDuplicatesForClients,
  type ClientEntry,
  type ClientEntryStatus,
  type DuplicateResolution,
  type ImportStats,
} from "@/lib/imports/folder-import";
import { runImport, retryFailedDocuments } from "@/lib/imports/folder-import-engine";

// ─── Types ────────────────────────────────────────────────────────────────────

type WizardStep = "idle" | "analyzing" | "preview" | "importing" | "done";

interface Props {
  onClose: () => void;
  onSuccess: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<ClientEntryStatus, string> = {
  new: "Nuevo",
  duplicate_exact: "Duplicado exacto",
  duplicate_approximate: "Nombre similar",
  empty: "Sin documentos",
  excluded: "Excluido",
  failed: "Fallido",
  done: "Completado",
};

const STATUS_COLORS: Record<ClientEntryStatus, string> = {
  new: "bg-emerald-100 text-emerald-700 border-emerald-200",
  duplicate_exact: "bg-red-100 text-red-700 border-red-200",
  duplicate_approximate: "bg-amber-100 text-amber-700 border-amber-200",
  empty: "bg-slate-100 text-slate-600 border-slate-200",
  excluded: "bg-muted text-muted-foreground border-border",
  failed: "bg-red-100 text-red-700 border-red-200",
  done: "bg-emerald-100 text-emerald-700 border-emerald-200",
};

// ─── Sub-component: ClientCard ────────────────────────────────────────────────

interface ClientCardProps {
  entry: ClientEntry;
  onExclude: () => void;
  onResolve: (resolution: DuplicateResolution) => void;
  existingClientOptions: Array<{ id: string; name: string }>;
}

function ClientCard({ entry, onExclude, onResolve, existingClientOptions }: ClientCardProps) {
  const [expanded, setExpanded] = useState(false);
  const validDocs = entry.documents.filter(
    (d) => !["invalid_format", "invalid_empty", "invalid_size"].includes(d.status),
  );
  const invalidDocs = entry.documents.filter((d) =>
    ["invalid_format", "invalid_empty", "invalid_size"].includes(d.status),
  );

  const invalidLabel: Record<string, string> = {
    invalid_format: "Formato no permitido",
    invalid_empty: "Archivo vacío",
    invalid_size: "Supera 10 MB",
  };

  return (
    <div className={`rounded-xl border bg-card ${entry.status === "excluded" ? "opacity-50" : ""}`}>
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 text-muted-foreground"
          aria-label={expanded ? "Contraer" : "Expandir"}
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <FolderOpen className="h-4 w-4 shrink-0 text-amber-500" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{entry.folderName}</div>
          <div className="text-[10px] text-muted-foreground">
            {validDocs.length} documento{validDocs.length !== 1 ? "s" : ""} válido
            {validDocs.length !== 1 ? "s" : ""}
            {invalidDocs.length > 0 && (
              <span className="ml-2 text-red-500">
                {invalidDocs.length} inválido{invalidDocs.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${STATUS_COLORS[entry.status]}`}
        >
          {STATUS_LABELS[entry.status]}
        </span>
        <button
          type="button"
          onClick={onExclude}
          className={`shrink-0 rounded-lg border px-2 py-1 text-[10px] font-medium transition
            ${
              entry.status === "excluded"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-red-200 bg-red-50 text-red-600 hover:bg-red-100"
            }`}
        >
          {entry.status === "excluded" ? (
            <>
              <Eye className="mr-0.5 inline h-3 w-3" />
              Incluir
            </>
          ) : (
            <>
              <EyeOff className="mr-0.5 inline h-3 w-3" />
              Excluir
            </>
          )}
        </button>
      </div>

      {expanded && (
        <div className="border-t border-border px-4 pb-4 pt-3 space-y-3">
          {/* Duplicate exact resolution */}
          {entry.status === "duplicate_exact" && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-2">
              <p className="text-xs font-semibold text-red-800">
                ⚠ Cliente existente: <span className="font-bold">{entry.existingClientName}</span>
              </p>
              <div className="flex flex-wrap gap-2">
                {(["use_existing", "create_new", "skip"] as DuplicateResolution[]).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => onResolve(r)}
                    className={`rounded-lg border px-3 py-1.5 text-[11px] font-medium transition
                      ${
                        entry.duplicateResolution === r
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border hover:bg-muted/60 text-muted-foreground"
                      }`}
                  >
                    {r === "use_existing"
                      ? "Usar cliente existente"
                      : r === "create_new"
                        ? "Crear nuevo cliente"
                        : "Omitir esta carpeta"}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Approximate duplicate warning */}
          {entry.status === "duplicate_approximate" && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
              ~ Nombre similar a: <span className="font-semibold">{entry.existingClientName}</span>{" "}
              — solo advertencia, no bloquea la importación
            </div>
          )}

          {/* Valid documents list */}
          {validDocs.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">
                Documentos válidos ({validDocs.length})
              </p>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {validDocs.map((doc, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <FileText className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{doc.relativePath}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Empty folder note */}
          {entry.status === "empty" && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
              ℹ Esta carpeta no contiene archivos válidos detectables. Los directorios completamente
              vacíos no son visibles a través de la API del navegador (limitación de{" "}
              <code>webkitdirectory</code>). Puedes excluirla o añadir documentos manualmente desde
              la ficha del cliente tras la importación.
            </div>
          )}
          {invalidDocs.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase text-red-600">
                Archivos inválidos ({invalidDocs.length})
              </p>
              {invalidDocs.map((doc, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-red-600">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{doc.originalName}</span>
                  <span className="shrink-0 text-[10px]">
                    — {invalidLabel[doc.status] ?? doc.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function FolderImport({ onClose, onSuccess }: Props) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: existingClients = [] } = useClients();

  const [step, setStep] = useState<WizardStep>("idle");
  const [clients, setClients] = useState<ClientEntry[]>([]);
  const [rootName, setRootName] = useState("");
  const [ignoredCount, setIgnoredCount] = useState(0);
  const [stats, setStats] = useState<ImportStats | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ClientEntryStatus | "all">("all");
  const [error, setError] = useState<string | null>(null);
  const [supportsWebkit] = useState(() =>
    typeof document !== "undefined" ? "webkitdirectory" in document.createElement("input") : true,
  );

  // ─── File selection ──────────────────────────────────────────────────────

  const handleFiles = useCallback(
    (fileList: FileList) => {
      setError(null);
      setStep("analyzing");

      const files = Array.from(fileList);
      const result = analyzeFiles(files);

      if (result.clients.length === 0) {
        setError("La carpeta seleccionada no contiene subcarpetas con archivos válidos.");
        setStep("idle");
        return;
      }

      const withDuplicates = detectDuplicatesForClients(result.clients, existingClients);
      setRootName(result.rootName);
      setClients(withDuplicates);
      setIgnoredCount(result.ignoredFiles.length);
      setStep("preview");
    },
    [existingClients],
  );

  // ─── Preview actions ─────────────────────────────────────────────────────

  const toggleExclude = useCallback((index: number) => {
    setClients((prev) =>
      prev.map((c, i) => {
        if (i !== index) return c;
        if (c.status === "excluded") {
          // Restore original status from document analysis
          const hasPending = c.documents.some((d) => d.status === "pending");
          return { ...c, status: hasPending ? "new" : "empty" };
        }
        return { ...c, status: "excluded" };
      }),
    );
  }, []);

  const resolveExact = useCallback((index: number, resolution: DuplicateResolution) => {
    setClients((prev) =>
      prev.map((c, i) => (i === index ? { ...c, duplicateResolution: resolution } : c)),
    );
  }, []);

  // ─── Confirm check ───────────────────────────────────────────────────────

  const canConfirm = useMemo(() => {
    const unresolvedExact = clients.some(
      (c) => c.status === "duplicate_exact" && !c.duplicateResolution,
    );
    if (unresolvedExact) return false;
    const hasAnyValidDoc = clients.some(
      (c) => c.status !== "excluded" && c.documents.some((d) => d.status === "pending"),
    );
    const hasAnyNewClient = clients.some(
      (c) =>
        c.status === "new" ||
        c.status === "duplicate_approximate" ||
        c.status === "duplicate_exact",
    );
    return hasAnyValidDoc || hasAnyNewClient;
  }, [clients]);

  // ─── Run import ──────────────────────────────────────────────────────────

  const handleConfirm = useCallback(async () => {
    setStep("importing");
    setError(null);

    try {
      const result = await runImport({
        rootName,
        clients,
        onProgress: (s) => setStats({ ...s }),
      });
      setClients(result.clients);
      setStats(result.stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado durante la importación.");
    } finally {
      setStep("done");
    }
  }, [rootName, clients]);

  // ─── Retry failed ────────────────────────────────────────────────────────

  const handleRetry = useCallback(async () => {
    setStep("importing");
    setError(null);

    try {
      const result = await retryFailedDocuments(clients, (s) => setStats({ ...s }));
      setClients(result.clients);
      setStats(result.stats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error durante el reintento.");
    } finally {
      setStep("done");
    }
  }, [clients]);

  // ─── Close / success ─────────────────────────────────────────────────────

  const handleClose = useCallback(() => {
    if (step === "importing") return; // prevent close during import
    if (step === "done") {
      invalidateCrmQueries(qc, {});
      onSuccess();
    } else {
      onClose();
    }
  }, [step, qc, onSuccess, onClose]);

  // ─── Filtered preview list ───────────────────────────────────────────────

  const filteredClients = useMemo(() => {
    return clients.filter((c) => {
      const matchSearch = !search || c.folderName.toLowerCase().includes(search.toLowerCase());
      const matchStatus = statusFilter === "all" || c.status === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [clients, search, statusFilter]);

  const existingClientOptions = useMemo(
    () => existingClients.map((c) => ({ id: c.id, name: c.name })),
    [existingClients],
  );

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="relative flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl bg-background shadow-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <FolderOpen className="h-5 w-5 text-primary" />
            <div>
              <h2 className="text-base font-semibold">Importar carpeta de clientes</h2>
              {rootName && (
                <p className="text-xs text-muted-foreground">
                  Carpeta: <span className="font-medium">{rootName}</span>
                </p>
              )}
            </div>
          </div>
          {step !== "importing" && (
            <button
              type="button"
              onClick={handleClose}
              className="rounded-lg p-2 hover:bg-muted/60"
              aria-label="Cerrar"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {step === "idle" && (
            <StepIdle
              supportsWebkit={supportsWebkit}
              inputRef={inputRef}
              onFiles={handleFiles}
              error={error}
            />
          )}
          {step === "analyzing" && <StepAnalyzing />}
          {step === "preview" && (
            <StepPreview
              clients={filteredClients}
              allClients={clients}
              search={search}
              onSearch={setSearch}
              statusFilter={statusFilter}
              onStatusFilter={(v) => setStatusFilter(v as ClientEntryStatus | "all")}
              onExclude={toggleExclude}
              onResolve={resolveExact}
              existingClientOptions={existingClientOptions}
              ignoredCount={ignoredCount}
            />
          )}
          {step === "importing" && stats && <StepImporting stats={stats} />}
          {step === "done" && stats && (
            <StepDone stats={stats} clients={clients} onRetry={handleRetry} error={error} />
          )}
        </div>

        {/* Footer */}
        {(step === "preview" || step === "done") && (
          <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-4">
            {step === "preview" && (
              <>
                <button
                  type="button"
                  onClick={handleClose}
                  className="h-9 rounded-lg border border-border px-4 text-sm font-medium hover:bg-muted/60"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={!canConfirm}
                  className="h-9 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  Confirmar importación (
                  {clients.filter((c) => c.status !== "excluded" && c.status !== "empty").length}{" "}
                  clientes)
                </button>
              </>
            )}
            {step === "done" && (
              <button
                type="button"
                onClick={handleClose}
                className="h-9 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:brightness-110 transition"
              >
                Cerrar
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Step sub-components ──────────────────────────────────────────────────────

function StepIdle({
  supportsWebkit,
  inputRef,
  onFiles,
  error,
}: {
  supportsWebkit: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onFiles: (files: FileList) => void;
  error: string | null;
}) {
  return (
    <div className="flex flex-col items-center gap-6 py-8">
      {!supportsWebkit && (
        <div className="w-full rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          ⚠ Tu navegador puede no soportar la selección de carpetas. Usa Chrome, Edge o Safari.
        </div>
      )}
      <div
        className="flex w-full cursor-pointer flex-col items-center gap-4 rounded-xl border-2 border-dashed border-border p-10 hover:bg-muted/30 transition"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
        role="button"
        tabIndex={0}
        aria-label="Seleccionar carpeta"
      >
        <Upload className="h-10 w-10 text-muted-foreground" />
        <div className="text-center">
          <p className="text-sm font-semibold">Haz clic para seleccionar una carpeta</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Cada subcarpeta de primer nivel se interpretará como un cliente.
            <br />
            Formatos permitidos: PDF, DOC, DOCX, XLS, XLSX, JPG, PNG, WEBP, TXT
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          // @ts-expect-error — webkitdirectory is non-standard but widely supported
          webkitdirectory=""
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              onFiles(e.target.files);
            }
          }}
        />
      </div>
      <div className="w-full rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
        💡 <strong>Recomendación para carpetas grandes:</strong> importa por bloques de 20 a 30
        clientes y revisa el informe después de cada importación. Así puedes detectar errores antes
        de continuar.
      </div>
      {error && (
        <div className="flex w-full items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}
    </div>
  );
}

function StepAnalyzing() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="text-sm text-muted-foreground">Analizando estructura de carpetas…</p>
    </div>
  );
}

function StepPreview({
  clients,
  allClients,
  search,
  onSearch,
  statusFilter,
  onStatusFilter,
  onExclude,
  onResolve,
  existingClientOptions,
  ignoredCount,
}: {
  clients: ClientEntry[];
  allClients: ClientEntry[];
  search: string;
  onSearch: (v: string) => void;
  statusFilter: string;
  onStatusFilter: (v: string) => void;
  onExclude: (i: number) => void;
  onResolve: (i: number, r: DuplicateResolution) => void;
  existingClientOptions: Array<{ id: string; name: string }>;
  ignoredCount: number;
}) {
  const total = allClients.length;
  const exactPending = allClients.filter(
    (c) => c.status === "duplicate_exact" && !c.duplicateResolution,
  ).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold">
          {total} carpeta{total !== 1 ? "s" : ""} detectada{total !== 1 ? "s" : ""}
        </span>
        {ignoredCount > 0 && (
          <span className="text-xs text-muted-foreground">
            {ignoredCount} archivos de sistema ignorados
          </span>
        )}
      </div>

      {exactPending > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          <AlertCircle className="mr-1 inline h-3.5 w-3.5" />
          {exactPending} carpeta{exactPending !== 1 ? "s" : ""} con clientes duplicados exactos sin
          resolver. Debes elegir una acción para cada una antes de confirmar.
        </div>
      )}

      {/* Search + filter */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Buscar cliente…"
            className="w-full h-9 rounded-lg border border-border bg-muted/40 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/15"
          />
        </div>
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <select
            value={statusFilter}
            onChange={(e) => onStatusFilter(e.target.value)}
            className="h-9 rounded-lg border border-border bg-muted/40 pl-9 pr-4 text-sm focus:outline-none"
          >
            <option value="all">Todos</option>
            <option value="new">Nuevos</option>
            <option value="duplicate_exact">Duplicado exacto</option>
            <option value="duplicate_approximate">Nombre similar</option>
            <option value="empty">Sin documentos</option>
            <option value="excluded">Excluidos</option>
          </select>
        </div>
      </div>

      {/* Client cards */}
      <div className="space-y-2">
        {clients.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No hay carpetas que coincidan con el filtro.
          </p>
        )}
        {clients.map((entry) => {
          const globalIndex = allClients.findIndex((c) => c.folderName === entry.folderName);
          return (
            <ClientCard
              key={entry.folderName}
              entry={entry}
              onExclude={() => onExclude(globalIndex)}
              onResolve={(r) => onResolve(globalIndex, r)}
              existingClientOptions={existingClientOptions}
            />
          );
        })}
      </div>
    </div>
  );
}

function StepImporting({ stats }: { stats: ImportStats }) {
  const percent =
    stats.totalDocuments > 0
      ? Math.round(
          ((stats.documentsUploaded + stats.documentsFailed + stats.documentsDuplicateSkipped) /
            stats.totalDocuments) *
            100,
        )
      : 0;

  return (
    <div className="flex flex-col gap-6 py-8">
      <div className="text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
        <p className="mt-3 text-sm font-semibold">Importando…</p>
        {stats.currentClientName && (
          <p className="mt-1 text-xs text-muted-foreground truncate">
            Procesando: {stats.currentClientName}
          </p>
        )}
      </div>
      <Progress value={percent} className="h-3" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-center text-xs">
        <Card className="p-3">
          <div className="text-lg font-bold text-emerald-600">{stats.documentsUploaded}</div>
          <div className="text-muted-foreground">Subidos</div>
        </Card>
        <Card className="p-3">
          <div className="text-lg font-bold text-amber-600">{stats.documentsDuplicateSkipped}</div>
          <div className="text-muted-foreground">Omitidos</div>
        </Card>
        <Card className="p-3">
          <div className="text-lg font-bold text-red-600">{stats.documentsFailed}</div>
          <div className="text-muted-foreground">Errores</div>
        </Card>
        <Card className="p-3">
          <div className="text-lg font-bold">
            {Math.max(
              0,
              stats.totalDocuments -
                stats.documentsUploaded -
                stats.documentsFailed -
                stats.documentsDuplicateSkipped,
            )}
          </div>
          <div className="text-muted-foreground">Pendientes</div>
        </Card>
      </div>
    </div>
  );
}

function StepDone({
  stats,
  clients,
  onRetry,
  error,
}: {
  stats: ImportStats;
  clients: ClientEntry[];
  onRetry: () => void;
  error: string | null;
}) {
  const failedDocs = clients.flatMap((c) =>
    c.documents
      .filter((d) => d.status === "failed")
      .map((d) => ({ client: c.folderName, name: d.originalName, error: d.errorMessage ?? "" })),
  );

  const isFullSuccess = stats.clientsFailed === 0 && stats.documentsFailed === 0;

  return (
    <div className="space-y-6 py-4">
      {isFullSuccess ? (
        <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
          <p className="text-sm font-semibold text-emerald-800">Importación completada con éxito</p>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <AlertCircle className="h-5 w-5 text-amber-600 shrink-0" />
          <p className="text-sm font-semibold text-amber-800">
            Importación completada con errores parciales
          </p>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Summary grid */}
      <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
        {[
          { label: "Clientes creados", value: stats.clientsCreated, color: "text-emerald-600" },
          {
            label: "Asociados a existentes",
            value: stats.clientsAssociated,
            color: "text-blue-600",
          },
          {
            label: "Clientes omitidos",
            value: stats.clientsSkipped,
            color: "text-muted-foreground",
          },
          { label: "Clientes fallidos", value: stats.clientsFailed, color: "text-red-600" },
          {
            label: "Documentos subidos",
            value: stats.documentsUploaded,
            color: "text-emerald-600",
          },
          {
            label: "Duplicados omitidos",
            value: stats.documentsDuplicateSkipped,
            color: "text-amber-600",
          },
          { label: "Inválidos", value: stats.documentsInvalid, color: "text-muted-foreground" },
          { label: "Documentos fallidos", value: stats.documentsFailed, color: "text-red-600" },
        ].map(({ label, value, color }) => (
          <Card key={label} className="p-3 text-center">
            <div className={`text-lg font-bold ${color}`}>{value}</div>
            <div className="text-muted-foreground leading-tight">{label}</div>
          </Card>
        ))}
      </div>

      {/* Failed documents list */}
      {failedDocs.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase text-red-600">
              Documentos fallidos ({failedDocs.length})
            </p>
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted/60"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Reintentar fallos
            </button>
          </div>
          <div className="max-h-48 overflow-y-auto space-y-1">
            {failedDocs.map((d, i) => (
              <div key={i} className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs">
                <span className="font-medium">{d.client}</span>
                <span className="mx-1 text-muted-foreground">›</span>
                <span>{d.name}</span>
                {d.error && <p className="mt-0.5 text-red-600">{d.error}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
