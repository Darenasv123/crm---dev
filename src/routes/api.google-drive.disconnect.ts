import { createFileRoute } from "@tanstack/react-router";
import { disconnectGoogleDrive, safeServerError } from "@/lib/google-drive/google-drive.server";

export const Route = createFileRoute("/api/google-drive/disconnect")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          return Response.json(await disconnectGoogleDrive(request));
        } catch (cause) {
          return safeServerError(cause);
        }
      },
    },
  },
});
