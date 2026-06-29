export type CaseStatus =
  | "Consulta"
  | "Documentación"
  | "Demanda presentada"
  | "En proceso"
  | "Audiencia"
  | "Sentencia"
  | "Archivado";

export const CASE_STATUSES: CaseStatus[] = [
  "Consulta",
  "Documentación",
  "Demanda presentada",
  "En proceso",
  "Audiencia",
  "Sentencia",
  "Archivado",
];

export type Priority = "Alta" | "Media" | "Baja";

export interface Client {
  id: string;
  name: string;
  initials: string;
  dni: string;
  phone: string;
  email: string;
  address: string;
  birthdate: string;
  civilStatus: string;
  processType: string;
  status: "Activo" | "En espera" | "Cerrado";
  registeredAt: string;
  lawyer: string;
  color: string;
}

export const clients: Client[] = [
  { id: "c1", name: "María Fernanda López", initials: "MF", dni: "45678912", phone: "+51 987 123 456", email: "maria.lopez@mail.com", address: "Av. Larco 1234, Miraflores, Lima", birthdate: "1988-03-14", civilStatus: "Casada", processType: "Divorcio", status: "Activo", registeredAt: "2025-02-12", lawyer: "Dr. Carlos Ramírez", color: "oklch(0.74 0.12 80)" },
  { id: "c2", name: "Jorge Antonio Castillo", initials: "JC", dni: "70123456", phone: "+51 956 781 220", email: "jcastillo@mail.com", address: "Jr. Cusco 432, Cercado, Lima", birthdate: "1975-09-02", civilStatus: "Soltero", processType: "Laboral", status: "Activo", registeredAt: "2025-03-04", lawyer: "Dra. Lucía Mendoza", color: "oklch(0.55 0.13 235)" },
  { id: "c3", name: "Patricia Salinas Vega", initials: "PS", dni: "41239876", phone: "+51 944 332 100", email: "psalinas@mail.com", address: "Calle Las Camelias 89, San Isidro", birthdate: "1990-11-22", civilStatus: "Divorciada", processType: "Sucesión", status: "En espera", registeredAt: "2025-04-21", lawyer: "Dr. Carlos Ramírez", color: "oklch(0.62 0.14 155)" },
  { id: "c4", name: "Luis Eduardo Paredes", initials: "LP", dni: "08712345", phone: "+51 998 776 553", email: "lparedes@mail.com", address: "Av. Brasil 2050, Magdalena", birthdate: "1982-06-30", civilStatus: "Casado", processType: "Penal", status: "Activo", registeredAt: "2025-01-09", lawyer: "Dra. Lucía Mendoza", color: "oklch(0.62 0.18 25)" },
  { id: "c5", name: "Rocío Hernández Díaz", initials: "RH", dni: "47812003", phone: "+51 977 412 889", email: "rhernandez@mail.com", address: "Jr. Tarapacá 540, Barranco", birthdate: "1995-12-08", civilStatus: "Soltera", processType: "Civil", status: "Cerrado", registeredAt: "2024-11-17", lawyer: "Dr. Andrés Vilca", color: "oklch(0.55 0.13 290)" },
  { id: "c6", name: "Empresa Andina S.A.C.", initials: "EA", dni: "20512345678", phone: "+51 1 421 5500", email: "legal@andina.com.pe", address: "Av. República de Panamá 3500, San Isidro", birthdate: "—", civilStatus: "—", processType: "Comercial", status: "Activo", registeredAt: "2025-05-02", lawyer: "Dr. Carlos Ramírez", color: "oklch(0.34 0.09 255)" },
  { id: "c7", name: "Andrea Quiroz Soto", initials: "AQ", dni: "73456120", phone: "+51 933 221 109", email: "aquiroz@mail.com", address: "Av. Petit Thouars 4500, Lince", birthdate: "1992-04-18", civilStatus: "Conviviente", processType: "Familia", status: "Activo", registeredAt: "2025-06-11", lawyer: "Dra. Lucía Mendoza", color: "oklch(0.74 0.12 80)" },
  { id: "c8", name: "Diego Alarcón Ruiz", initials: "DA", dni: "44129876", phone: "+51 922 998 110", email: "dalarcon@mail.com", address: "Calle Schell 310, Miraflores", birthdate: "1986-08-25", civilStatus: "Soltero", processType: "Tributario", status: "En espera", registeredAt: "2025-06-22", lawyer: "Dr. Andrés Vilca", color: "oklch(0.55 0.13 235)" },
];

