/**
 * Secciones válidas de Configuración (QA-006). Extraído a un módulo propio
 * para poder testear la validación real de ?seccion= sin importar nada
 * desde el archivo de ruta (evita mezclar exports no-componente en un
 * route file, que rompe el Fast Refresh de ese archivo).
 */
export const SECTIONS = [
  "usuarios",
  "backup",
  "herramientas",
  "google-calendar",
  "notificaciones",
  "correo",
  "plantillas",
] as const;

export type Section = (typeof SECTIONS)[number];

export const DEFAULT_SECTION: Section = "usuarios";

/** Sección inválida o ausente cae siempre a DEFAULT_SECTION, nunca a undefined. */
export function isValidSection(value: unknown): value is Section {
  return typeof value === "string" && (SECTIONS as readonly string[]).includes(value);
}
