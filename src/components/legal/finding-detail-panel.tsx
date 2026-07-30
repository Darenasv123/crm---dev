import { Card, StatusBadge } from "@/components/app-layout";
import { AlertTriangle, Check, Edit3, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface FindingDetailPanelProps {
  finding: {
    id: string;
    group: string;
    fieldName: string;
    value: string;
    status: "pending" | "approved" | "edited" | "rejected" | "conflict";
    clientName?: string;
    caseType?: string;
    caseNumber?: string;
    caseStatus?: string;
    nextAction?: string;
    reviewNotes?: string | null;
  };
  onDecide: (
    status: "pending" | "approved" | "edited" | "rejected" | "conflict",
    editedValue?: string,
    notes?: string,
  ) => void;
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
            <Input
              autoFocus
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              aria-label={`Editar ${finding.fieldName}`}
              className="min-w-0 flex-1"
            />
            <Button
              type="button"
              disabled={isSaving}
              onClick={() => {
                onDecide("edited", editValue, notes);
                setEditing(false);
              }}
              size="sm"
            >
              Guardar
            </Button>
          </div>
        ) : (
          <div className="text-base font-semibold">{finding.value}</div>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Info label="Cliente probable" value={finding.clientName ?? "—"} />
        <Info label="Materia" value={finding.caseType ?? "—"} />
        <Info label="Expediente" value={finding.caseNumber ?? "—"} />
        <Info label="Estado probable" value={finding.caseStatus ?? "—"} />
        <Info label="Próxima acción sugerida" value={finding.nextAction ?? "—"} />
      </div>

      {/* Notas de revisión */}
      <div className="mt-4">
        <label
          htmlFor="finding-review-notes"
          className="text-xs font-semibold text-muted-foreground"
        >
          Notas de revisión (opcional):
        </label>
        <Textarea
          id="finding-review-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Escribe observaciones o contexto técnico..."
          className="mt-1 min-h-20 text-xs"
        />
      </div>

      <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4">
        <Button
          type="button"
          disabled={isSaving}
          onClick={() => onDecide("approved", undefined, notes)}
          variant="success"
          size="sm"
        >
          <Check className="h-3.5 w-3.5" /> Aprobar dato
        </Button>
        <Button
          type="button"
          disabled={isSaving}
          onClick={() => {
            setEditing(true);
            setEditValue(finding.value);
          }}
          variant="outline"
          size="sm"
        >
          <Edit3 className="h-3.5 w-3.5" /> Editar dato
        </Button>
        <Button
          type="button"
          disabled={isSaving}
          onClick={() => onDecide("rejected", undefined, notes)}
          variant="destructive"
          size="sm"
        >
          <X className="h-3.5 w-3.5" /> Rechazar
        </Button>
        <Button
          type="button"
          disabled={isSaving}
          onClick={() => onDecide("conflict", undefined, notes)}
          variant="outline"
          size="sm"
          className="border-warning/35 text-warning-foreground hover:bg-warning/10"
        >
          <AlertTriangle className="h-3.5 w-3.5" /> Marcar conflicto
        </Button>
        <Button
          type="button"
          disabled={isSaving}
          onClick={() => onDecide("pending", undefined, notes)}
          variant="ghost"
          size="sm"
        >
          Dejar pendiente
        </Button>
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
