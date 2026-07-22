import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { FileSpreadsheet, FolderArchive, Upload, FileText } from "lucide-react";
import { AppLayout, Card } from "@/components/app-layout";
import { CSVImport } from "@/components/csv-import";
import { ZipImport } from "@/components/zip-import";
import { MassImportDryRun } from "@/components/mass-import-dry-run";

export const Route = createFileRoute("/_app/importaciones/")({
  head: () => ({ meta: [{ title: "Importaciones - CRM Juridico" }] }),
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
      subtitle="Migra clientes y expedientes con revision previa antes de guardar"
    >
      {lastSuccess && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <FileText className="h-4 w-4 shrink-0" />
          {lastSuccess.type === "csv"
            ? "Clientes importados correctamente desde CSV/XLSX."
            : "Cliente importado correctamente desde ZIP."}
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="flex flex-col gap-4 p-6">
          <div className="flex items-start gap-4">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <FileSpreadsheet className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold">Importar lista de clientes</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Sube una hoja de calculo con columnas de nombre, DNI, telefono, correo y tipo de
                proceso.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <FormatBadge ext=".csv" />
            <FormatBadge ext=".xlsx" />
          </div>

          <ul className="space-y-1 text-xs text-muted-foreground">
            <li>- Una fila por cliente</li>
            <li>- Encabezados reconocidos automaticamente (espanol/ingles)</li>
            <li>- Vista previa antes de confirmar</li>
            <li>- Plantilla de ejemplo descargable</li>
          </ul>

          <button
            type="button"
            onClick={() => setModal("csv")}
            className="mt-auto flex h-10 items-center justify-center gap-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110"
          >
            <Upload className="h-4 w-4" /> Subir CSV o XLSX
          </button>
        </Card>

        <Card className="flex flex-col gap-4 p-6">
          <div className="flex items-start gap-4">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700">
              <FolderArchive className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold">Importar un cliente desde ZIP</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Sube un ZIP que contenga una sola carpeta de cliente. El CRM detecta datos,
                expedientes y documentos para revision antes de guardar.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <FormatBadge ext=".zip" color="amber" />
          </div>

          <ul className="space-y-1 text-xs text-muted-foreground">
            <li>- Solo una carpeta de cliente por ZIP</li>
            <li>- Extrae texto de DOCX y PDF seleccionables</li>
            <li>- Detecta DNI, telefono, expedientes y juzgado</li>
            <li>- Vista previa jerarquica y edicion antes de guardar</li>
            <li>- Deteccion de duplicados por DNI, nombre y telefono</li>
            <li>- PDF escaneados marcados para OCR posterior</li>
          </ul>

          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <strong>Uso recomendado</strong>
            <br />
            Selecciona una carpeta individual del cliente, descargala como ZIP y confirma despues de
            revisar duplicados, expedientes y documentos.
          </div>

          <button
            type="button"
            onClick={() => setModal("zip")}
            className="mt-auto flex h-10 items-center justify-center gap-2 rounded-lg bg-amber-600 text-white text-sm font-semibold hover:brightness-110"
          >
            <Upload className="h-4 w-4" /> Subir ZIP de un cliente
          </button>
        </Card>
      </div>

      <MassImportDryRun />

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
