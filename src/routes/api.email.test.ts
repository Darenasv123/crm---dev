import { createFileRoute } from "@tanstack/react-router";
import {
  isValidEmail,
  requireEmailRole,
  safeEmailServerError,
  sendTestEmail,
} from "@/lib/email.server";

export const Route = createFileRoute("/api/email/test")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          // Enviar el correo de prueba es una acción de verificación de la
          // integración, no una tarea operativa diaria -- mismo criterio ya
          // usado para las acciones de Google Calendar: solo Administrador.
          await requireEmailRole(request, ["Administrador"]);
          const body = (await request.json().catch(() => ({}))) as { to?: unknown };
          const to = typeof body.to === "string" ? body.to.trim() : "";
          if (!isValidEmail(to)) {
            return Response.json({ error: "Indica un correo de destino válido." }, { status: 400 });
          }
          await sendTestEmail(to);
          return Response.json({ sent: true });
        } catch (cause) {
          return safeEmailServerError(cause);
        }
      },
    },
  },
});
