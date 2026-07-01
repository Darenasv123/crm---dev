/**
 * ICS (iCalendar) export utility.
 * Generates a .ics file from agenda events that can be imported into
 * Google Calendar, Apple Calendar, Outlook, and any RFC 5545-compliant client.
 *
 * Google Calendar import: calendar.google.com → Settings → Import & Export → Import
 */

export interface ICSEvent {
  id: string;
  title: string;
  type: string;
  event_date: string;   // YYYY-MM-DD
  event_time: string;   // HH:MM
  location: string | null;
  client?: string | null;
}

/** Escapes special characters per RFC 5545. */
function icsEscape(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

/** Formats a date+time as ICS DTSTART/DTEND (1-hour duration). */
function icsDateTime(date: string, time: string): { start: string; end: string } {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);

  function pad(n: number) { return String(n).padStart(2, "0"); }

  const start = `${y}${pad(m)}${pad(d)}T${pad(hh)}${pad(mm)}00`;

  // End = start + 1 hour
  const endDate = new Date(y, m - 1, d, hh + 1, mm);
  const end = `${endDate.getFullYear()}${pad(endDate.getMonth() + 1)}${pad(endDate.getDate())}T${pad(endDate.getHours())}${pad(endDate.getMinutes())}00`;

  return { start, end };
}

/** Generates a .ics file and triggers a browser download. */
export function exportAgendaICS(events: ICSEvent[], filename = "agenda_juridica.ics") {
  const now = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .split(".")[0] + "Z";

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Estudio Jurídico Arenas//CRM//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:Estudio Jurídico Arenas`,
    `X-WR-TIMEZONE:America/Lima`,
  ];

  for (const ev of events) {
    const { start, end } = icsDateTime(ev.event_date, ev.event_time);
    const description = ev.client ? `Cliente: ${ev.client}\\nTipo: ${ev.type}` : `Tipo: ${ev.type}`;

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${ev.id}@crm.estudio-arenas.pe`);
    lines.push(`DTSTAMP:${now}`);
    lines.push(`DTSTART;TZID=America/Lima:${start}`);
    lines.push(`DTEND;TZID=America/Lima:${end}`);
    lines.push(`SUMMARY:${icsEscape(ev.title)}`);
    lines.push(`DESCRIPTION:${description}`);
    if (ev.location) lines.push(`LOCATION:${icsEscape(ev.location)}`);
    lines.push(`CATEGORIES:${icsEscape(ev.type)}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");

  const content = lines.join("\r\n");
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Opens a single event directly in Google Calendar "new event" form. */
export function openEventInGoogleCalendar(ev: ICSEvent) {
  const [y, m, d] = ev.event_date.split("-").map(Number);
  const [hh, mm] = ev.event_time.split(":").map(Number);

  function pad(n: number) { return String(n).padStart(2, "0"); }

  // Google Calendar URL format: YYYYMMDDTHHMMSS/YYYYMMDDTHHMMSS
  const startStr = `${y}${pad(m)}${pad(d)}T${pad(hh)}${pad(mm)}00`;
  const endDate = new Date(y, m - 1, d, hh + 1, mm);
  const endStr = `${endDate.getFullYear()}${pad(endDate.getMonth() + 1)}${pad(endDate.getDate())}T${pad(endDate.getHours())}${pad(endDate.getMinutes())}00`;

  const details = ev.client ? `Cliente: ${ev.client} | Tipo: ${ev.type}` : `Tipo: ${ev.type}`;

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: ev.title,
    dates: `${startStr}/${endStr}`,
    details,
    location: ev.location ?? "",
    ctz: "America/Lima",
  });

  window.open(`https://calendar.google.com/calendar/render?${params.toString()}`, "_blank");
}
