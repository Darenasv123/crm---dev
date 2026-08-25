/**
 * Fase 8C — capa REST de SOLO LECTURA de carpetas de Google Drive.
 *
 * Deliberadamente separada de google-drive.server.ts: aquí no hay Supabase,
 * ni sesión, ni tokens persistidos -- solo "dado un access token, consulta
 * carpetas". Eso permite probar el comportamiento real (query construida,
 * paginación, parámetros de Unidad compartida, rechazo de archivos que no
 * son carpetas) con `fetch` mockeado, sin montar base de datos ni OAuth.
 *
 * El access token NUNCA sale de servidor: estas funciones lo reciben, pero
 * ninguna ruta lo devuelve al navegador (ver la decisión de no usar Google
 * Picker en server-release/docs/GOOGLE_DRIVE_CONFIGURATION.md).
 *
 * NO existe aquí ninguna operación de escritura: sin files.create, sin
 * update, sin trash, sin descarga de contenido. Eso llega en 8D+.
 */
import { DriveError } from "./drive-errors";

const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";

export const DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

/**
 * Campos mínimos. No se piden `permissions`, `owners`, `description` ni
 * nada del contenido: minimización de datos -- el navegador de carpetas y
 * el matching solo necesitan identidad, nombre y ubicación.
 */
const DRIVE_FOLDER_FIELDS = "id,name,mimeType,parents,driveId,trashed,modifiedTime";

/** Máximo que Drive acepta por página en files.list. */
const DRIVE_PAGE_SIZE = 1000;

/**
 * Tope defensivo de páginas. No es un límite de resultados: si Google
 * devolviera un `nextPageToken` defectuoso (o cíclico), un `while` sin tope
 * se convertiría en un bucle infinito que cuelga el servidor. Al superarlo
 * se lanza un error explícito -- nunca se recortan resultados en silencio,
 * porque una lista de clientes truncada produciría "carpetas sin cliente"
 * falsas en el onboarding.
 */
export const MAX_DRIVE_FOLDER_PAGES = 50;

export interface DriveFolder {
  id: string;
  name: string;
  /** Presente solo si Google lo devuelve; nunca se confía en el del cliente. */
  parents?: string[];
  driveId?: string;
  modifiedTime?: string;
}

interface DriveFileResource {
  id?: string;
  name?: string;
  mimeType?: string;
  parents?: string[];
  driveId?: string;
  trashed?: boolean;
  modifiedTime?: string;
}

export interface DriveScopeOptions {
  /** null/undefined => Mi unidad. Con valor => Unidad compartida. */
  sharedDriveId?: string | null;
}

/**
 * Escapa un valor para interpolarlo dentro de una query de Drive, que usa
 * comillas simples como delimitador. Sin esto, un folderId manipulado con
 * `'` podría cerrar la cadena e inyectar cláusulas en la query (por ejemplo
 * salir del filtro `in parents` y listar carpetas ajenas a la raíz).
 * Google documenta la barra invertida y la comilla escapada como las dos
 * secuencias de escape válidas dentro de esas cadenas.
 */
export function escapeDriveQueryValue(value: string) {
  return value.split("\\").join("\\\\").split("'").join("\\'");
}

/** Hijos DIRECTOS de `parentId` que son carpetas y no están en la papelera. */
export function buildChildFoldersQuery(parentId: string) {
  return [
    `'${escapeDriveQueryValue(parentId)}' in parents`,
    `mimeType = '${DRIVE_FOLDER_MIME_TYPE}'`,
    "trashed = false",
  ].join(" and ");
}

export function buildFolderListSearchParams(input: {
  parentId: string;
  pageToken?: string | null;
  sharedDriveId?: string | null;
}) {
  const params = new URLSearchParams({
    q: buildChildFoldersQuery(input.parentId),
    fields: `nextPageToken,files(${DRIVE_FOLDER_FIELDS})`,
    pageSize: String(DRIVE_PAGE_SIZE),
    orderBy: "name",
    spaces: "drive",
    // Preparación para Unidad compartida (Fase 8C Sección 6): no cambia el
    // comportamiento en Mi unidad, pero evita tener que tocar todas las
    // llamadas más adelante.
    supportsAllDrives: "true",
  });
  if (input.sharedDriveId) {
    params.set("corpora", "drive");
    params.set("driveId", input.sharedDriveId);
    params.set("includeItemsFromAllDrives", "true");
  }
  if (input.pageToken) params.set("pageToken", input.pageToken);
  return params;
}

