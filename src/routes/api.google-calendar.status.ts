import { createFileRoute } from "@tanstack/react-router";
import { googleConnectionStatus, safeServerError } from "@/lib/google-calendar.server";

export const Route = createFileRoute("/api/google-calendar/status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          return Response.json(await googleConnectionStatus(request));
        } catch (cause) {
          return safeServerError(cause);
        }
      },
    },
  },
});
