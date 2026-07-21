/**
 * ICS (iCalendar) export utility.
 * Generates a .ics file from agenda events that can be imported into
 * Google Calendar, Apple Calendar, Outlook, and any RFC 5545-compliant client.
 *
 * Google Calendar import: calendar.google.com → Settings → Import & Export → Import
 */

import { PERU_TIME_ZONE, PERU_UTC_OFFSET } from "./peru-time";

export interface ICSEvent {
  id: string;
  title: string;
  type: string;
  event_date: string; // YYYY-MM-DD
  event_time: string; // HH:MM
  location: string | null;
  client?: string | null;
  case?: string | null;
}

/** Escapes special characters per RFC 5545. */
function icsEscape(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

/** Formats a date+time as ICS DTSTART/DTEND (1-hour duration). */
function icsDateTime(date: string, time: string): { start: string; end: string } {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);

  function pad(n: number) {
    return String(n).padStart(2, "0");
  }

  const start = `${y}${pad(m)}${pad(d)}T${pad(hh)}${pad(mm)}00`;

  const endDate = new Date(
    new Date(`${date}T${pad(hh)}:${pad(mm)}:00${PERU_UTC_OFFSET}`).getTime() + 60 * 60 * 1000,
  );
  const endParts = new Intl.DateTimeFormat("en-US", {
    timeZone: PERU_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(endDate);
  const values = Object.fromEntries(endParts.map((part) => [part.type, part.value])) as Record<
    string,
    string
  >;
  const end = `${values.year}${values.month}${values.day}T${values.hour}${values.minute}00`;

  return { start, end };
}

/** Generates a .ics file and triggers a browser download. */
export function exportAgendaICS(events: ICSEvent[], filename = "agenda_juridica.ics") {
  const now = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Estudio Jurídico Arenas//CRM//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:Estudio Jurídico Arenas`,
    `X-WR-TIMEZONE:${PERU_TIME_ZONE}`,
  ];

  for (const ev of events) {
    const { start, end } = icsDateTime(ev.event_date, ev.event_time);
    const description = [
      ev.client ? `Cliente: ${ev.client}` : null,
      ev.case ? `Expediente: ${ev.case}` : null,
      `Tipo: ${ev.type}`,
    ]
      .filter(Boolean)
      .join("\\n");

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${ev.id}@crm.estudio-arenas.pe`);
    lines.push(`DTSTAMP:${now}`);
    lines.push(`DTSTART;TZID=${PERU_TIME_ZONE}:${start}`);
    lines.push(`DTEND;TZID=${PERU_TIME_ZONE}:${end}`);
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

  function pad(n: number) {
    return String(n).padStart(2, "0");
  }

  // Google Calendar URL format: YYYYMMDDTHHMMSS/YYYYMMDDTHHMMSS
  const startStr = `${y}${pad(m)}${pad(d)}T${pad(hh)}${pad(mm)}00`;
  const { end } = icsDateTime(ev.event_date, ev.event_time);
  const endStr = end;

  const details = [
    ev.client ? `Cliente: ${ev.client}` : null,
    ev.case ? `Expediente: ${ev.case}` : null,
    `Tipo: ${ev.type}`,
  ]
    .filter(Boolean)
    .join(" | ");

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: ev.title,
    dates: `${startStr}/${endStr}`,
    details,
    location: ev.location ?? "",
    ctz: PERU_TIME_ZONE,
  });

  window.open(`https://calendar.google.com/calendar/render?${params.toString()}`, "_blank");
}
