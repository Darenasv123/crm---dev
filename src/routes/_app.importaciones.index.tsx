import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { FileSpreadsheet, FolderArchive, Upload, FileText } from "lucide-react";
import { AppLayout, Card } from "@/components/app-layout";
import { CSVImport } from "@/components/csv-import";
import { ZipImport } from "@/components/zip-import";

export const Route = createFileRoute("/_app/importaciones/")({
  head: () => ({ meta: [{ title: "Importaciones — CRM Jurídico" }] }),
  component: ImportsPage,
});

type ActiveModal = "csv" | "zip" | null;

function ImportsPage() {
  const [modal, setModal] = useState<ActiveModal>(null);
  const [lastSuccess, setLastSuccess] = useState<{ type: ActiveModal; ts: number } | null>(null);

  function handleSuccess(type: ActiveModal) {
    setLastSuccess({ type, ts: Date.now() });
    setModal(null);
  }

  return (
    <AppLayout
      title="Importaciones"
      subtitle="Migra clientes y expedientes al CRM desde distintas fuentes"
    >
      {/* ── Success banner ── */}
      {lastSuccess && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <FileText className="h-4 w-4 shrink-0" />
          {lastSuccess.type === "csv"
            ? "Clientes importados correctamente desde CSV/XLSX."
            : "Carpetas importadas correctamente desde ZIP."}
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {/* ── Opción 1: CSV / XLSX ── */}
        <Card className="flex flex-col gap-4 p-6">
          <div className="flex items-start gap-4">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <FileSpreadsheet className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold">Importar lista de clientes</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Sube una hoja de cálculo con columnas de nombre, DNI, teléfono, correo y tipo de
                proceso.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <FormatBadge ext=".csv" />
            <FormatBadge ext=".xlsx" />
          </div>

          <ul className="space-y-1 text-xs text-muted-foreground">
            <li>• Una fila por cliente</li>
            <li>• Encabezados reconocidos automáticamente (español/inglés)</li>
            <li>• Vista previa antes de confirmar</li>
            <li>• Plantilla de ejemplo descargable</li>
          </ul>

          <button
            type="button"
            onClick={() => setModal("csv")}
            className="mt-auto flex h-10 items-center justify-center gap-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110"
          >
            <Upload className="h-4 w-4" /> Subir CSV o XLSX
          </button>
        </Card>

        {/* ── Opción 2: ZIP Google Drive ── */}
        <Card className="flex flex-col gap-4 p-6">
          <div className="flex items-start gap-4">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700">
              <FolderArchive className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold">Importar carpetas de clientes desde ZIP</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Descarga tus carpetas de Google Drive como ZIP y sube el archivo. El CRM extrae
                clientes, expedientes y documentos automáticamente.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <FormatBadge ext=".zip" color="amber" />
          </div>

          <ul className="space-y-1 text-xs text-muted-foreground">
            <li>• Cada carpeta = un cliente</li>
            <li>• Extrae texto de DOCX y PDF seleccionables</li>
            <li>• Detecta DNI, teléfono, expedientes, juzgado…</li>
            <li>• Vista previa y edición antes de guardar</li>
            <li>• Detección de duplicados por DNI, nombre y teléfono</li>
            <li>• PDF escaneados marcados para OCR posterior</li>
          </ul>

          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <strong>¿Cómo descargar desde Google Drive?</strong>
            <br />
            Selecciona las carpetas → clic derecho → <em>"Descargar"</em>. Google Drive genera
            automáticamente un archivo ZIP.
          </div>

          <button
            type="button"
            onClick={() => setModal("zip")}
            className="mt-auto flex h-10 items-center justify-center gap-2 rounded-lg bg-amber-600 text-white text-sm font-semibold hover:brightness-110"
          >
            <Upload className="h-4 w-4" /> Subir ZIP de Google Drive
          </button>
        </Card>
      </div>

      {/* ── Modals ── */}
      {modal === "csv" && (
        <CSVImport onClose={() => setModal(null)} onSuccess={() => handleSuccess("csv")} />
      )}
      {modal === "zip" && (
        <ZipImport onClose={() => setModal(null)} onSuccess={() => handleSuccess("zip")} />
      )}
    </AppLayout>
  );
}

function FormatBadge({ ext, color = "blue" }: { ext: string; color?: "blue" | "amber" }) {
  const cls =
    color === "amber"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : "border-primary/20 bg-primary/5 text-primary";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cls}`}
    >
      {ext}
    </span>
  );
}
