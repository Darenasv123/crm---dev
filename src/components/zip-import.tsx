/**
 * zip-import.tsx
 * Componente de importaciÃ³n de carpetas de clientes desde ZIP (Google Drive).
 */
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
  Merge,
  SkipForward,
  UserPlus,
  RefreshCw,
} from "lucide-react";
import { Card } from "@/components/app-layout";
import { getAuthClient, supabase } from "@/lib/supabase";
import {
  parseZipFile,
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

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface Props {
  onClose: () => void;
  onSuccess: () => void;
}

type ImportStep = "upload" | "parsing" | "review" | "importing" | "done";

interface FolderImportResult {
  folderName: string;
  status: "success" | "partial" | "failed" | "skipped";
  clientId?: string;
  error?: string;
  documentsImported: number;
  documentsSkipped?: number;
  errors?: string[];
  compensations?: string[];
}

// â”€â”€â”€ Constants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
  skip: "Omitir esta carpeta",
};

const DUPLICATE_ICONS: Record<DuplicateAction, typeof UserPlus> = {
  create_new: UserPlus,
  update_existing: Pencil,
  attach_docs: FileText,
  skip: SkipForward,
};

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function buildInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  return words.length >= 2
    ? (words[0][0] + words[1][0]).toUpperCase()
    : (words[0] ?? "??").slice(0, 2).toUpperCase();
}

function randomColor(): string {
  return COLORS[Math.floor(Math.random() * COLORS.length)];
}

