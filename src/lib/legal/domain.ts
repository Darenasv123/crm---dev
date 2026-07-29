import { z } from "zod";

const nullableText = z
  .string()
  .trim()
  .transform((value) => value || null)
  .nullable()
  .optional();

export const verificationStatusSchema = z.enum([
  "pending",
  "approved",
  "edited",
  "rejected",
  "conflict",
]);

export const clientDraftSchema = z.object({
  name: z.string().trim().min(2, "Ingresa el nombre del cliente."),
  documentType: z.string().trim().min(1).default("DNI"),
  documentNumber: nullableText,
  phone: nullableText,
  whatsapp: nullableText,
  email: z
    .string()
    .trim()
    .email()
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
  processType: z.string().trim().min(2, "Ingresa el servicio o materia inicial."),
});

export const caseDraftSchema = z.object({
  clientId: z.string().uuid(),
  internalCode: nullableText,
  caseNumber: z.string().trim().min(2, "Ingresa el número de expediente."),
  caseName: z.string().trim().min(2),
  caseType: z.string().trim().min(2),
  legalArea: nullableText,
  caseStage: nullableText,
  court: z.string().trim().min(2),
  priority: z.enum(["Alta", "Media", "Baja"]).default("Media"),
});

export const documentRecordSchema = z.object({
  clientId: z.string().uuid().nullable().optional(),
  caseId: z.string().uuid().nullable().optional(),
  originalName: z.string().trim().min(1),
  displayName: z.string().trim().min(1),
  documentType: z.string().trim().min(1),
  mimeType: nullableText,
  sourceType: z.enum(["manual_upload", "google_drive", "supabase_storage", "generated", "other"]),
  sourceProvider: nullableText,
  storagePath: z.string().trim().min(1),
});

export const caseEventDraftSchema = z.object({
  caseId: z.string().uuid(),
  documentId: z.string().uuid().nullable().optional(),
  eventType: z.string().trim().min(1),
  title: z.string().trim().min(2),
  description: nullableText,
  eventDate: z.string().date(),
  verificationStatus: verificationStatusSchema.default("approved"),
  createdByAi: z.boolean().default(false),
});

export const caseTaskDraftSchema = z.object({
  caseId: z.string().uuid().nullable().optional(),
  clientId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(2),
  description: nullableText,
  priority: z.enum(["Baja", "Normal", "Media", "Alta", "Urgente"]).default("Normal"),
  status: z
    .enum([
      "pending",
      "in_progress",
      "ready_to_file",
      "completed",
      "blocked",
      "cancelled",
      "overdue",
    ])
    .default("pending"),
  dueDate: z.string().datetime().nullable().optional(),
  isAllDay: z.boolean().default(false),
  assignedTo: z.string().uuid().nullable().optional(),
  source: z.string().trim().min(1).default("manual"),
});

export type ClientDraft = z.input<typeof clientDraftSchema>;
export type CaseDraft = z.input<typeof caseDraftSchema>;
export type DocumentRecordDraft = z.input<typeof documentRecordSchema>;
export type CaseEventDraft = z.input<typeof caseEventDraftSchema>;
export type CaseTaskDraft = z.input<typeof caseTaskDraftSchema>;

export function normalizeDocumentNumber(value?: string | null) {
  const normalized = value?.replace(/[^0-9A-Za-z-]/g, "").toUpperCase() ?? "";
  return normalized || null;
}

export function normalizePhone(value?: string | null) {
  const digits = value?.replace(/\D/g, "") ?? "";
  if (!digits) return null;
  if (digits.startsWith("51") && digits.length === 11) return `+${digits}`;
  if (digits.length === 9) return `+51${digits}`;
  return `+${digits}`;
}

export function normalizeCaseNumber(value: string) {
  return value.trim().replace(/\s+/g, "").toUpperCase();
}

export function buildLegacyCompatibleClient(input: ClientDraft) {
  const parsed = clientDraftSchema.parse(input);
  const documentNumber = normalizeDocumentNumber(parsed.documentNumber);
  const phone = normalizePhone(parsed.phone);
  return {
    name: parsed.name,
    dni: documentNumber ?? "",
    document_type: parsed.documentType,
    document_number: documentNumber,
    phone: phone ?? "",
    whatsapp: normalizePhone(parsed.whatsapp) ?? phone,
    email: parsed.email ?? null,
    process_type: parsed.processType,
  };
}

export function buildLegacyCompatibleCase(input: CaseDraft) {
  const parsed = caseDraftSchema.parse(input);
  const caseNumber = normalizeCaseNumber(parsed.caseNumber);
  return {
    client_id: parsed.clientId,
    expediente: caseNumber,
    internal_code: parsed.internalCode ?? caseNumber,
    case_number: caseNumber,
    case_name: parsed.caseName,
    case_type: parsed.caseType,
    process_type: parsed.caseType,
    legal_area: parsed.legalArea ?? null,
    case_stage: parsed.caseStage ?? null,
    juzgado: parsed.court,
    court: parsed.court,
    priority: parsed.priority,
  };
}

export function buildDocumentRecord(input: DocumentRecordDraft) {
  const parsed = documentRecordSchema.parse(input);
  return {
    client_id: parsed.clientId ?? null,
    case_id: parsed.caseId,
    name: parsed.displayName,
    original_name: parsed.originalName,
    display_name: parsed.displayName,
    type: parsed.documentType,
    document_type: parsed.documentType,
    mime_type: parsed.mimeType ?? null,
    source_type: parsed.sourceType,
    source_provider: parsed.sourceProvider ?? null,
    storage_path: parsed.storagePath,
  };
}

export function buildCaseEvent(input: CaseEventDraft) {
  const parsed = caseEventDraftSchema.parse(input);
  return {
    case_id: parsed.caseId ?? null,
    document_id: parsed.documentId ?? null,
    event_type: parsed.eventType,
    title: parsed.title,
    description: parsed.description ?? null,
    event_date: parsed.eventDate,
    verification_status: parsed.verificationStatus,
    created_by_ai: parsed.createdByAi,
  };
}

export function buildCaseTask(input: CaseTaskDraft) {
  const parsed = caseTaskDraftSchema.parse(input);
  return {
    case_id: parsed.caseId ?? null,
    client_id: parsed.clientId ?? null,
    title: parsed.title,
    description: parsed.description ?? null,
    priority: parsed.priority,
    status: parsed.status,
    due_date: parsed.dueDate ?? null,
    is_all_day: parsed.isAllDay,
    assigned_to: parsed.assignedTo ?? null,
    source: parsed.source,
  };
}
