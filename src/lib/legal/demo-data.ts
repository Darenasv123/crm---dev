export const DEMO_NOTICE =
  "Demostración local. Esta información no pertenece a clientes reales ni se guarda en Supabase.";

export const demoClient = {
  id: "demo-client-maria",
  name: "María López García",
  documentNumber: "45879632",
  phone: "987654321",
  email: "maria.lopez@example.test",
};

export const demoCase = {
  id: "demo-case-food-2025",
  internalCode: "FAM-2025-014",
  legalArea: "Derecho de Familia",
  caseType: "Pensión de alimentos",
  caseNumber: "01234-2025-0-1801-JP-FC-01",
  claimant: "María López García",
  defendant: "Juan Pérez Torres",
  status: "Ejecución de sentencia",
  nextAction: "Presentar liquidación actualizada de pensiones devengadas",
};

export const demoDriveFolders = [
  {
    id: "folder-maria",
    name: "María López García",
    parentId: "demo-root",
    path: "/Clientes/María López García",
  },
  {
    id: "folder-case",
    name: "01234-2025 Alimentos",
    parentId: "folder-maria",
    path: "/Clientes/María López García/01234-2025 Alimentos",
  },
];

export const demoDriveFiles = [
  {
    id: "doc-1",
    folderId: "folder-case",
    name: "Demanda de alimentos.pdf",
    mimeType: "application/pdf",
    size: 328000,
    status: "analysis_completed",
    progress: 100,
    error: null,
  },
  {
    id: "doc-2",
    folderId: "folder-case",
    name: "Anexos de demanda.pdf",
    mimeType: "application/pdf",
    size: 1940000,
    status: "ocr_required",
    progress: 35,
    error: null,
  },
  {
    id: "doc-3",
    folderId: "folder-case",
    name: "Resolución 01.pdf",
    mimeType: "application/pdf",
    size: 486000,
    status: "review_required",
    progress: 100,
    error: null,
  },
  {
    id: "doc-4",
    folderId: "folder-case",
    name: "Contestación de demanda.pdf",
    mimeType: "application/pdf",
    size: 721000,
    status: "pending",
    progress: 0,
    error: null,
  },
  {
    id: "doc-5",
    folderId: "folder-case",
    name: "Acta de audiencia única.pdf",
    mimeType: "application/pdf",
    size: 558000,
    status: "analysis_completed",
    progress: 100,
    error: null,
  },
  {
    id: "doc-6",
    folderId: "folder-case",
    name: "Sentencia.pdf",
    mimeType: "application/pdf",
    size: 634000,
    status: "review_required",
    progress: 100,
    error: null,
  },
  {
    id: "doc-7",
    folderId: "folder-case",
    name: "Liquidación de devengados.pdf",
    mimeType: "application/pdf",
    size: 412000,
    status: "failed",
    progress: 62,
    error: "El archivo de demostración está incompleto.",
  },
] as const;

export const demoTimeline = [
  { date: "2025-03-14", title: "Presentación de demanda", document: "Demanda de alimentos.pdf" },
  { date: "2025-03-28", title: "Admisión de demanda", document: "Resolución 01.pdf" },
  { date: "2025-04-22", title: "Contestación", document: "Contestación de demanda.pdf" },
  { date: "2025-05-12", title: "Audiencia única", document: "Acta de audiencia única.pdf" },
  { date: "2025-06-20", title: "Sentencia", document: "Sentencia.pdf" },
  {
    date: "2026-01-08",
    title: "Liquidación de devengados",
    document: "Liquidación de devengados.pdf",
  },
];

export const demoFindings = [
  {
    id: "finding-client-name",
    group: "Cliente probable",
    fieldName: "Nombre completo",
    value: demoClient.name,
    confidence: 0.98,
    document: "Demanda de alimentos.pdf",
    page: 1,
    excerpt: "La demandante María López García, identificada con DNI...",
    status: "pending" as const,
  },
  {
    id: "finding-dni",
    group: "Cliente probable",
    fieldName: "DNI",
    value: demoClient.documentNumber,
    confidence: 0.97,
    document: "Anexos de demanda.pdf",
    page: 2,
    excerpt: "Documento Nacional de Identidad N.° 45879632.",
    status: "pending" as const,
  },
  {
    id: "finding-case",
    group: "Expediente detectado",
    fieldName: "Número de expediente",
    value: demoCase.caseNumber,
    confidence: 0.99,
    document: "Sentencia.pdf",
    page: 1,
    excerpt: "Expediente 01234-2025-0-1801-JP-FC-01.",
    status: "pending" as const,
  },
  {
    id: "finding-next-action",
    group: "Próxima acción",
    fieldName: "Acción sugerida",
    value: demoCase.nextAction,
    confidence: 0.79,
    document: "Liquidación de devengados.pdf",
    page: 4,
    excerpt: "Corresponde actualizar la liquidación con los periodos posteriores.",
    status: "conflict" as const,
  },
];
