import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { getAuthClient } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";
import { invalidateCrmQueries } from "@/lib/query-invalidation";

export type ReportCategory =
  "Reporte" | "Noticia" | "Seguimiento" | "Alerta" | "Estado" | "Observacion";

export type ReportMateria = "Familia" | "Penal";

type ClientReport = Database["public"]["Tables"]["client_reports"]["Row"];
type ClientReportInsert = Database["public"]["Tables"]["client_reports"]["Insert"];

export interface ClientReportWithRelations extends ClientReport {
  clients?: { name: string; initials: string; color: string } | null;
  cases?: {
    expediente: string;
    process_type: string;
    materia: string | null;
    status: Database["public"]["Tables"]["cases"]["Row"]["status"];
  } | null;
  profiles?: { full_name: string; initials: string; role: string } | null;
}

export const REPORT_CATEGORIES: ReportCategory[] = [
  "Reporte",
  "Noticia",
  "Seguimiento",
  "Alerta",
  "Estado",
  "Observacion",
];

export function reportCategoryLabel(category: ReportCategory) {
  return category === "Observacion" ? "Observación" : category;
}

export function useClientReports() {
  return useQuery({
    queryKey: ["client_reports"],
    queryFn: async () => {
      const db = await getAuthClient();
      const { data, error } = await db
        .from("client_reports")
        .select(
          "*, clients(name, initials, color), cases(expediente, process_type, materia, status), profiles(full_name, initials, role)",
        )
        .order("created_at", { ascending: false });

      if (error) throw new Error(error.message);
      return data as ClientReportWithRelations[];
    },
  });
}

export function useCreateClientReport() {
  const qc = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (input: Omit<ClientReportInsert, "author_id">) => {
      if (!user?.id) throw new Error("Sesión expirada. Inicia sesión de nuevo.");

      const db = await getAuthClient();
      const { data, error } = await db
        .from("client_reports")
        .insert({
          ...input,
          author_id: user.id,
          case_id: input.case_id || null,
          materia: input.materia || null,
          status_date: input.status_date || null,
          current_status: input.current_status || null,
          informative_message: input.informative_message || null,
          reminder_days: input.reminder_days || null,
          final_text: input.final_text || null,
        })
        .select(
          "*, clients(name, initials, color), cases(expediente, process_type, materia, status), profiles(full_name, initials, role)",
        )
        .single();

      if (error) throw new Error(error.message);
      return data as ClientReportWithRelations;
    },
    onSuccess: (data) =>
      invalidateCrmQueries(qc, { clientId: data.client_id, caseId: data.case_id }),
  });
}
