/**
 * zip-import-result.tsx
 * Etapa 8: Resultado final de la importación con opción de descarga de informe.
 */

import { CheckCircle2, AlertTriangle, Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ImportJobResult } from "@/lib/zip-import/types";

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

interface Props {
  result: ImportJobResult;
  onClose: () => void;
}

export function ZipImportResult({ result, onClose }: Props) {
  const hasErrors = result.errors.length > 0 || result.documentsWithErrors > 0;
  const isSuccess = result.documentsUploaded > 0 && !hasErrors;

  function downloadReport() {
    const report = {
      generatedAt: new Date().toISOString(),
      importJobId: result.importJobId,
      summary: {
        clientsCreated: result.clientsCreated,
        clientsLinked: result.clientsLinked,
        clientsSkipped: result.clientsSkipped,
        documentsUploaded: result.documentsUploaded,
        documentsSkipped: result.documentsSkipped,
        documentsWithErrors: result.documentsWithErrors,
        durationSeconds: result.durationSeconds,
      },
      errors: result.errors,
      warnings: result.warnings,
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `import-report-${result.importJobId.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      {/* Estado general */}
      <div
        className={[
          "flex items-start gap-3 rounded-xl p-4 border",
          isSuccess
            ? "bg-emerald-50 border-emerald-200"
            : hasErrors
              ? "bg-amber-50 border-amber-200"
              : "bg-muted/30 border-border",
        ].join(" ")}
      >
        {isSuccess ? (
          <CheckCircle2 className="h-6 w-6 text-emerald-600 shrink-0" />
        ) : (
          <AlertTriangle className="h-6 w-6 text-amber-600 shrink-0" />
        )}
        <div>
          <p
            className={["font-semibold", isSuccess ? "text-emerald-800" : "text-amber-800"].join(
              " ",
            )}
          >
            {isSuccess
              ? "Importación completada exitosamente"
              : hasErrors
                ? "Importación completada con errores"
                : "Importación finalizada"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            ID del trabajo: <code className="font-mono">{result.importJobId}</code>
            {" · "}
            {formatDuration(result.durationSeconds)}
          </p>
        </div>
      </div>

      {/* Estadísticas */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <ResultStat label="Clientes creados" value={result.clientsCreated} />
        <ResultStat label="Clientes vinculados" value={result.clientsLinked} />
        <ResultStat label="Clientes omitidos" value={result.clientsSkipped} />
        <ResultStat
          label="Documentos subidos"
          value={result.documentsUploaded}
          highlight="success"
        />
        <ResultStat label="Documentos omitidos" value={result.documentsSkipped} />
        <ResultStat
          label="Errores"
          value={result.errors.length}
          highlight={hasErrors ? "error" : undefined}
        />
      </div>

      {/* Advertencias */}
      {result.warnings.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Advertencias
          </p>
          {result.warnings.slice(0, 10).map((w, i) => (
            <div
              key={i}
              className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-1.5"
            >
              {w}
            </div>
          ))}
          {result.warnings.length > 10 && (
            <p className="text-xs text-muted-foreground">
              y {result.warnings.length - 10} advertencia(s) más. Descarga el informe para el
              detalle completo.
            </p>
          )}
        </div>
      )}

      {/* Errores */}
      {result.errors.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-red-600 uppercase tracking-wide">Errores</p>
          <div className="max-h-36 overflow-y-auto rounded-lg border border-red-200 bg-red-50 p-3 space-y-1.5">
            {result.errors.slice(0, 20).map((e, i) => (
              <div key={i} className="text-xs text-red-700">
                <span className="font-medium">{e.client}</span>
                {e.file && <span className="text-red-400"> / {e.file}</span>}
                <span className="text-red-600">: {e.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-between gap-2 pt-1">
        <Button variant="outline" onClick={downloadReport}>
          <Download className="h-4 w-4 mr-1" />
          Descargar informe JSON
        </Button>
        <Button onClick={onClose}>
          <X className="h-4 w-4 mr-1" />
          Cerrar
        </Button>
      </div>
    </div>
  );
}

function ResultStat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: "success" | "error";
}) {
  return (
    <div
      className={[
        "rounded-xl border p-4 text-center",
        highlight === "success"
          ? "border-emerald-200 bg-emerald-50"
          : highlight === "error" && value > 0
            ? "border-red-200 bg-red-50"
            : "border-border bg-muted/20",
      ].join(" ")}
    >
      <p
        className={[
          "text-2xl font-bold",
          highlight === "success"
            ? "text-emerald-700"
            : highlight === "error" && value > 0
              ? "text-red-700"
              : "",
        ].join(" ")}
      >
        {value}
      </p>
      <p className="text-xs text-muted-foreground mt-1">{label}</p>
    </div>
  );
}
