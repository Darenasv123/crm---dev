/**
 * Fase 8D — `appProperties` de los objetos que el CRM crea en Drive.
 *
 * Módulo puro y sin dependencias: solo construye objetos. Se aísla aquí para
 * que exista UNA sola definición de la forma de estas propiedades. Tener dos
 * constructores divergentes sería un fallo silencioso grave: un archivo
 * creado con una forma y reconciliado (tras un 409) comparando con la otra
 * parecería "de otro" y dispararía DRIVE_IDENTITY_CONFLICT sobre un archivo
 * que en realidad es el nuestro.
 *
 * Se usa `appProperties` y NUNCA `properties`: `properties` es visible para
 * cualquiera con acceso al archivo, mientras que `appProperties` solo es
 * legible por el OAuth client que las escribió.
 *
 * MINIMIZACIÓN DE DATOS: solo identificadores internos del CRM. Nunca
 * nombre, DNI, teléfono, correo, materia ni número de expediente. Estas
 * propiedades viven en Google; meter ahí un dato jurídico sería exportarlo
 * fuera del CRM sin que nadie lo haya decidido.
 *
 * Estas marcas son defensa en profundidad para reconciliar identidad, NUNCA
 * el mapping autoritativo: ese vive en google_drive_client_folders y
 * google_drive_document_files (Fase 8A, decisión de arquitectura).
 */

export const DRIVE_ENTITY_CLIENT_FOLDER = "client_folder";
export const DRIVE_ENTITY_DOCUMENT = "document";

export interface DriveClientFolderAppProperties extends Record<string, string> {
  crm_entity: typeof DRIVE_ENTITY_CLIENT_FOLDER;
  crm_client_id: string;
}

export interface DriveDocumentAppProperties extends Record<string, string> {
  crm_entity: typeof DRIVE_ENTITY_DOCUMENT;
  crm_document_id: string;
  crm_client_id: string;
}

/** Marca de una carpeta de Cliente creada por el CRM. */
export function buildDriveClientFolderAppProperties(
  clientId: string,
): DriveClientFolderAppProperties {
  return { crm_entity: DRIVE_ENTITY_CLIENT_FOLDER, crm_client_id: clientId };
}

/** Marca de un documento subido por el CRM. */
export function buildDriveDocumentAppProperties(
  documentId: string,
  clientId: string,
): DriveDocumentAppProperties {
  return {
    crm_entity: DRIVE_ENTITY_DOCUMENT,
    crm_document_id: documentId,
    crm_client_id: clientId,
  };
}

/**
 * ¿Las appProperties que devuelve Drive corresponden a la carpeta de ESTE
 * cliente? Se usa al reconciliar un 409: solo si la identidad coincide se
 * puede tratar el conflicto como "ya lo habíamos creado nosotros".
 */
export function matchesClientFolderIdentity(
  appProperties: Record<string, string> | undefined,
  clientId: string,
): boolean {
  return (
    appProperties?.crm_entity === DRIVE_ENTITY_CLIENT_FOLDER &&
    appProperties?.crm_client_id === clientId
  );
}

/** Equivalente para documentos: deben coincidir documento Y cliente. */
export function matchesDocumentIdentity(
  appProperties: Record<string, string> | undefined,
  documentId: string,
  clientId: string,
): boolean {
  return (
    appProperties?.crm_entity === DRIVE_ENTITY_DOCUMENT &&
    appProperties?.crm_document_id === documentId &&
    appProperties?.crm_client_id === clientId
  );
}

// ── Fase 8E: clasificación de propiedad para archivos descubiertos en Drive
/**
 * Al importar un archivo que apareció manualmente en Drive, lo primero que
 * hay que descartar es que en realidad NO sea manual: pudo haberlo creado el
 * propio CRM (una subida outbound) o pudo ser el rastro de un documento que
 * el CRM ya borró. Tratar cualquiera de esos casos como "documento nuevo"
 * sería gravísimo -- en el segundo caso, literalmente resucitaría un
 * documento que alguien eliminó a propósito.
 *
 * "unmanaged": sin `crm_entity`. Candidato normal a import.
 * "known_document": `crm_entity="document"` con forma reconocible. El
 *   llamador debe cruzar `documentId` contra la tabla `documents` del CRM
 *   para decidir entre "ya gestionado" (existe) o "huérfano" (no existe) --
 *   esta función es pura y no consulta la base de datos.
 * "conflict": existe `crm_entity` pero con una forma que no reconocemos
 *   (falta algún campo, o el valor de `crm_entity` no es ninguno de los
 *   conocidos). Nunca se ignora en silencio: se trata como un archivo
 *   posiblemente gestionado por el CRM hasta que una persona lo revise.
 */
export type DriveAppPropertyOwnership =
  | { kind: "unmanaged" }
  | { kind: "known_document"; documentId: string; clientId: string }
  | { kind: "conflict" };

export function classifyAppPropertiesOwnership(
  appProperties: Record<string, string> | undefined,
): DriveAppPropertyOwnership {
  const entity = appProperties?.crm_entity;
  if (entity === undefined) return { kind: "unmanaged" };

  if (entity === DRIVE_ENTITY_DOCUMENT) {
    const documentId = appProperties?.crm_document_id;
    const clientId = appProperties?.crm_client_id;
    if (documentId && clientId) return { kind: "known_document", documentId, clientId };
    return { kind: "conflict" };
  }

  // crm_entity="client_folder" (o cualquier otro valor futuro) no es una
  // forma que un ARCHIVO (no carpeta) deba tener nunca. También conflicto.
  return { kind: "conflict" };
}
