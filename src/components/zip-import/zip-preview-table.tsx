/**
 * zip-preview-table.tsx
 * Etapa 4: Tabla de vista previa con controles por cliente.
 */

import { Fragment, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  SkipForward,
  Link2,
  Plus,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import type {
  ZipAnalysisSummary,
  ClientPreviewItem,
  ClientImportAction,
} from "@/lib/zip-import/types";

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function ActionIcon({ action }: { action: ClientImportAction }) {
  if (action === "create") return <Plus className="h-4 w-4 text-emerald-600" />;
  if (action === "link") return <Link2 className="h-4 w-4 text-blue-600" />;
  if (action === "skip") return <SkipForward className="h-4 w-4 text-muted-foreground" />;
  return <HelpCircle className="h-4 w-4 text-amber-500" />;
}

function ActionLabel({ action }: { action: ClientImportAction }) {
  const labels: Record<ClientImportAction, string> = {
    create: "Crear nuevo",
    link: "Vincular existente",
    skip: "Omitir",
    review: "Requiere revisión",
  };
  return <span>{labels[action]}</span>;
}

interface Props {
  summary: ZipAnalysisSummary;
  existingClients: Array<{ id: string; name: string }>;
  onUpdateAction: (index: number, updates: Partial<ClientPreviewItem>) => void;
  onRunDryRun: (clients: ClientPreviewItem[]) => void;
  onCancel: () => void;
}

export function ZipPreviewTable({
  summary,
  existingClients,
  onUpdateAction,
  onRunDryRun,
  onCancel,
}: Props) {
  const [expandedWarnings, setExpandedWarnings] = useState<Set<number>>(new Set());

  const toggleWarnings = (index: number) => {
    setExpandedWarnings((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const pendingReview = summary.clients.filter((c) => c.action === "review").length;
  const activeClients = summary.clients.filter((c) => c.action !== "skip");
  const canContinue = pendingReview === 0 && activeClients.length > 0;
  const totalDocs = activeClients.reduce((s, c) => s + c.allowedFileCount, 0);

  return (
    <div className="space-y-4">
      {/* Resumen global */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Clientes detectados" value={summary.clients.length} />
        <StatCard label="Documentos" value={totalDocs} />
        <StatCard label="Entradas ignoradas" value={summary.ignoredCount} />
        <StatCard label="Pendientes revisión" value={pendingReview} highlight={pendingReview > 0} />
      </div>

      {/* Advertencias globales */}
      {summary.warnings.length > 0 && (
        <div className="space-y-1">
          {summary.warnings.map((w, i) => (
            <div
              key={i}
              className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700"
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              {w}
            </div>
          ))}
        </div>
      )}

      {/* Tabla */}
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="min-w-[720px] w-full text-sm">
          <thead>
            <tr className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground text-left">
              <th className="py-3 pl-4 pr-3 font-semibold">Cliente detectado</th>
              <th className="py-3 px-3 font-semibold">Docs</th>
              <th className="py-3 px-3 font-semibold">Tamaño</th>
              <th className="py-3 px-3 font-semibold">Coincidencia DB</th>
              <th className="py-3 px-3 font-semibold w-48">Acción</th>
              <th className="py-3 pr-4 font-semibold sr-only">Info</th>
            </tr>
          </thead>
          <tbody>
            {summary.clients.map((client) => (
              <Fragment key={client.index}>
                <tr
                  className={[
                    "border-t border-border",
                    client.action === "skip" ? "opacity-50" : "",
                    client.action === "review" ? "bg-amber-50/50" : "hover:bg-muted/20",
                  ].join(" ")}
                >
                  <td className="py-3 pl-4 pr-3">
                    <div className="flex items-center gap-2">
                      <ActionIcon action={client.action} />
                      <div>
                        <p className="font-medium leading-tight">{client.originalName}</p>
                        {client.subfolderCount > 0 && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {client.subfolderCount} subcarpeta
                            {client.subfolderCount !== 1 ? "s" : ""}
                          </p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-3 text-muted-foreground">
                    {client.allowedFileCount}
                    {client.ignoredFileCount > 0 && (
                      <span className="ml-1 text-amber-600">
                        +{client.ignoredFileCount} ignorados
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-3 text-muted-foreground">
                    {formatSize(client.totalSize)}
                  </td>
                  <td className="py-3 px-3">
                    {client.existingMatch ? (
                      <div>
                        <span
                          className={[
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                            client.existingMatch.strength === "exact"
                              ? "bg-blue-100 text-blue-700"
                              : "bg-amber-100 text-amber-700",
                          ].join(" ")}
                        >
                          {client.existingMatch.strength === "exact" ? (
                            <CheckCircle2 className="h-3 w-3" />
                          ) : (
                            <AlertTriangle className="h-3 w-3" />
                          )}
                          {client.existingMatch.strength === "exact" ? "Exacto" : "Probable"}
                        </span>
                        <p
                          className="text-xs text-muted-foreground mt-1 truncate max-w-[140px]"
                          title={client.existingMatch.clientName}
                        >
                          {client.existingMatch.clientName}
                        </p>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">Sin coincidencia</span>
                    )}
                  </td>
                  <td className="py-3 px-3">
                    <ActionSelector
                      client={client}
                      existingClients={existingClients}
                      onChange={(updates) => onUpdateAction(client.index, updates)}
                    />
                  </td>
                  <td className="py-3 pr-4">
                    {client.warnings.length > 0 && (
                      <button
                        type="button"
                        onClick={() => toggleWarnings(client.index)}
                        className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-800"
                      >
                        <AlertTriangle className="h-3.5 w-3.5" />
                        {client.warnings.length}
                        <ChevronDown
                          className={[
                            "h-3 w-3 transition-transform",
                            expandedWarnings.has(client.index) ? "rotate-180" : "",
                          ].join(" ")}
                        />
                      </button>
                    )}
                  </td>
                </tr>
                {expandedWarnings.has(client.index) && client.warnings.length > 0 && (
                  <tr
                    key={`warn-${client.index}`}
                    className="border-t border-amber-100 bg-amber-50/30"
                  >
                    <td colSpan={6} className="px-8 py-2">
                      <ul className="space-y-0.5">
                        {client.warnings.map((w, wi) => (
                          <li key={wi} className="text-xs text-amber-700">
                            • {w}
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {pendingReview > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          Hay {pendingReview} cliente{pendingReview !== 1 ? "s" : ""} marcado
          {pendingReview !== 1 ? "s" : ""} como "Requiere revisión". Elige una acción para cada uno
          antes de continuar.
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
        <Button onClick={() => onRunDryRun(summary.clients)} disabled={!canContinue}>
          Ejecutar simulación
        </Button>
      </div>
    </div>
  );
}

// ─── Selector de acción por cliente ──────────────────────────────────────────

function ActionSelector({
  client,
  existingClients,
  onChange,
}: {
  client: ClientPreviewItem;
  existingClients: Array<{ id: string; name: string }>;
  onChange: (updates: Partial<ClientPreviewItem>) => void;
}) {
  return (
    <div className="space-y-1.5">
      <NativeSelect
        value={client.action}
        onChange={(e) => {
          const action = e.target.value as ClientImportAction;
          const linkToClientId =
            action === "link" ? (client.existingMatch?.clientId ?? null) : null;
          onChange({ action, linkToClientId });
        }}
        className="text-xs h-8"
      >
        <option value="create">Crear nuevo</option>
        <option value="link">Vincular existente</option>
        <option value="skip">Omitir</option>
        <option value="review">Revisar</option>
      </NativeSelect>

      {client.action === "link" && (
        <NativeSelect
          value={client.linkToClientId ?? ""}
          onChange={(e) => onChange({ linkToClientId: e.target.value || null })}
          className="text-xs h-8"
        >
          <option value="">— Seleccionar cliente —</option>
          {existingClients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </NativeSelect>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div
      className={[
        "rounded-xl border p-4 text-center",
        highlight ? "border-amber-200 bg-amber-50" : "border-border bg-muted/20",
      ].join(" ")}
    >
      <p className={["text-2xl font-bold", highlight ? "text-amber-700" : ""].join(" ")}>{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{label}</p>
    </div>
  );
}
