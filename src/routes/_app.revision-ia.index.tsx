import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Edit3,
  FileText,
  Link2,
  Merge,
  RotateCcw,
  Split,
  UserPlus,
  X,
} from "lucide-react";
import { AppLayout, Card, StatusBadge } from "@/components/app-layout";
import { DEMO_NOTICE, demoCase, demoClient, demoFindings } from "@/lib/legal/demo-data";
import { applyReviewDecision } from "@/lib/ai-review/review-state";

export const Route = createFileRoute("/_app/revision-ia/")({
  head: () => ({ meta: [{ title: "Revisión de IA — CRM Jurídico" }] }),
  component: AiReviewPage,
});

type ReviewStatus = "pending" | "approved" | "edited" | "rejected" | "conflict";
type Finding = Omit<(typeof demoFindings)[number], "status"> & {
  status: ReviewStatus;
  reviewNotes?: string | null;
};

function AiReviewPage() {
  const [findings, setFindings] = useState<Finding[]>(() =>
    demoFindings.map((item) => ({ ...item })),
  );
  const [selectedId, setSelectedId] = useState(findings[0].id);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const selected = findings.find((item) => item.id === selectedId) ?? findings[0];
  const counts = useMemo(
    () => ({
      pending: findings.filter((item) => item.status === "pending").length,
      conflicts: findings.filter((item) => item.status === "conflict").length,
      approved: findings.filter((item) => item.status === "approved" || item.status === "edited")
        .length,
    }),
    [findings],
  );

  function decide(status: ReviewStatus, editedValue?: string) {
    setFindings(
      (current) =>
        applyReviewDecision(current, { findingId: selected.id, status, editedValue }) as Finding[],
    );
    setEditing(false);
    setMessage(
      status === "approved"
        ? "Dato aprobado en la demostración."
        : status === "rejected"
          ? "Dato rechazado en la demostración."
          : "Estado de revisión actualizado.",
    );
  }

  function secondaryAction(label: string) {
    setMessage(`${label}: acción simulada. No se modificó información real.`);
  }

  function reset() {
    setFindings(demoFindings.map((item) => ({ ...item })) as Finding[]);
    setSelectedId(demoFindings[0].id);
    setMessage(null);
    setEditing(false);
  }

  return (
    <AppLayout
      title="Revisión de IA"
      subtitle="Validación humana de información detectada en documentos"
      actions={
        <button
          type="button"
          onClick={reset}
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium"
        >
          <RotateCcw className="h-4 w-4" /> Reiniciar revisión
        </button>
      }
    >
      <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <div className="font-semibold">Demostración sin documentos reales</div>
        <p className="mt-1 text-xs leading-5">
          {DEMO_NOTICE} Toda aprobación, edición o rechazo se mantiene solo en esta pantalla.
        </p>
      </div>
      {message && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {message}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[260px_minmax(420px,1fr)_340px]">
        <Card className="h-fit p-4">
          <h2 className="text-sm font-semibold">Elementos detectados</h2>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Count label="Pendientes" value={counts.pending} />
            <Count label="Conflictos" value={counts.conflicts} tone="danger" />
            <Count label="Revisados" value={counts.approved} tone="success" />
          </div>
          <div className="mt-4 space-y-2">
            {findings.map((finding) => (
              <button
                key={finding.id}
                type="button"
                onClick={() => {
                  setSelectedId(finding.id);
                  setEditing(false);
                  setMessage(null);
                }}
                className={`w-full rounded-lg border p-3 text-left transition ${selected.id === finding.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase text-muted-foreground">
                      {finding.group}
                    </div>
                    <div className="mt-1 truncate text-sm font-semibold">{finding.fieldName}</div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">
                      {finding.value}
                    </div>
                  </div>
                  <span
                    className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${finding.status === "approved" || finding.status === "edited" ? "bg-emerald-500" : finding.status === "rejected" ? "bg-red-500" : finding.status === "conflict" ? "bg-amber-500" : "bg-slate-300"}`}
                  />
                </div>
              </button>
            ))}
          </div>
          <div className="mt-4 space-y-2 border-t border-border pt-4 text-xs">
            <button
              type="button"
              onClick={() => secondaryAction("Unir con cliente existente")}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-2 hover:bg-muted"
            >
              <Merge className="h-3.5 w-3.5" /> Unir con cliente existente
            </button>
            <button
              type="button"
              onClick={() => secondaryAction("Crear nuevo cliente")}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-2 hover:bg-muted"
            >
              <UserPlus className="h-3.5 w-3.5" /> Crear nuevo cliente
            </button>
            <button
              type="button"
              onClick={() => secondaryAction("Separar expedientes")}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-2 hover:bg-muted"
            >
              <Split className="h-3.5 w-3.5" /> Separar expedientes
            </button>
            <button
              type="button"
              onClick={() => secondaryAction("Reasignar documento")}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-2 hover:bg-muted"
            >
              <Link2 className="h-3.5 w-3.5" /> Reasignar documento
            </button>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase text-muted-foreground">
                {selected.group}
              </div>
              <h2 className="mt-1 text-lg font-bold">{selected.fieldName}</h2>
            </div>
            <StatusBadge
              tone={
                selected.status === "approved" || selected.status === "edited"
                  ? "success"
                  : selected.status === "rejected"
                    ? "danger"
                    : selected.status === "conflict"
                      ? "warning"
                      : "default"
              }
            >
              {selected.status === "pending"
                ? "Pendiente"
                : selected.status === "approved"
                  ? "Aprobado"
                  : selected.status === "edited"
                    ? "Editado"
                    : selected.status === "rejected"
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
                  onChange={(event) => setEditValue(event.target.value)}
                  className="h-10 min-w-0 flex-1 rounded-lg border border-border px-3 text-sm outline-none"
                />
                <button
                  type="button"
                  onClick={() => decide("edited", editValue)}
                  className="h-10 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground"
                >
                  Guardar
                </button>
              </div>
            ) : (
              <div className="text-base font-semibold">{selected.value}</div>
            )}
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Info label="Cliente probable" value={demoClient.name} />
            <Info label="DNI" value={demoClient.documentNumber} />
            <Info label="Materia" value={demoCase.caseType} />
            <Info label="Expediente" value={demoCase.caseNumber} />
            <Info label="Estado probable" value={demoCase.status} />
            <Info label="Próxima acción sugerida" value={demoCase.nextAction} />
          </div>
          <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4">
            <button
              type="button"
              onClick={() => decide("approved")}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white"
            >
              <Check className="h-3.5 w-3.5" /> Aprobar dato
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(true);
                setEditValue(selected.value);
              }}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold"
            >
              <Edit3 className="h-3.5 w-3.5" /> Editar dato
            </button>
            <button
              type="button"
              onClick={() => decide("rejected")}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-red-200 px-3 text-xs font-semibold text-red-700"
            >
              <X className="h-3.5 w-3.5" /> Rechazar
            </button>
            <button
              type="button"
              onClick={() => decide("conflict")}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-amber-200 px-3 text-xs font-semibold text-amber-800"
            >
              <AlertTriangle className="h-3.5 w-3.5" /> Marcar conflicto
            </button>
            <button
              type="button"
              onClick={() => decide("pending")}
              className="h-9 rounded-lg border border-border px-3 text-xs font-semibold"
            >
              Dejar pendiente
            </button>
          </div>
        </Card>

        <Card className="h-fit p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <FileText className="h-4 w-4 text-primary" /> Fuente del dato
          </h2>
          <div className="mt-4 rounded-lg border border-border p-4">
            <div className="text-sm font-semibold">{selected.document}</div>
            <div className="mt-1 text-xs text-muted-foreground">Página {selected.page}</div>
            <blockquote className="mt-4 border-l-2 border-primary pl-3 text-sm leading-6 text-foreground/80">
              {selected.excerpt}
            </blockquote>
          </div>
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Nivel de confianza</span>
              <span className="font-semibold">{Math.round(selected.confidence * 100)}%</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full ${selected.confidence >= 0.9 ? "bg-emerald-500" : "bg-amber-500"}`}
                style={{ width: `${selected.confidence * 100}%` }}
              />
            </div>
          </div>
          <p className="mt-4 text-xs leading-5 text-muted-foreground">
            El nivel de confianza orienta la revisión, pero nunca sustituye la comprobación del
            documento fuente.
          </p>
        </Card>
      </div>
    </AppLayout>
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
      className={`rounded-lg p-2 text-center ${tone === "danger" ? "bg-red-50 text-red-700" : tone === "success" ? "bg-emerald-50 text-emerald-700" : "bg-muted/50"}`}
    >
      <div className="text-lg font-bold">{value}</div>
      <div className="text-[9px] uppercase">{label}</div>
    </div>
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
