/**
 * zip-dry-run-panel.tsx
 * Etapa 5: Muestra el resultado del dry-run sin haber creado nada.
 */

import { CheckCircle2, AlertTriangle, FileText, Users, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DryRunResult } from "@/lib/zip-import/types";

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface Props {
  dryRunResult: DryRunResult;
  onConfirm: () => void;
  onBack: () => void;
  onCancel: () => void;
}

export function ZipDryRunPanel({ dryRunResult, onConfirm, onBack, onCancel }: Props) {
  return (
    <div className="space-y-4">
      {/* Encabezado de simulación */}
      <div className="flex items-center gap-3 rounded-xl bg-emerald-50 border border-emerald-200 p-4">
        <CheckCircle2 className="h-6 w-6 text-emerald-600 shrink-0" />
        <div>
          <p className="font-semibold text-emerald-800">Simulación completada</p>
          <p className="text-xs text-emerald-700 mt-0.5">
            No se ha creado ni modificado ningún dato. Este es el resultado esperado si confirmas.
          </p>
        </div>
      </div>

      {/* Estadísticas */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard
          icon={<Users className="h-5 w-5" />}
          label="Clientes a crear"
          value={dryRunResult.clientsToCreate}
          color="emerald"
        />
        <StatCard
          icon={<Users className="h-5 w-5" />}
          label="Clientes a vincular"
          value={dryRunResult.clientsToLink}
          color="blue"
        />
        <StatCard
          icon={<SkipForward className="h-5 w-5" />}
          label="Clientes omitidos"
          value={dryRunResult.clientsToSkip}
          color="neutral"
        />
        <StatCard
          icon={<FileText className="h-5 w-5" />}
          label="Archivos a subir"
          value={dryRunResult.filesToUpload}
          color="emerald"
        />
        <StatCard
          icon={<FileText className="h-5 w-5" />}
          label="Archivos omitidos"
          value={dryRunResult.filesToSkip}
          color="neutral"
        />
        <StatCard
          icon={<FileText className="h-5 w-5" />}
          label="Tamaño total"
          value={formatSize(dryRunResult.totalSize)}
          color="neutral"
          isText
        />
      </div>

      {/* Advertencias */}
      {dryRunResult.warnings.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Advertencias
          </p>
          {dryRunResult.warnings.map((w, i) => (
            <div
              key={i}
              className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700"
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              {w}
            </div>
          ))}
        </div>
      )}

      {/* Detalle por cliente */}
      {dryRunResult.clientResults.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground select-none py-1">
            Ver detalle por cliente ({dryRunResult.clientResults.length})
          </summary>
          <div className="mt-2 rounded-xl border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/50 text-left text-muted-foreground">
                  <th className="py-2 pl-4 pr-3 font-semibold">Cliente</th>
                  <th className="py-2 px-3 font-semibold">Acción</th>
                  <th className="py-2 px-3 font-semibold">Docs a subir</th>
                  <th className="py-2 pr-4 font-semibold">Omitidos</th>
                </tr>
              </thead>
              <tbody>
                {dryRunResult.clientResults.map((cr, i) => (
                  <tr key={i} className="border-t border-border hover:bg-muted/20">
                    <td className="py-2 pl-4 pr-3 font-medium truncate max-w-[200px]">
                      {cr.originalName}
                    </td>
                    <td className="py-2 px-3 text-muted-foreground capitalize">{cr.action}</td>
                    <td className="py-2 px-3">{cr.documentsToUpload.length}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{cr.documentsSkipped}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
        <Button variant="outline" onClick={onBack}>
          Atrás
        </Button>
        <Button onClick={onConfirm}>Continuar a confirmación</Button>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  color,
  isText,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  color: "emerald" | "blue" | "neutral";
  isText?: boolean;
}) {
  const colorMap = {
    emerald: "bg-emerald-50 border-emerald-200 text-emerald-700",
    blue: "bg-blue-50 border-blue-200 text-blue-700",
    neutral: "bg-muted/30 border-border text-foreground",
  };
  return (
    <div className={`flex items-center gap-3 rounded-xl border p-4 ${colorMap[color]}`}>
      <div className="shrink-0 opacity-70">{icon}</div>
      <div>
        <p className={`font-bold ${isText ? "text-base" : "text-xl"}`}>{value}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
      </div>
    </div>
  );
}
