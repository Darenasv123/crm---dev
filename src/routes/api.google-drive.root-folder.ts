import { createFileRoute } from "@tanstack/react-router";
import { safeServerError, setGoogleDriveRootFolder } from "@/lib/google-drive/google-drive.server";

/**
 * Fija la carpeta raíz de Clientes. Solo Administrador.
 *
 * El cuerpo solo puede traer `folderId`. Un `folderName` enviado por el
 * frontend se ignora por completo: el nombre que se persiste lo obtiene el
 * servidor de la metadata real de Google.
 */
export const Route = createFileRoute("/api/google-drive/root-folder")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json().catch(() => ({}))) as { folderId?: unknown };
          return Response.json(await setGoogleDriveRootFolder(request, body.folderId));
        } catch (cause) {
          return safeServerError(cause);
        }
      },
    },
  },
});
