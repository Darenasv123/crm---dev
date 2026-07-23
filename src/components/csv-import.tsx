import { useState, useRef } from "react";
import { Upload, X, CheckCircle2, AlertCircle, Loader2, Download } from "lucide-react";
import { Card } from "@/components/app-layout";
import { getAuthClient } from "@/lib/supabase";
import ExcelJS from "exceljs";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ParsedRow {
  name: string;
  dni: string;
  phone: string;
  email: string;
  process_type: string;
  status: string;
  valid: boolean;
  error?: string;
}

interface Props {
  onClose: () => void;
  onSuccess: () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const COLORS = [
  "oklch(0.74 0.12 80)",
  "oklch(0.55 0.13 235)",
  "oklch(0.62 0.14 155)",
  "oklch(0.62 0.18 25)",
  "oklch(0.55 0.13 290)",
  "oklch(0.34 0.09 255)",
];

// Accepted MIME types — .xls (legacy binary) is NOT supported by ExcelJS
const ACCEPTED_EXTENSIONS = [".csv", ".xlsx"];
const ACCEPTED_MIME = [
  "text/csv",
  "application/csv",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

// Column alias map (lowercase, partial match)
const COL_ALIASES: Record<string, string[]> = {
  name: ["nombre", "name", "nombre completo", "full name", "cliente"],
  dni: ["dni", "ruc", "documento", "cedula", "id"],
  phone: ["telefono", "teléfono", "celular", "phone", "movil", "móvil", "tel"],
  email: ["email", "correo", "mail", "correo electrónico", "e-mail"],
  process_type: ["tipo", "proceso", "tipo de proceso", "materia", "process_type", "especialidad"],
  status: ["estado", "status", "estado del cliente"],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeStatus(raw: string): string {
  const map: Record<string, string> = {
    activo: "Activo",
    active: "Activo",
    si: "Activo",
    yes: "Activo",
    "1": "Activo",
    "en espera": "En espera",
    espera: "En espera",
    waiting: "En espera",
    pending: "En espera",
    cerrado: "Cerrado",
    closed: "Cerrado",
    inactivo: "Cerrado",
    no: "Cerrado",
    "0": "Cerrado",
  };
  return map[(raw ?? "").trim().toLowerCase()] ?? "Activo";
}

function validateRow(row: Omit<ParsedRow, "valid" | "error">): string | undefined {
  if (!row.name.trim()) return "Nombre requerido";
  if (row.dni.length !== 8) return `DNI debe tener 8 dígitos (tiene ${row.dni.length})`;
  if (row.phone.length !== 9) return `Teléfono debe tener 9 dígitos (tiene ${row.phone.length})`;
  return undefined;
}

/** Detects the column index (0-based) for each field using the alias map. */
function buildColIndex(headers: string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(COL_ALIASES)) {
    const idx = headers.findIndex((h) => aliases.some((alias) => h.includes(alias)));
    result[field] = idx; // -1 if not found
  }
  return result;
}

// ─── CSV Parser ───────────────────────────────────────────────────────────────

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

function parseCSV(text: string): ParsedRow[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headerLine = parseCSVLine(lines[0]).map((h) =>
    h.toLowerCase().replace(/^["'\s]+|["'\s]+$/g, ""),
  );
  const cols = buildColIndex(headerLine);

  return lines
    .slice(1)
    .filter((l) => l.trim())
    .map((line): ParsedRow => {
      const vals = parseCSVLine(line).map((v) => v.replace(/^["']+|["']+$/g, "").trim());

      const get = (field: string) => (cols[field] >= 0 ? (vals[cols[field]] ?? "") : "");

      const name = get("name");
      const dni = get("dni").replace(/\D/g, "");
      const phone = get("phone").replace(/\D/g, "");
      const email = get("email");
      const process_type = get("process_type") || "Defensa penal — Otros";
      const status = normalizeStatus(get("status"));
      const error = validateRow({ name, dni, phone, email, process_type, status });

      return { name, dni, phone, email, process_type, status, valid: !error, error };
    });
}

// ─── Excel (.xlsx) Parser ─────────────────────────────────────────────────────

/**
 * Converts any ExcelJS cell value to a plain string.
 * Handles: string, number, boolean, Date, RichText, CellErrorValue,
 * formula results, null/undefined.
 */
function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";

  // Primitive types
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";

  // Date
  if (value instanceof Date) return value.toISOString().slice(0, 10);

  // Formula cell — use the cached result
  if (typeof value === "object" && "result" in value) {
    return cellToString(value.result as ExcelJS.CellValue);
  }

  // Rich text  { richText: [{text: string}] }
  if (typeof value === "object" && "richText" in value) {
    const rt = value as ExcelJS.CellRichTextValue;
    return rt.richText
      .map((r) => r.text)
      .join("")
      .trim();
  }

  // Hyperlink { text: string, hyperlink: string }
  if (typeof value === "object" && "text" in value) {
    return String((value as { text: string }).text).trim();
  }

  // CellErrorValue e.g. { error: "#REF!" }
  if (typeof value === "object" && "error" in value) return "";

  return String(value).trim();
}

async function parseExcel(buffer: ArrayBuffer): Promise<ParsedRow[]> {
  const workbook = new ExcelJS.Workbook();

  // ExcelJS.load throws for invalid/corrupt files — caller catches it
  await workbook.xlsx.load(buffer);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("El archivo Excel no contiene ninguna hoja de cálculo.");

  // Build header index from first non-empty row
  let headerRowNum = 1;
  let headers: string[] = [];

  worksheet.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (headers.length === 0) {
      headerRowNum = rowNum;
      headers = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        headers.push(cellToString(cell.value).toLowerCase());
      });
    }
  });

  if (headers.length === 0)
    throw new Error("No se encontró una fila de encabezados en el archivo.");

  // ExcelJS columns are 1-indexed; buildColIndex returns 0-based index into headers array
  const cols = buildColIndex(headers);

  const results: ParsedRow[] = [];

  worksheet.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum <= headerRowNum) return;

    /** Get a cell value by its 0-based column index in the header array. */
    const get = (field: string): string => {
      const colIdx = cols[field];
      if (colIdx < 0) return "";
      // ExcelJS row cells are 1-based, but our index is 0-based relative to the header
      // We need to find the actual column number in the worksheet
      // The header was read with eachCell which gives cells from column 1 onward
      const cell = row.getCell(colIdx + 1);
      return cellToString(cell.value);
    };

    const name = get("name");
    const dni = get("dni").replace(/\D/g, "");
    const phone = get("phone").replace(/\D/g, "");
    const email = get("email");
    const process_type = get("process_type") || "Defensa penal — Otros";
    const status = normalizeStatus(get("status"));

    // Skip rows that are completely empty (merged cells, blank separators, etc.)
    if (!name && !dni && !phone && !email) return;

    const error = validateRow({ name, dni, phone, email, process_type, status });
    results.push({ name, dni, phone, email, process_type, status, valid: !error, error });
  });

  return results;
}

