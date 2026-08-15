/**
 * describe-caught-error.ts
 *
 * Convierte cualquier valor capturado en un catch (o en un React error
 * boundary) en un mensaje de texto seguro para mostrar al usuario.
 *
 * Se introdujo durante el diagnóstico del bug QA-IMPORT-TEST-20260815
 * ("Cannot read properties of undefined (reading 'includes')" tras el
 * fallo de creación del import_job). No se pudo reproducir de forma
 * determinista el punto exacto de ese TypeError dentro de este sandbox
 * (sin servidor de desarrollo ni navegador disponibles — ver el informe de
 * la Fase 4/6), pero el patrón de raíz es siempre el mismo: código que
 * asume que un valor capturado en un catch (o el error de un render) es
 * una instancia de Error con `.message` definido, cuando en realidad puede
 * ser cualquier cosa — undefined, un string, un objeto plano, etc.
 *
 * Esta función centraliza esa conversión de forma explícitamente segura
 * (nunca asume el tipo del valor recibido) y la reutilizan tanto los
 * catch de src/components/zip-import/zip-importer.tsx como
 * ZipImportErrorBoundary, para que ambos puntos de fallo compartan la
 * misma garantía y la misma cobertura de pruebas.
 */
export function describeCaughtError(error: unknown, fallback: string): string {
  if (error instanceof Error && typeof error.message === "string" && error.message.length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.length > 0) {
    return error;
  }
  return fallback;
}
