import { createFileRoute } from "@tanstack/react-router";
import { safeServerError } from "@/lib/google-drive/google-drive.server";
import { prepareDocumentTrash } from "@/lib/google-drive/drive-sync.server";

/**
 * Productor: se llama ANTES de borrar un documento en el CRM y encola el
 * traslado a la papelera de Drive con un margen. Exige el permiso real de
 * eliminar documentos. No llama a Google.
 *
 * Si esto falla, el borrado en el CRM debe seguir adelante igualmente: la
 * copia en Drive quedará huérfana hasta la reconciliación de Fase 8F, que es
 * mucho mejor que impedir borrar un documento porque Google no responde.
 */
export const Route = createFileRoute("/api/google-drive/prepare-document-trash")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json().catch(() => ({}))) as { documentId?: unknown };
          return Response.json(await prepareDocumentTrash(request, body.documentId));
        } catch (cause) {
          return safeServerError(cause);
        }
      },
    },
  },
});
