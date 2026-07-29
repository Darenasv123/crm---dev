import { describe, it, expect } from "vitest";
import {
  buildClientReportMessage,
  formatSpanishDate,
  normalizePhoneNumber,
  buildWhatsAppUrl,
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
      "Su expediente ha sido admitido por el juzgado.\n\nSe ha fijado audiencia preliminar para el 20 de agosto de 2026.\n\nDebe presentar los documentos solicitados antes del 10 de agosto.",
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
    expect(result).toContain("Su expediente ha sido admitido por el juzgado.");
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

describe("normalizePhoneNumber", () => {
  it("debe normalizar número peruano de 9 dígitos", () => {
    const result = normalizePhoneNumber("987654321");
    expect(result).toBe("51987654321");
  });

  it("debe conservar código 51 si ya está presente", () => {
    const result = normalizePhoneNumber("51987654321");
    expect(result).toBe("51987654321");
  });

  it("debe eliminar el símbolo +", () => {
    const result = normalizePhoneNumber("+51987654321");
    expect(result).toBe("51987654321");
  });

  it("debe eliminar espacios", () => {
    const result = normalizePhoneNumber("987 654 321");
    expect(result).toBe("51987654321");
  });

  it("debe eliminar guiones", () => {
    const result = normalizePhoneNumber("987-654-321");
    expect(result).toBe("51987654321");
  });

  it("debe eliminar paréntesis", () => {
    const result = normalizePhoneNumber("(987) 654-321");
    expect(result).toBe("51987654321");
  });

  it("debe eliminar múltiples caracteres especiales", () => {
    const result = normalizePhoneNumber("+51 (987) 654-321");
    expect(result).toBe("51987654321");
  });

  it("debe rechazar número con letras", () => {
    const result = normalizePhoneNumber("987abc321");
    expect(result).toBeNull();
  });

  it("debe rechazar número muy corto", () => {
    const result = normalizePhoneNumber("12345");
    expect(result).toBeNull();
  });

  it("debe rechazar número muy largo", () => {
    const result = normalizePhoneNumber("12345678901234567890");
    expect(result).toBeNull();
  });

  it("debe aceptar números internacionales válidos", () => {
    const result = normalizePhoneNumber("+1234567890");
    expect(result).toBe("1234567890");
  });
});

describe("buildWhatsAppUrl", () => {
  const message = "Hola, este es un mensaje de prueba con emojis 🧑🏻‍🎓 y saltos de línea.\n\nGracias.";

  it("debe producir URL wa.me correcta", () => {
    const url = buildWhatsAppUrl("987654321", message);
    expect(url).not.toBeNull();
    expect(url).toMatch(/^https:\/\/wa\.me\/51987654321\?text=/);
  });

  it("debe codificar emojis correctamente", () => {
    const url = buildWhatsAppUrl("987654321", "Test 🧑🏻‍🎓");
    expect(url).not.toBeNull();
    expect(url).toContain("Test%20");
  });

  it("debe codificar saltos de línea", () => {
    const url = buildWhatsAppUrl("987654321", "Línea 1\nLínea 2");
    expect(url).not.toBeNull();
    expect(url).toContain("%0A");
  });

  it("debe retornar null para número inválido", () => {
    const url = buildWhatsAppUrl("abc123", message);
    expect(url).toBeNull();
  });

  it("debe usar número normalizado en la URL", () => {
    const url = buildWhatsAppUrl("+51 (987) 654-321", message);
    expect(url).not.toBeNull();
    expect(url).toContain("wa.me/51987654321");
  });

  it("debe codificar mensaje completo", () => {
    const url = buildWhatsAppUrl(
      "987654321",
      "Test con espacios y caracteres especiales: ¿Cómo estás?",
    );
    expect(url).not.toBeNull();
    expect(url).toContain("Test%20con%20espacios");
  });
});
