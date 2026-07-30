import ExcelJS from "exceljs";
import { AlertCircle, CheckCircle2, FileSpreadsheet, Loader2, Upload, X } from "lucide-react";
import { useMemo, useState } from "react";
import { getAuthClient } from "@/lib/supabase";
import { buildClientInitials, normalizeDigits } from "@/lib/client-validation";
import { parseClientCsvText, parseClientRows, type ClientImportRow } from "@/lib/client-csv-import";

type Props = {
  onClose: () => void;
  onSuccess: () => void;
};

async function parseFile(file: File) {
  if (file.name.toLowerCase().endsWith(".csv")) {
    return parseClientCsvText(await file.text());
  }
  if (file.name.toLowerCase().endsWith(".xlsx")) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await file.arrayBuffer());
    const worksheet = workbook.worksheets[0];
    if (!worksheet) return [];
    const matrix: string[][] = [];
    worksheet.eachRow((row) => {
      const values: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => values.push(String(cell.value ?? "")));
      matrix.push(values);
    });
    return parseClientRows(matrix);
  }
  throw new Error("Usa un archivo CSV o XLSX.");
}

export function CSVImport({ onClose, onSuccess }: Props) {
  const [rows, setRows] = useState<ClientImportRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const validRows = useMemo(() => rows.filter((row) => row.valid), [rows]);

  async function selectFile(file?: File) {
    if (!file) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setRows(await parseFile(file));
      setFileName(file.name);
    } catch (cause) {
      setRows([]);
      setError(cause instanceof Error ? cause.message : "No se pudo leer el archivo.");
    } finally {
      setLoading(false);
    }
  }

  async function importRows() {
    setImporting(true);
    setError(null);
    try {
      const db = await getAuthClient();
      const { data: existing, error: queryError } = await db
        .from("clients")
        .select("name, phone, email");
      if (queryError) throw new Error(queryError.message);
      const phones = new Set(
        (existing ?? []).map((item) => normalizeDigits(item.phone)).filter(Boolean),
      );
      const emails = new Set(
        (existing ?? []).map((item) => (item.email ?? "").trim().toLowerCase()).filter(Boolean),
      );
      const pending = validRows.filter(
        (row) => !(row.phone && phones.has(row.phone)) && !(row.email && emails.has(row.email)),
      );
      if (pending.length === 0) throw new Error("No hay filas nuevas para importar.");
      const { error: insertError } = await db.from("clients").insert(
        pending.map((row) => ({
          name: row.name,
          phone: row.phone || null,
          email: row.email || null,
          status: row.status,
          initials: buildClientInitials(row.name),
          color: "oklch(0.55 0.13 235)",
        })),
      );
      if (insertError) throw new Error(insertError.message);
      setResult(`${pending.length} cliente(s) importado(s).`);
      onSuccess();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo completar la importación.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border bg-card p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold">Importar clientes</h2>
            <p className="text-sm text-muted-foreground">
              Columnas admitidas: nombre, teléfono, correo y estado.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-lg hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <label className="mt-6 flex cursor-pointer flex-col items-center rounded-xl border border-dashed p-8 text-center hover:bg-muted/30">
          {loading ? <Loader2 className="h-7 w-7 animate-spin" /> : <Upload className="h-7 w-7" />}
          <span className="mt-2 text-sm font-semibold">{fileName || "Selecciona CSV o XLSX"}</span>
          <input
            type="file"
            accept=".csv,.xlsx"
            className="sr-only"
            onChange={(event) => void selectFile(event.target.files?.[0])}
          />
        </label>

        {rows.length > 0 && (
          <div className="mt-5 overflow-hidden rounded-xl border">
            <div className="grid grid-cols-[1.4fr_1fr_1.2fr_90px] gap-3 border-b bg-muted/35 px-4 py-2 text-xs font-semibold">
              <span>Cliente</span>
              <span>Teléfono</span>
              <span>Correo</span>
              <span>Estado</span>
            </div>
            {rows.slice(0, 50).map((row, index) => (
              <div
                key={`${row.name}-${index}`}
                className="grid grid-cols-[1.4fr_1fr_1.2fr_90px] gap-3 border-b px-4 py-2 text-sm last:border-b-0"
              >
                <span className="truncate">{row.name || row.error}</span>
                <span>{row.phone || "—"}</span>
                <span className="truncate">{row.email || "—"}</span>
                <span>{row.valid ? row.status : "Revisar"}</span>
              </div>
            ))}
          </div>
        )}

        {(error || result) && (
          <div
            className={`mt-4 flex gap-2 rounded-lg border p-3 text-sm ${error ? "border-red-200 text-red-700" : "border-emerald-200 text-emerald-700"}`}
          >
            {error ? <AlertCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
            {error || result}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-10 rounded-lg border px-4">
            Cerrar
          </button>
          <button
            type="button"
            onClick={() => void importRows()}
            disabled={validRows.length === 0 || importing}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 font-semibold text-primary-foreground disabled:opacity-50"
          >
            <FileSpreadsheet className="h-4 w-4" />
            Importar {validRows.length || ""}
          </button>
        </div>
      </div>
    </div>
  );
}
