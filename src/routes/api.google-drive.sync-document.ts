import { createFileRoute } from "@tanstack/react-router";
import { safeServerError } from "@/lib/google-drive/google-drive.server";
import { requestDocumentSync } from "@/lib/google-drive/drive-sync.server";

/**
 * Productor: pide sincronizar un documento con Drive (alta o renombrado).
 *
 * Solo acepta `documentId`; el servidor decide qué operación corresponde.
 * No llama a Google: solo encola.
 */
export const Route = createFileRoute("/api/google-drive/sync-document")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json().catch(() => ({}))) as { documentId?: unknown };
          return Response.json(await requestDocumentSync(request, body.documentId));
        } catch (cause) {
          return safeServerError(cause);
        }
      },
    },
  },
});
