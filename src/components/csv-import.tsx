import { useState, useRef } from "react";
import { Upload, X, CheckCircle2, AlertCircle, Loader2, FileText, Download } from "lucide-react";
import { Card } from "@/components/app-layout";
import { getAuthClient } from "@/lib/supabase";
import ExcelJS from "exceljs";

interface ParsedClient {
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

const COLORS = [
  "oklch(0.74 0.12 80)",
  "oklch(0.55 0.13 235)",
  "oklch(0.62 0.14 155)",
  "oklch(0.62 0.18 25)",
  "oklch(0.55 0.13 290)",
  "oklch(0.34 0.09 255)",
];

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(cur.trim());
      cur = "";
    } else {
      cur += char;
    }
  }
  result.push(cur.trim());
  return result;
}

function normalizeStatus(raw: string): string {
  const statusMap: Record<string, string> = {
    activo: "Activo",
    active: "Activo",
    "1": "Activo",
    "en espera": "En espera",
    espera: "En espera",
    pending: "En espera",
    cerrado: "Cerrado",
    closed: "Cerrado",
    "0": "Cerrado",
  };
  return statusMap[raw.toLowerCase()] ?? "Activo";
}

function validateRow(row: Omit<ParsedClient, "valid" | "error">): string | undefined {
  if (!row.name) return "Nombre requerido";
  if (row.dni.length !== 8) return `DNI debe tener 8 dígitos (tiene ${row.dni.length})`;
  if (row.phone.length !== 9) return `Teléfono debe tener 9 dígitos (tiene ${row.phone.length})`;
  return undefined;
}

