import { describe, expect, it } from "vitest";
import { validateCaseForm } from "@/lib/case-validation";

describe("payload simplificado de expedientes", () => {
  it("normaliza únicamente la información operativa", () => {
    expect(
      validateCaseForm({
        client_id: " client-1 ",
        expediente: " 00042-2026 ",
        materia: "Penal",
        process_type: " Defensa ",
        status: "En proceso",
        next_hearing: "2026-08-20",
        next_action: " Preparar audiencia ",
        current_summary: " Resumen ",
        current_status_description: " En trámite ",
      }),
    ).toEqual({
      client_id: "client-1",
      expediente: "00042-2026",
      materia: "Penal",
      process_type: "Defensa",
      status: "En trámite",
      next_hearing: "2026-08-20",
      next_action: "Preparar audiencia",
      current_summary: "Resumen",
      current_status_description: "En trámite",
    });
  });

  it("rechaza materia desconocida", () => {
    expect(() =>
      validateCaseForm({
        client_id: "client-1",
        expediente: "42",
        materia: "Otra",
        process_type: "Consulta",
        status: "Consulta",
      }),
    ).toThrow(/materia/);
  });
});
