/**
 * zip-analysis-progress.tsx
 * Etapa 3: Indicador de progreso mientras se analiza el ZIP.
 */

import { Loader2, FolderArchive } from "lucide-react";

interface Props {
  message: string;
  fileName: string;
}

export function ZipAnalysisProgress({ message, fileName }: Props) {
  return (
    <div className="flex flex-col items-center gap-6 py-10 text-center">
      <div className="relative">
        <div className="grid h-16 w-16 place-items-center rounded-2xl bg-primary/10 text-primary">
          <FolderArchive className="h-8 w-8" aria-hidden="true" />
        </div>
        <Loader2 className="absolute -right-1 -bottom-1 h-6 w-6 animate-spin text-primary" />
      </div>

      <div>
        <p className="font-semibold text-base">Analizando estructura</p>
        {fileName && (
          <p className="mt-1 text-sm text-muted-foreground truncate max-w-xs">{fileName}</p>
        )}
        <p className="mt-3 text-sm text-muted-foreground animate-pulse">{message}</p>
      </div>

      <div className="text-xs text-muted-foreground">No se está creando ningún dato todavía.</div>
    </div>
  );
}
