import { createFileRoute } from "@tanstack/react-router";
import { getEmailConfigStatus, requireEmailRole, safeEmailServerError } from "@/lib/email.server";

export const Route = createFileRoute("/api/email/status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          await requireEmailRole(request, ["Administrador", "Personal"]);
          return Response.json(getEmailConfigStatus());
        } catch (cause) {
          return safeEmailServerError(cause);
        }
      },
    },
  },
});
