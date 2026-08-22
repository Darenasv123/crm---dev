import { describe, it, expect } from "vitest";
import {
  buildClientReportMessage,
  formatSpanishDate,
  matchesClientSearch,
  searchClients,
  casesForClient,
  isCaseOwnedByClient,
  type ClientReportData,
} from "@/lib/client-reports";

describe("formatSpanishDate", () => {
  it("debe formatear fecha en español de Perú", () => {
    const result = formatSpanishDate("2026-07-14");
    expect(result).toBe("14 de julio de 2026");
  });

  it("debe manejar fechas de diferentes meses", () => {
    expect(formatSpanishDate("2026-01-01")).toBe("1 de enero de 2026");
    expect(formatSpanishDate("2026-12-31")).toBe("31 de diciembre de 2026");
  });
});

describe("buildClientReportMessage", () => {
  const baseData: ClientReportData = {
    clientName: "Juan Pérez García",
    materia: "Familia",
    statusDate: "2026-07-14",
    currentStatus: "Expediente en trámite de notificación",
    informativeMessage:
      "Su expediente ha sido admitido.\n\nSe ha fijado audiencia preliminar para el 20 de agosto de 2026.\n\nDebe presentar los documentos solicitados antes del 10 de agosto.",
    reminderDays: 25,
  };

  it("debe insertar correctamente el nombre del cliente", () => {
    const result = buildClientReportMessage(baseData);
    expect(result).toContain("🧞‍♀️ Cliente: Juan Pérez García");
  });

  it("debe insertar correctamente la materia Familia", () => {
    const result = buildClientReportMessage(baseData);
    expect(result).toContain("🧚🏽‍♂️ Materia: Familia");
  });

  it("debe insertar correctamente la materia Penal", () => {
    const data = { ...baseData, materia: "Penal" as const };
    const result = buildClientReportMessage(data);
    expect(result).toContain("🧚🏽‍♂️ Materia: Penal");
  });

  it("debe formatear la fecha en español", () => {
    const result = buildClientReportMessage(baseData);
    expect(result).toContain("🔺 Estado del proceso al 14 de julio de 2026");
  });

  it("debe insertar el estado actual", () => {
    const result = buildClientReportMessage(baseData);
    expect(result).toContain("Expediente en trámite de notificación");
  });

  it("debe insertar el mensaje informativo completo", () => {
    const result = buildClientReportMessage(baseData);
    expect(result).toContain("Su expediente ha sido admitido.");
    expect(result).toContain("Se ha fijado audiencia preliminar");
    expect(result).toContain("Debe presentar los documentos solicitados");
  });

  it("debe conservar saltos de línea del mensaje", () => {
    const result = buildClientReportMessage(baseData);
    expect(result).toContain("\n\nSe ha fijado");
    expect(result).toContain("\n\nDebe presentar");
  });

  it("debe conservar todos los emojis de la plantilla", () => {
    const result = buildClientReportMessage(baseData);
    expect(result).toContain("🧑🏻‍🎓🖋️");
    expect(result).toContain("🚨");
    expect(result).toContain("🧞‍♀️");
    expect(result).toContain("🧚🏽‍♂️");
    expect(result).toContain("🔺");
    expect(result).toContain("🟦");
  });

  it("debe usar 25 días por defecto en el recordatorio", () => {
    const result = buildClientReportMessage(baseData);
    expect(result).toContain("en 25 días");
  });

  it("debe permitir cambiar los días del recordatorio", () => {
    const data = { ...baseData, reminderDays: 15 };
    const result = buildClientReportMessage(data);
    expect(result).toContain("en 15 días");
  });

  it("no debe generar undefined en el texto", () => {
    const result = buildClientReportMessage(baseData);
    expect(result).not.toContain("undefined");
  });

  it("no debe generar null en el texto", () => {
    const result = buildClientReportMessage(baseData);
    expect(result).not.toContain("null");
  });

  it("debe mantener la estructura completa de la plantilla", () => {
    const result = buildClientReportMessage(baseData);
    expect(result).toContain("Buen día, le saluda el Área de Reportes");
    expect(result).toContain("REPORTE DEL ESTADO DEL PROCESO");
    expect(result).toContain("Mensaje informativo:");
    expect(result).toContain("Estimado(a) cliente:");
    expect(result).toContain("Atentamente,");
    expect(result).toContain("Área de Reportes del estudio jurídico Abogados a tu Servicio");
    expect(result).toContain("Por favor, no se olvide de solicitar el informe");
  });
});

describe("matchesClientSearch / searchClients — búsqueda de cliente para Reportes", () => {
  const clients = [
    { id: "c1", name: "Ana Torres", phone: "987654321", email: "ana@example.com" },
    { id: "c2", name: "Bruno Salas", phone: "911222333", email: "bruno@estudio.pe" },
    { id: "c3", name: "Carla Ñañez", phone: null, email: null },
  ];

  it("encuentra por coincidencia parcial de nombre, insensible a mayúsculas", () => {
    expect(searchClients(clients, "ana t").map((c) => c.id)).toEqual(["c1"]);
    expect(searchClients(clients, "ANA").map((c) => c.id)).toEqual(["c1"]);
  });

  it("encuentra por teléfono parcial", () => {
    expect(searchClients(clients, "9112223").map((c) => c.id)).toEqual(["c2"]);
  });

  it("encuentra por correo parcial, insensible a mayúsculas", () => {
    expect(searchClients(clients, "ESTUDIO.PE").map((c) => c.id)).toEqual(["c2"]);
  });

  it("término vacío devuelve todos los clientes", () => {
    expect(searchClients(clients, "").map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
    expect(searchClients(clients, "   ").map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
  });

  it("no falla con clientes sin teléfono ni correo", () => {
    expect(searchClients(clients, "ñañez").map((c) => c.id)).toEqual(["c3"]);
  });

  it("sin coincidencias devuelve lista vacía", () => {
    expect(searchClients(clients, "no-existe-nadie")).toHaveLength(0);
  });

  it("no aplica fuzzy matching (typo no encuentra resultado)", () => {
    expect(matchesClientSearch(clients[0], "anaa")).toBe(false);
  });
});

describe("casesForClient / isCaseOwnedByClient — acotamiento de expediente al cliente", () => {
  const cases = [
    { id: "case-1", client_id: "c1" },
    { id: "case-2", client_id: "c1" },
    { id: "case-3", client_id: "c2" },
  ];

  it("solo devuelve expedientes del cliente indicado", () => {
    expect(casesForClient(cases, "c1").map((c) => c.id)).toEqual(["case-1", "case-2"]);
    expect(casesForClient(cases, "c2").map((c) => c.id)).toEqual(["case-3"]);
  });

  it("cliente sin expedientes devuelve lista vacía", () => {
    expect(casesForClient(cases, "c3")).toHaveLength(0);
  });

  it("client_id vacío devuelve lista vacía (sin cliente seleccionado aún)", () => {
    expect(casesForClient(cases, "")).toHaveLength(0);
  });

  it("acepta un expediente que sí pertenece al cliente", () => {
    expect(isCaseOwnedByClient(cases, "case-1", "c1")).toBe(true);
  });

  it("rechaza un expediente de otro cliente (mismatch client_id/case_id)", () => {
    expect(isCaseOwnedByClient(cases, "case-3", "c1")).toBe(false);
  });

  it("rechaza un case_id inexistente", () => {
    expect(isCaseOwnedByClient(cases, "case-inexistente", "c1")).toBe(false);
  });

  it("case_id vacío se considera válido (expediente opcional)", () => {
    expect(isCaseOwnedByClient(cases, "", "c1")).toBe(true);
  });
});
