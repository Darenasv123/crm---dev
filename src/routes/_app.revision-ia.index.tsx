import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import { AppLayout } from "@/components/app-layout";
import { DEMO_NOTICE, demoCase, demoClient, demoFindings } from "@/lib/legal/demo-data";
import { applyReviewDecision } from "@/lib/ai-review/review-state";
import { useAiFindings, useImportJobsFilter, useUpdateFindingDecision } from "@/hooks/use-ai-findings";
import { useAuth } from "@/hooks/use-auth";
import { FindingsFilters } from "@/components/legal/findings-filters";
import { DisplayFinding, FindingsListPanel } from "@/components/legal/findings-list-panel";
import { FindingDetailPanel } from "@/components/legal/finding-detail-panel";
import { FindingSourcePanel } from "@/components/legal/finding-source-panel";
import type { FindingFilterOptions, VerificationStatus } from "@/lib/ai-review/findings-service";

export const Route = createFileRoute("/_app/revision-ia/")({
  head: () => ({ meta: [{ title: "Revisión de IA — CRM Jurídico" }] }),
  component: AiReviewPage,
});

type DemoFinding = Omit<(typeof demoFindings)[number], "status"> & {
  status: VerificationStatus;
  reviewNotes?: string | null;
};

function AiReviewPage() {
  const { user } = useAuth();
  const [isDemoMode, setIsDemoMode] = useState(true);
  const [filters, setFilters] = useState<FindingFilterOptions>({
    status: "all",
    page: 1,
    pageSize: 20,
  });

  // Supabase Queries & Mutations
  const { data: realFindingsResult, isLoading: isLoadingReal, isError, error } = useAiFindings(filters);
  const { data: importJobs = [] } = useImportJobsFilter();
  const updateDecisionMutation = useUpdateFindingDecision();

  // State local demo
  const [demoState, setDemoState] = useState<DemoFinding[]>(() =>
    demoFindings.map((item) => ({ ...item, status: item.status as VerificationStatus })),
  );
  const [selectedDemoId, setSelectedDemoId] = useState(demoFindings[0].id);
  const [selectedRealId, setSelectedRealId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Lista unificada según modo
  const listItems: DisplayFinding[] = useMemo(() => {
    if (isDemoMode) {
      return demoState.map((item) => ({
        id: item.id,
        group: item.group,
        fieldName: item.fieldName,
        value: item.value,
        status: item.status as VerificationStatus,
      }));
    }
    return (realFindingsResult?.data ?? []).map((item) => ({
      id: item.id,
      group: item.finding_type,
      fieldName: item.field_name,
      value: (item.normalized_value as string) ?? (item.proposed_value as string) ?? "—",
      status: item.verification_status as VerificationStatus,
    }));
  }, [isDemoMode, demoState, realFindingsResult]);

  const selectedId = isDemoMode
    ? selectedDemoId
    : (selectedRealId ?? listItems[0]?.id ?? "");

  const counts = useMemo(
    () => ({
      pending: listItems.filter((item) => item.status === "pending").length,
      conflicts: listItems.filter((item) => item.status === "conflict").length,
      approved: listItems.filter((item) => item.status === "approved" || item.status === "edited").length,
    }),
    [listItems],
  );

  // Detalle del hallazgo seleccionado
  const selectedDemoItem = demoState.find((item) => item.id === selectedId) ?? demoState[0];
  const selectedRealItem = (realFindingsResult?.data ?? []).find((item) => item.id === selectedId);

  async function handleDecide(
    status: VerificationStatus,
    editedValue?: string,
    notes?: string,
  ) {
    if (isDemoMode) {
      setDemoState(
        (current) =>
          applyReviewDecision(current, { findingId: selectedDemoItem.id, status, editedValue }) as DemoFinding[],
      );
      setMessage(
        status === "approved"
          ? "Dato aprobado en la demostración local."
          : status === "rejected"
            ? "Dato rechazado en la demostración local."
            : "Estado de revisión actualizado en demostración.",
      );
      return;
    }

    if (!selectedRealItem || !user) {
      setMessage("Se requiere una sesión activa de usuario para guardar en Supabase.");
      return;
    }

    try {
      await updateDecisionMutation.mutateAsync({
        findingId: selectedRealItem.id,
        status,
        editedValue: editedValue ?? null,
        reviewNotes: notes ?? null,
        userId: user.id,
      });
      setMessage("Decisión guardada con éxito en Supabase.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error al guardar la decisión.";
      setMessage(`Fallo al guardar: ${msg}`);
    }
  }

  function handleSecondaryAction(label: string) {
    setMessage(`${label}: acción registrada. En esta fase no altera datos del CRM.`);
  }

  function resetDemo() {
    setDemoState(demoFindings.map((item) => ({ ...item })) as DemoFinding[]);
    setSelectedDemoId(demoFindings[0].id);
    setMessage("Revisión demostrativa reiniciada.");
  }

  const detailProps = isDemoMode
    ? {
        id: selectedDemoItem.id,
        group: selectedDemoItem.group,
        fieldName: selectedDemoItem.fieldName,
        value: selectedDemoItem.value,
        status: selectedDemoItem.status,
        clientName: demoClient.name,
        documentNumber: demoClient.documentNumber,
        caseType: demoCase.caseType,
        caseNumber: demoCase.caseNumber,
        caseStatus: demoCase.status,
        nextAction: demoCase.nextAction,
        reviewNotes: selectedDemoItem.reviewNotes,
      }
    : {
        id: selectedRealItem?.id ?? "",
        group: selectedRealItem?.finding_type ?? "N/A",
        fieldName: selectedRealItem?.field_name ?? "N/A",
        value: (selectedRealItem?.normalized_value as string) ?? (selectedRealItem?.proposed_value as string) ?? "Sin valor",
        status: (selectedRealItem?.verification_status as VerificationStatus) ?? "pending",
        clientName: "Cliente detectado",
        documentNumber: undefined,
        caseType: undefined,
        caseNumber: undefined,
        caseStatus: undefined,
        nextAction: undefined,
        reviewNotes: selectedRealItem?.review_notes,
      };

  const sourceProps = isDemoMode
    ? {
        documentName: selectedDemoItem.document,
        page: selectedDemoItem.page,
        excerpt: selectedDemoItem.excerpt,
        confidence: selectedDemoItem.confidence,
      }
    : {
        documentName: "Documento en Supabase",
        page: selectedRealItem?.source_page ?? null,
        excerpt: selectedRealItem?.source_excerpt ?? null,
        confidence: selectedRealItem?.confidence_score ?? 0.8,
      };

  return (
    <AppLayout
      title="Revisión de IA"
      subtitle="Validación humana de información detectada en documentos"
      actions={
        isDemoMode ? (
          <button
            type="button"
            onClick={resetDemo}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium hover:bg-muted"
          >
            <RotateCcw className="h-4 w-4" /> Reiniciar demostración
          </button>
        ) : null
      }
    >
      {/* Barra de Filtros y Selector de Modo */}
      <FindingsFilters
        filters={filters}
        onChange={setFilters}
        importJobs={importJobs}
        isDemoMode={isDemoMode}
        onToggleDemoMode={setIsDemoMode}
      />

      {isDemoMode && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="font-semibold">Modo demostración local activo</div>
          <p className="mt-1 text-xs leading-5">
            {DEMO_NOTICE} Cambia a &quot;Supabase (Real)&quot; en los filtros si deseas revisar registros persistidos en la base de datos.
          </p>
        </div>
      )}

      {!isDemoMode && isError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Error al conectar con Supabase: {error.message}
        </div>
      )}

      {message && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {message}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[260px_minmax(420px,1fr)_340px]">
        <FindingsListPanel
          findings={listItems}
          selectedId={selectedId}
          onSelect={(id) => {
            if (isDemoMode) setSelectedDemoId(id);
            else setSelectedRealId(id);
            setMessage(null);
          }}
          counts={counts}
          onSecondaryAction={handleSecondaryAction}
          isLoading={!isDemoMode && isLoadingReal}
        />

        <FindingDetailPanel
          finding={detailProps}
          onDecide={handleDecide}
          isSaving={updateDecisionMutation.isPending}
        />

        <FindingSourcePanel source={sourceProps} />
      </div>
    </AppLayout>
  );
}