async function driveGet<T>(url: string, accessToken: string): Promise<T> {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    // El cuerpo de Google NO se propaga: se descarta explícitamente para que
    // no pueda acabar en un mensaje visible ni en un log.
    await response.text().catch(() => "");
    if (response.status === 404) throw new DriveError("DRIVE_FOLDER_NOT_FOUND");
    const error = new Error(`Google Drive respondió ${response.status}.`);
    Object.assign(error, { status: response.status });
    throw error;
  }
  return (await response.json()) as T;
}

function toDriveFolder(file: DriveFileResource): DriveFolder {
  return {
    id: file.id ?? "",
    name: file.name ?? "",
    ...(file.parents ? { parents: file.parents } : {}),
    ...(file.driveId ? { driveId: file.driveId } : {}),
    ...(file.modifiedTime ? { modifiedTime: file.modifiedTime } : {}),
  };
}

/**
 * Lista TODAS las subcarpetas directas de `parentId`, siguiendo la
 * paginación de Drive hasta agotarla. Nunca recorre recursivamente el árbol
 * (Fase 8C Sección 16): las nietas de la raíz -- "Expediente", "Sentencias"
 * dentro de la carpeta de un cliente -- no son candidatas a Cliente.
 */
export async function listChildDriveFolders(
  accessToken: string,
  parentId: string,
  options: DriveScopeOptions = {},
): Promise<DriveFolder[]> {
  const folders: DriveFolder[] = [];
  let pageToken: string | null = null;

  for (let page = 0; page < MAX_DRIVE_FOLDER_PAGES; page += 1) {
    const params = buildFolderListSearchParams({
      parentId,
      pageToken,
      sharedDriveId: options.sharedDriveId ?? null,
    });
    const body: { files?: DriveFileResource[]; nextPageToken?: string } = await driveGet(
      `${DRIVE_FILES_URL}?${params}`,
      accessToken,
    );
    for (const file of body.files ?? []) {
      // Defensa en profundidad: la query ya filtra por mimeType y trashed,
      // pero no se confía en que la respuesta lo respete.
      if (file.mimeType !== DRIVE_FOLDER_MIME_TYPE || file.trashed) continue;
      if (!file.id || !file.name) continue;
      folders.push(toDriveFolder(file));
    }
    pageToken = body.nextPageToken ?? null;
    if (!pageToken) {
      // Orden estable independientemente de cómo pagine Google: `orderBy`
      // ordena dentro de cada página, no el conjunto concatenado.
      return folders.sort((left, right) => left.name.localeCompare(right.name, "es"));
    }
  }

  throw new Error(
    "Google Drive devolvió demasiadas páginas de carpetas; revisa la carpeta seleccionada.",
  );
}

/**
 * Metadata de una carpeta concreta. Rechaza -- con un código estable -- lo
 * que no es una carpeta utilizable: inexistente, un archivo normal, o en la
 * papelera. `parents` que devuelve es la ÚNICA autoridad para navegar hacia
 * arriba; nunca se acepta un parentId enviado por el navegador.
 */
export async function getDriveFolder(
  accessToken: string,
  folderId: string,
  options: DriveScopeOptions = {},
): Promise<DriveFolder> {
  const params = new URLSearchParams({
    fields: DRIVE_FOLDER_FIELDS,
    supportsAllDrives: "true",
  });
  const file = await driveGet<DriveFileResource>(
    `${DRIVE_FILES_URL}/${encodeURIComponent(folderId)}?${params}`,
    accessToken,
  );
  if (!file.id || file.mimeType !== DRIVE_FOLDER_MIME_TYPE) {
    throw new DriveError("DRIVE_FOLDER_NOT_FOUND");
  }
  if (file.trashed) throw new DriveError("DRIVE_FOLDER_TRASHED");
  void options;
  return toDriveFolder(file);
}
