import { createFileRoute } from "@tanstack/react-router";
import {
  googleDriveOnboardingPreview,
  safeServerError,
} from "@/lib/google-drive/google-drive.server";

/**
 * Vista previa Cliente <-> Carpeta. Solo Administrador y estrictamente de
 * solo lectura: no escribe en Supabase ni en Google Drive. Abrirla nunca
 * vincula nada -- toda vinculación pasa por /onboarding/apply.
 */
export const Route = createFileRoute("/api/google-drive/onboarding/preview")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          return Response.json(await googleDriveOnboardingPreview(request));
        } catch (cause) {
          return safeServerError(cause);
        }
      },
    },
  },
});
