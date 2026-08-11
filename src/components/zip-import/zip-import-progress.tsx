/**
 * zip-import-progress.tsx
 * Etapa 6: Indicador de progreso durante la importación real.
 * (La importación real es sincrónica en el server function, por lo que
 *  mostramos un spinner mientras esperamos la respuesta.)
 */

import { Loader2, ShieldCheck } from "lucide-react";

export function ZipImportProgress() {
  return (
    <div className="flex flex-col items-center gap-6 py-12 text-center">
      <div className="relative">
        <div className="grid h-16 w-16 place-items-center rounded-2xl bg-primary/10 text-primary">
          <ShieldCheck className="h-8 w-8" aria-hidden="true" />
        </div>
        <Loader2 className="absolute -right-1 -bottom-1 h-6 w-6 animate-spin text-primary" />
      </div>

      <div>
        <p className="font-semibold text-base">Importando clientes y documentos</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Creando registros en la base de datos y subiendo archivos a Storage…
        </p>
        <p className="mt-3 text-xs text-muted-foreground animate-pulse">
          No cierres esta ventana hasta que la importación finalice.
        </p>
      </div>
    </div>
  );
}
