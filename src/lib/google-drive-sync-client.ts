import { supabase } from "@/lib/supabase";

/**
 * Fase 8D — disparadores de sincronización CRM -> Drive desde el navegador.
 *
 * Todas estas llamadas son BEST-EFFORT y NUNCA deben hacer fallar la
 * operación del CRM que las precede. Por eso cada una está envuelta en su
 * propio try/catch y devuelve un resultado en vez de lanzar: si Drive está
 * caído, el documento ya está guardado en Supabase y el usuario no tiene por
 * qué ver un error.
 *
 * El navegador solo envía identificadores del CRM (clientId, documentId).
 * Nunca recibe ni envía un drive_file_id, un drive_folder_id ni un access
 * token: esos los resuelve el servidor a partir de sus mappings.
 */

export type DriveSyncResult = {
  queued: boolean;
  reason?: string;
  operation?: string;
  /** true solo si la petición al CRM falló (Drive conectado pero con error). */
  requestFailed?: boolean;
};

async function post(path: string, body: Record<string, string>): Promise<DriveSyncResult> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) return { queued: false, reason: "no_session" };

    const response = await fetch(path, {
      method: "POST",
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) return { queued: false, requestFailed: true };
    return (await response.json()) as DriveSyncResult;
  } catch {
    // Red caída, servidor no disponible: la operación del CRM ya terminó
    // bien, así que esto no puede escalar a error visible.
    return { queued: false, requestFailed: true };
  }
}

/** Tras crear un Cliente: pedir que se asegure su carpeta en Drive. */
export function requestClientDriveFolderSync(clientId: string) {
  return post("/api/google-drive/sync-client", { clientId });
}

/** Tras crear o renombrar un documento: pedir su sincronización. */
export function requestDocumentDriveSync(documentId: string) {
  return post("/api/google-drive/sync-document", { documentId });
}

/** ANTES de borrar un documento: encolar el traslado a la papelera de Drive. */
export function prepareDocumentDriveTrash(documentId: string) {
  return post("/api/google-drive/prepare-document-trash", { documentId });
}

/**
 * ¿Merece la pena avisar al usuario?
 *
 * Solo cuando Drive está realmente conectado y aun así el encolado falló. Si
 * Drive no está configurado o no está conectado, no hay nada que avisar: el
 * estudio no ha activado la integración y un aviso solo daría la impresión
 * falsa de que algo salió mal con el documento.
 */
export function shouldWarnAboutDriveSync(result: DriveSyncResult): boolean {
  if (result.queued) return false;
  if (result.requestFailed) return true;
  return false;
}
