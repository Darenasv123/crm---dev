import { describe, it, expect } from "vitest";
import { normalizePhoneNumber, buildWhatsAppUrl } from "@/lib/whatsapp";

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
