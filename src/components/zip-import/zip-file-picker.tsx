/**
 * zip-file-picker.tsx
 * Etapa 2: Selección del archivo ZIP con validaciones y metadatos.
 */

import { useState, useCallback } from "react";
import { Upload, FolderArchive, AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MAX_ZIP_SIZE_BYTES } from "@/lib/zip-import/security";

const WARN_ZIP_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB para mostrar advertencia

function formatSize(bytes: number): string {
  if (bytes === MAX_ZIP_SIZE_BYTES) return "1 GB";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface Props {
  onFileSelected: (file: File) => void;
  onCancel: () => void;
}

export function ZipFilePicker({ onFileSelected, onCancel }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const validateAndSet = useCallback((candidate: File) => {
    setError(null);
    if (!candidate.name.toLowerCase().endsWith(".zip")) {
      setError("Solo se aceptan archivos .zip");
      setFile(null);
      return;
    }
    if (candidate.size > MAX_ZIP_SIZE_BYTES) {
      setError(`El archivo supera el límite de ${formatSize(MAX_ZIP_SIZE_BYTES)}.`);
      setFile(null);
      return;
    }
    setFile(candidate);
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLLabelElement>) => {
      event.preventDefault();
      setDragging(false);
      const dropped = event.dataTransfer.files[0];
      if (dropped) validateAndSet(dropped);
    },
    [validateAndSet],
  );

  const warnings: string[] = [];
  if (file && file.size > WARN_ZIP_SIZE_BYTES) {
    warnings.push(
      `El archivo es grande (${formatSize(file.size)}). El análisis puede tardar unos segundos.`,
    );
  }

  return (
    <div className="space-y-4">
      <label
        onDrop={handleDrop}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        className={[
          "flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed p-10 text-center transition-colors",
          dragging
            ? "border-primary/60 bg-primary/5"
            : "border-border hover:border-primary/40 hover:bg-muted/30",
        ].join(" ")}
      >
        <FolderArchive className="h-10 w-10 text-muted-foreground mb-3" aria-hidden="true" />
        <p className="font-semibold text-sm">{file ? file.name : "Arrastra el archivo ZIP aquí"}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          o haz clic para seleccionar · Solo archivos .zip · Máx {formatSize(MAX_ZIP_SIZE_BYTES)}
        </p>
        <input
          type="file"
          accept=".zip"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) validateAndSet(f);
          }}
        />
      </label>

      {/* Metadatos del archivo */}
      {file && (
        <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
          <div className="grid grid-cols-2 gap-y-2 gap-x-4">
            <span className="text-muted-foreground">Nombre</span>
            <span className="font-medium truncate">{file.name}</span>
            <span className="text-muted-foreground">Tamaño</span>
            <span className="font-medium">{formatSize(file.size)}</span>
            <span className="text-muted-foreground">Última modificación</span>
            <span className="font-medium">
              {new Date(file.lastModified).toLocaleString("es-PE", {
                day: "2-digit",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
        </div>
      )}

      {/* Advertencias de tamaño */}
      {warnings.map((w, i) => (
        <div
          key={i}
          className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          {w}
        </div>
      ))}

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={onCancel}>
          <X className="h-4 w-4 mr-1" /> Cancelar
        </Button>
        <Button onClick={() => file && onFileSelected(file)} disabled={!file}>
          <Upload className="h-4 w-4 mr-1" /> Analizar ZIP
        </Button>
      </div>
    </div>
  );
}
