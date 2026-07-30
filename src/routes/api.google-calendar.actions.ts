import { createFileRoute } from "@tanstack/react-router";
import {
  disconnectGoogleCalendar,
  processGoogleSyncQueue,
  renewGoogleChannel,
  safeServerError,
  syncGoogleToCrm,
} from "@/lib/google-calendar.server";

export const Route = createFileRoute("/api/google-calendar/actions")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as { action?: string };
          if (body.action === "disconnect") {
            return Response.json(await disconnectGoogleCalendar(request));
          }
          const { googleConnectionStatus } = await import("@/lib/google-calendar.server");
          await googleConnectionStatus(request);
          if (body.action === "sync") {
            const direct = await syncGoogleToCrm();
            const queue = await processGoogleSyncQueue();
            return Response.json({ ...direct, queued: queue.processed });
          }
          if (body.action === "renew") {
            return Response.json(await renewGoogleChannel());
          }
          return Response.json({ error: "Acción no válida." }, { status: 400 });
        } catch (cause) {
          return safeServerError(cause);
        }
      },
    },
  },
});