export interface CaseItem {
  id: string;
  clientId: string;
  client: string;
  initials: string;
  expediente: string;
  processType: string;
  priority: Priority;
  nextHearing: string;
  status: CaseStatus;
  juzgado: string;
  demandante: string;
  demandado: string;
}

export const cases: CaseItem[] = [
  { id: "e1", clientId: "c1", client: "María F. López", initials: "MF", expediente: "00231-2025-0-1801-JR-FC-03", processType: "Divorcio por causal", priority: "Alta", nextHearing: "2026-07-08 10:30", status: "Audiencia", juzgado: "3° Juzgado de Familia – Lima", demandante: "María Fernanda López", demandado: "Roberto Castillo Vera" },
  { id: "e2", clientId: "c2", client: "Jorge A. Castillo", initials: "JC", expediente: "01290-2025-0-1801-JR-LA-12", processType: "Despido arbitrario", priority: "Media", nextHearing: "2026-07-15 09:00", status: "En proceso", juzgado: "12° Juzgado Laboral – Lima", demandante: "Jorge Antonio Castillo", demandado: "Constructora Pacífico S.A." },
  { id: "e3", clientId: "c3", client: "Patricia Salinas", initials: "PS", expediente: "00876-2025-0-1801-JR-CI-08", processType: "Sucesión intestada", priority: "Baja", nextHearing: "2026-08-04 11:00", status: "Documentación", juzgado: "8° Juzgado Civil – Lima", demandante: "Patricia Salinas Vega", demandado: "—" },
  { id: "e4", clientId: "c4", client: "Luis E. Paredes", initials: "LP", expediente: "00432-2025-0-1801-JR-PE-04", processType: "Estafa agravada", priority: "Alta", nextHearing: "2026-07-02 14:30", status: "Demanda presentada", juzgado: "4° Juzgado Penal – Lima", demandante: "Ministerio Público", demandado: "Luis Eduardo Paredes" },
  { id: "e5", clientId: "c5", client: "Rocío Hernández", initials: "RH", expediente: "00118-2024-0-1801-JR-CI-15", processType: "Indemnización", priority: "Media", nextHearing: "—", status: "Archivado", juzgado: "15° Juzgado Civil – Lima", demandante: "Rocío Hernández Díaz", demandado: "Seguros del Sur S.A." },
  { id: "e6", clientId: "c6", client: "Andina S.A.C.", initials: "EA", expediente: "02101-2025-0-1801-JR-CO-02", processType: "Resolución de contrato", priority: "Alta", nextHearing: "2026-07-22 09:30", status: "En proceso", juzgado: "2° Juzgado Comercial – Lima", demandante: "Andina S.A.C.", demandado: "Logística Global E.I.R.L." },
  { id: "e7", clientId: "c7", client: "Andrea Quiroz", initials: "AQ", expediente: "00567-2025-0-1801-JR-FC-07", processType: "Tenencia de menor", priority: "Alta", nextHearing: "2026-07-11 15:00", status: "Audiencia", juzgado: "7° Juzgado de Familia – Lima", demandante: "Andrea Quiroz Soto", demandado: "Marcos Linares P." },
  { id: "e8", clientId: "c8", client: "Diego Alarcón", initials: "DA", expediente: "00990-2025-0-1801-JR-CA-05", processType: "Contencioso tributario", priority: "Media", nextHearing: "2026-08-19 10:00", status: "Consulta", juzgado: "5° Juzgado Contencioso – Lima", demandante: "Diego Alarcón Ruiz", demandado: "SUNAT" },
  { id: "e9", clientId: "c1", client: "María F. López", initials: "MF", expediente: "00231-2025-0-1801-JR-FC-03-A", processType: "Alimentos", priority: "Media", nextHearing: "2026-07-30 09:00", status: "Sentencia", juzgado: "3° Juzgado de Familia – Lima", demandante: "María Fernanda López", demandado: "Roberto Castillo Vera" },
  { id: "e10", clientId: "c2", client: "Jorge A. Castillo", initials: "JC", expediente: "01290-2025-0-1801-JR-LA-12-B", processType: "Beneficios sociales", priority: "Baja", nextHearing: "—", status: "Consulta", juzgado: "12° Juzgado Laboral – Lima", demandante: "Jorge Antonio Castillo", demandado: "Constructora Pacífico S.A." },
];

