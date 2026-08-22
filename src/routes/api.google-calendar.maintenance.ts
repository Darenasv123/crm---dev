import { createFileRoute } from "@tanstack/react-router";
import { readServerRuntimeEnv } from "@/lib/server-runtime-env";
import {
  runGoogleCalendarScheduledMaintenance,
  safeServerError,
  timingSafeEqual,
} from "@/lib/google-calendar.server";

/**
 * Disparador de mantenimiento programado para el target Node/Virtualmin.
 *
 * `src/server.ts` expone `scheduled()`, que solo se ejecuta bajo Cloudflare
 * Workers Cron Triggers (confirmado por `wrangler.toml` + el test de
 * seguridad existente). El preset Nitro "node" (el que realmente usa
 * producción, según la auditoría de fases previas) no tiene equivalente:
 * ese entorno nunca renovaba el canal de Google ni procesaba la cola de
 * sincronización, así que Google→CRM se degradaba silenciosamente ~6 días
 * después de conectar (expiración del canal sin renovar).
 *
 * Este endpoint permite que un cron del sistema operativo (crontab, PM2,
 * systemd timer) dispare el mismo mantenimiento por HTTP. No usa sesión de
 * usuario (un cron no tiene una) sino un secreto compartido, comparado en
 * tiempo constante. Si el operador no configura el secreto, el endpoint
 * queda deshabilitado (no autoriza con secreto vacío).
 *
 * Ejemplo de wiring en el VPS (no se ejecuta como parte de esta fase):
 *   crontab: cada 15 minutos, ejecutar
 *   curl -fsS -X POST \
 *     -H "x-maintenance-secret: $GOOGLE_CALENDAR_MAINTENANCE_SECRET" \
 *     https://abogado.consoldi.com/api/google-calendar/maintenance
 */
export const Route = createFileRoute("/api/google-calendar/maintenance")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const configuredSecret = readServerRuntimeEnv("GOOGLE_CALENDAR_MAINTENANCE_SECRET");
          if (!configuredSecret) {
            return Response.json(
              { error: "Mantenimiento programado no configurado en este servidor." },
              { status: 503 },
            );
          }
          const providedSecret = request.headers.get("x-maintenance-secret") ?? "";
          if (!providedSecret || !(await timingSafeEqual(providedSecret, configuredSecret))) {
            return Response.json({ error: "No autorizado." }, { status: 401 });
          }
          const result = await runGoogleCalendarScheduledMaintenance();
          return Response.json(result);
        } catch (cause) {
          return safeServerError(cause);
        }
      },
    },
  },
});
