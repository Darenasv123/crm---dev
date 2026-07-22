import { describe, expect, it } from "vitest";
import { MAX_DOCUMENT_SIZE_BYTES, validateDocumentFile } from "../src/hooks/use-documents";
import { validatePaymentInput } from "../src/hooks/use-payments";

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
