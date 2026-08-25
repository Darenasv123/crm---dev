import { createFileRoute } from "@tanstack/react-router";
import {
  applyGoogleDriveClientFolderMappings,
  safeServerError,
} from "@/lib/google-drive/google-drive.server";

/**
 * Persiste un lote de vinculaciones Cliente <-> Carpeta. Solo Administrador.
 *
 * Todo lo que llega en el cuerpo se revalida contra Google antes de escribir
 * nada, y la escritura es atómica: o se aplica el lote entero o ninguno.
 */
export const Route = createFileRoute("/api/google-drive/onboarding/apply")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json().catch(() => ({}))) as { mappings?: unknown };
          return Response.json(await applyGoogleDriveClientFolderMappings(request, body.mappings));
        } catch (cause) {
          return safeServerError(cause);
        }
      },
    },
  },
});
