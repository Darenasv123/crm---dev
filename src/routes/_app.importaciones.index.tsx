import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  CloudDownload,
  FileSearch,
  FolderSearch,
  Loader2,
  Play,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { AppLayout, Card, StatusBadge } from "@/components/app-layout";
import {
  DEMO_NOTICE,
  demoClient,
  demoCase,
  demoDriveFiles,
  demoDriveFolders,
} from "@/lib/legal/demo-data";
import { MockDriveProvider } from "@/lib/imports/mock-drive-provider";

export const Route = createFileRoute("/_app/importaciones/")({
  head: () => ({ meta: [{ title: "Importaciones — CRM Jurídico" }] }),
  component: ImportsPage,
});

const STEPS = [
  "Conectar fuente",
  "Seleccionar carpeta",
  "Inventariar documentos",
  "Procesar documentos",
  "Analizar carpetas",
  "Revisar resultados",
  "Confirmar importación",
] as const;

const progressByStep = [0, 8, 24, 52, 76, 92, 100];
const statusLabel: Record<string, string> = {
  pending: "Pendiente",
  analysis_completed: "Analizado",
  ocr_required: "Documento escaneado",
  failed: "Con error",
  review_required: "Pendiente de revisión",
};

function ImportsPage() {
  const [step, setStep] = useState(0);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const provider = useMemo(() => new MockDriveProvider(), []);
  const progress = progressByStep[step];

  async function advance() {
    setRunning(true);
    setMessage(null);
    try {
      if (step === 0) await provider.listFolders("demo-root");
      if (step === 1) await provider.listFiles("folder-case");
      setStep((current) => Math.min(STEPS.length - 1, current + 1));
      setMessage(
        step >= STEPS.length - 2
          ? "Resultados demostrativos listos para revisión."
          : "Etapa demostrativa completada.",
      );
    } finally {
      setRunning(false);
    }
  }

  function reset() {
    setStep(0);
    setMessage(null);
  }

  return (
    <AppLayout
      title="Importar expedientes desde Google Drive"
      subtitle="Flujo preparatorio con fuente y documentos de demostración"
      actions={
        <button
          type="button"
          onClick={reset}
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium hover:bg-muted/50"
        >
          <RotateCcw className="h-4 w-4" /> Reiniciar
        </button>
      }
    >
      <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <div className="font-semibold">Entorno de demostración</div>
          <p className="mt-0.5 text-xs leading-5">
            {DEMO_NOTICE} No se solicitan credenciales ni se modifica Google Drive.
          </p>
        </div>
      </div>

      <Card className="p-4">
        <div className="overflow-x-auto">
          <ol className="flex min-w-[920px] items-center gap-2">
            {STEPS.map((label, index) => (
              <li key={label} className="flex min-w-0 flex-1 items-center gap-2">
                <div
                  className={`flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border px-3 ${index === step ? "border-primary bg-primary/5 text-primary" : index < step ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-border text-muted-foreground"}`}
                >
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[10px] font-bold">
                    {index < step ? <CheckCircle2 className="h-3.5 w-3.5" /> : index + 1}
                  </span>
                  <span className="truncate text-xs font-semibold">{label}</span>
                </div>
                {index < STEPS.length - 1 && (
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
              </li>
            ))}
          </ol>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>{STEPS[step]}</span>
          <span>{progress}%</span>
        </div>
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
        <div className="space-y-4">
          <Card className="p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                  <CloudDownload className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold">Carpeta seleccionada</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    /Clientes/{demoClient.name}/{demoCase.caseNumber}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={advance}
                disabled={running || step === STEPS.length - 1}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
                {running ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                {step === 0
                  ? "Iniciar simulación"
                  : step === STEPS.length - 1
                    ? "Simulación completa"
                    : "Completar etapa"}
              </button>
            </div>
            {message && (
              <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                {message}
              </p>
            )}
          </Card>

          <Card className="overflow-hidden">
            <div className="border-b border-border px-5 py-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <FileSearch className="h-4 w-4 text-primary" /> Inventario de documentos
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-[840px] w-full text-sm">
                <thead>
                  <tr className="bg-muted/30 text-left text-xs uppercase text-muted-foreground">
                    <th className="px-4 py-3">Nombre</th>
                    <th className="px-4 py-3">Carpeta</th>
                    <th className="px-4 py-3">Tipo</th>
                    <th className="px-4 py-3">Estado</th>
                    <th className="px-4 py-3">Progreso</th>
                    <th className="px-4 py-3">Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {demoDriveFiles.map((file) => (
                    <tr key={file.id} className="border-t border-border">
                      <td className="px-4 py-3 font-medium">{file.name}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        01234-2025 Alimentos
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">PDF</td>
                      <td className="px-4 py-3">
                        <StatusBadge
                          tone={
                            file.status === "failed"
                              ? "danger"
                              : file.status === "analysis_completed"
                                ? "success"
                                : file.status === "review_required" ||
                                    file.status === "ocr_required"
                                  ? "warning"
                                  : "default"
                          }
                        >
                          {statusLabel[file.status]}
                        </StatusBadge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full bg-primary"
                              style={{ width: `${file.progress}%` }}
                            />
                          </div>
                          <span className="text-xs text-muted-foreground">{file.progress}%</span>
                        </div>
                      </td>
                      <td className="max-w-[220px] px-4 py-3 text-xs text-muted-foreground">
                        {file.error || "Sin observaciones"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-5">
            <h2 className="text-sm font-semibold">Estado general</h2>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Metric label="Carpetas" value={demoDriveFolders.length} icon={FolderSearch} />
              <Metric label="Documentos" value={demoDriveFiles.length} icon={FileSearch} />
              <Metric
                label="Procesados"
                value={demoDriveFiles.filter((item) => item.progress === 100).length}
                icon={CheckCircle2}
              />
              <Metric
                label="Con error"
                value={demoDriveFiles.filter((item) => item.status === "failed").length}
                icon={AlertCircle}
              />
            </div>
          </Card>
          <Card className="p-5">
            <h2 className="text-sm font-semibold">Coincidencias probables</h2>
            <dl className="mt-4 space-y-3">
              <DataRow label="Cliente" value={demoClient.name} />
              <DataRow label="DNI" value={demoClient.documentNumber} />
              <DataRow label="Expediente" value={demoCase.caseNumber} />
              <DataRow label="Materia" value={demoCase.caseType} />
            </dl>
            <p className="mt-4 text-xs leading-5 text-muted-foreground">
              Estas coincidencias no se incorporan al CRM hasta ser revisadas y confirmadas por una
              persona.
            </p>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}

function Metric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: typeof FolderSearch;
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <Icon className="h-4 w-4 text-primary" />
      <div className="mt-2 text-xl font-bold">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}
function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/30 p-3">
      <dt className="text-[10px] font-semibold uppercase text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm font-medium">{value}</dd>
    </div>
  );
}
