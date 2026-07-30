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
  next_hearing?: string;
  next_action?: string;
  current_summary?: string;
  current_status_description?: string;
};

const STATUS_ALIASES: Record<string, CaseStatus> = {
  consulta: "Pendiente de clasificación",
  "pendiente revision": "Pendiente de clasificación",
  "pendiente de revision": "Pendiente de clasificación",
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

function clean(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function stripAccents(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function normalizeCaseStatus(status: unknown): CaseStatus {
  const normalized = stripAccents(clean(status)).toLowerCase();
  return STATUS_ALIASES[normalized] ?? "Pendiente de clasificación";
}

export function displayCaseNumber(expediente: string, caseNumber?: string | null) {
  return clean(caseNumber) || clean(expediente) || "Sin número";
}

export function normalizeCaseForm(values: CaseFormValues) {
  const materia = MATERIA_OPTIONS.includes(values.materia as CaseMateria)
    ? (values.materia as CaseMateria)
    : undefined;
  if (!materia) throw new Error("Selecciona la materia del expediente.");
  return {
    client_id: clean(values.client_id),
    expediente: clean(values.expediente),
    materia,
    process_type: clean(values.process_type),
    status: normalizeCaseStatus(values.status),
    next_hearing: clean(values.next_hearing),
    next_action: clean(values.next_action),
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
  next_hearing: z.string().optional(),
  next_action: z.string().optional(),
  current_summary: z.string().optional(),
  current_status_description: z.string().optional(),
});

export function validateCaseForm(values: CaseFormValues) {
  const result = caseFormSchema.safeParse(normalizeCaseForm(values));
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "Revisa los datos del expediente.");
  }
  return result.data;
}
