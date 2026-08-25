import { createFileRoute } from "@tanstack/react-router";
import {
  googleDriveConnectionStatus,
  safeServerError,
} from "@/lib/google-drive/google-drive.server";

export const Route = createFileRoute("/api/google-drive/status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          return Response.json(await googleDriveConnectionStatus(request));
        } catch (cause) {
          return safeServerError(cause);
        }
      },
    },
  },
});
