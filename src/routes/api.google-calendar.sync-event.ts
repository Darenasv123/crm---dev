import { createFileRoute } from "@tanstack/react-router";
import {
  authorizeAgendaSync,
  resolveAgendaSyncConflict,
  safeServerError,
  syncCrmEventToGoogle,
} from "@/lib/google-calendar.server";

export const Route = createFileRoute("/api/google-calendar/sync-event")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          await authorizeAgendaSync(request);
          const body = (await request.json()) as {
            eventId?: string;
            resolution?: "crm" | "google";
          };
          if (!body.eventId) {
            return Response.json({ error: "Falta el evento." }, { status: 400 });
          }
          if (body.resolution) {
            return Response.json(
              await resolveAgendaSyncConflict(request, body.eventId, body.resolution),
            );
          }
          return Response.json(await syncCrmEventToGoogle(body.eventId));
        } catch (cause) {
          return safeServerError(cause);
        }
      },
    },
  },
});
