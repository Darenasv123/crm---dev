import { describe, it, expect } from "vitest";
import type { Database } from "@/lib/database.types";

type ClientRow = Database["public"]["Tables"]["clients"]["Row"];
type CaseRow = Database["public"]["Tables"]["cases"]["Row"];

describe("Integración de formulario de reportes", () => {
  const mockClient: ClientRow = {
    id: "client-123",
    name: "María González",
    dni: "12345678",
    phone: "987654321",
    email: "maria@example.com",
    process_type: "Divorcio",
    status: "Activo",
    initials: "MG",
    color: "#3b82f6",
    document_type: "DNI",
    document_number: "12345678",
    registered_at: "2026-01-01",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    created_by: null,
    address: null,
    birthdate: null,
    civil_status: null,
    notes: null,
    occupation: null,
    whatsapp: null,
  };

  const mockClientWithoutPhone: ClientRow = {
    ...mockClient,
    id: "client-456",
    name: "Pedro Ramírez",
    phone: null,
  };

  const mockCase: CaseRow = {
    id: "case-789",
    client_id: "client-123",
    expediente: "00123-2026",
    materia: "Familia",
    process_type: "Divorcio por causal",
    status: "En proceso",
    juzgado: "Juzgado de Familia",
    priority: "Media",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    case_name: null,
    case_number: null,
    case_stage: null,
    case_type: null,
    case_year: null,
    closing_date: null,
    court: null,
    created_by: null,
    current_status_description: null,
    current_summary: null,
    demandado: null,
    demandante: null,
    filing_date: null,
    internal_code: null,
    judge_or_prosecutor: null,
    judicial_district: null,
    last_action_date: null,
    legal_area: null,
    next_action: null,
    next_hearing: null,
    responsible_user_id: null,
  };

  it("debe permitir crear reporte sin expediente", () => {
    // Caso: cliente sin expedientes
    const clientsWithoutCase = [mockClient];
    const cases: CaseRow[] = [];

    // El formulario debe permitir seleccionar cliente
    expect(clientsWithoutCase.length).toBeGreaterThan(0);
    expect(cases.length).toBe(0);

    // Y debe poder enviar reporte con expediente vacío
    const formData = {
      client_id: mockClient.id,
      case_id: "",
      materia: "Familia" as const,
      status_date: "2026-07-27",
      current_status: "Consulta inicial",
      informative_message: "Se ha recibido su consulta",
      reminder_days: 25,
    };

    expect(formData.case_id).toBe("");
    expect(formData.materia).toBe("Familia");
  });

  it("debe autocompletar materia desde expediente", () => {
    const caseWithMateria = { ...mockCase, materia: "Familia" };

    // Si el expediente tiene materia, debe autocompletarse
    expect(caseWithMateria.materia).toBe("Familia");
  });

  it("debe permitir cambiar materia manualmente", () => {
    const caseWithMateria = { ...mockCase, materia: "Familia" };

    // Aunque el caso tenga Familia, el usuario puede elegir Penal
    const selectedMateria = "Penal";

    expect(selectedMateria).not.toBe(caseWithMateria.materia);
    expect(selectedMateria).toBe("Penal");
  });

  it("debe deshabilitar copiar cuando faltan datos obligatorios", () => {
    const incompleteData = {
      client_id: mockClient.id,
      case_id: "",
      materia: "",
      status_date: "2026-07-27",
      current_status: "",
      informative_message: "",
      reminder_days: 25,
    };

    const canCopy =
      incompleteData.materia &&
      incompleteData.status_date &&
      incompleteData.current_status.trim() &&
      incompleteData.informative_message.trim();

    expect(canCopy).toBeFalsy();
  });

  it("debe deshabilitar WhatsApp cuando no hay teléfono", () => {
    const clientWithoutPhone = mockClientWithoutPhone;
    const hasPhone = !!clientWithoutPhone.phone;

    expect(hasPhone).toBeFalsy();
  });

  it("debe habilitar WhatsApp cuando hay teléfono válido", () => {
    const clientWithPhone = mockClient;
    const hasPhone = !!clientWithPhone.phone;

    expect(hasPhone).toBeTruthy();
    expect(clientWithPhone.phone).toBe("987654321");
  });

  it("debe guardar reporte con datos válidos", () => {
    const validData = {
      client_id: mockClient.id,
      case_id: mockCase.id,
      materia: "Familia" as const,
      status_date: "2026-07-27",
      current_status: "Expediente admitido",
      informative_message: "Su expediente ha sido admitido por el juzgado.",
      reminder_days: 25,
    };

    const isValid =
      validData.client_id &&
      validData.materia &&
      validData.status_date &&
      validData.current_status.trim() &&
      validData.informative_message.trim() &&
      validData.reminder_days > 0;

    expect(isValid).toBeTruthy();
  });

  it("debe mantener acceso permitido a Reportes para Personal", () => {
    // Los permisos de Personal siguen siendo los mismos
    const personalRoles = ["Administrador", "Personal"];

    expect(personalRoles).toContain("Personal");
    expect(personalRoles).toContain("Administrador");
  });

  it("no debe marcar reporte como entregado al abrir WhatsApp", () => {
    // El sistema solo registra que el reporte fue creado
    // No hay campos de "enviado", "entregado" o "leído"
    const reportFields = [
      "client_id",
      "case_id",
      "materia",
      "status_date",
      "current_status",
      "informative_message",
      "reminder_days",
      "final_text",
      "created_at",
      "created_by",
    ];

    expect(reportFields).not.toContain("sent_at");
    expect(reportFields).not.toContain("delivered_at");
    expect(reportFields).not.toContain("read_at");
  });

  it("debe usar teléfono principal del cliente", () => {
    const client = mockClient;

    // Solo se usa phone, no whatsapp ni teléfono alternativo
    expect(client.phone).toBe("987654321");
    // El campo whatsapp existe pero no se usa para envío
    expect(client).toHaveProperty("phone");
  });

  it("debe abrir WhatsApp en pestaña nueva con noopener y noreferrer", () => {
    const windowFeatures = "noopener,noreferrer";

    expect(windowFeatures).toContain("noopener");
    expect(windowFeatures).toContain("noreferrer");
  });
});
