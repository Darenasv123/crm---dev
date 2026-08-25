import { createFileRoute } from "@tanstack/react-router";
import { beginGoogleDriveOAuth, safeServerError } from "@/lib/google-drive/google-drive.server";

// POST (Fase 8B Sección 28) -- a diferencia de Calendar (GET), Drive no
// necesita ningún parámetro de query al iniciar la conexión (la carpeta
// raíz se elige después, desde la BD, no durante el propio OAuth).
export const Route = createFileRoute("/api/google-drive/connect")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          return Response.json(await beginGoogleDriveOAuth(request));
        } catch (cause) {
          return safeServerError(cause);
        }
      },
    },
  },
});
