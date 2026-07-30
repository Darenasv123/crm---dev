import { describe, expect, it } from "vitest";
import { MAX_DOCUMENT_SIZE_BYTES, validateDocumentFile } from "@/hooks/use-documents";
import { validatePaymentInput } from "@/hooks/use-payments";
import { findClientDuplicates, validateClientForm, type ClientRow } from "@/lib/client-validation";
import { displayCaseNumber, normalizeCaseStatus, validateCaseForm } from "@/lib/case-validation";

describe("validaciones operativas", () => {
  it("valida archivos y pagos sin alterar sus reglas vigentes", () => {
    expect(() =>
      validateDocumentFile({ name: "demanda.pdf", size: 1024, type: "application/pdf" }),
    ).not.toThrow();
    expect(() => validateDocumentFile({ name: "script.exe", size: 1024, type: "" })).toThrow(
      /Formato no permitido/,
    );
    expect(() =>
      validateDocumentFile({ name: "archivo.pdf", size: 0, type: "application/pdf" }),
    ).toThrow(/vacío/);
    expect(() =>
      validateDocumentFile({
        name: "archivo.pdf",
        size: MAX_DOCUMENT_SIZE_BYTES + 1,
        type: "application/pdf",
      }),
    ).toThrow(/10 MB/);

    expect(() =>
      validatePaymentInput({
        client_id: "client-1",
        service: "Honorarios",
        fees: 1000,
        total_installments: 2,
      }),
    ).not.toThrow();
  });

  it("permite correo vacío y rechaza un correo inválido", () => {
    expect(
      validateClientForm({
        name: "Cliente de prueba",
        phone: "987654321",
        email: "",
        status: "Activo",
      }).email,
    ).toBe("");
    expect(() =>
      validateClientForm({
        name: "Cliente de prueba",
        phone: "987654321",
        email: "correo-invalido",
        status: "Activo",
      }),
    ).toThrow(/correo válido/);
  });

  it("normaliza contacto y detecta duplicados sólo por datos vigentes", () => {
    const existing: ClientRow = {
      id: "client-1",
      name: "Juan Pérez García",
      phone: "987654321",
      email: "juan@example.test",
      status: "Activo",
      initials: "JP",
      color: "#123456",
      created_at: "2026-01-01T00:00:00Z",
      registered_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      created_by: null,
    };
    const matches = findClientDuplicates(
      {
        name: "Persona distinta",
        phone: "987 654 321",
        email: "",
        status: "Activo",
      },
      [existing],
    );
    expect(matches).toEqual([
      {
        clientId: "client-1",
        clientName: "Juan Pérez García",
        reason: "Mismo teléfono",
        strength: "exact",
      },
    ]);
  });

  it("crea un expediente con el conjunto compacto de campos", () => {
    const payload = validateCaseForm({
      client_id: "client-1",
      expediente: "",
      materia: "Familia",
      process_type: "Alimentos",
      status: "Consulta",
      next_hearing: "",
      next_action: "Revisar escrito",
      current_summary: "",
      current_status_description: "",
    });
    expect(Object.keys(payload).sort()).toEqual(
      [
        "client_id",
        "current_status_description",
        "current_summary",
        "expediente",
        "materia",
        "next_action",
        "next_hearing",
        "process_type",
        "status",
      ].sort(),
    );
    expect(normalizeCaseStatus("Consulta")).toBe("Pendiente de clasificación");
    expect(displayCaseNumber("", null)).toBe("Sin número");
  });
});
