/**
 * Excel export utility using ExcelJS.
 * Generates styled .xlsx workbooks for backup/reporting.
 * All exports run client-side — no server needed.
 */
import ExcelJS from "exceljs";

/** Triggers a browser download of the given ArrayBuffer as an .xlsx file. */
function downloadBuffer(buffer: ArrayBuffer, filename: string) {
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Applies consistent header styling to a row. */
function styleHeader(row: ExcelJS.Row) {
  row.eachCell(cell => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = {
      bottom: { style: "thin", color: { argb: "FFAAAAAA" } },
    };
  });
  row.height = 22;
}

/** Alternating row fill for readability. */
function styleDataRow(row: ExcelJS.Row, index: number) {
  const color = index % 2 === 0 ? "FFF5F7FA" : "FFFFFFFF";
  row.eachCell(cell => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
    cell.alignment = { vertical: "middle", wrapText: false };
    cell.border = { bottom: { style: "hair", color: { argb: "FFDDDDDD" } } };
  });
  row.height = 18;
}

// ──────────────────────────────────────────────
// CLIENTES
// ──────────────────────────────────────────────
export interface ExportClient {
  name: string;
  dni: string;
  phone: string;
  email: string | null;
  process_type: string;
  status: string;
  registered_at: string;
}

export async function exportClientsExcel(clients: ExportClient[]) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Estudio Jurídico Arenas";
  wb.created = new Date();

  const ws = wb.addWorksheet("Clientes", { views: [{ state: "frozen", ySplit: 1 }] });

  ws.columns = [
    { header: "Nombre completo", key: "name",          width: 30 },
    { header: "DNI",             key: "dni",           width: 12 },
    { header: "Teléfono",        key: "phone",         width: 14 },
    { header: "Correo",          key: "email",         width: 28 },
    { header: "Proceso",         key: "process_type",  width: 35 },
    { header: "Estado",          key: "status",        width: 14 },
    { header: "Registro",        key: "registered_at", width: 14 },
  ];

  styleHeader(ws.getRow(1));

  clients.forEach((c, i) => {
    const row = ws.addRow({
      ...c,
      email: c.email ?? "",
      registered_at: new Date(c.registered_at).toLocaleDateString("es-PE"),
    });
    styleDataRow(row, i);
  });

  ws.autoFilter = { from: "A1", to: "G1" };

  const buf = await wb.xlsx.writeBuffer();
  const date = new Date().toISOString().slice(0, 10);
  downloadBuffer(buf, `clientes_${date}.xlsx`);
}

// ──────────────────────────────────────────────
// CASOS
// ──────────────────────────────────────────────
export interface ExportCase {
  expediente: string;
  client: string;
  process_type: string;
  status: string;
  priority: string;
  juzgado: string;
  next_hearing: string | null;
  created_at: string;
}

export async function exportCasesExcel(cases: ExportCase[]) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Estudio Jurídico Arenas";
  wb.created = new Date();

  const ws = wb.addWorksheet("Casos", { views: [{ state: "frozen", ySplit: 1 }] });

  ws.columns = [
    { header: "N° Expediente",    key: "expediente",   width: 28 },
    { header: "Cliente",          key: "client",       width: 28 },
    { header: "Proceso",          key: "process_type", width: 35 },
    { header: "Estado",           key: "status",       width: 20 },
    { header: "Prioridad",        key: "priority",     width: 12 },
    { header: "Juzgado",          key: "juzgado",      width: 35 },
    { header: "Próxima audiencia",key: "next_hearing", width: 20 },
    { header: "Registrado",       key: "created_at",   width: 14 },
  ];

  styleHeader(ws.getRow(1));

  cases.forEach((c, i) => {
    const row = ws.addRow({
      ...c,
      next_hearing: c.next_hearing
        ? new Date(c.next_hearing).toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short" })
        : "—",
      created_at: new Date(c.created_at).toLocaleDateString("es-PE"),
    });
    styleDataRow(row, i);
  });

  ws.autoFilter = { from: "A1", to: "H1" };

  const buf = await wb.xlsx.writeBuffer();
  const date = new Date().toISOString().slice(0, 10);
  downloadBuffer(buf, `casos_${date}.xlsx`);
}

