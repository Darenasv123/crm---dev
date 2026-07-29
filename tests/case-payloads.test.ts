import { describe, it, expect } from "vitest";
import type { Database } from "@/lib/database.types";

type CaseInsert = Database["public"]["Tables"]["cases"]["Insert"];
type CaseUpdate = Database["public"]["Tables"]["cases"]["Update"];

/**
 * Función auxiliar que simula la construcción del payload de creación
 * Replica la lógica de useCreateCase sin la llamada a Supabase
 */
function buildCreatePayload(input: CaseInsert): CaseInsert {
  return {
    client_id: input.client_id,
    expediente: input.expediente,
    materia: input.materia,
    process_type: input.process_type,
    status: input.status,
    juzgado: input.juzgado,
    ...(input.case_name && { case_name: input.case_name }),
    ...(input.case_type && { case_type: input.case_type }),
    ...(input.case_stage && { case_stage: input.case_stage }),
    ...(input.case_number && { case_number: input.case_number }),
    ...(input.court && { court: input.court }),
    ...(input.demandante && { demandante: input.demandante }),
    ...(input.demandado && { demandado: input.demandado }),
    ...(input.judicial_district && { judicial_district: input.judicial_district }),
    ...(input.judge_or_prosecutor && { judge_or_prosecutor: input.judge_or_prosecutor }),
    ...(input.current_summary && { current_summary: input.current_summary }),
    ...(input.current_status_description && {
      current_status_description: input.current_status_description,
    }),
    ...(input.next_action && { next_action: input.next_action }),
    ...(input.next_hearing && { next_hearing: input.next_hearing }),
  };
}

/**
 * Función auxiliar que simula la construcción del payload de actualización
 * Replica la lógica de useUpdateCase sin la llamada a Supabase
 */
function buildUpdatePayload(updates: CaseUpdate): CaseUpdate {
  const payload: CaseUpdate = {};
  if (updates.client_id !== undefined) payload.client_id = updates.client_id;
  if (updates.expediente !== undefined) payload.expediente = updates.expediente;
  if (updates.materia !== undefined) payload.materia = updates.materia;
  if (updates.process_type !== undefined) payload.process_type = updates.process_type;
  if (updates.status !== undefined) payload.status = updates.status;
  if (updates.juzgado !== undefined) payload.juzgado = updates.juzgado;
  if (updates.case_name !== undefined) payload.case_name = updates.case_name;
  if (updates.case_type !== undefined) payload.case_type = updates.case_type;
  if (updates.case_stage !== undefined) payload.case_stage = updates.case_stage;
  if (updates.case_number !== undefined) payload.case_number = updates.case_number;
  if (updates.court !== undefined) payload.court = updates.court;
  if (updates.demandante !== undefined) payload.demandante = updates.demandante;
  if (updates.demandado !== undefined) payload.demandado = updates.demandado;
  if (updates.judicial_district !== undefined)
    payload.judicial_district = updates.judicial_district;
  if (updates.judge_or_prosecutor !== undefined)
    payload.judge_or_prosecutor = updates.judge_or_prosecutor;
  if (updates.current_summary !== undefined) payload.current_summary = updates.current_summary;
  if (updates.current_status_description !== undefined)
    payload.current_status_description = updates.current_status_description;
  if (updates.next_action !== undefined) payload.next_action = updates.next_action;
  if (updates.next_hearing !== undefined) payload.next_hearing = updates.next_hearing;
  return payload;
}

