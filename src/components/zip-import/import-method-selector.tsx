/**
 * import-method-selector.tsx
 *
 * Etapa 1: Modal inicial que permite elegir entre:
 *   - Importar desde Excel o CSV
 *   - Importar clientes y documentos desde ZIP
 */

import { FileSpreadsheet, FolderArchive, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export type ImportMethod = "csv" | "zip";

interface Props {
  open: boolean;
  zipAllowed: boolean;
  onSelect: (method: ImportMethod) => void;
  onClose: () => void;
}

export function ImportMethodSelector({ open, zipAllowed, onSelect, onClose }: Props) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Importar clientes</DialogTitle>
          <DialogDescription>Elige el método de importación.</DialogDescription>
        </DialogHeader>

        <div className="mt-2 grid gap-3">
          <button
            type="button"
            onClick={() => onSelect("csv")}
            className="flex items-start gap-4 rounded-xl border border-border p-4 text-left transition-colors hover:bg-primary/5 hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:rounded-xl"
          >
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-600">
              <FileSpreadsheet className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <p className="font-semibold text-sm">Desde Excel o CSV</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Importa una lista de clientes desde un archivo .csv o .xlsx. Columnas: nombre,
                teléfono, correo, estado.
              </p>
            </div>
          </button>

          <button
            type="button"
            disabled={!zipAllowed}
            onClick={() => onSelect("zip")}
            className="flex items-start gap-4 rounded-xl border border-border p-4 text-left transition-colors hover:bg-primary/5 hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:rounded-xl disabled:cursor-not-allowed disabled:opacity-50"
          >
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-amber-50 text-amber-600">
              <FolderArchive className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <p className="font-semibold text-sm">Desde archivo ZIP</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Importa clientes y sus documentos desde un ZIP con carpetas. Detecta automáticamente
                clientes, subcarpetas y documentos. Solo Administrador activo.
              </p>
            </div>
          </button>
        </div>

        <div className="mt-4 flex justify-end">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4 mr-1" />
            Cancelar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
