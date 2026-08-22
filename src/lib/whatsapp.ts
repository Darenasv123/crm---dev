/**
 * Utilidades específicas de WhatsApp (normalización de teléfono peruano y
 * construcción de enlaces wa.me).
 *
 * Este módulo ya no es consumido por Reportes (Fase 4 — QA-013: la acción
 * "Enviar al cliente" por WhatsApp fue eliminada de Reportes, no reparada,
 * porque WhatsApp está siendo retirado del producto). Se conserva aquí,
 * aislado y sin ningún consumidor activo, como el punto único a revisar en
 * la futura fase de Configuración que decida el retiro completo de
 * WhatsApp del CRM.
 */

/**
 * Normaliza un número de teléfono peruano para WhatsApp
 * - Elimina espacios, guiones, paréntesis y el símbolo +
 * - Si tiene 9 dígitos, antepone 51 (código de Perú)
 * - Si ya tiene código de país, lo conserva
 */
export function normalizePhoneNumber(phone: string): string | null {
  // Limpiar caracteres no numéricos
  const cleaned = phone.replace(/[\s\-()+ ]/g, "");

  // Validar que solo contenga dígitos
  if (!/^\d+$/.test(cleaned)) {
    return null;
  }

  // Si tiene 9 dígitos, es un número peruano sin código
  if (cleaned.length === 9) {
    return `51${cleaned}`;
  }

  // Si tiene 11 dígitos y empieza con 51, ya está bien
  if (cleaned.length === 11 && cleaned.startsWith("51")) {
    return cleaned;
  }

  // Si tiene otro formato con código de país válido (10-15 dígitos), conservarlo
  if (cleaned.length >= 10 && cleaned.length <= 15) {
    return cleaned;
  }

  // Número inválido
  return null;
}

/**
 * Construye la URL de WhatsApp Web con el mensaje
 */
export function buildWhatsAppUrl(phone: string, message: string): string | null {
  const normalized = normalizePhoneNumber(phone);

  if (!normalized) {
    return null;
  }

  const encodedMessage = encodeURIComponent(message);
  return `https://wa.me/${normalized}?text=${encodedMessage}`;
}