// ──────────────────────────────────────────────
// PAGOS
// ──────────────────────────────────────────────
export interface ExportPayment {
  client: string;
  service: string;
  fees: number;
  paid: number;
  pending: number;
  total_installments: number;
  paid_installments: number;
  status: string;
  created_at: string;
}

export async function exportPaymentsExcel(payments: ExportPayment[]) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Estudio Jurídico Arenas";
  wb.created = new Date();

  const ws = wb.addWorksheet("Pagos", { views: [{ state: "frozen", ySplit: 1 }] });

  ws.columns = [
    { header: "Cliente",        key: "client",             width: 28 },
    { header: "Servicio",       key: "service",            width: 32 },
    { header: "Honorarios",     key: "fees",               width: 14 },
    { header: "Pagado",         key: "paid",               width: 14 },
    { header: "Saldo pendiente",key: "pending",            width: 16 },
    { header: "Cuotas",         key: "total_installments", width: 10 },
    { header: "Pagadas",        key: "paid_installments",  width: 10 },
    { header: "Estado",         key: "status",             width: 14 },
    { header: "Creado",         key: "created_at",         width: 14 },
  ];

  styleHeader(ws.getRow(1));

  // Currency format
  const currencyFmt = '"S/ "#,##0.00';

  payments.forEach((p, i) => {
    const row = ws.addRow({
      ...p,
      created_at: new Date(p.created_at).toLocaleDateString("es-PE"),
    });
    styleDataRow(row, i);
    // Apply currency format to numeric columns
    (["fees", "paid", "pending"] as const).forEach(key => {
      const col = ws.getColumn(key);
      row.getCell(col.number!).numFmt = currencyFmt;
    });
  });

  // Totals row
  const totalRow = ws.addRow({
    client: "TOTAL",
    service: "",
    fees:    payments.reduce((s, p) => s + p.fees, 0),
    paid:    payments.reduce((s, p) => s + p.paid, 0),
    pending: payments.reduce((s, p) => s + p.pending, 0),
    total_installments: "",
    paid_installments: "",
    status: "",
    created_at: "",
  });
  totalRow.eachCell(cell => {
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EDF5" } };
    cell.border = { top: { style: "medium", color: { argb: "FF1E3A5F" } } };
  });
  (["fees", "paid", "pending"] as const).forEach(key => {
    const col = ws.getColumn(key);
    totalRow.getCell(col.number!).numFmt = currencyFmt;
  });

  ws.autoFilter = { from: "A1", to: "I1" };

  const buf = await wb.xlsx.writeBuffer();
  const date = new Date().toISOString().slice(0, 10);
  downloadBuffer(buf, `pagos_${date}.xlsx`);
}

// ──────────────────────────────────────────────
// AGENDA
// ──────────────────────────────────────────────
export interface ExportAgendaEvent {
  title: string;
  type: string;
  event_date: string;
  event_time: string;
  location: string | null;
  client: string | null;
}

export async function exportAgendaExcel(events: ExportAgendaEvent[]) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Estudio Jurídico Arenas";
  wb.created = new Date();

  const ws = wb.addWorksheet("Agenda", { views: [{ state: "frozen", ySplit: 1 }] });

  ws.columns = [
    { header: "Título",   key: "title",      width: 35 },
    { header: "Tipo",     key: "type",        width: 15 },
    { header: "Fecha",    key: "event_date",  width: 14 },
    { header: "Hora",     key: "event_time",  width: 10 },
    { header: "Lugar",    key: "location",    width: 30 },
    { header: "Cliente",  key: "client",      width: 28 },
  ];

  styleHeader(ws.getRow(1));

  events.forEach((e, i) => {
    const row = ws.addRow({
      ...e,
      location: e.location ?? "",
      client: e.client ?? "",
    });
    styleDataRow(row, i);
  });

  ws.autoFilter = { from: "A1", to: "F1" };

  const buf = await wb.xlsx.writeBuffer();
  const date = new Date().toISOString().slice(0, 10);
  downloadBuffer(buf, `agenda_${date}.xlsx`);
}

