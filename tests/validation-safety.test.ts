import { describe, expect, it } from "vitest";
import { MAX_DOCUMENT_SIZE_BYTES, validateDocumentFile } from "../src/hooks/use-documents";
import { validatePaymentInput } from "../src/hooks/use-payments";
import {
  findClientDuplicates,
  validateClientForm,
  type ClientRow,
} from "../src/lib/client-validation";

describe("document upload validation", () => {
  it("accepts supported documents within the size limit", () => {
    expect(() =>
      validateDocumentFile({ name: "demanda.pdf", size: 1024, type: "application/pdf" }),
    ).not.toThrow();
  });

  it("rejects unsupported extensions", () => {
    expect(() => validateDocumentFile({ name: "script.exe", size: 1024, type: "" })).toThrow(
      /Formato no permitido/,
    );
  });

  it("rejects empty and oversized files", () => {
    expect(() =>
      validateDocumentFile({ name: "dni.pdf", size: 0, type: "application/pdf" }),
    ).toThrow(/vacio/);
    expect(() =>
      validateDocumentFile({
        name: "archivo.pdf",
        size: MAX_DOCUMENT_SIZE_BYTES + 1,
        type: "application/pdf",
      }),
    ).toThrow(/10 MB/);
  });
});

describe("payment validation", () => {
  it("accepts a valid payment", () => {
    expect(() =>
      validatePaymentInput({
        client_id: "client-1",
        service: "Honorarios",
        fees: 1000,
        total_installments: 2,
      }),
    ).not.toThrow();
  });

  it("rejects invalid amounts and installments", () => {
    expect(() =>
      validatePaymentInput({
        client_id: "client-1",
        service: "Honorarios",
        fees: -1,
        total_installments: 1,
      }),
    ).toThrow(/mayores a 0/);
    expect(() =>
      validatePaymentInput({
        client_id: "client-1",
        service: "Honorarios",
        fees: 100,
        total_installments: 0,
      }),
    ).toThrow(/cuotas/);
  });
});

describe("client validation", () => {
  it("validates DNI, RUC, phone and email", () => {
    expect(() =>
      validateClientForm({
        name: "Cliente Uno",
        document_type: "DNI",
        document_number: "12345678",
        phone: "987654321",
        whatsapp: "",
        email: "cliente@mail.com",
        occupation: "",
        process_type: "Familia",
        status: "Activo",
        address: "",
        notes: "",
      }),
    ).not.toThrow();

    expect(() =>
      validateClientForm({
        name: "Empresa SAC",
        document_type: "RUC",
        document_number: "20123456789",
        phone: "987654321",
        whatsapp: "",
        email: "",
        occupation: "",
        process_type: "Civil",
        status: "Activo",
        address: "",
        notes: "",
      }),
    ).not.toThrow();

    expect(() =>
      validateClientForm({
        name: "Cliente Dos",
        document_type: "DNI",
        document_number: "123",
        phone: "987654321",
        whatsapp: "",
        email: "",
        occupation: "",
        process_type: "Penal",
        status: "Activo",
        address: "",
        notes: "",
      }),
    ).toThrow(/DNI/);
  });

  it("warns about exact and approximate duplicates without overwriting", () => {
    const existing: ClientRow[] = [
      {
        id: "client-1",
        name: "Juan Perez Garcia",
        dni: "12345678",
        document_type: "DNI",
        document_number: "12345678",
        phone: "987654321",
        whatsapp: null,
        email: "juan@mail.com",
        process_type: "Penal",
        status: "Activo",
        initials: "JP",
        color: "blue",
        address: null,
        birthdate: null,
        civil_status: null,
        occupation: null,
        notes: null,
        created_at: "2026-01-01T00:00:00Z",
        registered_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        created_by: null,
      },
    ];

    expect(
      findClientDuplicates(
        {
          name: "Juan Perez G.",
          document_type: "DNI",
          document_number: "87654321",
          phone: "912345678",
          whatsapp: "",
          email: "",
          occupation: "",
          process_type: "Penal",
          status: "Activo",
          address: "",
          notes: "",
        },
        existing,
      )[0]?.strength,
    ).toBe("approximate");

    expect(
      findClientDuplicates(
        {
          name: "Otro Cliente",
          document_type: "DNI",
          document_number: "12345678",
          phone: "912345678",
          whatsapp: "",
          email: "",
          occupation: "",
          process_type: "Penal",
          status: "Activo",
          address: "",
          notes: "",
        },
        existing,
      )[0]?.reason,
    ).toMatch(/DNI\/RUC/);
  });
});
