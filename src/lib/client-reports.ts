/**
 * Funciones puras para generación de reportes de clientes: construcción del
 * mensaje/plantilla, búsqueda de clientes y acotamiento de expedientes al
 * cliente seleccionado. No contiene ninguna lógica específica de WhatsApp —
 * ver src/lib/whatsapp.ts para eso.
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

/** Datos mínimos de un cliente necesarios para la búsqueda por texto. */
export interface SearchableClient {
  name: string;
  phone: string | null;
  email: string | null;
}

/**
 * Determina si un cliente coincide con un término de búsqueda libre por
 * nombre, teléfono o correo (comparación insensible a mayúsculas/minúsculas,
 * sin fuzzy matching).
 */
export function matchesClientSearch(client: SearchableClient, term: string): boolean {
  const query = term.trim().toLowerCase();
  if (!query) return true;
  return (
    client.name.toLowerCase().includes(query) ||
    (client.phone ?? "").toLowerCase().includes(query) ||
    (client.email ?? "").toLowerCase().includes(query)
  );
}

/** Filtra una lista de clientes por nombre, teléfono o correo. */
export function searchClients<T extends SearchableClient>(clients: T[], term: string): T[] {
  return clients.filter((client) => matchesClientSearch(client, term));
}

/** Datos mínimos de un expediente necesarios para acotarlo a un cliente. */
export interface ClientScopedCase {
  id: string;
  client_id: string;
}

/** Filtra los expedientes que pertenecen al cliente indicado. */
export function casesForClient<T extends ClientScopedCase>(cases: T[], clientId: string): T[] {
  if (!clientId) return [];
  return cases.filter((item) => item.client_id === clientId);
}

/**
 * Verifica que un expediente exista y pertenezca realmente al cliente
 * indicado, para impedir un `case_id` de un cliente distinto al `client_id`
 * del reporte.
 */
export function isCaseOwnedByClient<T extends ClientScopedCase>(
  cases: T[],
  caseId: string,
  clientId: string,
): boolean {
  if (!caseId) return true;
  return cases.some((item) => item.id === caseId && item.client_id === clientId);
}
