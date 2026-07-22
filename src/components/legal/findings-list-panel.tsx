import { Card } from "@/components/app-layout";
import { Link2, Merge, Split, UserPlus } from "lucide-react";

export interface DisplayFinding {
  id: string;
  group: string;
  fieldName: string;
  value: string;
  status: "pending" | "approved" | "edited" | "rejected" | "conflict";
}

interface FindingsListPanelProps {
  findings: DisplayFinding[];
  selectedId: string;
  onSelect: (id: string) => void;
  counts: { pending: number; conflicts: number; approved: number };
  onSecondaryAction: (label: string) => void;
  isLoading?: boolean;
}

export function FindingsListPanel({
  findings,
  selectedId,
  onSelect,
  counts,
  onSecondaryAction,
  isLoading,
}: FindingsListPanelProps) {
  return (
    <Card className="h-fit p-4">
      <h2 className="text-sm font-semibold">Elementos detectados</h2>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Count label="Pendientes" value={counts.pending} />
        <Count label="Conflictos" value={counts.conflicts} tone="danger" />
        <Count label="Revisados" value={counts.approved} tone="success" />
      </div>

      <div className="mt-4 space-y-2 max-h-[480px] overflow-y-auto pr-1">
        {isLoading ? (
          <div className="py-8 text-center text-xs text-muted-foreground">
            Cargando hallazgos...
          </div>
        ) : findings.length === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground">
            No se encontraron hallazgos con los filtros seleccionados.
          </div>
        ) : (
          findings.map((finding) => (
            <button
              key={finding.id}
              type="button"
              onClick={() => onSelect(finding.id)}
              className={`w-full rounded-lg border p-3 text-left transition ${
                selectedId === finding.id
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-muted/30"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[10px] uppercase text-muted-foreground">{finding.group}</div>
                  <div className="mt-1 truncate text-sm font-semibold">{finding.fieldName}</div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">{finding.value}</div>
                </div>
                <span
                  className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                    finding.status === "approved" || finding.status === "edited"
                      ? "bg-emerald-500"
                      : finding.status === "rejected"
                        ? "bg-red-500"
                        : finding.status === "conflict"
                          ? "bg-amber-500"
                          : "bg-slate-300"
                  }`}
                />
              </div>
            </button>
          ))
        )}
      </div>

      <div className="mt-4 space-y-2 border-t border-border pt-4 text-xs">
        <button
          type="button"
          onClick={() => onSecondaryAction("Unir con cliente existente")}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-2 hover:bg-muted"
        >
          <Merge className="h-3.5 w-3.5" /> Unir con cliente existente
        </button>
        <button
          type="button"
          onClick={() => onSecondaryAction("Crear nuevo cliente")}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-2 hover:bg-muted"
        >
          <UserPlus className="h-3.5 w-3.5" /> Crear nuevo cliente
        </button>
        <button
          type="button"
          onClick={() => onSecondaryAction("Separar expedientes")}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-2 hover:bg-muted"
        >
          <Split className="h-3.5 w-3.5" /> Separar expedientes
        </button>
        <button
          type="button"
          onClick={() => onSecondaryAction("Reasignar documento")}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-2 hover:bg-muted"
        >
          <Link2 className="h-3.5 w-3.5" /> Reasignar documento
        </button>
      </div>
    </Card>
  );
}

function Count({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "danger" | "success";
}) {
  return (
    <div
      className={`rounded-lg p-2 text-center ${
        tone === "danger"
          ? "bg-red-50 text-red-700"
          : tone === "success"
            ? "bg-emerald-50 text-emerald-700"
            : "bg-muted/50"
      }`}
    >
      <div className="text-lg font-bold">{value}</div>
      <div className="text-[9px] uppercase">{label}</div>
    </div>
  );
}
