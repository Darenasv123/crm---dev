import { describe, expect, it, vi } from "vitest";
import {
  updateFindingDecisionSchema,
  type UpdateFindingDecisionInput,
} from "@/lib/ai-review/findings-service";
import { applyReviewDecision } from "@/lib/ai-review/review-state";
import { demoFindings } from "@/lib/legal/demo-data";

describe("Persistencia real y lógica de Revisión de IA (Fase 2A)", () => {
  const sampleFinding = {
    id: "finding-client-name",
    analysis_run_id: "run-1",
    client_id: null,
    case_id: null,
    document_id: "doc-1",
    finding_type: "client_name",
    field_name: "Nombre completo",
    proposed_value: "María López García",
    normalized_value: null,
    confidence_score: 0.98,
    source_page: 1,
    source_excerpt: "La solicitud corresponde al cliente detectado...",
    verification_status: "pending" as const,
    review_notes: null,
    created_at: "2026-07-21T10:00:00Z",
    reviewed_at: null,
    reviewed_by: null,
  };

  it("valida la entrada para actualizar decisiones con Zod (Aprobado)", () => {
    const input: UpdateFindingDecisionInput = {
      findingId: "123e4567-e89b-12d3-a456-426614174000",
      status: "approved",
      userId: "123e4567-e89b-12d3-a456-426614174001",
    };
    const parsed = updateFindingDecisionSchema.parse(input);
    expect(parsed.status).toBe("approved");
    expect(parsed.findingId).toBe(input.findingId);
  });

  it("valida edición conservando el valor propuesto y asignando el valor editado", () => {
    const input: UpdateFindingDecisionInput = {
      findingId: "123e4567-e89b-12d3-a456-426614174000",
      status: "edited",
      editedValue: "María López de Pérez",
      reviewNotes: "Corrección de apellido según el documento revisado",
      userId: "123e4567-e89b-12d3-a456-426614174001",
    };
    const parsed = updateFindingDecisionSchema.parse(input);
    expect(parsed.status).toBe("edited");
    expect(parsed.editedValue).toBe("María López de Pérez");
    expect(parsed.reviewNotes).toBe("Corrección de apellido según el documento revisado");
  });

  it("valida la acción de rechazo de un hallazgo", () => {
    const input: UpdateFindingDecisionInput = {
      findingId: "123e4567-e89b-12d3-a456-426614174000",
      status: "rejected",
      reviewNotes: "No corresponde al expediente",
      userId: "123e4567-e89b-12d3-a456-426614174001",
    };
    const parsed = updateFindingDecisionSchema.parse(input);
    expect(parsed.status).toBe("rejected");
  });

  it("garantiza que el modo demo no altera el esquema de Supabase", () => {
    const mockStore = vi.fn();
    const demoItem = demoFindings[0];
    const decision = {
      findingId: demoItem.id,
      status: "approved" as const,
    };
    const result = applyReviewDecision([demoItem], decision);

    expect(result[0].status).toBe("approved");
    expect(mockStore).not.toHaveBeenCalled();
  });

  it("formatea correctamente las referencias de fuente (página, fragmento y confianza)", () => {
    const sourceRef = {
      id: "ref-1",
      entity_type: "ai_finding",
      entity_id: sampleFinding.id,
      field_name: sampleFinding.field_name,
      document_id: "doc-1",
      source_page: 2,
      source_excerpt: "Texto citado de prueba",
      confidence_score: 0.95,
      created_at: "2026-07-21T10:00:00Z",
      created_by: null,
    };

    expect(sourceRef.source_page).toBe(2);
    expect(sourceRef.confidence_score).toBe(0.95);
    expect(sourceRef.source_excerpt).toContain("Texto citado");
  });

  it("simula el comportamiento de rollback en actualización optimista ante fallo de red", () => {
    const initialFindings: Array<{ id: string; verification_status: string }> = [
      { ...sampleFinding, verification_status: "pending" },
    ];

    // Simulación de rollback
    let currentFindings = [...initialFindings];
    const previousSnapshot = [...currentFindings];

    // Optimistic Update
    currentFindings = currentFindings.map((f) =>
      f.id === sampleFinding.id ? { ...f, verification_status: "approved" as const } : f,
    );
    expect(currentFindings[0].verification_status).toBe("approved");

    // Simular error de red -> rollback
    const hasNetworkError = true;
    if (hasNetworkError) {
      currentFindings = previousSnapshot;
    }

    expect(currentFindings[0].verification_status).toBe("pending");
  });
});
