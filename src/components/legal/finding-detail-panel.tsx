import { Card, StatusBadge } from "@/components/app-layout";
import { AlertTriangle, Check, Edit3, X } from "lucide-react";
import { useState } from "react";

interface FindingDetailPanelProps {
  finding: {
    id: string;
    group: string;
    fieldName: string;
    value: string;
    status: "pending" | "approved" | "edited" | "rejected" | "conflict";
    clientName?: string;
    documentNumber?: string;
    caseType?: string;
    caseNumber?: string;
    caseStatus?: string;
    nextAction?: string;
    reviewNotes?: string | null;
  };
  onDecide: (status: "pending" | "approved" | "edited" | "rejected" | "conflict", editedValue?: string, notes?: string) => void;
  isSaving?: boolean;
}

export function FindingDetailPanel({ finding, onDecide, isSaving }: FindingDetailPanelProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [notes, setNotes] = useState(finding.reviewNotes ?? "");

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase text-muted-foreground">
            {finding.group}
          </div>
          <h2 className="mt-1 text-lg font-bold">{finding.fieldName}</h2>
        </div>
        <StatusBadge
          tone={
            finding.status === "approved" || finding.status === "edited"
              ? "success"
              : finding.status === "rejected"
                ? "danger"
                : finding.status === "conflict"
                  ? "warning"
                  : "default"
          }
        >
          {finding.status === "pending"
            ? "Pendiente"
            : finding.status === "approved"
              ? "Aprobado"
              : finding.status === "edited"
                ? "Editado"
                : finding.status === "rejected"
                  ? "Rechazado"
                  : "Conflicto"}
        </StatusBadge>
      </div>

      <div className="mt-5 rounded-lg border border-border p-4">
        {editing ? (
          <div className="flex gap-2">
            <input
              autoFocus
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className="h-10 min-w-0 flex-1 rounded-lg border border-border px-3 text-sm outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              type="button"
              disabled={isSaving}
              onClick={() => {
                onDecide("edited", editValue, notes);
                setEditing(false);
              }}
              className="h-10 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-50"
            >
              Guardar
            </button>
          </div>
        ) : (
          <div className="text-base font-semibold">{finding.value}</div>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Info label="Cliente probable" value={finding.clientName ?? "—"} />
        <Info label="DNI / RUC" value={finding.documentNumber ?? "—"} />
        <Info label="Materia" value={finding.caseType ?? "—"} />
        <Info label="Expediente" value={finding.caseNumber ?? "—"} />
        <Info label="Estado probable" value={finding.caseStatus ?? "—"} />
        <Info label="Próxima acción sugerida" value={finding.nextAction ?? "—"} />
      </div>

      {/* Notas de revisión */}
      <div className="mt-4">
        <label className="text-xs font-semibold text-muted-foreground">Notas de revisión (opcional):</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Escribe observaciones o contexto técnico..."
          className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-xs outline-none focus:ring-1 focus:ring-primary resize-none h-16"
        />
      </div>

      <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4">
        <button
          type="button"
          disabled={isSaving}
          onClick={() => onDecide("approved", undefined, notes)}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 transition"
        >
          <Check className="h-3.5 w-3.5" /> Aprobar dato
        </button>
        <button
          type="button"
          disabled={isSaving}
          onClick={() => {
            setEditing(true);
            setEditValue(finding.value);
          }}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold hover:bg-muted disabled:opacity-50 transition"
        >
          <Edit3 className="h-3.5 w-3.5" /> Editar dato
        </button>
        <button
          type="button"
          disabled={isSaving}
          onClick={() => onDecide("rejected", undefined, notes)}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-red-200 px-3 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 transition"
        >
          <X className="h-3.5 w-3.5" /> Rechazar
        </button>
        <button
          type="button"
          disabled={isSaving}
          onClick={() => onDecide("conflict", undefined, notes)}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-amber-200 px-3 text-xs font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-50 transition"
        >
          <AlertTriangle className="h-3.5 w-3.5" /> Marcar conflicto
        </button>
        <button
          type="button"
          disabled={isSaving}
          onClick={() => onDecide("pending", undefined, notes)}
          className="h-9 rounded-lg border border-border px-3 text-xs font-semibold hover:bg-muted disabled:opacity-50 transition"
        >
          Dejar pendiente
        </button>
      </div>
    </Card>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/30 p-3">
      <div className="text-[10px] font-semibold uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 break-words text-sm font-medium">{value}</div>
    </div>
  );
}