describe("Case Payloads — Fase B", () => {
  describe("Payload de creación", () => {
    it("incluye materia cuando es Familia", () => {
      const input: CaseInsert = {
        client_id: "client-123",
        expediente: "EXP-001",
        materia: "Familia",
        process_type: "Divorcio",
        status: "En trámite",
        juzgado: "1er Juzgado de Familia",
      };

      const payload = buildCreatePayload(input);

      expect(payload.materia).toBe("Familia");
    });

    it("incluye materia cuando es Penal", () => {
      const input: CaseInsert = {
        client_id: "client-456",
        expediente: "EXP-002",
        materia: "Penal",
        process_type: "Defensa penal por robo agravado",
        status: "Presentado",
        juzgado: "3er Juzgado Penal",
      };

      const payload = buildCreatePayload(input);

      expect(payload.materia).toBe("Penal");
    });

    it("NO omite materia mediante spread condicional", () => {
      const input: CaseInsert = {
        client_id: "client-789",
        expediente: "EXP-003",
        materia: "Familia",
        process_type: "Alimentos",
        status: "En preparación",
        juzgado: "2do Juzgado de Familia",
      };

      const payload = buildCreatePayload(input);

      expect("materia" in payload).toBe(true);
      expect(payload.materia).toBe("Familia");
    });

    it("NO incluye internal_code", () => {
      const input = {
        client_id: "client-abc",
        expediente: "EXP-004",
        materia: "Penal",
        process_type: "Proceso penal",
        status: "En trámite",
        juzgado: "Juzgado Penal",
        internal_code: "CODIGO-INTERNO-001",
      } as CaseInsert;

      const payload = buildCreatePayload(input);

      expect("internal_code" in payload).toBe(false);
    });

    it("NO incluye legal_area", () => {
      const input = {
        client_id: "client-def",
        expediente: "EXP-005",
        materia: "Familia",
        process_type: "Divorcio",
        status: "En trámite",
        juzgado: "Juzgado de Familia",
        legal_area: "Área legal antigua",
      } as CaseInsert;

      const payload = buildCreatePayload(input);

      expect("legal_area" in payload).toBe(false);
    });

    it("NO incluye priority", () => {
      const input = {
        client_id: "client-ghi",
        expediente: "EXP-006",
        materia: "Penal",
        process_type: "Proceso penal",
        status: "En trámite",
        juzgado: "Juzgado Penal",
        priority: "Alta",
      } as CaseInsert;

      const payload = buildCreatePayload(input);

      expect("priority" in payload).toBe(false);
    });

    it("NO incluye filing_date", () => {
      const input = {
        client_id: "client-jkl",
        expediente: "EXP-007",
        materia: "Familia",
        process_type: "Alimentos",
        status: "Presentado",
        juzgado: "Juzgado de Familia",
        filing_date: "2026-01-15",
      } as CaseInsert;

      const payload = buildCreatePayload(input);

      expect("filing_date" in payload).toBe(false);
    });

    it("NO incluye assigned_to", () => {
      const input = {
        client_id: "client-mno",
        expediente: "EXP-008",
        materia: "Penal",
        process_type: "Proceso penal",
        status: "En trámite",
        juzgado: "Juzgado Penal",
        assigned_to: "user-123",
      } as CaseInsert;

      const payload = buildCreatePayload(input);

      expect("assigned_to" in payload).toBe(false);
    });

    it("NO incluye counterpart", () => {
      const input = {
        client_id: "client-pqr",
        expediente: "EXP-009",
        materia: "Familia",
        process_type: "Divorcio",
        status: "En trámite",
        juzgado: "Juzgado de Familia",
        counterpart: "Contraparte XYZ",
      } as CaseInsert;

      const payload = buildCreatePayload(input);

      expect("counterpart" in payload).toBe(false);
    });
  });

  describe("Payload de actualización", () => {
    it("incluye materia cuando se actualiza a Familia", () => {
      const updates: CaseUpdate = {
        materia: "Familia",
        process_type: "Nuevo proceso",
      };

      const payload = buildUpdatePayload(updates);

      expect(payload.materia).toBe("Familia");
    });

    it("incluye materia cuando se actualiza a Penal", () => {
      const updates: CaseUpdate = {
        materia: "Penal",
        status: "En audiencia",
      };

      const payload = buildUpdatePayload(updates);

      expect(payload.materia).toBe("Penal");
    });

    it("NO incluye internal_code", () => {
      const updates = {
        materia: "Familia",
        process_type: "Proceso actualizado",
        internal_code: "CODIGO-ACTUALIZADO",
      } as CaseUpdate;

      const payload = buildUpdatePayload(updates);

      expect("internal_code" in payload).toBe(false);
    });

    it("NO incluye legal_area", () => {
      const updates = {
        materia: "Penal",
        status: "Concluido",
        legal_area: "Área actualizada",
      } as CaseUpdate;

      const payload = buildUpdatePayload(updates);

      expect("legal_area" in payload).toBe(false);
    });

    it("NO incluye priority", () => {
      const updates = {
        materia: "Familia",
        juzgado: "Nuevo juzgado",
        priority: "Media",
      } as CaseUpdate;

      const payload = buildUpdatePayload(updates);

      expect("priority" in payload).toBe(false);
    });

    it("NO incluye filing_date", () => {
      const updates = {
        materia: "Penal",
        next_hearing: "2026-08-15T10:00:00",
        filing_date: "2026-07-01",
      } as CaseUpdate;

      const payload = buildUpdatePayload(updates);

      expect("filing_date" in payload).toBe(false);
    });

    it("NO incluye assigned_to", () => {
      const updates = {
        materia: "Familia",
        status: "En ejecución",
        assigned_to: "user-456",
      } as CaseUpdate;

      const payload = buildUpdatePayload(updates);

      expect("assigned_to" in payload).toBe(false);
    });

    it("NO incluye counterpart", () => {
      const updates = {
        materia: "Penal",
        case_stage: "Etapa de apelación",
        counterpart: "Nueva contraparte",
      } as CaseUpdate;

      const payload = buildUpdatePayload(updates);

      expect("counterpart" in payload).toBe(false);
    });
  });

  describe("Validación de campos vigentes", () => {
    it("incluye todos los campos vigentes cuando están presentes", () => {
      const input: CaseInsert = {
        client_id: "client-xyz",
        expediente: "EXP-010",
        materia: "Familia",
        process_type: "Divorcio complejo",
        status: "En trámite",
        juzgado: "Juzgado especializado",
        case_name: "Caso importante",
        case_type: "Divorcio",
        case_stage: "Etapa probatoria",
        case_number: "12345-2026",
        court: "Corte Superior",
        demandante: "Juan Pérez",
        demandado: "María García",
        judicial_district: "Lima",
        judge_or_prosecutor: "Dr. Rodríguez",
        current_summary: "Resumen del caso",
        current_status_description: "En espera de audiencia",
        next_action: "Presentar escrito",
        next_hearing: "2026-08-20T14:00:00",
      };

      const payload = buildCreatePayload(input);

      expect(payload).toHaveProperty("client_id");
      expect(payload).toHaveProperty("expediente");
      expect(payload).toHaveProperty("materia");
      expect(payload).toHaveProperty("process_type");
      expect(payload).toHaveProperty("status");
      expect(payload).toHaveProperty("juzgado");
      expect(payload).toHaveProperty("case_name");
      expect(payload).toHaveProperty("case_type");
      expect(payload).toHaveProperty("case_stage");
      expect(payload).toHaveProperty("case_number");
      expect(payload).toHaveProperty("court");
      expect(payload).toHaveProperty("demandante");
      expect(payload).toHaveProperty("demandado");
      expect(payload).toHaveProperty("judicial_district");
      expect(payload).toHaveProperty("judge_or_prosecutor");
      expect(payload).toHaveProperty("current_summary");
      expect(payload).toHaveProperty("current_status_description");
      expect(payload).toHaveProperty("next_action");
      expect(payload).toHaveProperty("next_hearing");
    });

    it("NO incluye campos opcionales cuando están vacíos", () => {
      const input: CaseInsert = {
        client_id: "client-123",
        expediente: "EXP-011",
        materia: "Penal",
        process_type: "Defensa simple",
        status: "Pendiente de clasificación",
        juzgado: "Por determinar",
      };

      const payload = buildCreatePayload(input);

      expect("case_name" in payload).toBe(false);
      expect("case_type" in payload).toBe(false);
      expect("case_stage" in payload).toBe(false);
      expect("case_number" in payload).toBe(false);
      expect("court" in payload).toBe(false);
      expect("demandante" in payload).toBe(false);
      expect("demandado" in payload).toBe(false);
      expect("judicial_district" in payload).toBe(false);
      expect("judge_or_prosecutor" in payload).toBe(false);
      expect("current_summary" in payload).toBe(false);
      expect("current_status_description" in payload).toBe(false);
      expect("next_action" in payload).toBe(false);
      expect("next_hearing" in payload).toBe(false);
    });
  });
});
