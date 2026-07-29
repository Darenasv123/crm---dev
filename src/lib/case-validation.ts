import { z } from "zod";

export const CASE_STATUS_OPTIONS = [
  "Pendiente de clasificación",
  "En preparación",
  "Presentado",
  "En trámite",
  "En audiencia",
  "En ejecución",
  "Concluido",
  "Archivado",
] as const;

export type CaseStatus = (typeof CASE_STATUS_OPTIONS)[number];

export const MATERIA_OPTIONS = ["Familia", "Penal"] as const;
export type CaseMateria = (typeof MATERIA_OPTIONS)[number];

export type CaseFormValues = {
  client_id: string;
  expediente: string;
  materia: string;
  process_type: string;
  status: string;
  juzgado: string;
  next_hearing?: string;
  case_stage?: string;
  next_action?: string;
  judicial_district?: string;
  judge_or_prosecutor?: string;
  current_summary?: string;
  current_status_description?: string;
};

const STATUS_ALIASES: Record<string, CaseStatus> = {
  consulta: "Pendiente de clasificación",
  "pendiente revision": "Pendiente de clasificación",
  "pendiente de revisión": "Pendiente de clasificación",
  "pendiente de clasificacion": "Pendiente de clasificación",
  documentacion: "En preparación",
  "en preparacion": "En preparación",
  "demanda presentada": "Presentado",
  presentado: "Presentado",
  "en proceso": "En trámite",
  "en tramite": "En trámite",
  audiencia: "En audiencia",
  "en audiencia": "En audiencia",
  sentencia: "Concluido",
  concluido: "Concluido",
  "en ejecucion": "En ejecución",
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
  return STATUS_ALIASES[normalized] ?? "Pendiente de clasificación";
}

export function displayCaseNumber(expediente?: string | null, caseNumber?: string | null) {
  return clean(expediente) || clean(caseNumber) || "Sin número";
}

export function normalizeCaseForm(values: CaseFormValues) {
  const materia = MATERIA_OPTIONS.includes(values.materia as CaseMateria)
    ? (values.materia as CaseMateria)
    : undefined;
  if (!materia) {
    throw new Error("Selecciona la materia del expediente.");
  }
  return {
    client_id: clean(values.client_id),
    expediente: clean(values.expediente),
    materia,
    process_type: clean(values.process_type),
    status: normalizeCaseStatus(values.status),
    juzgado: clean(values.juzgado),
    next_hearing: clean(values.next_hearing),
    case_stage: clean(values.case_stage),
    next_action: clean(values.next_action),
    judicial_district: clean(values.judicial_district),
    judge_or_prosecutor: clean(values.judge_or_prosecutor),
    current_summary: clean(values.current_summary),
    current_status_description: clean(values.current_status_description),
  };
}

const caseFormSchema = z.object({
  client_id: z.string().min(1, "Selecciona un cliente."),
  expediente: z.string(),
  materia: z.enum(MATERIA_OPTIONS, {
    errorMap: () => ({ message: "Selecciona la materia del expediente." }),
  }),
  process_type: z.string().min(2, "Indica el proceso del expediente."),
  status: z.enum(CASE_STATUS_OPTIONS),
  juzgado: z.string(),
  next_hearing: z.string().optional(),
  case_stage: z.string().optional(),
  next_action: z.string().optional(),
  judicial_district: z.string().optional(),
  judge_or_prosecutor: z.string().optional(),
  current_summary: z.string().optional(),
  current_status_description: z.string().optional(),
});

export function validateCaseForm(values: CaseFormValues) {
  const normalized = normalizeCaseForm(values);
  const result = caseFormSchema.safeParse(normalized);
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "Revisa los datos del expediente.");
  }
  return result.data;
}
