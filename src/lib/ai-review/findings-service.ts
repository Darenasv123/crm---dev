import { getAuthClient } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";
import { z } from "zod";

export type AiFindingRow = Database["public"]["Tables"]["ai_findings"]["Row"];

// Supabase gen types emits `string` for TEXT columns with CHECK constraints.
// We declare the allowed values explicitly so the rest of the codebase is narrowed.
export type VerificationStatus = "pending" | "approved" | "edited" | "rejected" | "conflict";
export type ImportJobRow = Database["public"]["Tables"]["import_jobs"]["Row"];
export type SourceReferenceRow = Database["public"]["Tables"]["source_references"]["Row"];

export interface FindingFilterOptions {
  status?: VerificationStatus | "all";
  importJobId?: string | "all";
  clientId?: string | "all";
  caseId?: string | "all";
  findingType?: string | "all";
  minConfidence?: number;
  page?: number;
  pageSize?: number;
}

export interface PaginatedFindingsResult {
  data: AiFindingRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export const VERIFICATION_STATUSES = [
  "pending",
  "approved",
  "edited",
  "rejected",
  "conflict",
] as const;

export const updateFindingDecisionSchema = z.object({
  findingId: z.string().uuid("ID de hallazgo inválido."),
  status: z.enum(VERIFICATION_STATUSES),
  editedValue: z.string().trim().nullable().optional(),
  reviewNotes: z
    .string()
    .trim()
    .max(1000, "Las notas no pueden superar los 1000 caracteres.")
    .nullable()
    .optional(),
  userId: z.string().uuid("ID de usuario inválido."),
});

export type UpdateFindingDecisionInput = z.infer<typeof updateFindingDecisionSchema>;

/**
 * Consulta paginada y filtrada de hallazgos de IA en Supabase.
 */
export async function fetchFindings(
  options: FindingFilterOptions = {},
): Promise<PaginatedFindingsResult> {
  const db = await getAuthClient();
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.max(1, Math.min(100, options.pageSize ?? 10));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = db.from("ai_findings").select("*", { count: "exact" });

  if (options.status && options.status !== "all") {
    query = query.eq("verification_status", options.status);
  }

  if (options.clientId && options.clientId !== "all") {
    query = query.eq("client_id", options.clientId);
  }

  if (options.caseId && options.caseId !== "all") {
    query = query.eq("case_id", options.caseId);
  }

  if (options.findingType && options.findingType !== "all") {
    query = query.eq("finding_type", options.findingType);
  }

  if (options.minConfidence && options.minConfidence > 0) {
    query = query.gte("confidence_score", options.minConfidence);
  }

  query = query.order("created_at", { ascending: false }).range(from, to);

  const { data, error, count } = await query;

  if (error) {
    throw new Error(`Error al consultar hallazgos de IA: ${error.message}`);
  }

  const total = count ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  return {
    data: data ?? [],
    total,
    page,
    pageSize,
    totalPages,
  };
}

/**
 * Obtiene la referencia de fuente vinculada a un hallazgo.
 */
export async function fetchSourceReferenceForFinding(
  findingId: string,
): Promise<SourceReferenceRow | null> {
  const db = await getAuthClient();
  const { data, error } = await db
    .from("source_references")
    .select("*")
    .eq("entity_type", "ai_finding")
    .eq("entity_id", findingId)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    console.warn(`No se pudo obtener la referencia de fuente para ${findingId}:`, error.message);
  }

  return data ?? null;
}

/**
 * Obtiene la lista de trabajos de importación para poblar el filtro.
 */
export async function fetchImportJobsForFilter(): Promise<ImportJobRow[]> {
  const db = await getAuthClient();
  const { data, error } = await db
    .from("import_jobs")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.warn("Error al cargar trabajos de importación para filtro:", error.message);
    return [];
  }

  return data ?? [];
}

/**
 * Persiste la decisión de revisión humana sobre un hallazgo de IA en Supabase.
 */
export async function persistFindingDecision(
  input: UpdateFindingDecisionInput,
): Promise<AiFindingRow> {
  const parsed = updateFindingDecisionSchema.parse(input);
  const db = await getAuthClient();

  const updatePayload: Database["public"]["Tables"]["ai_findings"]["Update"] = {
    verification_status: parsed.status,
    reviewed_at: new Date().toISOString(),
    reviewed_by: parsed.userId,
    review_notes: parsed.reviewNotes ?? null,
  };

  if (parsed.status === "edited" && parsed.editedValue !== undefined) {
    updatePayload.normalized_value = parsed.editedValue;
  }

  const { data, error } = await db
    .from("ai_findings")
    .update(updatePayload)
    .eq("id", parsed.findingId)
    .select()
    .single();

  if (error) {
    throw new Error(`Error al actualizar la decisión del hallazgo: ${error.message}`);
  }

  return data;
}
