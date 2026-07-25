/**
 * zip-import.tsx
 * Componente de importación de carpetas de clientes desde ZIP (Google Drive).
 */
import { Link } from "@tanstack/react-router";
import { useRef, useState, useCallback } from "react";
import {
  Upload,
  X,
  AlertCircle,
  CheckCircle2,
  Loader2,
  ChevronDown,
  ChevronRight,
  FileText,
  FolderOpen,
  Eye,
  EyeOff,
  Pencil,
  Users,
  Trash2,
  SkipForward,
  UserPlus,
  RefreshCw,
  GitMerge,
} from "lucide-react";
import { Card } from "@/components/app-layout";
import {
  formatDuplicateWarning,
  formatZipReviewSelection,
  formatZipReviewStats,
  ZIP_IMPORT_COPY,
} from "@/lib/import-copy";
import { formatCount } from "@/lib/text-utils";
import { getAuthClient, supabase } from "@/lib/supabase";
import {
  CASE_STATUS_OPTIONS,
  normalizeCaseStatus as normalizeReviewCaseStatus,
} from "@/lib/case-validation";
import {
  parseSingleClientZipFile,
  SINGLE_CLIENT_ZIP_ERROR,
  moveDocumentBetweenCases,
  removeCaseCandidate,
  detectDuplicates,
  normalizeFolderName,
  formatSize,
  type ClientCandidate,
  type ReviewCandidate,
  type DuplicateMatch,
  type DuplicateAction,
  type ExistingClient,
  type ZipFileEntry,
  type ZipCaseCandidate,
} from "@/lib/imports/zip-import";
import { persistZipCandidate } from "@/lib/imports/zip-persistence";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
  onSuccess: () => void;
}

type ImportStep = "upload" | "parsing" | "review" | "importing" | "done";