function parseCSV(text: string): ParsedClient[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]).map((h) => h.toLowerCase().replace(/['"]/g, ""));

  const colMap: Record<string, string[]> = {
    name: ["nombre", "name", "nombre completo", "full name", "cliente"],
    dni: ["dni", "ruc", "documento", "cedula", "id"],
    phone: ["telefono", "teléfono", "celular", "phone", "movil", "móvil"],
    email: ["email", "correo", "mail", "correo electrónico"],
    process_type: ["tipo", "proceso", "tipo de proceso", "materia", "process_type", "especialidad"],
    status: ["estado", "status", "estado del cliente"],
  };

  function findCol(key: string): number {
    const aliases = colMap[key] ?? [key];
    for (const alias of aliases) {
      const idx = headers.findIndex((h) => h.includes(alias));
      if (idx !== -1) return idx;
    }
    return -1;
  }

  const cols = {
    name: findCol("name"),
    dni: findCol("dni"),
    phone: findCol("phone"),
    email: findCol("email"),
    process_type: findCol("process_type"),
    status: findCol("status"),
  };

  return lines
    .slice(1)
    .filter((l) => l.trim())
    .map((line) => {
      const vals = parseCSVLine(line).map((v) => v.replace(/^["']|["']$/g, ""));

      const name = cols.name >= 0 ? (vals[cols.name] ?? "") : "";
      const dni = cols.dni >= 0 ? (vals[cols.dni] ?? "").replace(/\D/g, "") : "";
      const phone = cols.phone >= 0 ? (vals[cols.phone] ?? "").replace(/\D/g, "") : "";
      const email = cols.email >= 0 ? (vals[cols.email] ?? "") : "";
      const process_type =
        cols.process_type >= 0
          ? (vals[cols.process_type] ?? "Defensa penal — Otros")
          : "Defensa penal — Otros";
      const rawStatus = cols.status >= 0 ? (vals[cols.status] ?? "Activo") : "Activo";
      const status = normalizeStatus(rawStatus);
      const error = validateRow({ name, dni, phone, email, process_type, status });

      return { name, dni, phone, email, process_type, status, valid: !error, error };
    });
}

async function parseExcel(buffer: ArrayBuffer): Promise<ParsedClient[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];

  // Read first row as headers
  const headerRow = worksheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell((cell) => {
    headers.push(
      String(cell.value ?? "")
        .toLowerCase()
        .trim(),
    );
  });

  const colMap: Record<string, string[]> = {
    name: ["nombre", "name", "nombre completo", "full name", "cliente"],
    dni: ["dni", "ruc", "documento", "cedula", "id"],
    phone: ["telefono", "teléfono", "celular", "phone", "movil", "móvil"],
    email: ["email", "correo", "mail", "correo electrónico"],
    process_type: ["tipo", "proceso", "tipo de proceso", "materia", "process_type", "especialidad"],
    status: ["estado", "status", "estado del cliente"],
  };

  function findCol(key: string): number {
    const aliases = colMap[key] ?? [key];
    for (const alias of aliases) {
      const idx = headers.findIndex((h) => h.includes(alias));
      if (idx !== -1) return idx + 1; // ExcelJS columns are 1-indexed
    }
    return -1;
  }

  const cols = {
    name: findCol("name"),
    dni: findCol("dni"),
    phone: findCol("phone"),
    email: findCol("email"),
    process_type: findCol("process_type"),
    status: findCol("status"),
  };

  const results: ParsedClient[] = [];

  worksheet.eachRow((row, rowNum) => {
    if (rowNum === 1) return; // skip header

    function getCellStr(colIdx: number): string {
      if (colIdx < 1) return "";
      const cell = row.getCell(colIdx);
      const v = cell.value;
      if (v === null || v === undefined) return "";
      if (typeof v === "object" && "text" in v) return String((v as { text: string }).text);
      return String(v).trim();
    }

    const name = getCellStr(cols.name);
    const dni = getCellStr(cols.dni).replace(/\D/g, "");
    const phone = getCellStr(cols.phone).replace(/\D/g, "");
    const email = getCellStr(cols.email);
    const process_type = getCellStr(cols.process_type) || "Defensa penal — Otros";
    const status = normalizeStatus(getCellStr(cols.status));
    const error = validateRow({ name, dni, phone, email, process_type, status });

    // Skip completely empty rows
    if (!name && !dni && !phone) return;

    results.push({ name, dni, phone, email, process_type, status, valid: !error, error });
  });

  return results;
}

export function CSVImport({ onClose, onSuccess }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ParsedClient[]>([]);
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState<{ success: number; failed: number } | null>(null);
  const [step, setStep] = useState<"upload" | "preview" | "done">("upload");
  const [parseError, setParseError] = useState<string | null>(null);

  async function handleFile(f: File) {
    setFile(f);
    setParseError(null);
    try {
      const isExcel =
        f.name.endsWith(".xlsx") ||
        f.name.endsWith(".xls") ||
        f.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
        f.type === "application/vnd.ms-excel";

      if (isExcel) {
        const buffer = await f.arrayBuffer();
        const parsed = await parseExcel(buffer);
        setPreview(parsed);
        setStep("preview");
      } else {
        const reader = new FileReader();
        reader.onload = (e) => {
          const text = e.target?.result as string;
          const parsed = parseCSV(text);
          setPreview(parsed);
          setStep("preview");
        };
        reader.readAsText(f, "UTF-8");
      }
    } catch (err) {
      setParseError(
        err instanceof Error ? err.message : "No se pudo leer el archivo. Verifica el formato.",
      );
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }

  async function handleImport() {
    const valid = preview.filter((r) => r.valid);
    if (valid.length === 0) return;

    setImporting(true);
    let success = 0;
    let failed = 0;

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

        if (error) failed++;
        else success++;
      } catch {
        failed++;
      }
    }

    setDone({ success, failed });
    setStep("done");
    setImporting(false);
    if (success > 0) onSuccess();
  }

  function downloadTemplate() {
    const csv = [
      "nombre,dni,telefono,email,proceso,estado",
      "Juan Pérez García,12345678,987654321,juan@mail.com,Defensa penal — Delitos comunes,Activo",
      "María López Torres,87654321,912345678,maria@mail.com,Familia — Divorcio,En espera",
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
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
          <div>
            <h3 className="text-base font-semibold">Importar clientes desde CSV o Excel</h3>
            <p className="text-xs text-muted-foreground">
              {step === "upload" && "Sube un archivo .csv o .xlsx con los datos de tus clientes"}
              {step === "preview" && `${validCount} válidos · ${invalidCount} con errores`}
              {step === "done" && "Importación completada"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 grid place-items-center rounded-lg hover:bg-muted/60"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {step === "upload" && (
            <div className="space-y-4">
              {/* Drop zone */}
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => fileRef.current?.click()}
                className="flex flex-col items-center justify-center gap-3 h-40 rounded-xl border-2 border-dashed border-border hover:border-primary/50 hover:bg-primary/5 cursor-pointer transition"
              >
                <Upload className="h-8 w-8 text-muted-foreground" />
                <div className="text-sm text-center">
                  <p className="font-medium">Arrastra tu archivo CSV o Excel aquí</p>
                  <p className="text-muted-foreground text-xs mt-0.5">
                    o haz clic para seleccionar · .csv, .xlsx
                  </p>
                </div>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />

              {parseError && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {parseError}
                </p>
              )}

              {/* Template download */}
              <button
                onClick={downloadTemplate}
                className="w-full flex items-center justify-center gap-2 h-10 rounded-lg border border-border text-sm font-medium hover:bg-muted/60"
              >
                <Download className="h-4 w-4" /> Descargar plantilla de ejemplo (.csv)
              </button>

              <div className="rounded-lg bg-muted/40 p-4 text-xs text-muted-foreground space-y-1">
                <p className="font-semibold text-foreground mb-1">Columnas reconocidas:</p>
                <p>
                  • <strong>nombre</strong> — Nombre completo del cliente (requerido)
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
              </div>
            </div>
          )}

          {step === "preview" && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-sm">
                <span className="flex items-center gap-1.5 text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-lg">
                  <CheckCircle2 className="h-4 w-4" /> {validCount} para importar
                </span>
                {invalidCount > 0 && (
                  <span className="flex items-center gap-1.5 text-red-700 bg-red-50 px-3 py-1.5 rounded-lg">
                    <AlertCircle className="h-4 w-4" /> {invalidCount} con errores (se omitirán)
                  </span>
                )}
              </div>

              <div className="rounded-xl border border-border overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/50 text-left text-muted-foreground">
                      <th className="py-2 pl-3 pr-2">Estado</th>
                      <th className="py-2 px-2">Nombre</th>
                      <th className="py-2 px-2">DNI</th>
                      <th className="py-2 px-2">Teléfono</th>
                      <th className="py-2 px-2">Proceso</th>
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
                        <td className="py-2 px-2 font-medium truncate max-w-[140px]">
                          {r.name || "—"}
                        </td>
                        <td className="py-2 px-2 font-mono">{r.dni || "—"}</td>
                        <td className="py-2 px-2 font-mono">{r.phone || "—"}</td>
                        <td className="py-2 px-2 truncate max-w-[140px] text-muted-foreground">
                          {r.process_type}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.length > 20 && (
                  <div className="px-3 py-2 text-xs text-muted-foreground border-t border-border">
                    +{preview.length - 20} filas más
                  </div>
                )}
              </div>
            </div>
          )}

          {step === "done" && done && (
            <div className="flex flex-col items-center justify-center gap-4 py-8 text-center">
              <div
                className={`grid h-16 w-16 place-items-center rounded-full ${done.failed === 0 ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"}`}
              >
                <CheckCircle2 className="h-8 w-8" />
              </div>
              <div>
                <p className="text-lg font-bold">{done.success} clientes importados</p>
                {done.failed > 0 && (
                  <p className="text-sm text-muted-foreground">{done.failed} registros fallaron</p>
                )}
              </div>
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
                onClick={() => setStep("upload")}
                className="flex-1 h-10 rounded-lg border border-border text-sm font-medium hover:bg-muted/60"
              >
                Atrás
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
                  <>Importar {validCount} clientes</>
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