export interface Payment {
  id: string;
  clientId: string;
  client: string;
  service: string;
  fees: number;
  paid: number;
  status: "Pagado" | "Parcial" | "Pendiente" | "Vencido";
  dueDate: string;
}

export const payments: Payment[] = [
  { id: "p1", clientId: "c1", client: "María F. López", service: "Divorcio por causal", fees: 8500, paid: 5500, status: "Parcial", dueDate: "2026-07-15" },
  { id: "p2", clientId: "c2", client: "Jorge A. Castillo", service: "Demanda laboral", fees: 6000, paid: 6000, status: "Pagado", dueDate: "2026-06-20" },
  { id: "p3", clientId: "c3", client: "Patricia Salinas", service: "Sucesión intestada", fees: 4200, paid: 1000, status: "Parcial", dueDate: "2026-07-30" },
  { id: "p4", clientId: "c4", client: "Luis E. Paredes", service: "Defensa penal", fees: 12000, paid: 4000, status: "Pendiente", dueDate: "2026-07-05" },
  { id: "p5", clientId: "c5", client: "Rocío Hernández", service: "Indemnización civil", fees: 5000, paid: 5000, status: "Pagado", dueDate: "2025-11-10" },
  { id: "p6", clientId: "c6", client: "Andina S.A.C.", service: "Asesoría comercial mensual", fees: 9500, paid: 4500, status: "Vencido", dueDate: "2026-06-15" },
  { id: "p7", clientId: "c7", client: "Andrea Quiroz", service: "Tenencia y alimentos", fees: 5500, paid: 2200, status: "Parcial", dueDate: "2026-08-01" },
];

export interface PaymentRecord {
  id: string;
  date: string;
  method: string;
  amount: number;
  receipt: string;
  notes: string;
}

export const paymentHistory: PaymentRecord[] = [
  { id: "ph1", date: "2025-03-15", method: "Transferencia BCP", amount: 2500, receipt: "F001-00231", notes: "Pago inicial" },
  { id: "ph2", date: "2025-05-22", method: "Yape", amount: 1500, receipt: "F001-00248", notes: "Cuota 2" },
  { id: "ph3", date: "2025-09-10", method: "Efectivo", amount: 1500, receipt: "F001-00267", notes: "Cuota 3" },
];

export interface Activity {
  id: string;
  type: "case" | "payment" | "document" | "hearing" | "client";
  title: string;
  description: string;
  time: string;
}

export const activities: Activity[] = [
  { id: "a1", type: "hearing", title: "Audiencia confirmada", description: "Caso 00231-2025 — María F. López", time: "Hace 12 min" },
  { id: "a2", type: "payment", title: "Pago recibido", description: "S/ 1,500.00 — Patricia Salinas", time: "Hace 1 h" },
  { id: "a3", type: "document", title: "Documento cargado", description: "Resolución N° 04 — Caso 01290-2025", time: "Hace 2 h" },
  { id: "a4", type: "client", title: "Nuevo cliente registrado", description: "Diego Alarcón Ruiz", time: "Ayer" },
  { id: "a5", type: "case", title: "Cambio de estado", description: "Caso 00567-2025 pasó a Audiencia", time: "Ayer" },
  { id: "a6", type: "document", title: "Demanda presentada", description: "Caso 02101-2025 — Andina S.A.C.", time: "Hace 2 d" },
];

export interface AgendaEvent {
  id: string;
  title: string;
  type: "Audiencia" | "Cita" | "Recordatorio" | "Vencimiento" | "Plazo legal";
  date: string;
  time: string;
  location: string;
  client: string;
}

