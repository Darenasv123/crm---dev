export const PERU_TIME_ZONE = "America/Lima";
export const PERU_UTC_OFFSET = "-05:00";

function partsFor(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PERU_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  return Object.fromEntries(parts.map((part) => [part.type, part.value])) as Record<string, string>;
}

export function getPeruTodayISO(date = new Date()) {
  const parts = partsFor(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function getPeruHour(date = new Date()) {
  return Number(partsFor(date).hour);
}

export function localDateToISO(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

export function addDaysToISO(dateISO: string, days: number) {
  const [year, month, day] = dateISO.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(
    date.getUTCDate(),
  ).padStart(2, "0")}`;
}

export function peruDateTimeToISO(value: string) {
  if (!value) return null;
  return new Date(`${value}:00${PERU_UTC_OFFSET}`).toISOString();
}

export function toPeruDateTimeInput(value?: string | null) {
  if (!value) return "";
  const parts = partsFor(new Date(value));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function formatPeruDate(value?: string | null, options?: Intl.DateTimeFormatOptions) {
  if (!value) return "—";
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(isDateOnly ? `${value}T00:00:00${PERU_UTC_OFFSET}` : value);
  return date.toLocaleDateString("es-PE", { timeZone: PERU_TIME_ZONE, ...options });
}

export function formatPeruDateTime(value?: string | null, options?: Intl.DateTimeFormatOptions) {
  if (!value) return "—";
  return new Date(value).toLocaleString("es-PE", { timeZone: PERU_TIME_ZONE, ...options });
}

export function formatPeruTime(value?: string | null, options?: Intl.DateTimeFormatOptions) {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString("es-PE", { timeZone: PERU_TIME_ZONE, ...options });
}
