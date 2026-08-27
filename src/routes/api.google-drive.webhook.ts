import { createFileRoute } from "@tanstack/react-router";
import { handleGoogleDriveWebhookNotification } from "@/lib/google-drive/drive-sync.server";
import { safeServerError } from "@/lib/google-drive/google-drive.server";

/**
 * Fase 8F — receptor de notificaciones de Google Drive (`changes.watch`).
 *
 * Deliberadamente LIGERO (Sección 33): la única acción real es encolar
 * `poll_changes` (deduped) y responder. Nunca llama a Google, nunca lee el
 * body (Google no garantiza uno útil aquí y el pedido exige ignorarlo),
 * nunca hace un scan de base de datos largo. Toda la autoridad real vive en
 * `changes.list`, que el worker de la cola ejecutará por separado.
 *
 * Sin sesión de Administrador ni `X-Maintenance-Secret` (Sección 29): la
 * autoridad es el propio canal -- su `channel_id` + el hash de su
 * `channel_token`, verificados en tiempo constante dentro de
 * `handleGoogleDriveWebhookNotification`. Mezclar aquí el secreto de
 * mantenimiento confundiría dos modelos de confianza distintos.
 *
 * Siempre responde 204, incluso ante datos desconocidos (Sección 28/58/61):
 * un `channel_id` que todavía no existe en nuestra base de datos puede
 * significar simplemente que el mensaje `sync` llegó antes de que la
 * respuesta de `changes.watch` terminara de persistirse -- nunca un 500.
 * Un token incorrecto sí se rechaza explícitamente.
 */
export const Route = createFileRoute("/api/google-drive/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          // El body se ignora a propósito -- toda la información que
          // necesitamos viaja en las cabeceras X-Goog-*.
          const action = await handleGoogleDriveWebhookNotification({
            channelId: request.headers.get("x-goog-channel-id"),
            channelToken: request.headers.get("x-goog-channel-token"),
            resourceId: request.headers.get("x-goog-resource-id"),
            resourceState: request.headers.get("x-goog-resource-state"),
          });
          if (action.kind === "reject") {
            return new Response(null, { status: 403 });
          }
          return new Response(null, { status: 204 });
        } catch (cause) {
          return safeServerError(cause);
        }
      },
    },
  },
});