interface FolderImportResult {
  folderName: string;
  status: "success" | "partial" | "failed" | "skipped";
  clientId?: string;
  /** True when the client existed from a previous attempt */
  clientAlreadyExisted?: boolean;
  error?: string;
  /** Structured error detail for display with "Ver detalle" */
  errorDetail?: import("@/lib/imports/zip-persistence").OperationError;
  documentsImported: number;
  documentsSkipped?: number;
  errors?: string[];
  compensations?: string[];
  caseIds?: Array<{ id: string; title: string; caseNumber: string | null }>;
  documentIds?: Array<{ id: string; name: string; storagePath: string; caseId: string | null }>;
  failedFiles?: Array<{ name: string; path: string; error: string }>;
  warnings?: string[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const COLORS = [
  "oklch(0.74 0.12 80)",
  "oklch(0.55 0.13 235)",
  "oklch(0.62 0.14 155)",
  "oklch(0.62 0.18 25)",
  "oklch(0.55 0.13 290)",
  "oklch(0.34 0.09 255)",
];

const DUPLICATE_LABELS: Record<DuplicateAction, string> = {
  create_new: "Crear nuevo cliente",
  update_existing: "Actualizar cliente existente",
  attach_docs: "Solo adjuntar documentos",
  skip: "Cancelar importación",
};

const DUPLICATE_ICONS: Record<DuplicateAction, typeof UserPlus> = {
  create_new: UserPlus,
  update_existing: Pencil,
  attach_docs: FileText,
  skip: SkipForward,
};

const ZIP_DOCUMENT_TYPE_OPTIONS = [
  "DNI",
  "DEMANDA",
  "CONTESTACIÓN",
  "ANEXOS",
  "CARGO",
  "RESOLUCIÓN",
  "SENTENCIA",
  "AUDIENCIA",
  "LIQUIDACIÓN",
  "ESCRITO",
  "NOTIFICACIÓN",
  "OTROS",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  return words.length >= 2
    ? (words[0][0] + words[1][0]).toUpperCase()
    : (words[0] ?? "??").slice(0, 2).toUpperCase();
}

function randomColor(): string {
  return COLORS[Math.floor(Math.random() * COLORS.length)];
}

function formatImportStatus(success: number, partial: number, failed: number): string {
  return [
    formatCount(success, "importación completada", "importaciones completadas"),
    formatCount(partial, "importación parcial", "importaciones parciales"),
    formatCount(failed, "importación fallida", "importaciones fallidas"),
  ].join(" · ");
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ExtractionBadge({ status }: { status: ZipFileEntry["extractionStatus"] }) {
  const map = {
    extracted: {
      cls: "bg-emerald-50 text-emerald-700 border-emerald-200",
      label: "Texto extraído",
    },
    ocr_required: {
      cls: "bg-amber-50 text-amber-700 border-amber-200",
      label: "Pendiente de extracción OCR",
    },
    binary: { cls: "bg-slate-50 text-slate-600 border-slate-200", label: "Imagen/binario" },
    empty: { cls: "bg-red-50 text-red-600 border-red-200", label: "Vacío" },
    error: { cls: "bg-red-50 text-red-600 border-red-200", label: "Error de lectura" },
  };
  const { cls, label } = map[status] ?? map.binary;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${cls}`}
    >
      {label}
    </span>
  );
}

function DuplicateActionSelector({
  matches,
  selected,
  onChange,
  existingClientId,
  onClientChange,
}: {
  matches: DuplicateMatch[];
  selected?: DuplicateAction;
  onChange: (a: DuplicateAction) => void;
  existingClientId?: string;
  onClientChange: (id: string) => void;
}) {
  const actions: DuplicateAction[] = ["create_new", "update_existing", "attach_docs", "skip"];
  return (
    <div className="mt-3 space-y-2">
      <p className="text-xs font-semibold text-amber-800">
        Se encontraron posibles clientes existentes:
      </p>
      {matches.slice(0, 3).map((m) => (
        <div
          key={m.clientId}
          className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs"
        >
          <span className="font-medium">{m.clientName}</span>
          <span className="ml-2 text-amber-600">— {m.matchReason}</span>
          {m.matchStrength === "approximate" && (
            <span className="ml-1 italic text-amber-500">(solo advertencia)</span>
          )}
        </div>
      ))}
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 mt-2">
        {actions.map((action) => {
          const Icon = DUPLICATE_ICONS[action];
          return (
            <button
              key={action}
              type="button"
              onClick={() => onChange(action)}
              className={`flex flex-col items-center gap-1 rounded-lg border p-2 text-[10px] font-medium transition
                ${
                  selected === action
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border hover:bg-muted/50 text-muted-foreground"
                }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {DUPLICATE_LABELS[action]}
            </button>
          );
        })}
      </div>
      {(selected === "update_existing" || selected === "attach_docs") && (
        <select
          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-xs"
          value={existingClientId ?? ""}
          onChange={(e) => onClientChange(e.target.value)}
        >
          <option value="">— Selecciona el cliente existente —</option>
          {matches.map((m) => (
            <option key={m.clientId} value={m.clientId}>
              {m.clientName}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

// ─── CandidateCard ────────────────────────────────────────────────────────────

function CandidateCard({
  candidate,
  index,
  onUpdate,
}: {
  candidate: ReviewCandidate;
  index: number;
  onUpdate: (idx: number, partial: Partial<ReviewCandidate>) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const d = candidate.detected;
  const eff = candidate.edits;
  const name = eff.proposedName ?? candidate.proposedName;
  const caseCandidates = candidate.caseCandidates ?? [];
  const documentCaseMap = candidate.documentCaseMap ?? {};
  const excludedFolders = candidate.excludedFolders ?? new Set<string>();

  function patchCase(caseId: string, updates: Partial<ZipCaseCandidate>) {
    onUpdate(index, {
      caseCandidates: caseCandidates.map((caseCandidate) =>
        caseCandidate.id === caseId ? { ...caseCandidate, ...updates } : caseCandidate,
      ),
    });
  }

  function addCase() {
    const id = `manual-${Date.now()}`;
    onUpdate(index, {
      caseCandidates: [
        ...caseCandidates,
        {
          id,
          title: "Expediente pendiente de clasificación",
          caseNumber: null,
          processType: "Pendiente de clasificación",
          matter: "Pendiente de clasificación",
          specialty: "Pendiente de clasificación",
          juzgado: "Por determinar",
          status: "Pendiente de clasificación",
          origin: "importacion_zip_individual",
          originPath: candidate.folderPath,
          confidence: 0.3,
          warnings: ["Creado manualmente durante la revisión."],
          documentPaths: [],
          isProvisional: true,
        },
      ],
    });
  }

  function toggleFile(path: string) {
    const next = new Set(candidate.excludedFiles);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    onUpdate(index, { excludedFiles: next });
  }

  function moveFile(path: string, caseId: string) {
    onUpdate(index, moveDocumentBetweenCases(caseCandidates, documentCaseMap, path, caseId));
  }

  function patchFile(path: string, updates: Partial<ZipFileEntry>) {
    onUpdate(index, {
      files: candidate.files.map((file) =>
        file.zipPath === path ? { ...file, ...updates } : file,
      ),
    });
  }

  function mergeCaseIntoPrevious(caseId: string) {
    const currentIndex = caseCandidates.findIndex((caseCandidate) => caseCandidate.id === caseId);
    const source = caseCandidates[currentIndex];
    const target =
      caseCandidates[currentIndex - 1] ?? caseCandidates.find((item) => item.id !== caseId);
    if (!source || !target) return;

    const nextMap = { ...documentCaseMap };
    for (const path of source.documentPaths) nextMap[path] = target.id;
    onUpdate(index, {
      documentCaseMap: nextMap,
      caseCandidates: caseCandidates
        .filter((caseCandidate) => caseCandidate.id !== source.id)
        .map((caseCandidate) =>
          caseCandidate.id === target.id
            ? {
                ...caseCandidate,
                documentPaths: Array.from(
                  new Set([...caseCandidate.documentPaths, ...source.documentPaths]),
                ),
              }
            : caseCandidate,
        ),
    });
  }

  function deleteCase(caseId: string) {
    onUpdate(index, removeCaseCandidate(caseCandidates, documentCaseMap, caseId));
  }

  function toggleFolder(folderPath: string) {
    const nextFolders = new Set(excludedFolders);
    const nextFiles = new Set(candidate.excludedFiles);
    const folderFiles = candidate.files.filter((file) => file.zipPath.startsWith(`${folderPath}/`));
    if (nextFolders.has(folderPath)) {
      nextFolders.delete(folderPath);
      folderFiles.forEach((file) => nextFiles.delete(file.zipPath));
    } else {
      nextFolders.add(folderPath);
      folderFiles.forEach((file) => nextFiles.add(file.zipPath));
    }
    onUpdate(index, { excludedFolders: nextFolders, excludedFiles: nextFiles });
  }

  const activeFiles = candidate.files.filter((f) => !candidate.excludedFiles.has(f.zipPath));
  const subfolders = candidate.subfolderPaths ?? [];

  return (
    <div
      className={`rounded-xl border ${candidate.excluded ? "border-muted opacity-50" : "border-border"} bg-card`}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <button type="button" onClick={() => setExpanded((v) => !v)} className="shrink-0">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
        <FolderOpen className="h-4 w-4 shrink-0 text-amber-500" />
        <div className="min-w-0 flex-1">
          {editingName ? (
            <input
              autoFocus
              className="w-full rounded border border-border bg-background px-2 py-0.5 text-sm font-semibold"
              value={name}
              onChange={(e) => onUpdate(index, { edits: { ...eff, proposedName: e.target.value } })}
              onBlur={() => setEditingName(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setEditingName(false);
              }}
            />
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-semibold">{name}</span>
              <button
                type="button"
                onClick={() => setEditingName(true)}
                className="shrink-0 text-muted-foreground hover:text-foreground"
              >
                <Pencil className="h-3 w-3" />
              </button>
            </div>
          )}
          <p className="truncate text-[10px] text-muted-foreground">{candidate.folderPath}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
            {activeFiles.length} doc. / {caseCandidates.length} exp.
          </span>
          {candidate.duplicates.length > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
              {candidate.duplicates.length} duplicado{candidate.duplicates.length > 1 ? "s" : ""}
            </span>
          )}
          <button
            type="button"
            onClick={() => onUpdate(index, { excluded: !candidate.excluded })}
            className={`rounded-lg border px-2 py-1 text-[10px] font-medium transition ${candidate.excluded ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-600 hover:bg-red-100"}`}
          >
            {candidate.excluded ? (
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
      </div>

      {expanded && (
        <div className="space-y-4 border-t border-border px-4 pb-4 pt-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: "DNI", field: "dni" as const, value: eff.dni ?? d.dni },
              { label: "RUC", field: "ruc" as const, value: eff.ruc ?? d.ruc },
              { label: "Teléfono", field: "phone" as const, value: eff.phone ?? d.phone },
              { label: "Correo", field: "email" as const, value: eff.email ?? d.email },
              { label: "Dirección", field: "address" as const, value: eff.address ?? d.address },
              { label: "Estado", field: "status" as const, value: eff.status ?? d.status },
              {
                label: "Observaciones",
                field: "observations" as const,
                value: eff.observations ?? d.observations,
              },
            ].map(({ label, field, value }) => {
              const evidence = candidate.detectedFields?.[field];
              return (
                <div key={field} className="rounded-lg bg-muted/30 p-2">
                  <dt className="text-[9px] font-semibold uppercase text-muted-foreground">
                    {label}
                  </dt>
                  <input
                    className="mt-0.5 w-full bg-transparent text-xs font-medium placeholder:text-muted-foreground/50 focus:outline-none"
                    value={value ?? ""}
                    placeholder="No detectado"
                    onChange={(e) =>
                      onUpdate(index, { edits: { ...eff, [field]: e.target.value || undefined } })
                    }
                  />
                  {evidence && (
                    <div className="mt-1 space-y-1">
                      <p className="truncate text-[9px] text-muted-foreground">
                        {evidence.sourceName} · {Math.round(evidence.confidence * 100)}%
                      </p>
                      <p className="line-clamp-2 text-[9px] text-muted-foreground">
                        {evidence.evidence}
                      </p>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            onUpdate(index, {
                              edits: { ...eff, [field]: String(evidence.value) },
                            })
                          }
                          className="rounded border border-emerald-200 px-1.5 py-0.5 text-[9px] font-medium text-emerald-700 hover:bg-emerald-50"
                        >
                          Aceptar
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            onUpdate(index, {
                              edits: { ...eff, [field]: "" },
                            })
                          }
                          className="rounded border border-border px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground hover:bg-muted/60"
                        >
                          Descartar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {(candidate.evidence?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {candidate.evidence?.map((item) => (
                <span
                  key={item}
                  className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600"
                >
                  {item}
                </span>
              ))}
              {candidate.confidence !== undefined && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
                  Confianza {Math.round(candidate.confidence * 100)}%
                </span>
              )}
            </div>
          )}

          {subfolders.length > 0 && (
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase text-muted-foreground">
                Subcarpetas
              </p>
              <div className="flex flex-wrap gap-1.5">
                {subfolders.map((folderPath) => (
                  <button
                    key={folderPath}
                    type="button"
                    onClick={() => toggleFolder(folderPath)}
                    className={`rounded-full border px-2 py-1 text-[10px] ${excludedFolders.has(folderPath) ? "border-red-200 bg-red-50 text-red-600" : "border-border bg-background text-muted-foreground"}`}
                  >
                    {excludedFolders.has(folderPath) ? "Omitida" : "Activa"} ·{" "}
                    {folderPath.split("/").pop()}
                  </button>
                ))}
              </div>
            </div>
          )}

          {candidate.warnings.length > 0 && (
            <div className="space-y-1">
              {candidate.warnings.map((w, i) => (
                <div
                  key={i}
                  className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5"
                >
                  <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-amber-600" />
                  <span className="text-[10px] text-amber-800">{w}</span>
                </div>
              ))}
            </div>
          )}

          {candidate.duplicates.length > 0 && (
            <DuplicateActionSelector
              matches={candidate.duplicates}
              selected={candidate.duplicateAction}
              onChange={(action) => onUpdate(index, { duplicateAction: action })}
              existingClientId={candidate.existingClientId}
              onClientChange={(id) => onUpdate(index, { existingClientId: id })}
            />
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                Expedientes del cliente
              </p>
              <button
                type="button"
                onClick={addCase}
                className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border px-2 text-[10px] font-medium hover:bg-muted/60"
              >
                <UserPlus className="h-3.5 w-3.5" /> Crear expediente
              </button>
            </div>
            {caseCandidates.map((caseCandidate) => {
              const files = candidate.files.filter(
                (file) => documentCaseMap[file.zipPath] === caseCandidate.id,
              );
              return (
                <div
                  key={caseCandidate.id}
                  className="rounded-lg border border-border bg-background p-3"
                >
                  <div className="grid gap-2 sm:grid-cols-4">
                    <input
                      className="h-8 rounded border border-border bg-card px-2 text-xs"
                      value={caseCandidate.title}
                      onChange={(e) => patchCase(caseCandidate.id, { title: e.target.value })}
                    />
                    <input
                      className="h-8 rounded border border-border bg-card px-2 text-xs font-mono"
                      value={caseCandidate.caseNumber ?? ""}
                      placeholder="Expediente"
                      onChange={(e) =>
                        patchCase(caseCandidate.id, {
                          caseNumber: e.target.value || null,
                          isProvisional: !e.target.value,
                        })
                      }
                    />
                    <input
                      className="h-8 rounded border border-border bg-card px-2 text-xs"
                      value={caseCandidate.processType}
                      onChange={(e) =>
                        patchCase(caseCandidate.id, {
                          processType: e.target.value || "Pendiente de clasificación",
                          matter: e.target.value || "Pendiente de clasificación",
                        })
                      }
                    />
                    <select
                      className="h-8 rounded border border-border bg-card px-2 text-xs"
                      value={normalizeReviewCaseStatus(caseCandidate.status)}
                      onChange={(e) => patchCase(caseCandidate.id, { status: e.target.value })}
                    >
                      {CASE_STATUS_OPTIONS.map((status) => (
                        <option key={status}>{status}</option>
                      ))}
                    </select>
                    <input
                      className="h-8 rounded border border-border bg-card px-2 text-xs"
                      value={caseCandidate.specialty}
                      placeholder="Especialidad"
                      onChange={(e) => patchCase(caseCandidate.id, { specialty: e.target.value })}
                    />
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-4">
                    <input
                      className="h-8 rounded border border-border bg-card px-2 text-xs"
                      value={caseCandidate.juzgado}
                      placeholder="Juzgado"
                      onChange={(e) => patchCase(caseCandidate.id, { juzgado: e.target.value })}
                    />
                    <input
                      className="h-8 rounded border border-border bg-card px-2 text-xs"
                      value={caseCandidate.demandante ?? ""}
                      placeholder="Demandante"
                      onChange={(e) =>
                        patchCase(caseCandidate.id, { demandante: e.target.value || undefined })
                      }
                    />
                    <input
                      className="h-8 rounded border border-border bg-card px-2 text-xs"
                      value={caseCandidate.demandado ?? ""}
                      placeholder="Demandado"
                      onChange={(e) =>
                        patchCase(caseCandidate.id, { demandado: e.target.value || undefined })
                      }
                    />
                    <input
                      className="h-8 rounded border border-border bg-card px-2 text-xs"
                      value={caseCandidate.clientRole ?? ""}
                      placeholder="Rol del cliente"
                      onChange={(e) =>
                        patchCase(caseCandidate.id, { clientRole: e.target.value || undefined })
                      }
                    />
                  </div>
                  {caseCandidate.warnings.length > 0 && (
                    <p className="mt-2 text-[10px] text-amber-700">
                      {caseCandidate.warnings.join(" ")}
                    </p>
                  )}
                  {caseCandidate.detectedFields &&
                    Object.entries(caseCandidate.detectedFields).length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {Object.entries(caseCandidate.detectedFields).map(([field, evidence]) =>
                          evidence ? (
                            <span
                              key={field}
                              title={evidence.evidence}
                              className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] text-slate-600"
                            >
                              {field}: {evidence.sourceName} ·{" "}
                              {Math.round(evidence.confidence * 100)}%
                            </span>
                          ) : null,
                        )}
                      </div>
                    )}
                  <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                    <span>
                      {formatCount(files.length, "documento asignado", "documentos asignados")}
                    </span>
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {caseCandidates.length > 1 && (
                        <button
                          type="button"
                          onClick={() => mergeCaseIntoPrevious(caseCandidate.id)}
                          className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-muted-foreground hover:bg-muted/60"
                        >
                          <GitMerge className="h-3 w-3" /> Fusionar
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => deleteCase(caseCandidate.id)}
                        className="inline-flex items-center gap-1 rounded border border-red-200 px-2 py-1 text-red-600 hover:bg-red-50"
                      >
                        <Trash2 className="h-3 w-3" /> Eliminar expediente
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase text-muted-foreground">
              Documentos ({candidate.files.length})
            </p>
            <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
              {candidate.files.map((f) => (
                <div
                  key={f.zipPath}
                  className={`grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition ${candidate.excludedFiles.has(f.zipPath) ? "border-muted bg-muted/20 opacity-50" : "border-border bg-background"}`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate font-medium">{f.name}</span>
                    </div>
                    <p className="truncate pl-5 text-[10px] text-muted-foreground">
                      {f.zipPath} · {f.ext || "sin extension"}
                    </p>
                  </div>
                  <select
                    className="h-7 w-44 rounded border border-border bg-card px-2 text-[10px]"
                    value={documentCaseMap[f.zipPath] ?? "__unclassified"}
                    onChange={(e) => moveFile(f.zipPath, e.target.value)}
                  >
                    <option value="__unclassified">Sin clasificar</option>
                    {caseCandidates.map((caseCandidate) => (
                      <option key={caseCandidate.id} value={caseCandidate.id}>
                        {caseCandidate.caseNumber ?? caseCandidate.title}
                      </option>
                    ))}
                  </select>
                  <span className="text-muted-foreground">{formatSize(f.size)}</span>
                  <div className="flex items-center gap-1.5">
                    <select
                      value={f.docType}
                      onChange={(event) => patchFile(f.zipPath, { docType: event.target.value })}
                      className="h-7 w-32 rounded border border-border bg-card px-2 text-[9px] font-medium text-slate-600"
                    >
                      {ZIP_DOCUMENT_TYPE_OPTIONS.map((type) => (
                        <option key={type}>{type}</option>
                      ))}
                    </select>
                    <ExtractionBadge status={f.extractionStatus} />
                    <button
                      type="button"
                      onClick={() => toggleFile(f.zipPath)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      {candidate.excludedFiles.has(f.zipPath) ? (
                        <Eye className="h-3.5 w-3.5" />
                      ) : (
                        <EyeOff className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
// ─── ResultRow ────────────────────────────────────────────────────────────────

function ResultRow({ result: r }: { result: FolderImportResult }) {
  const [showDetail, setShowDetail] = useState(false);
  const detail = r.errorDetail;

  // Determine the label shown below the folder name for partial/failed results.
  // For a case-stage failure after a successful client creation the message
  // is more specific than just the raw error string.
  const errorSummary = detail?.summary ?? r.error;

  return (
    <div
      className={`rounded-lg border text-xs ${
        r.status === "success"
          ? "border-emerald-200 bg-emerald-50"
          : r.status === "partial"
            ? "border-amber-200 bg-amber-50"
            : r.status === "failed"
              ? "border-red-200 bg-red-50"
              : "border-muted bg-muted/20"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        {r.status === "success" && (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
        )}
        {r.status === "partial" && <AlertCircle className="h-3.5 w-3.5 text-amber-600 shrink-0" />}
        {r.status === "failed" && <AlertCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />}
        {r.status === "skipped" && (
          <SkipForward className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}

        <span className="flex-1 font-medium truncate">{r.folderName}</span>

        {r.status === "success" && (
          <span className="text-emerald-700">
            {formatCount(r.documentsImported, "documento", "documentos")}
          </span>
        )}

        {r.status === "partial" && (
          <span className="text-amber-700">
            {r.clientAlreadyExisted ? "Cliente ya existía." : "Cliente creado."} Expediente
            pendiente de creación.
          </span>
        )}

        {(r.status === "failed" || r.status === "partial") && errorSummary && (
          <button
            type="button"
            onClick={() => setShowDetail((v) => !v)}
            className={`inline-flex items-center gap-1 rounded border px-2 py-1 font-semibold transition ${
              r.status === "partial"
                ? "border-amber-300 text-amber-700 hover:bg-amber-100"
                : "border-red-300 text-red-600 hover:bg-red-100"
            }`}
          >
            {showDetail ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            Ver detalle
          </button>
        )}

        {r.clientId && (
          <Link
            to={"/clientes/$id" as never}
            params={{ id: r.clientId } as never}
            className="rounded border border-emerald-300 px-2 py-1 font-semibold text-emerald-700 hover:bg-emerald-100"
          >
            Abrir cliente
          </Link>
        )}
        {r.caseIds?.slice(0, 2).map((caseItem) => (
          <Link
            key={caseItem.id}
            to={"/casos/$id" as never}
            params={{ id: caseItem.id } as never}
            className="rounded border border-border px-2 py-1 font-semibold text-muted-foreground hover:bg-background/60"
          >
            {caseItem.caseNumber ?? "Expediente"}
          </Link>
        ))}
        {(r.documentIds?.length ?? 0) > 0 && (
          <Link
            to={"/documentos" as never}
            className="rounded border border-border px-2 py-1 font-semibold text-muted-foreground hover:bg-background/60"
          >
            Documentos ({r.documentIds?.length})
          </Link>
        )}
      </div>

      {showDetail && errorSummary && (
        <div
          className={`border-t px-3 py-2.5 space-y-1 ${
            r.status === "partial"
              ? "border-amber-200 bg-amber-50/80"
              : "border-red-200 bg-red-50/80"
          }`}
        >
          {/* Stage + code */}
          <div className="flex items-center gap-2 flex-wrap">
            {detail?.stage && (
              <span className="rounded-full bg-white/70 border border-current px-2 py-0.5 capitalize font-mono text-[10px]">
                etapa: {detail.stage}
              </span>
            )}
            {detail?.code && (
              <span className="rounded-full bg-white/70 border border-current px-2 py-0.5 font-mono text-[10px]">
                código: {detail.code}
              </span>
            )}
          </div>
          {/* Full selectable error text */}
          <p className="select-text break-words leading-relaxed">{errorSummary}</p>
          {detail?.action && (
            <p className="text-[10px] font-semibold opacity-80">
              Acción recomendada: {detail.action}
            </p>
          )}
          {/* Raw detail for copy-paste */}
          {detail?.detail && detail.detail !== errorSummary && (
            <details className="mt-1">
              <summary className="cursor-pointer text-[10px] opacity-60 hover:opacity-100">
                Detalle técnico (copiar)
              </summary>
              <pre className="mt-1 whitespace-pre-wrap break-all text-[10px] select-text opacity-70">
                {detail.detail}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ZipImport({ onClose, onSuccess }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<ImportStep>("upload");
  const [parseProgress, setParseProgress] = useState<string[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<ReviewCandidate[]>([]);
  const [results, setResults] = useState<FolderImportResult[]>([]);
  const [failedIndices, setFailedIndices] = useState<number[]>([]);
  const [importProgress, setImportProgress] = useState<string>("");
  const [fileName, setFileName] = useState("");
  const [retryOnly, setRetryOnly] = useState(false);

  const addProgress = useCallback(
    (msg: string) => setParseProgress((prev) => [...prev.slice(-19), msg]),
    [],
  );

  // ─── ZIP parsing ─────────────────────────────────────────────────────────────

  async function handleFile(f: File) {
    if (!f.name.toLowerCase().endsWith(".zip")) {
      setParseError(
        `"${f.name}" no es un archivo ZIP. Descarga la carpeta desde Google Drive como ZIP.`,
      );
      return;
    }
    setParseError(null);
    setFileName(f.name);
    setStep("parsing");
    setParseProgress([]);

    try {
      const buffer = await f.arrayBuffer();
      const result = await parseSingleClientZipFile(buffer, addProgress);

      if (result.rejectionReason) {
        setParseError(SINGLE_CLIENT_ZIP_ERROR);
        setStep("upload");
        return;
      }

      if (result.candidates.length === 0) {
        setParseError("El ZIP no contiene una carpeta de cliente reconocible.");
        setStep("upload");
        return;
      }

      // Cargar clientes existentes para detectar duplicados
      addProgress("Verificando duplicados en la base de datos…");
      const db = await getAuthClient();
      const { data: existingRaw } = await db
        .from("clients")
        .select("id, name, dni, phone")
        .order("name");

      const existing: ExistingClient[] = (existingRaw ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        dni: c.dni ?? "",
        phone: c.phone ?? "",
      }));

      const reviewCandidates: ReviewCandidate[] = result.candidates.map((c) => ({
        ...c,
        duplicates: detectDuplicates(c, existing),
        edits: {},
        excludedFiles: new Set<string>(),
        excludedFolders: new Set<string>(),
        documentCaseMap: Object.fromEntries(
          (c.caseCandidates ?? []).flatMap((caseCandidate) =>
            caseCandidate.documentPaths.map((path) => [path, caseCandidate.id] as const),
          ),
        ),
      }));

      setCandidates(reviewCandidates);
      setStep("review");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error desconocido";
      setParseError(`Error al procesar el ZIP: ${msg}`);
      setStep("upload");
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }

  // ─── Candidate updates ───────────────────────────────────────────────────────

  function updateCandidate(idx: number, partial: Partial<ReviewCandidate>) {
    setCandidates((prev) => prev.map((c, i) => (i === idx ? { ...c, ...partial } : c)));
  }

  // ─── Import final ────────────────────────────────────────────────────────────

  async function handleImport(indicesToImport?: number[]) {
    const toImport = candidates.filter((c, i) => {
      if (c.excluded) return false;
      if (c.duplicateAction === "skip") return false;
      if (indicesToImport && !indicesToImport.includes(i)) return false;
      if (c.duplicates.length > 0 && !c.duplicateAction) return false;
      return true;
    });

    if (toImport.length === 0) {
      setParseError(
        "No hay un cliente seleccionado para importar. Resuelve duplicados o cancela la importación.",
      );
      return;
    }

    setStep("importing");
    const batchResults: FolderImportResult[] = retryOnly ? [...results] : [];
    const newFailed: number[] = [];
    const db = await getAuthClient();
    const storageBucket = supabase.storage.from("documents");

    for (const candidate of toImport) {
      const globalIdx = candidates.indexOf(candidate);
      setImportProgress(`Importando: ${candidate.edits.proposedName ?? candidate.proposedName}...`);

      const result = await persistZipCandidate({
        candidate,
        db,
        storageBucket,
        sourceFileName: fileName,
        buildInitials,
        randomColor,
        // On retry, pass the clientId from the previous attempt so the client
        // is never re-created. existingClientIdOverride is undefined on first import.
        existingClientIdOverride: retryOnly
          ? (batchResults.find((r) => r.folderName === candidate.folderName)?.clientId ?? undefined)
          : undefined,
      });

      const existing = batchResults.find((r) => r.folderName === candidate.folderName);
      const nextResult: FolderImportResult = {
        folderName: result.folderName,
        status: result.status,
        clientId: result.clientId,
        clientAlreadyExisted: result.clientAlreadyExisted,
        error: result.error,
        errorDetail: result.errorDetail,
        documentsImported: result.documentsImported,
        documentsSkipped: result.documentsSkipped,
        errors: result.errors,
        compensations: result.compensations,
        caseIds: result.caseIds,
        documentIds: result.documentIds,
        failedFiles: result.failedFiles,
        warnings: result.warnings,
      };
      if (existing) Object.assign(existing, nextResult);
      else batchResults.push(nextResult);

      if (result.status === "failed" || result.status === "partial") newFailed.push(globalIdx);
    }

    setResults(batchResults);
    setFailedIndices(newFailed);
    setRetryOnly(false);
    setStep("done");
    if (
      batchResults.some((r) => r.status === "success") &&
      batchResults.every((r) => r.status !== "partial" && r.status !== "failed")
    )
      onSuccess();
  }
  // ─── Retry failed ────────────────────────────────────────────────────────────

  async function handleRetryFailed() {
    setRetrying(true);
    setRetryOnly(true);
    try {
      await handleImport(failedIndices);
    } finally {
      setRetrying(false);
    }
  }

  // ─── Render helpers ──────────────────────────────────────────────────────────

  const activeCount = candidates.filter((c) => !c.excluded && c.duplicateAction !== "skip").length;
  const unresolved = candidates.filter(
    (c) => !c.excluded && c.duplicates.length > 0 && !c.duplicateAction,
  ).length;

  const successCount = results.filter((r) => r.status === "success").length;
  const partialCount = results.filter((r) => r.status === "partial").length;
  const failedCount = results.filter((r) => r.status === "failed").length;
  // "completedCount" for the headline includes fully successful imports only.
  // Partial imports are surfaced separately so the user understands the client
  // was created even when the case failed.
  const completedCount = successCount;
  const [retrying, setRetrying] = useState(false);
  const activeFolderCount = candidates.filter((c) => !c.excluded).length;
  const totalDocumentCount = candidates.reduce((s, c) => s + c.files.length, 0);
  const totalDuplicateCount = candidates.reduce((s, c) => s + c.duplicates.length, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <Card className="w-full max-w-5xl shadow-xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div className="min-w-0">
            <h3 className="text-base font-semibold">{ZIP_IMPORT_COPY.title}</h3>
            <p className="text-xs text-muted-foreground truncate">
              {step === "upload" && ZIP_IMPORT_COPY.uploadSubtitle}
              {step === "parsing" && "Analizando archivo…"}
              {step === "review" && formatZipReviewSelection(activeCount)}
              {step === "importing" && importProgress}
              {step === "done" && formatImportStatus(completedCount, partialCount, failedCount)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 grid place-items-center rounded-lg hover:bg-muted/60 ml-3 shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {/* ── Upload ── */}
          {step === "upload" && (
            <div className="space-y-4">
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => fileRef.current?.click()}
                className="flex flex-col items-center justify-center gap-3 h-44 rounded-xl border-2 border-dashed border-border hover:border-primary/50 hover:bg-primary/5 cursor-pointer transition select-none"
              >
                <Upload className="h-10 w-10 text-muted-foreground" />
                <div className="text-sm text-center">
                  <p className="font-medium">{ZIP_IMPORT_COPY.dropTitle}</p>
                  <p className="text-muted-foreground text-xs mt-0.5">
                    {ZIP_IMPORT_COPY.dropHintPrefix} <strong>.zip</strong>
                  </p>
                </div>
                <p className="text-[10px] text-muted-foreground">{ZIP_IMPORT_COPY.helper}</p>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".zip,application/zip,application/x-zip-compressed"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
              {parseError && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
                  <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700">{parseError}</p>
                </div>
              )}
              <div className="rounded-lg bg-muted/40 p-4 text-xs text-muted-foreground space-y-1.5">
                <p className="font-semibold text-foreground mb-1">
                  {ZIP_IMPORT_COPY.structureTitle}
                </p>
                <p className="font-mono">{ZIP_IMPORT_COPY.exampleLines[0]}</p>
                <p className="font-mono ml-4">{ZIP_IMPORT_COPY.exampleLines[1]}</p>
                <p className="font-mono ml-4">{ZIP_IMPORT_COPY.exampleLines[2]}</p>
                <p className="font-mono ml-4">{ZIP_IMPORT_COPY.exampleLines[3]}</p>
                <p className="font-mono ml-8">{ZIP_IMPORT_COPY.exampleLines[4]}</p>
                <p className="mt-2">{ZIP_IMPORT_COPY.multipleClientsWarning}</p>
              </div>
            </div>
          )}

          {/* ── Parsing ── */}
          {step === "parsing" && (
            <div className="flex flex-col items-center justify-center gap-4 py-12">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <p className="text-sm font-medium">Analizando archivo ZIP…</p>
              <div className="w-full max-w-md space-y-1 max-h-40 overflow-y-auto">
                {parseProgress.map((msg, i) => (
                  <p key={i} className="text-xs text-muted-foreground">
                    {msg}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* ── Review ── */}
          {step === "review" && (
            <div className="space-y-3">
              {unresolved > 0 && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                  <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-sm text-amber-800">{formatDuplicateWarning(unresolved)}</p>
                </div>
              )}
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {formatZipReviewStats({
                    folders: candidates.length,
                    activeFolders: activeFolderCount,
                    duplicates: totalDuplicateCount,
                  })}
                </span>
                <span>{formatCount(totalDocumentCount, "documento", "documentos")} en total</span>
              </div>
              <div className="space-y-2">
                {candidates.map((c, i) => (
                  <CandidateCard
                    key={c.folderPath}
                    candidate={c}
                    index={i}
                    onUpdate={updateCandidate}
                  />
                ))}
              </div>
            </div>
          )}

          {/* ── Importing ── */}
          {step === "importing" && (
            <div className="flex flex-col items-center justify-center gap-4 py-12">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <p className="text-sm font-medium">{importProgress}</p>
            </div>
          )}

          {/* ── Done ── */}
          {step === "done" && (
            <div className="space-y-4">
              <div className="flex flex-col items-center gap-3 py-4">
                <div
                  className={`grid h-14 w-14 place-items-center rounded-full ${failedCount === 0 && partialCount === 0 ? "bg-emerald-50 text-emerald-600" : completedCount > 0 || partialCount > 0 ? "bg-amber-50 text-amber-600" : "bg-red-50 text-red-600"}`}
                >
                  {failedCount === 0 || completedCount > 0 || partialCount > 0 ? (
                    <CheckCircle2 className="h-8 w-8" />
                  ) : (
                    <AlertCircle className="h-8 w-8" />
                  )}
                </div>
                <div className="text-center">
                  <p className="text-base font-bold">
                    {formatCount(
                      completedCount,
                      "cliente importado correctamente",
                      "clientes importados correctamente",
                    )}
                  </p>
                  {partialCount > 0 && (
                    <p className="text-sm text-amber-700 mt-0.5">
                      {formatCount(
                        partialCount,
                        "importación parcial — cliente creado, expediente pendiente",
                        "importaciones parciales — clientes creados, expedientes pendientes",
                      )}
                    </p>
                  )}
                  {failedCount > 0 && (
                    <p className="text-sm text-red-600 mt-0.5">
                      {formatCount(failedCount, "importación fallida", "importaciones fallidas")}
                    </p>
                  )}
                </div>
              </div>
              <div className="space-y-1.5">
                {results.map((r, i) => (
                  <ResultRow key={i} result={r} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 py-4 border-t border-border shrink-0">
          {step === "upload" && (
            <button
              onClick={onClose}
              className="flex-1 h-10 rounded-lg border border-border text-sm font-medium hover:bg-muted/60"
            >
              Cancelar
            </button>
          )}
          {step === "review" && (
            <>
              <button
                onClick={() => {
                  setStep("upload");
                  setParseProgress([]);
                  setCandidates([]);
                }}
                className="h-10 px-4 rounded-lg border border-border text-sm font-medium hover:bg-muted/60"
              >
                {ZIP_IMPORT_COPY.backButton}
              </button>
              <button
                onClick={() => handleImport()}
                disabled={activeCount === 0 || unresolved > 0}
                className="flex-1 h-10 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 disabled:opacity-60 flex items-center justify-center gap-2"
              >
                <Users className="h-4 w-4" />
                {ZIP_IMPORT_COPY.confirmButton}
              </button>
            </>
          )}
          {step === "done" && (
            <>
              {(failedCount > 0 || partialCount > 0) && (
                <button
                  onClick={handleRetryFailed}
                  disabled={retrying}
                  className="flex items-center gap-2 h-10 px-4 rounded-lg border border-border text-sm font-medium hover:bg-muted/60 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <RefreshCw className={`h-4 w-4 ${retrying ? "animate-spin" : ""}`} />
                  {retrying ? "Reintentando…" : "Reintentar fallidas"}
                </button>
              )}
              <button
                onClick={onClose}
                disabled={retrying}
                className="flex-1 h-10 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 disabled:opacity-60"
              >
                Cerrar
              </button>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
