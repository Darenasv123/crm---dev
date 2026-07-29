/**
 * Funciones puras para generación de reportes de clientes
 * y construcción de URLs de WhatsApp
 */

export interface ClientReportData {
  clientName: string;
  materia: "Familia" | "Penal";
  statusDate: string; // ISO date string
  currentStatus: string;
  informativeMessage: string;
  reminderDays: number;
}

/**
 * Formatea una fecha ISO a formato español de Perú
 * Ejemplo: "14 de julio de 2026"
 */
export function formatSpanishDate(isoDate: string): string {
  // Parsear la fecha localmente para evitar problemas de zona horaria
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(year, month - 1, day);

  return new Intl.DateTimeFormat("es-PE", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

/**
 * Construye el mensaje final del reporte según la plantilla oficial
 */
export function buildClientReportMessage(data: ClientReportData): string {
  const formattedDate = formatSpanishDate(data.statusDate);

  const message = `🧑🏻‍🎓🖋️ Buen día, le saluda el Área de Reportes del estudio jurídico Abogado Arenas a tu Servicio. Mediante el presente mensaje le hacemos llegar el estado actual de su proceso judicial.

🚨 REPORTE DEL ESTADO DEL PROCESO

🧞‍♀️ Cliente: ${data.clientName}
🧚🏽‍♂️ Materia: ${data.materia}
🔺 Estado del proceso al ${formattedDate}: ${data.currentStatus}

🟦 Mensaje informativo:

Estimado(a) cliente:

${data.informativeMessage}

Atentamente,
Área de Reportes del estudio jurídico Abogados a tu Servicio – Dr. Arenas.

Por favor, no se olvide de solicitar el informe de su proceso en ${data.reminderDays} días. Gracias.`;

  return message;
}

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
