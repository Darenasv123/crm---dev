import { describe, expect, it } from "vitest";
import {
  buildMassImportDryRunPlan,
  isMassZipImportClient,
} from "@/lib/imports/mass-import-dry-run";

describe("mass import dry-run", () => {
  it("identifica clientes creados por importación ZIP masiva anterior", () => {
    expect(
      isMassZipImportClient({
        id: "c1",
        name: "CLIENTE",
        notes: "Importado desde Google Drive ZIP: clientes.zip",
      }),
    ).toBe(true);
    expect(isMassZipImportClient({ id: "c2", name: "MANUAL", notes: "Alta manual" })).toBe(false);
  });

  it("arma un plan exacto de clientes, casos, documentos y storage sin borrar", () => {
    const plan = buildMassImportDryRunPlan({
      clients: [
        {
          id: "client-1",
          name: "A-EXPEDIENTES DE CLIENTES",
          created_at: "2026-07-22T17:17:23Z",
          notes: "Importado desde Google Drive ZIP: A-EXPEDIENTES.zip",
          process_type: "texto libre",
        },
        { id: "client-2", name: "Manual", notes: "Manual" },
      ],
      cases: [{ id: "case-1", client_id: "client-1", expediente: "001-2024" }],
      documents: [
        {
          id: "doc-1",
          client_id: "client-1",
          case_id: null,
          name: "DEMANDA.pdf",
          storage_path: "client-1/DEMANDA.pdf",
          checksum: "hash-1",
          source_provider: "google_drive_zip",
          external_file_id: "A-EXPEDIENTES/CLIENTE/DEMANDA.pdf",
        },
      ],
    });

    expect(plan.totals).toMatchObject({ clients: 1, cases: 1, documents: 1, storageObjects: 1 });
    expect(plan.items[0].origin).toBe("A-EXPEDIENTES.zip");
    expect(plan.items[0].storagePaths).toEqual(["client-1/DEMANDA.pdf"]);
    expect(plan.items[0].zipPaths).toContain("A-EXPEDIENTES/CLIENTE/DEMANDA.pdf");
  });
});
