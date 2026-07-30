import { createFileRoute } from "@tanstack/react-router";
import { completeGoogleOAuth } from "@/lib/google-calendar.server";

export const Route = createFileRoute("/api/google-calendar/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = new URL(request.url).origin;
        try {
          await completeGoogleOAuth(request);
          return Response.redirect(`${origin}/configuracion?google=connected`, 303);
        } catch {
          return Response.redirect(`${origin}/configuracion?google=error`, 303);
        }
      },
    },
  },
});
