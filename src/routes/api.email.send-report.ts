import { createClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import { readServerRuntimeEnv } from "@/lib/server-runtime-env";
import { requireEmailRole, safeEmailServerError, sendReportEmail } from "@/lib/email.server";
import type { Database } from "@/lib/database.types";

function serverSecret(name: string) {
  const value = readServerRuntimeEnv(name);
  if (!value) throw new Error(`Falta la configuración de servidor ${name}.`);
  return value;
}

function adminClient() {
  return createClient<Database>(
    serverSecret("SUPABASE_URL"),
    serverSecret("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

export const Route = createFileRoute("/api/email/send-report")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          // Enviar un reporte ya guardado es una acción operativa del día a
          // día -- mismo permiso que crear/ver reportes (ambos roles).
          await requireEmailRole(request, ["Administrador", "Personal"]);

          const body = (await request.json().catch(() => ({}))) as { reportId?: unknown };
          const reportId = typeof body.reportId === "string" ? body.reportId.trim() : "";
          if (!reportId) {
            return Response.json({ error: "Falta el identificador del reporte." }, { status: 400 });
          }

          const db = adminClient();
          const { data: report, error } = await db
            .from("client_reports")
            .select("id, title, body, clients(name, email)")
            .eq("id", reportId)
            .single();

          if (error || !report) {
            return Response.json({ error: "No se encontró el reporte indicado." }, { status: 400 });
          }

          const client = report.clients;
          if (!client?.email) {
            return Response.json(
              { error: "El cliente de este reporte no tiene un correo registrado." },
              { status: 400 },
            );
          }

          await sendReportEmail({
            to: client.email,
            clientName: client.name,
            reportTitle: report.title,
            reportBody: report.body,
          });

          return Response.json({ sent: true });
        } catch (cause) {
          return safeEmailServerError(cause);
        }
      },
    },
  },
});