// ──────────────────────────────────────────────
// BACKUP COMPLETO (todas las hojas)
// ──────────────────────────────────────────────
export async function exportFullBackup(data: {
  clients: ExportClient[];
  cases: ExportCase[];
  payments: ExportPayment[];
  agendaEvents?: ExportAgendaEvent[];
}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Estudio Jurídico Arenas";
  wb.created = new Date();

  // ── Clientes ──
  const wsC = wb.addWorksheet("Clientes", { views: [{ state: "frozen", ySplit: 1 }] });
  wsC.columns = [
    { header: "Nombre completo", key: "name",          width: 30 },
    { header: "DNI",             key: "dni",           width: 12 },
    { header: "Teléfono",        key: "phone",         width: 14 },
    { header: "Correo",          key: "email",         width: 28 },
    { header: "Proceso",         key: "process_type",  width: 35 },
    { header: "Estado",          key: "status",        width: 14 },
    { header: "Registro",        key: "registered_at", width: 14 },
  ];
  styleHeader(wsC.getRow(1));
  data.clients.forEach((c, i) => {
    const row = wsC.addRow({ ...c, email: c.email ?? "", registered_at: new Date(c.registered_at).toLocaleDateString("es-PE") });
    styleDataRow(row, i);
  });

  // ── Casos ──
  const wsK = wb.addWorksheet("Casos", { views: [{ state: "frozen", ySplit: 1 }] });
  wsK.columns = [
    { header: "N° Expediente",    key: "expediente",   width: 28 },
    { header: "Cliente",          key: "client",       width: 28 },
    { header: "Proceso",          key: "process_type", width: 35 },
    { header: "Estado",           key: "status",       width: 20 },
    { header: "Prioridad",        key: "priority",     width: 12 },
    { header: "Juzgado",          key: "juzgado",      width: 35 },
    { header: "Próxima audiencia",key: "next_hearing", width: 20 },
    { header: "Registrado",       key: "created_at",   width: 14 },
  ];
  styleHeader(wsK.getRow(1));
  data.cases.forEach((c, i) => {
    const row = wsK.addRow({
      ...c,
      next_hearing: c.next_hearing ? new Date(c.next_hearing).toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short" }) : "—",
      created_at: new Date(c.created_at).toLocaleDateString("es-PE"),
    });
    styleDataRow(row, i);
  });

  // ── Pagos ──
  const wsP = wb.addWorksheet("Pagos", { views: [{ state: "frozen", ySplit: 1 }] });
  wsP.columns = [
    { header: "Cliente",        key: "client",             width: 28 },
    { header: "Servicio",       key: "service",            width: 32 },
    { header: "Honorarios",     key: "fees",               width: 14 },
    { header: "Pagado",         key: "paid",               width: 14 },
    { header: "Saldo pendiente",key: "pending",            width: 16 },
    { header: "Estado",         key: "status",             width: 14 },
    { header: "Creado",         key: "created_at",         width: 14 },
  ];
  styleHeader(wsP.getRow(1));
  const currencyFmt = '"S/ "#,##0.00';
  data.payments.forEach((p, i) => {
    const row = wsP.addRow({ ...p, created_at: new Date(p.created_at).toLocaleDateString("es-PE") });
    styleDataRow(row, i);
    [3, 4, 5].forEach(n => { row.getCell(n).numFmt = currencyFmt; });
  });

  // ── Agenda ──
  if (data.agendaEvents && data.agendaEvents.length > 0) {
    const wsA = wb.addWorksheet("Agenda", { views: [{ state: "frozen", ySplit: 1 }] });
    wsA.columns = [
      { header: "Título",  key: "title",      width: 35 },
      { header: "Tipo",    key: "type",        width: 15 },
      { header: "Fecha",   key: "event_date",  width: 14 },
      { header: "Hora",    key: "event_time",  width: 10 },
      { header: "Lugar",   key: "location",    width: 30 },
      { header: "Cliente", key: "client",      width: 28 },
    ];
    styleHeader(wsA.getRow(1));
    data.agendaEvents.forEach((e, i) => {
      const row = wsA.addRow({ ...e, location: e.location ?? "", client: e.client ?? "" });
      styleDataRow(row, i);
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  const date = new Date().toISOString().slice(0, 10);
  downloadBuffer(buf, `backup_completo_${date}.xlsx`);
}
