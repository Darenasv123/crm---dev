import { createFileRoute } from "@tanstack/react-router";
import { readServerRuntimeEnv } from "@/lib/server-runtime-env";
import { safeServerError, timingSafeEqual } from "@/lib/google-drive/google-drive.server";
import { processGoogleDriveSyncQueue } from "@/lib/google-drive/drive-sync.server";

/**
 * Mantenimiento de la cola de Drive. Máquina a máquina: lo invoca un cron
 * del servidor, NUNCA una sesión de Administrador.
 *
 * Deliberadamente no usa la sesión del CRM: un cron no tiene usuario, y
 * darle un token de Administrador para esto sería crear una credencial de
 * larga vida con muchos más permisos de los que necesita. Se autentica con
 * un secreto dedicado comparado en tiempo constante.
 *
 * Si el secreto no está configurado responde 503 en vez de quedar abierto:
 * ante una configuración incompleta, cerrado es el estado seguro.
 *
 * En Fase 8F esta misma ruta ejecutará además el sondeo de cambios de Drive
 * y la renovación de canales. Ahora solo procesa la cola CRM -> Drive.
 */
export const Route = createFileRoute("/api/google-drive/maintenance")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const secret = readServerRuntimeEnv("GOOGLE_DRIVE_MAINTENANCE_SECRET");
          if (!secret) {
            return Response.json(
              { error: "El mantenimiento de Google Drive no está configurado." },
              { status: 503 },
            );
          }
          const provided = request.headers.get("x-maintenance-secret") ?? "";
          if (!(await timingSafeEqual(provided, secret))) {
            return Response.json({ error: "No autorizado." }, { status: 403 });
          }
          return Response.json(await processGoogleDriveSyncQueue());
        } catch (cause) {
          return safeServerError(cause);
        }
      },
    },
  },
});
