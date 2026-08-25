import { createFileRoute } from "@tanstack/react-router";
import { browseGoogleDriveFolders, safeServerError } from "@/lib/google-drive/google-drive.server";

/**
 * Navegador de carpetas de Drive, solo Administrador.
 *
 * El ÚNICO parámetro aceptado es `parentId`. No se acepta `q`, `fields`,
 * `pageSize`, `orderBy` ni ninguna URL: este endpoint no es un proxy
 * genérico a Drive, solo lista subcarpetas. El servidor construye la
 * consulta entera y devuelve un DTO propio, nunca la respuesta de Google.
 */
export const Route = createFileRoute("/api/google-drive/folders")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const parentId = new URL(request.url).searchParams.get("parentId");
          return Response.json(await browseGoogleDriveFolders(request, parentId));
        } catch (cause) {
          return safeServerError(cause);
        }
      },
    },
  },
});