// ─── File validation ──────────────────────────────────────────────────────────

function validateFileType(f: File): { ok: boolean; error?: string } {
  const name = f.name.toLowerCase();
  const isCsv = name.endsWith(".csv");
  const isXlsx = name.endsWith(".xlsx");
  const mimeOk = ACCEPTED_MIME.includes(f.type) || f.type === "";

  if (!isCsv && !isXlsx) {
    // ZIP → redirige al importador correcto
    if (name.endsWith(".zip")) {
      return {
        ok: false,
        error:
          'Este archivo contiene carpetas y documentos. Utiliza la opción "Importar cliente desde ZIP" en Clientes.',
      };
    }
    // Detect .xls specifically to give a helpful message
    if (name.endsWith(".xls")) {
      return {
        ok: false,
        error:
          "El formato .xls (Excel 97-2003) no está soportado. Guarda el archivo como .xlsx (Excel moderno) e inténtalo de nuevo.",
      };
    }
    return {
      ok: false,
      error: `Formato no soportado: "${f.name}". Solo se aceptan archivos .csv o .xlsx.`,
    };
  }

  if (!mimeOk && f.type !== "") {
    // Some OS/browsers report unexpected MIME types — warn but allow
    console.warn(`[CSVImport] MIME type inesperado: ${f.type} para ${f.name}`);
  }

  return { ok: true };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CSVImport({ onClose, onSuccess }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ParsedRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    success: number;
    failed: number;
    errors: string[];
  } | null>(null);
  const [step, setStep] = useState<"upload" | "preview" | "done">("upload");
  const [parseError, setParseError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("");

  async function handleFile(f: File) {
    setParseError(null);

    const validation = validateFileType(f);
    if (!validation.ok) {
      setParseError(validation.error!);
      // Reset the input so the same file can be re-selected after fixing
      if (fileRef.current) fileRef.current.value = "";
      return;
    }

    setFileName(f.name);

    try {
      const isExcel =
        f.name.toLowerCase().endsWith(".xlsx") ||
        f.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

      let parsed: ParsedRow[];

      if (isExcel) {
        const buffer = await f.arrayBuffer();
        parsed = await parseExcel(buffer);
      } else {
        const text = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target?.result as string);
          reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
          reader.readAsText(f, "UTF-8");
        });
        parsed = parseCSV(text);
      }

      if (parsed.length === 0) {
        setParseError("El archivo no contiene filas de datos (solo encabezados o está vacío).");
        return;
      }

      setPreview(parsed);
      setStep("preview");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error desconocido al leer el archivo.";
      setParseError(`No se pudo procesar el archivo: ${msg}`);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }

  async function handleImport() {
    const valid = preview.filter((r) => r.valid);
    if (valid.length === 0 || importing) return;

    setImporting(true);
    let success = 0;
    let failed = 0;
    const errors: string[] = [];

    const db = await getAuthClient();

    for (const row of valid) {
      try {
        const words = row.name.trim().split(/\s+/);
        const initials =
          words.length >= 2
            ? (words[0][0] + words[1][0]).toUpperCase()
            : words[0].slice(0, 2).toUpperCase();
        const color = COLORS[Math.floor(Math.random() * COLORS.length)];

        const { error } = await db.from("clients").insert({
          name: row.name,
          dni: row.dni,
          phone: row.phone,
          email: row.email || null,
          process_type: row.process_type,
          status: row.status as "Activo" | "En espera" | "Cerrado",
          initials,
          color,
        });

        if (error) {
          failed++;
          // Collect errors but cap at 5 to avoid flooding the UI
          if (errors.length < 5) {
            errors.push(`${row.name}: ${error.message}`);
          }
        } else {
          success++;
        }
      } catch (err) {
        failed++;
        if (errors.length < 5) {
          errors.push(`${row.name}: ${err instanceof Error ? err.message : "Error desconocido"}`);
        }
      }
    }

    setImportResult({ success, failed, errors });
    setStep("done");
    setImporting(false);
    if (success > 0) onSuccess();
  }

  function handleReset() {
    setPreview([]);
    setImportResult(null);
    setParseError(null);
    setFileName("");
    setStep("upload");
    if (fileRef.current) fileRef.current.value = "";
  }

  function downloadTemplate() {
    const csv = [
      "nombre,dni,telefono,email,proceso,estado",
      "Juan Pérez García,12345678,987654321,juan@mail.com,Defensa penal — Delitos comunes,Activo",
      "María López Torres,87654321,912345678,maria@mail.com,Familia — Divorcio,En espera",
      "Carlos Ramírez Soto,45678901,945678123,,Laboral — Beneficios sociales,Activo",
    ].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }); // BOM for Excel
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "plantilla_clientes.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const validCount = preview.filter((r) => r.valid).length;
  const invalidCount = preview.filter((r) => !r.valid).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <Card className="w-full max-w-2xl shadow-xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div className="min-w-0">
            <h3 className="text-base font-semibold">Importar clientes</h3>
            <p className="text-xs text-muted-foreground truncate">
              {step === "upload" && "Sube un archivo .csv o .xlsx con los datos"}
              {step === "preview" &&
                (fileName ? `${fileName} · ` : "") +
                  `${validCount} válidos · ${invalidCount} con errores`}
              {step === "done" && "Importación completada"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 grid place-items-center rounded-lg hover:bg-muted/60 ml-3 shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {/* ── Step: Upload ── */}
          {step === "upload" && (
            <div className="space-y-4">
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => fileRef.current?.click()}
                className="flex flex-col items-center justify-center gap-3 h-40 rounded-xl border-2 border-dashed border-border hover:border-primary/50 hover:bg-primary/5 cursor-pointer transition select-none"
              >
                <Upload className="h-8 w-8 text-muted-foreground" />
                <div className="text-sm text-center">
                  <p className="font-medium">Arrastra tu archivo aquí</p>
                  <p className="text-muted-foreground text-xs mt-0.5">
                    o haz clic para seleccionar · <strong>.csv</strong> o <strong>.xlsx</strong>
                  </p>
                </div>
              </div>
              {/* Only .csv and .xlsx — .xls deliberately excluded */}
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />

              {parseError && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
                  <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700">{parseError}</p>
                </div>
              )}

              <button
                onClick={downloadTemplate}
                className="w-full flex items-center justify-center gap-2 h-10 rounded-lg border border-border text-sm font-medium hover:bg-muted/60"
              >
                <Download className="h-4 w-4" /> Descargar plantilla CSV de ejemplo
              </button>

              <div className="rounded-lg bg-muted/40 p-4 text-xs text-muted-foreground space-y-1">
                <p className="font-semibold text-foreground mb-2">Columnas reconocidas:</p>
                <p>
                  • <strong>nombre</strong> — Nombre completo (requerido)
                </p>
                <p>
                  • <strong>dni</strong> — DNI de 8 dígitos (requerido)
                </p>
                <p>
                  • <strong>telefono</strong> — Teléfono de 9 dígitos (requerido)
                </p>
                <p>
                  • <strong>email</strong> — Correo electrónico (opcional)
                </p>
                <p>
                  • <strong>proceso</strong> — Tipo de proceso (opcional)
                </p>
                <p>
                  • <strong>estado</strong> — Activo / En espera / Cerrado (opcional)
                </p>
                <p className="pt-1 text-amber-700 font-medium">
                  ⚠ El formato .xls (Excel 97-2003) no está soportado. Usa .xlsx o .csv.
                </p>
              </div>
            </div>
          )}

          {/* ── Step: Preview ── */}
          {step === "preview" && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="flex items-center gap-1.5 text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-lg">
                  <CheckCircle2 className="h-4 w-4" /> {validCount} listos para importar
                </span>
                {invalidCount > 0 && (
                  <span className="flex items-center gap-1.5 text-red-700 bg-red-50 px-3 py-1.5 rounded-lg">
                    <AlertCircle className="h-4 w-4" /> {invalidCount} con errores (se omitirán)
                  </span>
                )}
              </div>

              {validCount === 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
                  Ninguna fila es válida. Revisa el archivo y los encabezados.
                </div>
              )}

              <div className="rounded-xl border border-border overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/50 text-left text-muted-foreground">
                      <th className="py-2 pl-3 pr-2 w-8"></th>
                      <th className="py-2 px-2">Nombre</th>
                      <th className="py-2 px-2">DNI</th>
                      <th className="py-2 px-2">Teléfono</th>
                      <th className="py-2 px-2 hidden sm:table-cell">Proceso</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.slice(0, 20).map((r, i) => (
                      <tr
                        key={i}
                        className={`border-t border-border ${r.valid ? "" : "bg-red-50/50"}`}
                      >
                        <td className="py-2 pl-3 pr-2">
                          {r.valid ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                          ) : (
                            <span title={r.error}>
                              <AlertCircle className="h-3.5 w-3.5 text-red-500" />
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-2 font-medium truncate max-w-[130px]">
                          {r.name || <span className="text-muted-foreground italic">vacío</span>}
                          {!r.valid && r.error && (
                            <div className="text-[10px] text-red-600 mt-0.5 font-normal">
                              {r.error}
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-2 font-mono">{r.dni || "—"}</td>
                        <td className="py-2 px-2 font-mono">{r.phone || "—"}</td>
                        <td className="py-2 px-2 truncate max-w-[140px] text-muted-foreground hidden sm:table-cell">
                          {r.process_type}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.length > 20 && (
                  <div className="px-3 py-2 text-xs text-muted-foreground border-t border-border bg-muted/20">
                    +{preview.length - 20} filas más (total: {preview.length})
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Step: Done ── */}
          {step === "done" && importResult && (
            <div className="flex flex-col items-center justify-center gap-4 py-8 text-center">
              <div
                className={`grid h-16 w-16 place-items-center rounded-full ${
                  importResult.failed === 0
                    ? "bg-emerald-50 text-emerald-600"
                    : importResult.success > 0
                      ? "bg-amber-50 text-amber-600"
                      : "bg-red-50 text-red-600"
                }`}
              >
                {importResult.failed === 0 || importResult.success > 0 ? (
                  <CheckCircle2 className="h-8 w-8" />
                ) : (
                  <AlertCircle className="h-8 w-8" />
                )}
              </div>
              <div>
                <p className="text-lg font-bold">
                  {importResult.success} cliente{importResult.success !== 1 ? "s" : ""} importado
                  {importResult.success !== 1 ? "s" : ""}
                </p>
                {importResult.failed > 0 && (
                  <p className="text-sm text-muted-foreground mt-1">
                    {importResult.failed} registro{importResult.failed !== 1 ? "s" : ""} no se
                    pudieron insertar
                  </p>
                )}
              </div>
              {importResult.errors.length > 0 && (
                <div className="w-full rounded-lg border border-red-200 bg-red-50 p-3 text-left">
                  <p className="text-xs font-semibold text-red-700 mb-1">Errores de inserción:</p>
                  {importResult.errors.map((e, i) => (
                    <p key={i} className="text-xs text-red-600">
                      {e}
                    </p>
                  ))}
                  {importResult.failed > importResult.errors.length && (
                    <p className="text-xs text-red-500 mt-1">
                      …y {importResult.failed - importResult.errors.length} más.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 py-4 border-t border-border shrink-0">
          {step === "upload" && (
            <button
              onClick={onClose}
              className="flex-1 h-10 rounded-lg border border-border text-sm font-medium hover:bg-muted/60"
            >
              Cancelar
            </button>
          )}

          {step === "preview" && (
            <>
              <button
                onClick={handleReset}
                className="flex-1 h-10 rounded-lg border border-border text-sm font-medium hover:bg-muted/60"
              >
                ← Atrás
              </button>
              <button
                onClick={handleImport}
                disabled={importing || validCount === 0}
                className="flex-1 h-10 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {importing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Importando...
                  </>
                ) : (
                  `Importar ${validCount} cliente${validCount !== 1 ? "s" : ""}`
                )}
              </button>
            </>
          )}

          {step === "done" && (
            <button
              onClick={onClose}
              className="flex-1 h-10 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110"
            >
              Cerrar
            </button>
          )}
        </div>
      </Card>
    </div>
  );
}
