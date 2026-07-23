import { z } from "zod";

export const CASE_STATUS_OPTIONS = [
  "Pendiente de clasificacion",
  "En preparacion",
  "Presentado",
  "En tramite",
  "En audiencia",
  "En ejecucion",
  "Concluido",
  "Archivado",
] as const;

export type CaseStatus = (typeof CASE_STATUS_OPTIONS)[number];

export const CASE_PRIORITY_OPTIONS = ["Alta", "Media", "Baja"] as const;
export type CasePriority = (typeof CASE_PRIORITY_OPTIONS)[number];

export type CaseFormValues = {
  client_id: string;
  expediente: string;
  process_type: string;
  priority: string;
  status: string;
  juzgado: string;
  next_hearing?: string;
  internal_code?: string;
  legal_area?: string;
  case_stage?: string;
  responsible_user_id?: string;
  next_action?: string;
  filing_date?: string;
  judicial_district?: string;
  judge_or_prosecutor?: string;
  current_summary?: string;
  current_status_description?: string;
};

const STATUS_ALIASES: Record<string, CaseStatus> = {
  consulta: "Pendiente de clasificacion",
  "pendiente revision": "Pendiente de clasificacion",
  "pendiente de revision": "Pendiente de clasificacion",
  "pendiente de clasificacion": "Pendiente de clasificacion",
  documentacion: "En preparacion",
  "en preparacion": "En preparacion",
  "demanda presentada": "Presentado",
  presentado: "Presentado",
  "en proceso": "En tramite",
  "en tramite": "En tramite",
  audiencia: "En audiencia",
  "en audiencia": "En audiencia",
  sentencia: "Concluido",
  concluido: "Concluido",
  "en ejecucion": "En ejecucion",
  archivado: "Archivado",
};

function stripAccents(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function clean(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeCaseStatus(status: unknown): CaseStatus {
  const normalized = stripAccents(clean(status)).toLowerCase();
  return STATUS_ALIASES[normalized] ?? "Pendiente de clasificacion";
}

export function displayCaseNumber(expediente?: string | null, caseNumber?: string | null) {
  return clean(expediente) || clean(caseNumber) || "Sin numero";
}

export function normalizeCaseForm(values: CaseFormValues) {
  return {
    ...values,
    client_id: clean(values.client_id),
    expediente: clean(values.expediente),
    process_type: clean(values.process_type),
    priority: CASE_PRIORITY_OPTIONS.includes(values.priority as CasePriority)
      ? (values.priority as CasePriority)
      : "Media",
    status: normalizeCaseStatus(values.status),
    juzgado: clean(values.juzgado),
    internal_code: clean(values.internal_code),
    legal_area: clean(values.legal_area),
    case_stage: clean(values.case_stage),
    responsible_user_id: clean(values.responsible_user_id),
    next_action: clean(values.next_action),
    filing_date: clean(values.filing_date),
    judicial_district: clean(values.judicial_district),
    judge_or_prosecutor: clean(values.judge_or_prosecutor),
    current_summary: clean(values.current_summary),
    current_status_description: clean(values.current_status_description),
  };
}

const caseFormSchema = z.object({
  client_id: z.string().min(1, "Selecciona un cliente."),
  expediente: z.string(),
  process_type: z.string().min(2, "Indica la materia o proceso del expediente."),
  priority: z.enum(CASE_PRIORITY_OPTIONS),
  status: z.enum(CASE_STATUS_OPTIONS),
  juzgado: z.string(),
  next_hearing: z.string().optional(),
  internal_code: z.string(),
  legal_area: z.string(),
  case_stage: z.string(),
  responsible_user_id: z.string(),
  next_action: z.string(),
  filing_date: z.string(),
  judicial_district: z.string(),
  judge_or_prosecutor: z.string(),
  current_summary: z.string(),
  current_status_description: z.string(),
});

export function validateCaseForm(values: CaseFormValues) {
  const normalized = normalizeCaseForm(values);
  const result = caseFormSchema.safeParse(normalized);
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "Revisa los datos del expediente.");
  }
  return result.data;
}