// â”€â”€â”€ Sub-components â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function ExtractionBadge({ status }: { status: ZipFileEntry["extractionStatus"] }) {
  const map = {
    extracted: {
      cls: "bg-emerald-50 text-emerald-700 border-emerald-200",
      label: "Texto extraÃ­do",
    },
    ocr_required: {
      cls: "bg-amber-50 text-amber-700 border-amber-200",
      label: "Pendiente de extracciÃ³n OCR",
    },
    binary: { cls: "bg-slate-50 text-slate-600 border-slate-200", label: "Imagen/binario" },
    empty: { cls: "bg-red-50 text-red-600 border-red-200", label: "VacÃ­o" },
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
        âš  Se encontraron posibles clientes existentes:
      </p>
      {matches.slice(0, 3).map((m) => (
        <div
          key={m.clientId}
          className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs"
        >
          <span className="font-medium">{m.clientName}</span>
          <span className="ml-2 text-amber-600">â€” {m.matchReason}</span>
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
          <option value="">â€” Selecciona el cliente existente â€”</option>
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

// â”€â”€â”€ CandidateCard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function CandidateCard({
  candidate,
  index,
  onUpdate,
}: {
  candidate: ReviewCandidate;
  index: number;
  onUpdate: (idx: number, partial: Partial<ReviewCandidate>) => void;
}) {
  const [expanded, setExpanded] = useState(false);
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
          title: "Expediente pendiente de clasificacion",
          caseNumber: null,
          processType: "Pendiente de clasificacion",
          juzgado: "Por determinar",
          status: "Consulta",
          origin: "importacion_zip",
          originPath: candidate.folderPath,
          confidence: 0.3,
          warnings: ["Creado manualmente durante la revision."],
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
    const nextMap = { ...documentCaseMap, [path]: caseId };
    const nextCases = caseCandidates.map((caseCandidate) => {
      const without = caseCandidate.documentPaths.filter((docPath) => docPath !== path);
      return caseCandidate.id === caseId && caseId !== "__unclassified"
        ? { ...caseCandidate, documentPaths: [...without, path] }
        : { ...caseCandidate, documentPaths: without };
    });
    onUpdate(index, { documentCaseMap: nextMap, caseCandidates: nextCases });
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
    <div className={`rounded-xl border ${candidate.excluded ? "border-muted opacity-50" : "border-border"} bg-card`}>
      <div className="flex items-center gap-3 px-4 py-3">
        <button type="button" onClick={() => setExpanded((v) => !v)} className="shrink-0">
          {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
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
              <button type="button" onClick={() => setEditingName(true)} className="shrink-0 text-muted-foreground hover:text-foreground">
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
            {candidate.excluded ? <><Eye className="mr-0.5 inline h-3 w-3" />Incluir</> : <><EyeOff className="mr-0.5 inline h-3 w-3" />Excluir</>}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="space-y-4 border-t border-border px-4 pb-4 pt-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: "DNI", field: "dni" as const, value: eff.dni ?? d.dni },
              { label: "Telefono", field: "phone" as const, value: eff.phone ?? d.phone },
              { label: "Correo", field: "email" as const, value: eff.email ?? d.email },
              { label: "Juzgado", field: "juzgado" as const, value: eff.juzgado ?? d.juzgado },
            ].map(({ label, field, value }) => (
              <div key={field} className="rounded-lg bg-muted/30 p-2">
                <dt className="text-[9px] font-semibold uppercase text-muted-foreground">{label}</dt>
                <input
                  className="mt-0.5 w-full bg-transparent text-xs font-medium placeholder:text-muted-foreground/50 focus:outline-none"
                  value={value ?? ""}
                  placeholder="No detectado"
                  onChange={(e) => onUpdate(index, { edits: { ...eff, [field]: e.target.value || undefined } })}
                />
              </div>
            ))}
          </div>

          {(candidate.evidence?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {candidate.evidence?.map((item) => (
                <span key={item} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">{item}</span>
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
              <p className="mb-1.5 text-[10px] font-semibold uppercase text-muted-foreground">Subcarpetas</p>
              <div className="flex flex-wrap gap-1.5">
                {subfolders.map((folderPath) => (
                  <button
                    key={folderPath}
                    type="button"
                    onClick={() => toggleFolder(folderPath)}
                    className={`rounded-full border px-2 py-1 text-[10px] ${excludedFolders.has(folderPath) ? "border-red-200 bg-red-50 text-red-600" : "border-border bg-background text-muted-foreground"}`}
                  >
                    {excludedFolders.has(folderPath) ? "Omitida" : "Activa"} · {folderPath.split("/").pop()}
                  </button>
                ))}
              </div>
            </div>
          )}

          {candidate.warnings.length > 0 && (
            <div className="space-y-1">
              {candidate.warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5">
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
              <p className="text-[10px] font-semibold uppercase text-muted-foreground">Expedientes del cliente</p>
              <button type="button" onClick={addCase} className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border px-2 text-[10px] font-medium hover:bg-muted/60">
                <UserPlus className="h-3.5 w-3.5" /> Crear expediente
              </button>
            </div>
            {caseCandidates.map((caseCandidate) => {
              const files = candidate.files.filter((file) => documentCaseMap[file.zipPath] === caseCandidate.id);
              return (
                <div key={caseCandidate.id} className="rounded-lg border border-border bg-background p-3">
                  <div className="grid gap-2 sm:grid-cols-4">
                    <input className="h-8 rounded border border-border bg-card px-2 text-xs" value={caseCandidate.title} onChange={(e) => patchCase(caseCandidate.id, { title: e.target.value })} />
                    <input className="h-8 rounded border border-border bg-card px-2 text-xs font-mono" value={caseCandidate.caseNumber ?? ""} placeholder="Expediente" onChange={(e) => patchCase(caseCandidate.id, { caseNumber: e.target.value || null, isProvisional: !e.target.value })} />
                    <input className="h-8 rounded border border-border bg-card px-2 text-xs" value={caseCandidate.processType} onChange={(e) => patchCase(caseCandidate.id, { processType: e.target.value || "Pendiente de clasificacion" })} />
                    <select className="h-8 rounded border border-border bg-card px-2 text-xs" value={caseCandidate.status} onChange={(e) => patchCase(caseCandidate.id, { status: e.target.value })}>
                      {['Consulta','Documentacion','Demanda presentada','En proceso','Audiencia','Sentencia','Archivado'].map((status) => <option key={status}>{status}</option>)}
                    </select>
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    <input className="h-8 rounded border border-border bg-card px-2 text-xs" value={caseCandidate.juzgado} placeholder="Juzgado" onChange={(e) => patchCase(caseCandidate.id, { juzgado: e.target.value })} />
                    <input className="h-8 rounded border border-border bg-card px-2 text-xs" value={caseCandidate.demandante ?? ""} placeholder="Demandante" onChange={(e) => patchCase(caseCandidate.id, { demandante: e.target.value || undefined })} />
                    <input className="h-8 rounded border border-border bg-card px-2 text-xs" value={caseCandidate.demandado ?? ""} placeholder="Demandado" onChange={(e) => patchCase(caseCandidate.id, { demandado: e.target.value || undefined })} />
                  </div>
                  {caseCandidate.warnings.length > 0 && <p className="mt-2 text-[10px] text-amber-700">{caseCandidate.warnings.join(" ")}</p>}
                  <p className="mt-2 text-[10px] text-muted-foreground">{files.length} documento(s) asignado(s)</p>
                </div>
              );
            })}
          </div>

          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase text-muted-foreground">Documentos ({candidate.files.length})</p>
            <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
              {candidate.files.map((f) => (
                <div key={f.zipPath} className={`grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition ${candidate.excludedFiles.has(f.zipPath) ? "border-muted bg-muted/20 opacity-50" : "border-border bg-background"}`}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate font-medium">{f.name}</span>
                    </div>
                    <p className="truncate pl-5 text-[10px] text-muted-foreground">{f.zipPath}</p>
                  </div>
                  <select className="h-7 w-44 rounded border border-border bg-card px-2 text-[10px]" value={documentCaseMap[f.zipPath] ?? "__unclassified"} onChange={(e) => moveFile(f.zipPath, e.target.value)}>
                    <option value="__unclassified">Sin clasificar</option>
                    {caseCandidates.map((caseCandidate) => <option key={caseCandidate.id} value={caseCandidate.id}>{caseCandidate.caseNumber ?? caseCandidate.title}</option>)}
                  </select>
                  <span className="text-muted-foreground">{formatSize(f.size)}</span>
                  <div className="flex items-center gap-1.5">
                    <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium text-slate-600">{f.docType}</span>
                    <ExtractionBadge status={f.extractionStatus} />
                    <button type="button" onClick={() => toggleFile(f.zipPath)} className="text-muted-foreground hover:text-foreground">
                      {candidate.excludedFiles.has(f.zipPath) ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
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
// â”€â”€â”€ Main Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

  // â”€â”€â”€ ZIP parsing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
      const result = await parseZipFile(buffer, addProgress);

      if (result.candidates.length === 0) {
        setParseError("El ZIP no contiene carpetas de clientes reconocibles.");
        setStep("upload");
        return;
      }

      // Cargar clientes existentes para detectar duplicados
      addProgress("Verificando duplicados en la base de datosâ€¦");
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

  // â”€â”€â”€ Candidate updates â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  function updateCandidate(idx: number, partial: Partial<ReviewCandidate>) {
    setCandidates((prev) => prev.map((c, i) => (i === idx ? { ...c, ...partial } : c)));
  }

  // â”€â”€â”€ Import final â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async function handleImport(indicesToImport?: number[]) {
    const toImport = candidates.filter((c, i) => {
      if (c.excluded) return false;
      if (c.duplicateAction === "skip") return false;
      if (indicesToImport && !indicesToImport.includes(i)) return false;
      if (c.duplicates.length > 0 && !c.duplicateAction) return false;
      return true;
    });

    if (toImport.length === 0) {
      setParseError("No hay carpetas seleccionadas para importar. Asigna una accion a cada duplicado.");
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
      });

      const existing = batchResults.find((r) => r.folderName === candidate.folderName);
      const nextResult: FolderImportResult = {
        folderName: result.folderName,
        status: result.status,
        clientId: result.clientId,
        error: result.error,
        documentsImported: result.documentsImported,
        documentsSkipped: result.documentsSkipped,
        errors: result.errors,
        compensations: result.compensations,
      };
      if (existing) Object.assign(existing, nextResult);
      else batchResults.push(nextResult);

      if (result.status === "failed" || result.status === "partial") newFailed.push(globalIdx);
    }

    setResults(batchResults);
    setFailedIndices(newFailed);
    setRetryOnly(false);
    setStep("done");
    if (batchResults.some((r) => r.status === "success" || r.status === "partial")) onSuccess();
  }
  // â”€â”€â”€ Retry failed â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async function handleRetryFailed() {
    setRetryOnly(true);
    await handleImport(failedIndices);
  }

  // â”€â”€â”€ Render helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const activeCount = candidates.filter((c) => !c.excluded && c.duplicateAction !== "skip").length;
  const unresolved = candidates.filter(
    (c) => !c.excluded && c.duplicates.length > 0 && !c.duplicateAction,
  ).length;

  const successCount = results.filter((r) => r.status === "success").length;
  const partialCount = results.filter((r) => r.status === "partial").length;
  const failedCount = results.filter((r) => r.status === "failed").length;
  const completedCount = successCount + partialCount;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <Card className="w-full max-w-5xl shadow-xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div className="min-w-0">
            <h3 className="text-base font-semibold">Importar desde Google Drive / ZIP</h3>
            <p className="text-xs text-muted-foreground truncate">
              {step === "upload" && "Sube un archivo .zip descargado desde Google Drive"}
              {step === "parsing" && "Analizando archivoâ€¦"}
              {step === "review" &&
                `${candidates.length} carpeta(s) detectada(s) Â· ${activeCount} seleccionada(s)`}
              {step === "importing" && importProgress}
              {step === "done" && `${completedCount} importada(s) Â· ${partialCount} parcial(es) Â· ${failedCount} fallida(s)`}
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
          {/* â”€â”€ Upload â”€â”€ */}
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
                  <p className="font-medium">Arrastra el ZIP aquÃ­</p>
                  <p className="text-muted-foreground text-xs mt-0.5">
                    o haz clic para seleccionar Â· <strong>.zip</strong>
                  </p>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Descarga las carpetas desde Google Drive â†’ clic derecho â†’ "Descargar"
                </p>
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
                <p className="font-semibold text-foreground mb-1">Estructura esperada del ZIP:</p>
                <p className="font-mono">YLLA NEGRON YENI/</p>
                <p className="font-mono ml-4">DEMANDA DE EJECUCIÃ“N.docx</p>
                <p className="font-mono ml-4">CARGO-YLLA NEGRON.pdf</p>
                <p className="font-mono">GARCIA TORRES MANUEL/</p>
                <p className="font-mono ml-4">SENTENCIA.pdf</p>
                <p className="mt-2">Cada carpeta de primer nivel se trata como un cliente.</p>
              </div>
            </div>
          )}

          {/* â”€â”€ Parsing â”€â”€ */}
          {step === "parsing" && (
            <div className="flex flex-col items-center justify-center gap-4 py-12">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <p className="text-sm font-medium">Analizando archivo ZIPâ€¦</p>
              <div className="w-full max-w-md space-y-1 max-h-40 overflow-y-auto">
                {parseProgress.map((msg, i) => (
                  <p key={i} className="text-xs text-muted-foreground">
                    {msg}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* â”€â”€ Review â”€â”€ */}
          {step === "review" && (
            <div className="space-y-3">
              {unresolved > 0 && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                  <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-sm text-amber-800">
                    {unresolved} carpeta(s) tienen posibles duplicados. Asigna una acciÃ³n antes de
                    importar.
                  </p>
                </div>
              )}
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {candidates.length} carpetas Â· {candidates.filter((c) => !c.excluded).length}{" "}
                  activas
                </span>
                <span>{candidates.reduce((s, c) => s + c.files.length, 0)} documentos totales</span>
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

          {/* â”€â”€ Importing â”€â”€ */}
          {step === "importing" && (
            <div className="flex flex-col items-center justify-center gap-4 py-12">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <p className="text-sm font-medium">{importProgress}</p>
            </div>
          )}

          {/* â”€â”€ Done â”€â”€ */}
          {step === "done" && (
            <div className="space-y-4">
              <div className="flex flex-col items-center gap-3 py-4">
                <div
                  className={`grid h-14 w-14 place-items-center rounded-full ${failedCount === 0 && partialCount === 0 ? "bg-emerald-50 text-emerald-600" : completedCount > 0 ? "bg-amber-50 text-amber-600" : "bg-red-50 text-red-600"}`}
                >
                  {failedCount === 0 || completedCount > 0 ? (
                    <CheckCircle2 className="h-8 w-8" />
                  ) : (
                    <AlertCircle className="h-8 w-8" />
                  )}
                </div>
                <div className="text-center">
                  <p className="text-base font-bold">{completedCount} carpeta(s) importada(s)</p>
                  {failedCount > 0 && (
                    <p className="text-sm text-muted-foreground mt-0.5">{failedCount} fallida(s)</p>
                  )}
                </div>
              </div>
              <div className="space-y-1.5">
                {results.map((r, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${r.status === "success" ? "border-emerald-200 bg-emerald-50" : r.status === "partial" ? "border-amber-200 bg-amber-50" : r.status === "failed" ? "border-red-200 bg-red-50" : "border-muted bg-muted/20"}`}
                  >
                    {r.status === "success" && (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                    )}
                    {r.status === "failed" && (
                      <AlertCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
                    )}
                    {r.status === "skipped" && (
                      <SkipForward className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    )}
                    <span className="flex-1 font-medium truncate">{r.folderName}</span>
                    {r.status === "success" && (
                      <span className="text-emerald-700">{r.documentsImported} doc.</span>
                    )}
                    {r.status === "failed" && r.error && (
                      <span className="text-red-600 truncate max-w-[200px]">{r.error}</span>
                    )}
                  </div>
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
                â† AtrÃ¡s
              </button>
              <button
                onClick={() => handleImport()}
                disabled={activeCount === 0 || unresolved > 0}
                className="flex-1 h-10 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 disabled:opacity-60 flex items-center justify-center gap-2"
              >
                <Users className="h-4 w-4" />
                Importar {activeCount} carpeta{activeCount !== 1 ? "s" : ""}
              </button>
            </>
          )}
          {step === "done" && (
            <>
              {failedCount > 0 && (
                <button
                  onClick={handleRetryFailed}
                  className="flex items-center gap-2 h-10 px-4 rounded-lg border border-border text-sm font-medium hover:bg-muted/60"
                >
                  <RefreshCw className="h-4 w-4" /> Reintentar fallidas
                </button>
              )}
              <button
                onClick={onClose}
                className="flex-1 h-10 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110"
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









