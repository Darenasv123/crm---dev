import { createFileRoute } from "@tanstack/react-router";
import { completeGoogleDriveOAuth } from "@/lib/google-drive/google-drive.server";

// GET: el redirect de Google siempre llega como navegación del navegador.
// Usa ?googleDrive= (no ?google=, que ya usa el callback de Calendar) para
// que la página de Configuración pueda distinguir cuál integración generó
// el resultado si ambas comparten la misma pantalla.
export const Route = createFileRoute("/api/google-drive/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = new URL(request.url).origin;
        try {
          await completeGoogleDriveOAuth(request);
          return Response.redirect(`${origin}/configuracion?googleDrive=connected`, 303);
        } catch {
          return Response.redirect(`${origin}/configuracion?googleDrive=error`, 303);
        }
      },
    },
  },
});
