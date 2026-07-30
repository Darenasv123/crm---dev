import { normalizeDigits, normalizeText, validateClientForm } from "@/lib/client-validation";
import { stripUtf8Bom } from "@/lib/text-utils";

export type ClientImportRow = {
  name: string;
  phone: string;
  email: string;
  status: string;
  valid: boolean;
  error?: string;
};

const aliases = {
  name: ["nombre", "name", "nombre completo", "full name", "cliente"],
  phone: ["telefono", "teléfono", "celular", "phone", "movil", "móvil", "tel"],
  email: ["email", "correo", "mail"],
  status: ["estado", "status"],
};

function normalizeStatus(value: string) {
  const normalized = normalizeText(value);
  if (["en espera", "espera", "pending"].includes(normalized)) return "En espera";
  if (["cerrado", "closed", "0"].includes(normalized)) return "Cerrado";
  return "Activo";
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  values.push(current.trim());
  return values;
}

function columnIndexes(headers: string[]) {
  const normalized = headers.map(normalizeText);
  return Object.fromEntries(
    Object.entries(aliases).map(([field, options]) => [
      field,
      normalized.findIndex((header) => options.some((option) => header === normalizeText(option))),
    ]),
  ) as Record<keyof typeof aliases, number>;
}

export function parseClientRows(matrix: string[][]): ClientImportRow[] {
  if (matrix.length < 2) return [];
  const indexes = columnIndexes(matrix[0]);
  return matrix
    .slice(1)
    .filter((row) => row.some((value) => value.trim()))
    .map((row) => {
      const get = (field: keyof typeof aliases) =>
        indexes[field] >= 0 ? String(row[indexes[field]] ?? "").trim() : "";
      const candidate = {
        name: get("name"),
        phone: normalizeDigits(get("phone")),
        email: get("email"),
        status: normalizeStatus(get("status")),
      };
      try {
        return { ...validateClientForm(candidate), valid: true };
      } catch (cause) {
        return {
          ...candidate,
          valid: false,
          error: cause instanceof Error ? cause.message : "Fila no válida.",
        };
      }
    });
}

export function parseClientCsvText(text: string) {
  const lines = stripUtf8Bom(text)
    .split(/\r?\n/)
    .filter((line) => line.trim());
  return parseClientRows(lines.map(parseCsvLine));
}
