/**
 * Tests for CSV/Excel import parsing logic.
 * These test the pure parsing functions extracted from csv-import.tsx.
 *
 * NOTE: parseExcel cannot be tested here (requires ExcelJS + ArrayBuffer).
 *       Those paths are covered by the browser-level integration test steps
 *       documented in HANDOFF.md.
 */
import { describe, expect, it } from "vitest";
import { stripUtf8Bom } from "../src/lib/text-utils";

// ─── Replicated helpers (same logic as csv-import.tsx) ─────────────────────

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  result.push(cur.trim());
  return result;
}

function normalizeStatus(raw: string): string {
  const map: Record<string, string> = {
    activo: "Activo",
    active: "Activo",
    si: "Activo",
    "1": "Activo",
    "en espera": "En espera",
    espera: "En espera",
    pending: "En espera",
    cerrado: "Cerrado",
    closed: "Cerrado",
    "0": "Cerrado",
  };
  return map[(raw ?? "").trim().toLowerCase()] ?? "Activo";
}

function validateRow(row: { name: string; dni: string; phone: string }): string | undefined {
  if (!row.name.trim()) return "Nombre requerido";
  if (row.dni.length !== 8) return `DNI debe tener 8 dígitos (tiene ${row.dni.length})`;
  if (row.phone.length !== 9) return `Teléfono debe tener 9 dígitos (tiene ${row.phone.length})`;
  return undefined;
}

const COL_ALIASES: Record<string, string[]> = {
  name: ["nombre", "name", "nombre completo", "full name", "cliente"],
  dni: ["dni", "ruc", "documento", "cedula", "id"],
  phone: ["telefono", "teléfono", "celular", "phone", "movil", "móvil", "tel"],
  email: ["email", "correo", "mail"],
  process_type: ["tipo", "proceso", "materia", "process_type", "especialidad"],
  status: ["estado", "status"],
};

function buildColIndex(headers: string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(COL_ALIASES)) {
    const idx = headers.findIndex((h) => aliases.some((alias) => h.includes(alias)));
    result[field] = idx;
  }
  return result;
}

