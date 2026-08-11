/**
 * zip-import/client-normalizer.ts
 *
 * Normalización de nombres de clientes para:
 *  - Deduplicación insensible a mayúsculas, tildes, espacios y comas.
 *  - Comparación segura entre nombre del ZIP y nombres existentes en la DB.
 *
 * Conserva el nombre visible original; genera solo el nombre normalizado.
 */

/**
 * Normaliza un nombre de carpeta/cliente para comparación:
 *  - Trim de espacios
 *  - Colapsa espacios múltiples
 *  - Minúsculas
 *  - Elimina tildes y diacríticos
 *  - Elimina caracteres no alfanuméricos excepto espacios
 *    (conserva el espacio como separador de palabras)
 */
export function normalizeClientName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // elimina diacríticos
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ") // coma, paréntesis, etc. → espacio
    .replace(/\s+/g, " ")
    .trim();
}

export type DuplicateStrength = "exact" | "probable" | "none";

export interface DuplicateMatch {
  /** ID del cliente existente en la DB */
  clientId: string;
  /** Nombre original del cliente en la DB */
  clientName: string;
  /** Fuerza de la coincidencia */
  strength: DuplicateStrength;
  /** Descripción de la razón */
  reason: string;
}

/**
 * Compara un nombre de candidato (del ZIP) contra una lista de clientes existentes.
 * Devuelve la mejor coincidencia o null si no hay ninguna.
 *
 * Criterios en orden de prioridad:
 *  1. Coincidencia exacta del nombre normalizado.
 *  2. Coincidencia probable: ≥ 2 tokens compartidos y ≥ 75% de cobertura.
 */
export function findClientMatch(
  candidateName: string,
  existingClients: Array<{ id: string; name: string }>,
): DuplicateMatch | null {
  const normalized = normalizeClientName(candidateName);
  const candidateTokens = normalized.split(" ").filter((t) => t.length > 2);

  let bestProbable: DuplicateMatch | null = null;
  let bestScore = 0;

  for (const client of existingClients) {
    const existingNorm = normalizeClientName(client.name);

    // 1. Exacto
    if (existingNorm === normalized) {
      return {
        clientId: client.id,
        clientName: client.name,
        strength: "exact",
        reason: "Nombre idéntico (normalizado)",
      };
    }

    // 2. Probable
    const existingTokens = existingNorm.split(" ").filter((t) => t.length > 2);
    const existingSet = new Set(existingTokens);
    const shared = candidateTokens.filter((t) => existingSet.has(t)).length;
    const denominator = Math.max(1, Math.min(candidateTokens.length, existingTokens.length));
    const score = shared / denominator;

    if (shared >= 2 && score >= 0.75 && score > bestScore) {
      bestScore = score;
      bestProbable = {
        clientId: client.id,
        clientName: client.name,
        strength: "probable",
        reason: `${shared} palabras en común (${Math.round(score * 100)}% similitud)`,
      };
    }
  }

  return bestProbable;
}

/**
 * Detecta duplicados dentro de la propia lista de candidatos del ZIP.
 * Devuelve pares de índices con coincidencia (para advertir antes de importar).
 */
export interface InternalDuplicate {
  indexA: number;
  indexB: number;
  nameA: string;
  nameB: string;
  strength: DuplicateStrength;
}

export function findInternalDuplicates(names: string[]): InternalDuplicate[] {
  const result: InternalDuplicate[] = [];
  const normalized = names.map(normalizeClientName);

  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      if (normalized[i] === normalized[j]) {
        result.push({ indexA: i, indexB: j, nameA: names[i], nameB: names[j], strength: "exact" });
        continue;
      }
      const tokensA = normalized[i].split(" ").filter((t) => t.length > 2);
      const tokensB = normalized[j].split(" ").filter((t) => t.length > 2);
      const setB = new Set(tokensB);
      const shared = tokensA.filter((t) => setB.has(t)).length;
      const denom = Math.max(1, Math.min(tokensA.length, tokensB.length));
      if (shared >= 2 && shared / denom >= 0.75) {
        result.push({
          indexA: i,
          indexB: j,
          nameA: names[i],
          nameB: names[j],
          strength: "probable",
        });
      }
    }
  }
  return result;
}
