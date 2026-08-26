import { createFileRoute } from "@tanstack/react-router";
import { safeServerError } from "@/lib/google-drive/google-drive.server";
import { requestClientFolderSync } from "@/lib/google-drive/drive-sync.server";

/**
 * Productor: pide asegurar la carpeta de Drive de un Cliente.
 *
 * Solo acepta `clientId`. El servidor resuelve la conexión, la raíz y el
 * mapping; el navegador nunca ve ni envía identificadores de Drive.
 * No llama a Google: solo encola.
 */
export const Route = createFileRoute("/api/google-drive/sync-client")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json().catch(() => ({}))) as { clientId?: unknown };
          return Response.json(await requestClientFolderSync(request, body.clientId));
        } catch (cause) {
          return safeServerError(cause);
        }
      },
    },
  },
});
