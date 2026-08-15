/**
 * import-jobs-status.ts
 *
 * Utilidad pura para clasificar el estado visual (tone) de un import_job en
 * el panel de Configuración → Historial de importaciones.
 *
 * Se extrajo de src/routes/_app.configuracion.index.tsx (antes `statusTone`,
 * función local no exportada) durante el diagnóstico del bug QA-IMPORT-
 * TEST-20260815: la versión original hacía `status.toLowerCase()` sin
 * comprobar que `status` estuviera definido. import_jobs.status es NOT NULL
 * en el esquema, pero el propio bug diagnosticado en paralelo (constraint
 * import_jobs_status_check desalineado en self-hosted) demuestra que no hay
 * que confiar en que los datos que llegan del backend siempre respeten el
 * contrato esperado — de ahí la comprobación explícita aquí.
 */
export function importJobStatusTone(
  status: string | null | undefined,
): "default" | "success" | "warning" | "danger" | "info" {
  const value = (status ?? "").toLowerCase();
  if (["completed", "success", "done"].includes(value)) return "success";
  if (["failed", "error"].includes(value)) return "danger";
  if (["processing", "running", "pending"].includes(value)) return "warning";
  return "default";
}