function parseCSV(text: string) {
  const lines = stripUtf8Bom(text).trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headerLine = parseCSVLine(lines[0]).map((h) =>
    h.toLowerCase().replace(/^["'\s]+|["'\s]+$/g, ""),
  );
  const cols = buildColIndex(headerLine);
  return lines
    .slice(1)
    .filter((l) => l.trim())
    .map((line) => {
      const vals = parseCSVLine(line).map((v) => v.replace(/^["']+|["']+$/g, "").trim());
      const get = (field: string) => (cols[field] >= 0 ? (vals[cols[field]] ?? "") : "");
      const name = get("name");
      const dni = get("dni").replace(/\D/g, "");
      const phone = get("phone").replace(/\D/g, "");
      const email = get("email");
      const process_type = get("process_type") || "Defensa penal — Otros";
      const status = normalizeStatus(get("status"));
      const error = validateRow({ name, dni, phone });
      return { name, dni, phone, email, process_type, status, valid: !error, error };
    });
}

function validateFileType(fileName: string): { ok: boolean; error?: string } {
  const name = fileName.toLowerCase();
  if (name.endsWith(".csv") || name.endsWith(".xlsx")) return { ok: true };
  if (name.endsWith(".xls")) {
    return {
      ok: false,
      error: "El formato .xls (Excel 97-2003) no está soportado.",
    };
  }
  return { ok: false, error: `Formato no soportado: "${fileName}"` };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("parseCSVLine", () => {
  it("splits a simple line", () => {
    expect(parseCSVLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("handles quoted values with commas", () => {
    expect(parseCSVLine('"López, Juan",12345678,987654321')).toEqual([
      "López, Juan",
      "12345678",
      "987654321",
    ]);
  });

  it("handles escaped double quotes inside quoted values", () => {
    expect(parseCSVLine('"He said ""hi""",value')).toEqual(['He said "hi"', "value"]);
  });

  it("trims whitespace around values", () => {
    expect(parseCSVLine("  a , b , c  ")).toEqual(["a", "b", "c"]);
  });
});

describe("normalizeStatus", () => {
  it("maps 'activo' to 'Activo'", () => expect(normalizeStatus("activo")).toBe("Activo"));
  it("maps 'ACTIVO' to 'Activo'", () => expect(normalizeStatus("ACTIVO")).toBe("Activo"));
  it("maps '1' to 'Activo'", () => expect(normalizeStatus("1")).toBe("Activo"));
  it("maps 'en espera' to 'En espera'", () =>
    expect(normalizeStatus("en espera")).toBe("En espera"));
  it("maps 'pending' to 'En espera'", () => expect(normalizeStatus("pending")).toBe("En espera"));
  it("maps 'cerrado' to 'Cerrado'", () => expect(normalizeStatus("cerrado")).toBe("Cerrado"));
  it("maps '0' to 'Cerrado'", () => expect(normalizeStatus("0")).toBe("Cerrado"));
  it("defaults unknown values to 'Activo'", () =>
    expect(normalizeStatus("unknown")).toBe("Activo"));
  it("handles empty string", () => expect(normalizeStatus("")).toBe("Activo"));
});

describe("validateRow", () => {
  it("passes a valid row", () => {
    expect(
      validateRow({ name: "Juan Pérez", dni: "12345678", phone: "987654321" }),
    ).toBeUndefined();
  });

  it("rejects empty name", () => {
    expect(validateRow({ name: "", dni: "12345678", phone: "987654321" })).toMatch(/Nombre/);
  });

  it("rejects name with only spaces", () => {
    expect(validateRow({ name: "   ", dni: "12345678", phone: "987654321" })).toMatch(/Nombre/);
  });

  it("rejects DNI shorter than 8", () => {
    expect(validateRow({ name: "Juan", dni: "1234567", phone: "987654321" })).toMatch(/DNI/);
  });

  it("rejects DNI longer than 8", () => {
    expect(validateRow({ name: "Juan", dni: "123456789", phone: "987654321" })).toMatch(/DNI/);
  });

  it("rejects phone shorter than 9", () => {
    expect(validateRow({ name: "Juan", dni: "12345678", phone: "98765432" })).toMatch(/Teléfono/);
  });

  it("rejects phone longer than 9", () => {
    expect(validateRow({ name: "Juan", dni: "12345678", phone: "9876543210" })).toMatch(/Teléfono/);
  });
});

describe("parseCSV", () => {
  const validCSV = [
    "nombre,dni,telefono,email,proceso,estado",
    "Juan Pérez,12345678,987654321,juan@mail.com,Penal,Activo",
    "María López,87654321,912345678,maria@mail.com,Familia,En espera",
  ].join("\n");

  it("parses a valid CSV with 2 data rows", () => {
    const rows = parseCSV(validCSV);
    expect(rows).toHaveLength(2);
    expect(rows[0].name).toBe("Juan Pérez");
    expect(rows[0].valid).toBe(true);
    expect(rows[1].valid).toBe(true);
  });

  it("marks invalid rows but still returns them", () => {
    const csv = [
      "nombre,dni,telefono",
      "Juan,123,987654321", // DNI too short
    ].join("\n");
    const rows = parseCSV(csv);
    expect(rows[0].valid).toBe(false);
    expect(rows[0].error).toMatch(/DNI/);
  });

  it("handles different header aliases", () => {
    const csv = ["cliente,documento,celular", "Ana Torres,45678901,945678123"].join("\n");
    const rows = parseCSV(csv);
    expect(rows[0].name).toBe("Ana Torres");
    expect(rows[0].dni).toBe("45678901");
    expect(rows[0].phone).toBe("945678123");
    expect(rows[0].valid).toBe(true);
  });

  it("strips non-digit chars from DNI and phone", () => {
    const csv = ["nombre,dni,telefono", "Pedro Ruiz,12.345.678,987-654-321"].join("\n");
    const rows = parseCSV(csv);
    expect(rows[0].dni).toBe("12345678");
    expect(rows[0].phone).toBe("987654321");
    expect(rows[0].valid).toBe(true);
  });

  it("defaults process_type when column is missing", () => {
    const csv = ["nombre,dni,telefono", "Ana,12345678,987654321"].join("\n");
    const rows = parseCSV(csv);
    expect(rows[0].process_type).toBe("Defensa penal — Otros");
  });

  it("defaults status to Activo when column is missing", () => {
    const csv = ["nombre,dni,telefono", "Ana,12345678,987654321"].join("\n");
    const rows = parseCSV(csv);
    expect(rows[0].status).toBe("Activo");
  });

  it("returns empty array for header-only CSV", () => {
    expect(parseCSV("nombre,dni,telefono\n")).toHaveLength(0);
  });

  it("skips completely blank lines", () => {
    const csv = [
      "nombre,dni,telefono",
      "Juan Pérez,12345678,987654321",
      "   ",
      "María López,87654321,912345678",
    ].join("\n");
    expect(parseCSV(csv)).toHaveLength(2);
  });

  it("handles CRLF line endings", () => {
    const csv = "nombre,dni,telefono\r\nJuan,12345678,987654321";
    const rows = parseCSV(csv);
    expect(rows[0].name).toBe("Juan");
    expect(rows[0].valid).toBe(true);
  });

  it("handles UTF-8 BOM and accented headers", () => {
    const csv = "\uFEFFnombre,dni,teléfono\nMaría Ñúñez,12345678,987654321";
    const rows = parseCSV(csv);
    expect(rows[0].name).toBe("María Ñúñez");
    expect(rows[0].phone).toBe("987654321");
    expect(rows[0].valid).toBe(true);
  });

  it("handles quoted fields with commas", () => {
    const csv = [
      "nombre,dni,telefono,email",
      '"López, Juan Antonio",12345678,987654321,juan@mail.com',
    ].join("\n");
    const rows = parseCSV(csv);
    expect(rows[0].name).toBe("López, Juan Antonio");
    expect(rows[0].valid).toBe(true);
  });
});

describe("validateFileType", () => {
  it("accepts .csv", () => expect(validateFileType("clientes.csv").ok).toBe(true));
  it("accepts .xlsx", () => expect(validateFileType("clientes.xlsx").ok).toBe(true));
  it("accepts .CSV uppercase", () => expect(validateFileType("CLIENTES.CSV").ok).toBe(true));

  it("rejects .xls with specific message", () => {
    const result = validateFileType("clientes.xls");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/\.xls/);
    expect(result.error).toMatch(/no está soportado/);
  });

  it("rejects .pdf with generic message", () => {
    const result = validateFileType("clientes.pdf");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no soportado/i);
  });

  it("rejects .docx", () => expect(validateFileType("clientes.docx").ok).toBe(false));
});

describe("buildColIndex", () => {
  it("maps standard Spanish headers to field names", () => {
    const cols = buildColIndex(["nombre", "dni", "telefono", "email", "proceso", "estado"]);
    expect(cols.name).toBe(0);
    expect(cols.dni).toBe(1);
    expect(cols.phone).toBe(2);
    expect(cols.email).toBe(3);
    expect(cols.process_type).toBe(4);
    expect(cols.status).toBe(5);
  });

  it("returns -1 for missing columns", () => {
    const cols = buildColIndex(["nombre"]);
    expect(cols.dni).toBe(-1);
    expect(cols.phone).toBe(-1);
  });

  it("handles alias variants", () => {
    const cols = buildColIndex(["cliente", "cedula", "celular"]);
    expect(cols.name).toBe(0);
    expect(cols.dni).toBe(1);
    expect(cols.phone).toBe(2);
  });
});