export const agendaEvents: AgendaEvent[] = [
  { id: "ev1", title: "Audiencia de conciliación", type: "Audiencia", date: "2026-07-02", time: "14:30", location: "4° Juzgado Penal", client: "Luis E. Paredes" },
  { id: "ev2", title: "Cita con cliente", type: "Cita", date: "2026-07-03", time: "10:00", location: "Oficina principal", client: "Andina S.A.C." },
  { id: "ev3", title: "Vence plazo apelación", type: "Plazo legal", date: "2026-07-05", time: "23:59", location: "—", client: "Luis E. Paredes" },
  { id: "ev4", title: "Audiencia única", type: "Audiencia", date: "2026-07-08", time: "10:30", location: "3° Juzgado de Familia", client: "María F. López" },
  { id: "ev5", title: "Recordatorio: enviar escrito", type: "Recordatorio", date: "2026-07-09", time: "09:00", location: "—", client: "Patricia Salinas" },
  { id: "ev6", title: "Audiencia testimonial", type: "Audiencia", date: "2026-07-11", time: "15:00", location: "7° Juzgado de Familia", client: "Andrea Quiroz" },
  { id: "ev7", title: "Vencimiento de contrato", type: "Vencimiento", date: "2026-07-15", time: "18:00", location: "—", client: "Andina S.A.C." },
];

export const monthlyIncome = [
  { month: "Ene", income: 18400, pending: 4200 },
  { month: "Feb", income: 22100, pending: 3800 },
  { month: "Mar", income: 25800, pending: 5100 },
  { month: "Abr", income: 21500, pending: 4600 },
  { month: "May", income: 28900, pending: 6200 },
  { month: "Jun", income: 32400, pending: 5800 },
];

export const casesBySpecialty = [
  { name: "Familia", value: 18 },
  { name: "Civil", value: 14 },
  { name: "Penal", value: 9 },
  { name: "Laboral", value: 12 },
  { name: "Comercial", value: 7 },
  { name: "Tributario", value: 4 },
];

export const clientsByMonth = [
  { month: "Ene", value: 4 },
  { month: "Feb", value: 6 },
  { month: "Mar", value: 5 },
  { month: "Abr", value: 9 },
  { month: "May", value: 8 },
  { month: "Jun", value: 11 },
];

export const documents = [
  { id: "d1", name: "Demanda_Divorcio_MariaLopez.pdf", type: "Demanda", size: "2.4 MB", uploadedAt: "2025-04-12", client: "María F. López" },
  { id: "d2", name: "DNI_JorgeCastillo.pdf", type: "DNI", size: "640 KB", uploadedAt: "2025-03-04", client: "Jorge A. Castillo" },
  { id: "d3", name: "Resolucion_04_CasoAndina.pdf", type: "Resolución", size: "1.1 MB", uploadedAt: "2025-06-18", client: "Andina S.A.C." },
  { id: "d4", name: "Sentencia_Hernandez.pdf", type: "Sentencia", size: "3.2 MB", uploadedAt: "2025-10-08", client: "Rocío Hernández" },
  { id: "d5", name: "Poder_AndreaQuiroz.pdf", type: "Poder", size: "820 KB", uploadedAt: "2025-06-12", client: "Andrea Quiroz" },
  { id: "d6", name: "Contrato_AsesoriaAndina.pdf", type: "Contrato", size: "1.8 MB", uploadedAt: "2025-05-02", client: "Andina S.A.C." },
  { id: "d7", name: "Escrito_Apelacion_Paredes.pdf", type: "Otros", size: "910 KB", uploadedAt: "2025-06-25", client: "Luis E. Paredes" },
  { id: "d8", name: "DNI_PatriciaSalinas.pdf", type: "DNI", size: "580 KB", uploadedAt: "2025-04-21", client: "Patricia Salinas" },
];

export const users = [
  { id: "u1", name: "Carlos Ramírez", email: "cramirez@abogados.pe", role: "Administrador", initials: "CR", status: "Activo" },
  { id: "u2", name: "Lucía Mendoza", email: "lmendoza@abogados.pe", role: "Abogado", initials: "LM", status: "Activo" },
  { id: "u3", name: "Andrés Vilca", email: "avilca@abogados.pe", role: "Abogado", initials: "AV", status: "Activo" },
  { id: "u4", name: "Sofía Paredes", email: "sparedes@abogados.pe", role: "Asistente", initials: "SP", status: "Activo" },
  { id: "u5", name: "Karen Ríos", email: "krios@abogados.pe", role: "Secretaria", initials: "KR", status: "Activo" },
];

export function currency(n: number) {
  return new Intl.NumberFormat("es-PE", { style: "currency", currency: "PEN", maximumFractionDigits: 0 }).format(n);
}
