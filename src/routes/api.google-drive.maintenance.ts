import { createFileRoute } from "@tanstack/react-router";
import { readServerRuntimeEnv } from "@/lib/server-runtime-env";
import { safeServerError, timingSafeEqual } from "@/lib/google-drive/google-drive.server";
import { runGoogleDriveMaintenance } from "@/lib/google-drive/drive-sync.server";

/**
 * Mantenimiento de Drive. Máquina a máquina: lo invoca un cron del
 * servidor, NUNCA una sesión de Administrador.
 *
 * Deliberadamente no usa la sesión del CRM: un cron no tiene usuario, y
 * darle un token de Administrador para esto sería crear una credencial de
 * larga vida con muchos más permisos de los que necesita. Se autentica con
 * un secreto dedicado comparado en tiempo constante.
 *
 * Si el secreto no está configurado responde 503 en vez de quedar abierto:
 * ante una configuración incompleta, cerrado es el estado seguro.
 *
 * Fase 8F: además de procesar la cola CRM -> Drive, cada ejecución
 * inicializa el cursor de cambios si falta, asegura/renueva el canal de
 * watch si hay webhook configurado, encola `poll_changes`, y corre la
 * reconciliación cuando ya toca (ver `runGoogleDriveMaintenance`). No hace
 * falta cron interno: el despliegue final decide la frecuencia con la que
 * llama a esta ruta.
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
          return Response.json(await runGoogleDriveMaintenance());
        } catch (cause) {
          return safeServerError(cause);
        }
      },
    },
  },
});
