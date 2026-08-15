/**
 * tests/zip-import-error-handling.test.ts
 *
 * Prueba de regresión para el bug QA-IMPORT-TEST-20260815 (Fase 4):
 * tras el fallo de creación del import_job (constraint
 * import_jobs_status_check), la UI se rompió con
 * "Cannot read properties of undefined (reading 'includes')".
 *
 * vitest.config.ts usa environment: "node" (sin jsdom/happy-dom), por lo que
 * este archivo no intenta renderizar componentes React (ZipImportErrorBoundary
 * incluido) — sigue el mismo patrón que el resto del repo: probar la lógica
 * pura que respalda el comportamiento, no el árbol de React. Ver
 * src/components/zip-import/zip-import-error-boundary.tsx para el boundary
 * que consume describeCaughtError, y src/routes/_app.configuracion.index.tsx
 * para el uso de importJobStatusTone.
 */

import { describe, it, expect } from "vitest";
import { describeCaughtError } from "@/lib/zip-import/describe-caught-error";
import { importJobStatusTone } from "@/lib/import-jobs-status";

describe("describeCaughtError (bug QA-IMPORT-TEST-20260815)", () => {
  const fallback = "mensaje de repuesto";

  it("devuelve error.message para una instancia real de Error", () => {
    expect(describeCaughtError(new Error("No se pudo crear el import_job: boom"), fallback)).toBe(
      "No se pudo crear el import_job: boom",
    );
  });

  it("devuelve error.message para un TypeError (instanceof Error también)", () => {
    // Reproduce el tipo de valor exacto que dispara el bug reportado:
    // "Cannot read properties of undefined (reading 'includes')" es un
    // TypeError, y TypeError extiende Error — describeCaughtError debe
    // tratarlo igual que cualquier otro Error, nunca romperse con él.
    const typeError = new TypeError("Cannot read properties of undefined (reading 'includes')");
    expect(describeCaughtError(typeError, fallback)).toBe(
      "Cannot read properties of undefined (reading 'includes')",
    );
  });

  it("devuelve el valor cuando el error capturado es un string no vacío", () => {
    expect(describeCaughtError("mensaje plano", fallback)).toBe("mensaje plano");
  });

  it("nunca asume que el valor capturado está definido: undefined usa el fallback", () => {
    expect(describeCaughtError(undefined, fallback)).toBe(fallback);
  });

  it("nunca asume que el valor capturado está definido: null usa el fallback", () => {
    expect(describeCaughtError(null, fallback)).toBe(fallback);
  });

  it("usa el fallback para un objeto plano sin forma de Error (p.ej. un JSON de error crudo)", () => {
    expect(describeCaughtError({ unhandled: true, message: "HTTPError" }, fallback)).toBe(fallback);
  });

  it("usa el fallback para un Error con message vacío", () => {
    expect(describeCaughtError(new Error(""), fallback)).toBe(fallback);
  });

  it("usa el fallback para un string vacío", () => {
    expect(describeCaughtError("", fallback)).toBe(fallback);
  });

  it("usa el fallback para valores numéricos o booleanos capturados", () => {
    expect(describeCaughtError(0, fallback)).toBe(fallback);
    expect(describeCaughtError(false, fallback)).toBe(fallback);
  });
});

describe("importJobStatusTone (bug QA-IMPORT-TEST-20260815, panel de Configuración)", () => {
  it("clasifica los estados conocidos", () => {
    expect(importJobStatusTone("completed")).toBe("success");
    expect(importJobStatusTone("partially_completed")).toBe("default");
    expect(importJobStatusTone("failed")).toBe("danger");
    expect(importJobStatusTone("processing")).toBe("warning");
  });

  it("es insensible a mayúsculas", () => {
    expect(importJobStatusTone("COMPLETED")).toBe("success");
  });

  it("nunca asume que status está definido: undefined no revienta y cae en 'default'", () => {
    expect(importJobStatusTone(undefined)).toBe("default");
  });

  it("nunca asume que status está definido: null no revienta y cae en 'default'", () => {
    expect(importJobStatusTone(null)).toBe("default");
  });

  it("cae en 'default' para un estado desconocido", () => {
    expect(importJobStatusTone("review_required")).toBe("default");
  });
});
