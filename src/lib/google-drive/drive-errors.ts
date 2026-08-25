/**
 * Fase 8C — clasificación mínima de errores de la integración de Drive.
 *
 * Motivo: el resto del módulo nunca debe filtrar el cuerpo crudo de la
 * respuesta de Google al cliente (puede contener rutas internas, IDs de
 * proyecto o detalles del grant). Estas clases dan un código estable que la
 * UI puede interpretar y un mensaje en español ya saneado, sin exponer nada
 * de Google.
 */

export const DRIVE_ERROR_CODES = [
  "DRIVE_NOT_CONFIGURED",
  "DRIVE_NOT_CONNECTED",
  "DRIVE_ROOT_NOT_CONFIGURED",
  "DRIVE_FOLDER_NOT_FOUND",
  "DRIVE_FOLDER_TRASHED",
  "DRIVE_FOLDER_OUTSIDE_ROOT",
  "CLIENT_ALREADY_LINKED",
  "DRIVE_FOLDER_ALREADY_LINKED",
  "ROOT_FOLDER_HAS_EXISTING_MAPPINGS",
  // Fase 8C.1: la carpeta raíz cambió entre que el servidor la leyó y el
  // momento de escribir. No es un fallo del usuario -- basta con reintentar
  // sobre el estado nuevo.
  "DRIVE_ROOT_CHANGED_RETRY",
  // Fase 8C.1: la coincidencia mostrada en la vista previa dejó de ser
  // segura (la carpeta o el cliente se renombraron, o apareció otra carpeta
  // que ahora la vuelve ambigua). Requiere que el Administrador vuelva a
  // revisar en vez de guardar una clasificación que ya no es cierta.
  "MATCH_CHANGED_REVIEW",
] as const;

export type DriveErrorCode = (typeof DRIVE_ERROR_CODES)[number];

const DRIVE_ERROR_MESSAGES: Record<DriveErrorCode, string> = {
  DRIVE_NOT_CONFIGURED: "Google Drive no está configurado en este servidor.",
  DRIVE_NOT_CONNECTED: "Google Drive no está conectado.",
  DRIVE_ROOT_NOT_CONFIGURED: "Todavía no se ha seleccionado la carpeta raíz de Google Drive.",
  DRIVE_FOLDER_NOT_FOUND: "La carpeta ya no existe en Google Drive.",
  DRIVE_FOLDER_TRASHED: "La carpeta está en la papelera de Google Drive.",
  DRIVE_FOLDER_OUTSIDE_ROOT:
    "La carpeta no está directamente dentro de la carpeta raíz configurada.",
  CLIENT_ALREADY_LINKED: "El cliente ya está vinculado a otra carpeta de Google Drive.",
  DRIVE_FOLDER_ALREADY_LINKED: "La carpeta ya está vinculada a otro cliente.",
  ROOT_FOLDER_HAS_EXISTING_MAPPINGS:
    "No se puede cambiar la carpeta raíz: ya existen clientes vinculados a carpetas dentro de la raíz actual.",
  DRIVE_ROOT_CHANGED_RETRY:
    "La carpeta raíz cambió mientras se procesaba la operación. Vuelve a cargar y reinténtalo.",
  MATCH_CHANGED_REVIEW:
    "Alguna coincidencia dejó de ser segura desde que se calculó la vista previa. Vuelve a revisarla antes de guardar.",
};

/**
 * 409 para los conflictos de estado (ya vinculado / raíz con mappings):
 * distinguirlos de un 400 permite que la UI muestre "esto ya está hecho o
 * choca con algo existente" en vez de "enviaste algo mal formado".
 */
const DRIVE_ERROR_STATUS: Record<DriveErrorCode, number> = {
  DRIVE_NOT_CONFIGURED: 400,
  DRIVE_NOT_CONNECTED: 400,
  DRIVE_ROOT_NOT_CONFIGURED: 400,
  DRIVE_FOLDER_NOT_FOUND: 404,
  DRIVE_FOLDER_TRASHED: 400,
  DRIVE_FOLDER_OUTSIDE_ROOT: 400,
  CLIENT_ALREADY_LINKED: 409,
  DRIVE_FOLDER_ALREADY_LINKED: 409,
  ROOT_FOLDER_HAS_EXISTING_MAPPINGS: 409,
  // 409: conflicto con el estado actual, reintentable tras recargar.
  DRIVE_ROOT_CHANGED_RETRY: 409,
  MATCH_CHANGED_REVIEW: 409,
};

export class DriveError extends Error {
  readonly code: DriveErrorCode;
  readonly status: number;

  constructor(code: DriveErrorCode, detail?: string) {
    super(detail ? `${DRIVE_ERROR_MESSAGES[code]} ${detail}` : DRIVE_ERROR_MESSAGES[code]);
    this.name = "DriveError";
    this.code = code;
    this.status = DRIVE_ERROR_STATUS[code];
  }
}

export function isDriveError(value: unknown): value is DriveError {
  return value instanceof DriveError;
}

/**
 * Traduce el mensaje de una excepción lanzada por la RPC de apply. La RPC
 * usa `raise exception ... using errcode` con los mismos códigos, así que
 * el mensaje que devuelve PostgREST empieza por el código -- lo convertimos
 * de nuevo a DriveError para no filtrar el texto crudo de Postgres.
 */
export function driveErrorFromPostgres(message: string): DriveError | null {
  for (const code of DRIVE_ERROR_CODES) {
    if (message.includes(code)) return new DriveError(code);
  }
  return null;
}
