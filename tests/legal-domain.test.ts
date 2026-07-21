import { describe, expect, it } from "vitest";
import {
  buildCaseEvent,
  buildCaseTask,
  buildDocumentRecord,
  buildLegacyCompatibleCase,
  buildLegacyCompatibleClient,
  caseTaskDraftSchema,
  normalizeCaseNumber,
  normalizeDocumentNumber,
  normalizePhone,
} from "@/lib/legal/domain";

const clientId = "11111111-1111-4111-8111-111111111111";
const caseId = "22222222-2222-4222-8222-222222222222";
const documentId = "33333333-3333-4333-8333-333333333333";

describe("normalización jurídica", () => {
  it("normaliza documentos, teléfonos y expedientes", () => {
    expect(normalizeDocumentNumber(" 45 879 632 ")).toBe("45879632");
    expect(normalizePhone("987 654 321")).toBe("+51987654321");
    expect(normalizeCaseNumber(" 01234-2025-0-1801-jp-fc-01 ")).toBe("01234-2025-0-1801-JP-FC-01");
  });

  it("permite crear un cliente sin documento manteniendo compatibilidad", () => {
    const client = buildLegacyCompatibleClient({
      name: "Cliente de prueba",
      documentType: "DNI",
      documentNumber: null,
      phone: "987654321",
      processType: "Consulta de familia",
    });
    expect(client.dni).toBe("");
    expect(client.document_number).toBeNull();
    expect(client.phone).toBe("+51987654321");
  });
});

describe("creación de entidades", () => {
  it("crea un expediente asociado a su cliente y conserva campos heredados", () => {
    const item = buildLegacyCompatibleCase({
      clientId,
      caseNumber: "01234-2025-0-1801-JP-FC-01",
      caseName: "Alimentos",
      caseType: "Pensión de alimentos",
      legalArea: "Derecho de Familia",
      caseStage: "Ejecución de sentencia",
      court: "Primer Juzgado de Paz Letrado",
      priority: "Alta",
    });
    expect(item.client_id).toBe(clientId);
    expect(item.expediente).toBe(item.case_number);
    expect(item.process_type).toBe(item.case_type);
    expect(item.juzgado).toBe(item.court);
  });

  it("asocia un documento con cliente y expediente", () => {
    const document = buildDocumentRecord({
      clientId,
      caseId,
      originalName: "Sentencia.pdf",
      displayName: "Sentencia.pdf",
      documentType: "Sentencia",
      mimeType: "application/pdf",
      sourceType: "supabase_storage",
      storagePath: "tests/sentencia.pdf",
    });
    expect(document.client_id).toBe(clientId);
    expect(document.case_id).toBe(caseId);
    expect(document.name).toBe("Sentencia.pdf");
  });

  it("crea actuaciones y tareas con estados válidos", () => {
    const event = buildCaseEvent({
      caseId,
      documentId,
      eventType: "Sentencia",
      title: "Emisión de sentencia",
      eventDate: "2025-06-20",
    });
    const task = buildCaseTask({
      caseId,
      clientId,
      title: "Preparar liquidación",
      priority: "Alta",
      status: "pending",
      dueDate: "2026-08-01T15:00:00.000Z",
    });
    expect(event.document_id).toBe(documentId);
    expect(event.verification_status).toBe("approved");
    expect(task.case_id).toBe(caseId);
    expect(task.status).toBe("pending");
  });

  it("rechaza estados de tarea desconocidos", () => {
    expect(() =>
      caseTaskDraftSchema.parse({ caseId, title: "Tarea", status: "unknown" }),
    ).toThrow();
  });
});
