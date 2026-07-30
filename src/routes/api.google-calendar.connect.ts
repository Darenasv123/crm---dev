import { createFileRoute } from "@tanstack/react-router";
import { beginGoogleOAuth, safeServerError } from "@/lib/google-calendar.server";

export const Route = createFileRoute("/api/google-calendar/connect")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          return Response.json(await beginGoogleOAuth(request));
        } catch (cause) {
          return safeServerError(cause);
        }
      },
    },
  },
});
