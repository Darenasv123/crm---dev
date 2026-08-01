import { createFileRoute } from "@tanstack/react-router";

// Build-time constants injected by Vite / Nitro
// These are set during `npm run build:node` and baked into the bundle.
const BUILD_COMMIT = (import.meta.env.VITE_BUILD_COMMIT as string | undefined) ?? "unknown";
const BUILD_DATE = (import.meta.env.VITE_BUILD_DATE as string | undefined) ?? "unknown";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: () => {
        return Response.json(
          {
            status: "ok",
            service: "advocate-nest",
            version: BUILD_COMMIT,
            buildDate: BUILD_DATE,
          },
          {
            status: 200,
            headers: {
              "Cache-Control": "no-store",
              "Content-Type": "application/json",
            },
          },
        );
      },
    },
  },
});
