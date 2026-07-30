import { createFileRoute } from "@tanstack/react-router";
import { acceptGoogleWebhook } from "@/lib/google-calendar.server";

export const Route = createFileRoute("/api/google-calendar/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => acceptGoogleWebhook(request),
    },
  },
});
