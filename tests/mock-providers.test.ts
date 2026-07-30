import { describe, expect, it } from "vitest";
import { MockDriveProvider } from "@/lib/imports/mock-drive-provider";
import { MockDocumentAnalysisProvider } from "@/lib/ai-review/mock-document-analysis-provider";
import { demoCase, demoClient, demoDriveFiles } from "@/lib/legal/demo-data";

describe("adaptador simulado de Google Drive", () => {
  const provider = new MockDriveProvider();

  it("inventa carpetas y documentos sin acceder a una cuenta real", async () => {
    const folders = await provider.listFolders("demo-root");
    const files = await provider.listFiles("folder-case");
    expect(folders[0]?.name).toBe(demoClient.name);
    expect(files).toHaveLength(demoDriveFiles.length);
    expect(await provider.getFileMetadata("doc-6")).toMatchObject({ name: "Sentencia.pdf" });
  });

  it("devuelve contenido binario únicamente simulado", async () => {
    const content = await provider.downloadFile("doc-1");
    expect(content.byteLength).toBeGreaterThan(0);
  });
});

describe("adaptador simulado de análisis documental", () => {
  const provider = new MockDocumentAnalysisProvider();

  it("clasifica y extrae entidades con esquemas estrictos", async () => {
    const input = { documentId: "doc-6", fileName: "Sentencia.pdf", language: "es" };
    const classification = await provider.classifyDocument(input);
    const entities = await provider.extractEntities(input);
    expect(classification.documentType).toBe("sentencia");
    expect(classification.confidenceScore).toBeLessThanOrEqual(1);
    expect(entities.caseNumber).toBe(demoCase.caseNumber);
    expect(entities.people).toEqual([]);
  });

  it("consolida una carpeta y conserva conflictos para revisión", async () => {
    const result = await provider.consolidateFolder({
      folderId: "folder-case",
      documentIds: demoDriveFiles.map((file) => file.id),
    });
    expect(result.probableCases[0]?.caseNumber).toBe(demoCase.caseNumber);
    expect(result.conflicts.length).toBeGreaterThan(0);
  });
});
