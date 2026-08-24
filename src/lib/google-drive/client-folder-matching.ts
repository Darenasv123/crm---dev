/**
 * google-drive/client-folder-matching.ts
 *
 * Fase 8A — diseño puro, sin conexión real a Drive todavía.
 *
 * Clasifica candidatos de vinculación Cliente CRM ↔ Carpeta Drive durante el
 * onboarding inicial (Fase 8C). Deliberadamente MÁS ESTRICTO que
 * `zip-import/client-normalizer.ts`'s `findClientMatch`: ese matcher permite
 * un tercer nivel "probable" por solapamiento de tokens (≥2 palabras
 * compartidas, ≥75% cobertura) -- útil para sugerir clientes posiblemente
 * duplicados durante la importación de ZIP, donde el humano de todas formas
 * crea/fusiona manualmente. Vincular una carpeta de documentos jurídicos a un
 * Cliente es una operación de mayor riesgo (un documento mal vinculado puede
 * exponerse al cliente equivocado o perder su relación jurídica real), así
 * que aquí NO se reutiliza ese nivel "probable": solo EXACT_MATCH y
 * NORMALIZED_MATCH auto-clasifican; cualquier otra señal de similitud cae en
 * AMBIGUOUS y requiere selección manual del Administrador.
 *
 * Sí se reutiliza `normalizeClientName` (trim, colapso de espacios,
 * minúsculas, sin diacríticos, sin puntuación) tal cual -- es la misma
 * primitiva de normalización ya probada por el importador de ZIP, sin
 * reimplementarla.
 */
import { normalizeClientName } from "@/lib/zip-import/client-normalizer";

export type ClientFolderMatchType = "EXACT_MATCH" | "NORMALIZED_MATCH" | "AMBIGUOUS" | "NO_MATCH";

export interface DriveFolderCandidate {
  /** drive_folder_id real -- nunca se usa el nombre como identidad persistente. */
  id: string;
  name: string;
}

export interface ClientFolderMatchResult {
  type: ClientFolderMatchType;
  /**
   * EXACT_MATCH / NORMALIZED_MATCH: exactamente 1 candidato.
   * AMBIGUOUS: 2 o más candidatos (requiere que el Administrador elija).
   * NO_MATCH: 0 candidatos.
   */
  candidates: DriveFolderCandidate[];
}

/**
 * Clasifica las carpetas Drive candidatas para un Cliente CRM dado.
 *
 * Orden de evaluación:
 *   1. Coincidencia EXACTA de texto (sin normalizar) -- si hay más de una,
 *      es AMBIGUOUS (dos carpetas con el nombre idéntico, ej. duplicado
 *      accidental en Drive).
 *   2. Si no hay coincidencia exacta, coincidencia por nombre NORMALIZADO
 *      (acentos/mayúsculas/espacios) -- misma regla: más de una es AMBIGUOUS.
 *   3. Si ninguna carpeta coincide ni exacta ni normalizadamente: NO_MATCH.
 *
 * Nunca hace matching parcial/por token/por distancia de edición.
 */
export function matchClientToFolders(
  clientName: string,
  folders: DriveFolderCandidate[],
): ClientFolderMatchResult {
  const exact = folders.filter((folder) => folder.name === clientName);
  if (exact.length === 1) return { type: "EXACT_MATCH", candidates: exact };
  if (exact.length > 1) return { type: "AMBIGUOUS", candidates: exact };

  const normalizedClient = normalizeClientName(clientName);
  const normalized = folders.filter(
    (folder) => normalizeClientName(folder.name) === normalizedClient,
  );
  if (normalized.length === 1) return { type: "NORMALIZED_MATCH", candidates: normalized };
  if (normalized.length > 1) return { type: "AMBIGUOUS", candidates: normalized };

  return { type: "NO_MATCH", candidates: [] };
}

/**
 * Resultado de una pasada completa de onboarding (Fase 8C, Sección 9 del
 * pedido): cada Cliente CRM contra el listado de subcarpetas directas de la
 * carpeta raíz configurada, más las carpetas Drive que no coincidieron con
 * ningún Cliente. Estructura de solo lectura para el modo dry-run -- no
 * implica ninguna escritura en Drive ni en Supabase.
 */
export interface OnboardingPreview {
  linked: Array<{ clientId: string; clientName: string; folder: DriveFolderCandidate }>;
  suggested: Array<{
    clientId: string;
    clientName: string;
    folder: DriveFolderCandidate;
    matchType: "NORMALIZED_MATCH";
  }>;
  ambiguous: Array<{
    clientId: string;
    clientName: string;
    candidates: DriveFolderCandidate[];
  }>;
  withoutFolder: Array<{ clientId: string; clientName: string }>;
  unclaimedFolders: DriveFolderCandidate[];
}

/**
 * Calcula la vista previa de onboarding SIN mutar nada. `alreadyLinked`
 * representa clientes que ya tienen `drive_folder_id` persistido de una
 * corrida anterior -- se muestran como `linked` directamente, sin volver a
 * clasificarlos (cambiar el nombre del Cliente o de la carpeta después de
 * vincular NO debe reabrir el matching, ver Sección 6 del pedido).
 */
export function computeOnboardingPreview(
  clients: Array<{ id: string; name: string; driveFolderId: string | null }>,
  folders: DriveFolderCandidate[],
): OnboardingPreview {
  const preview: OnboardingPreview = {
    linked: [],
    suggested: [],
    ambiguous: [],
    withoutFolder: [],
    unclaimedFolders: [],
  };
  const claimedFolderIds = new Set<string>();

  for (const client of clients) {
    if (client.driveFolderId) {
      const folder = folders.find((f) => f.id === client.driveFolderId);
      if (folder) {
        preview.linked.push({ clientId: client.id, clientName: client.name, folder });
        claimedFolderIds.add(folder.id);
      }
      // Si la carpeta ya no existe en el listado (borrada/movida fuera de la
      // raíz), no se reclasifica automáticamente aquí -- eso es un caso de
      // DRIVE_PARENT_MISMATCH / carpeta faltante a resolver en 8F, no un
      // problema de matching inicial.
      continue;
    }

    const match = matchClientToFolders(client.name, folders);
    if (match.type === "EXACT_MATCH") {
      preview.linked.push({
        clientId: client.id,
        clientName: client.name,
        folder: match.candidates[0],
      });
      claimedFolderIds.add(match.candidates[0].id);
    } else if (match.type === "NORMALIZED_MATCH") {
      preview.suggested.push({
        clientId: client.id,
        clientName: client.name,
        folder: match.candidates[0],
        matchType: "NORMALIZED_MATCH",
      });
    } else if (match.type === "AMBIGUOUS") {
      preview.ambiguous.push({
        clientId: client.id,
        clientName: client.name,
        candidates: match.candidates,
      });
    } else {
      preview.withoutFolder.push({ clientId: client.id, clientName: client.name });
    }
  }

  preview.unclaimedFolders = folders.filter((folder) => !claimedFolderIds.has(folder.id));
  return preview;
}
