export interface MassImportClientRow {
  id: string;
  name: string;
  created_at?: string | null;
  notes?: string | null;
  process_type?: string | null;
}

export interface MassImportCaseRow {
  id: string;
  client_id: string | null;
  expediente?: string | null;
  case_number?: string | null;
  case_name?: string | null;
}

export interface MassImportDocumentRow {
  id: string;
  client_id: string | null;
  case_id?: string | null;
  name: string;
  storage_path?: string | null;
  checksum?: string | null;
  source_provider?: string | null;
  source_type?: string | null;
  external_file_id?: string | null;
  external_folder_id?: string | null;
  external_url?: string | null;
  created_at?: string | null;
}

export interface MassImportDryRunInput {
  clients: MassImportClientRow[];
  cases: MassImportCaseRow[];
  documents: MassImportDocumentRow[];
}

export interface MassImportDryRunItem {
  client: MassImportClientRow;
  origin: string;
  zipPaths: string[];
  hashes: string[];
  cases: MassImportCaseRow[];
  documents: MassImportDocumentRow[];
  storagePaths: string[];
}

export interface MassImportDryRunPlan {
  generatedAt: string;
  items: MassImportDryRunItem[];
  totals: {
    clients: number;
    cases: number;
    documents: number;
    storageObjects: number;
  };
}

export function isMassZipImportClient(client: MassImportClientRow): boolean {
  return /^Importado desde Google Drive ZIP:/i.test(client.notes ?? "");
}

function originFromClient(client: MassImportClientRow): string {
  const notes = client.notes ?? "";
  return (
    notes.replace(/^Importado desde Google Drive ZIP:\s*/i, "").trim() || "ZIP masivo anterior"
  );
}

export function buildMassImportDryRunPlan(input: MassImportDryRunInput): MassImportDryRunPlan {
  const documentsByClient = new Map<string, MassImportDocumentRow[]>();
  const casesByClient = new Map<string, MassImportCaseRow[]>();

  for (const doc of input.documents) {
    if (!doc.client_id) continue;
    if (!documentsByClient.has(doc.client_id)) documentsByClient.set(doc.client_id, []);
    documentsByClient.get(doc.client_id)!.push(doc);
  }

  for (const caseRow of input.cases) {
    if (!caseRow.client_id) continue;
    if (!casesByClient.has(caseRow.client_id)) casesByClient.set(caseRow.client_id, []);
    casesByClient.get(caseRow.client_id)!.push(caseRow);
  }

  const items = input.clients
    .filter((client) => isMassZipImportClient(client))
    .map((client) => {
      const documents = documentsByClient.get(client.id) ?? [];
      const cases = casesByClient.get(client.id) ?? [];
      const zipPaths = Array.from(
        new Set(
          documents
            .flatMap((doc) => [doc.external_file_id, doc.external_folder_id, doc.external_url])
            .filter((value): value is string => Boolean(value)),
        ),
      );
      const hashes = Array.from(
        new Set(
          documents.map((doc) => doc.checksum).filter((value): value is string => Boolean(value)),
        ),
      );
      const storagePaths = Array.from(
        new Set(
          documents
            .map((doc) => doc.storage_path)
            .filter((value): value is string => Boolean(value)),
        ),
      );
      return {
        client,
        origin: originFromClient(client),
        zipPaths,
        hashes,
        cases,
        documents,
        storagePaths,
      };
    });

  return {
    generatedAt: new Date().toISOString(),
    items,
    totals: {
      clients: items.length,
      cases: items.reduce((sum, item) => sum + item.cases.length, 0),
      documents: items.reduce((sum, item) => sum + item.documents.length, 0),
      storageObjects: items.reduce((sum, item) => sum + item.storagePaths.length, 0),
    },
  };
}
