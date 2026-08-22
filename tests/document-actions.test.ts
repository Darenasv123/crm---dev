import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  download: vi.fn(),
  from: vi.fn(),
  convertToHtml: vi.fn(),
  createObjectURL: vi.fn(),
  revokeObjectURL: vi.fn(),
  anchorClick: vi.fn(),
  anchorRemove: vi.fn(),
  appendChild: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { storage: { from: mocks.from } },
}));

vi.mock("mammoth", () => ({
  convertToHtml: mocks.convertToHtml,
  images: { dataUri: { converter: "data-uri" } },
}));

import {
  documentFileName,
  documentPreviewKind,
  downloadDocument,
  filterDocumentsByCase,
  filterDocumentsByClient,
  previewDocument,
  releaseDocumentPreview,
} from "@/lib/document-actions";
import { resolveDocumentPermissions } from "@/lib/permissions";

const documentRecord = {
  name: "Doc1.docx",
  original_name: "Doc1 original.docx",
  mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  storage_path: "clientes/qa/Doc1.docx",
};

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("acciones canónicas de documentos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.from.mockReturnValue({ download: mocks.download });
    mocks.download.mockResolvedValue({ data: new Blob(["contenido"]), error: null });
    mocks.convertToHtml.mockResolvedValue({ value: "<p>Contenido DOCX</p>", messages: [] });
    mocks.createObjectURL.mockReturnValue("blob:document-preview");

    const anchor = {
      href: "",
      download: "",
      style: { display: "" },
      click: mocks.anchorClick,
      remove: mocks.anchorRemove,
    };
    vi.stubGlobal("URL", {
      createObjectURL: mocks.createObjectURL,
      revokeObjectURL: mocks.revokeObjectURL,
    });
    vi.stubGlobal("window", {
      document: {
        createElement: vi.fn(() => anchor),
        body: { appendChild: mocks.appendChild },
      },
    });
  });

  it("clasifica PDF, DOCX, imágenes y TXT para preview sin convertirlos en descarga", () => {
    expect(documentPreviewKind({ ...documentRecord, name: "a.pdf", original_name: null })).toBe(
      "pdf",
    );
    expect(documentPreviewKind(documentRecord)).toBe("docx");
    expect(
      documentPreviewKind({
        ...documentRecord,
        name: "foto.png",
        original_name: null,
        mime_type: "image/png",
      }),
    ).toBe("image");
    expect(
      documentPreviewKind({
        ...documentRecord,
        name: "notas.txt",
        original_name: null,
        mime_type: "text/plain",
      }),
    ).toBe("text");
  });

  it("Visualizar obtiene el archivo autenticado del bucket privado", async () => {
    const preview = await previewDocument({
      ...documentRecord,
      name: "sentencia.pdf",
      original_name: null,
      mime_type: "application/pdf",
    });

    expect(mocks.from).toHaveBeenCalledWith("documents");
    expect(mocks.download).toHaveBeenCalledWith(documentRecord.storage_path);
    expect(preview).toEqual({ kind: "pdf", name: "sentencia.pdf", url: "blob:document-preview" });
  });

  it("Visualizar DOCX usa el visor Mammoth instalado", async () => {
    const preview = await previewDocument(documentRecord);

    expect(mocks.convertToHtml).toHaveBeenCalledOnce();
    expect(preview).toEqual({
      kind: "docx",
      name: "Doc1 original.docx",
      html: "<p>Contenido DOCX</p>",
    });
  });

  it("un formato sin visor devuelve un mensaje y no descarga silenciosamente", async () => {
    const preview = await previewDocument({
      ...documentRecord,
      name: "tabla.xlsx",
      original_name: null,
      mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    expect(preview.kind).toBe("unsupported");
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it("Descargar conserva original_name y fuerza una descarga Blob", async () => {
    await downloadDocument(documentRecord);

    const anchor = mocks.appendChild.mock.calls[0][0];
    expect(anchor.download).toBe("Doc1 original.docx");
    expect(anchor.href).toBe("blob:document-preview");
    expect(mocks.anchorClick).toHaveBeenCalledOnce();
    expect(mocks.anchorRemove).toHaveBeenCalledOnce();
  });

  it("Descargar y cerrar preview revocan sus object URLs", async () => {
    await downloadDocument(documentRecord);
    releaseDocumentPreview({ kind: "image", name: "foto.png", url: "blob:image" });

    expect(mocks.revokeObjectURL).toHaveBeenCalledWith("blob:document-preview");
    expect(mocks.revokeObjectURL).toHaveBeenCalledWith("blob:image");
  });

  it("un error Storage produce un mensaje controlado", async () => {
    mocks.download.mockResolvedValue({ data: null, error: new Error("detalle interno") });

    await expect(downloadDocument(documentRecord)).rejects.toThrow(
      "No se pudo obtener el documento. Verifica tu acceso e inténtalo nuevamente.",
    );
  });

  it("Administrador y Personal reciben los mismos permisos de visualizar y descargar", () => {
    for (const role of ["Administrador", "Personal"] as const) {
      const permissions = resolveDocumentPermissions(role);
      expect(permissions.canViewDocuments).toBe(true);
      expect(permissions.canDownloadDocuments).toBe(true);
    }
  });

  it("la página global conecta Visualizar y Descargar con handlers separados", () => {
    const route = source("src/routes/_app.documentos.index.tsx");
    expect(route).toContain("const preview = await previewDocument(doc)");
    expect(route).toContain("await downloadDocument(doc)");
    expect(route).toContain("onPreview={handlePreview}");
    expect(route).toContain("onDownload={handleDownload}");
  });

  it("la ficha de cliente y la ficha de expediente reutilizan el mismo núcleo documental", () => {
    const clientPage = source("src/components/clients/client-related-page.tsx");
    const caseDetail = source("src/routes/_app.casos.$id.tsx");
    const related = source("src/components/documents/related-documents.tsx");
    expect(clientPage).toContain(
      'import { RelatedDocuments } from "@/components/documents/related-documents"',
    );
    expect(caseDetail).toContain(
      'import { RelatedDocuments } from "@/components/documents/related-documents"',
    );
    // El componente compartido reutiliza las mismas acciones de storage y el
    // mismo visor que el explorador general, en vez de duplicar el gestor.
    expect(related).toContain('from "@/lib/document-actions"');
    expect(related).toContain(
      'import { DocumentViewerDialog } from "@/components/documents/document-viewer-dialog"',
    );
    expect(related).toContain("usePermissions");
  });

  it("el visor compartido se usa tanto en el explorador general como en los contextos relacionados", () => {
    const route = source("src/routes/_app.documentos.index.tsx");
    const related = source("src/components/documents/related-documents.tsx");
    expect(route).toContain(
      'import { DocumentViewerDialog } from "@/components/documents/document-viewer-dialog"',
    );
    expect(route).not.toContain("function DocumentPreviewDialog");
    expect(related).toContain("<DocumentViewerDialog");
  });

  it("el navegador de carpetas reutiliza la descarga canónica", () => {
    const folders = source("src/components/document-folders/document-folder-browser.tsx");
    expect(folders).toContain('import { downloadDocument } from "@/lib/document-actions"');
    expect(folders).toContain("await downloadDocument(doc)");
    expect(folders).not.toContain("createSignedUrl");
  });

  it("no usa bucket público, public URL ni credenciales service_role", () => {
    const actions = source("src/lib/document-actions.ts");
    expect(actions).toContain('storage.from("documents").download');
    expect(actions).not.toMatch(/getPublicUrl|service_role|SUPABASE_SERVICE/i);
  });

  it("prefiere original_name y conserva un fallback estable", () => {
    expect(documentFileName(documentRecord)).toBe("Doc1 original.docx");
    expect(documentFileName({ name: "archivo.pdf", original_name: null })).toBe("archivo.pdf");
  });
});

describe("filtrado de documentos por contexto (Cliente / Expediente)", () => {
  const docs = [
    { id: "1", client_id: "client-a", case_id: null },
    { id: "2", client_id: null, case_id: "case-a" },
    { id: "3", client_id: "client-b", case_id: null },
    { id: "4", client_id: null, case_id: "case-b" },
    { id: "5", client_id: null, case_id: null },
  ];

  it("filterDocumentsByClient incluye documentos del cliente directo y de sus expedientes", () => {
    const result = filterDocumentsByClient(docs, "client-a", ["case-a"]);
    expect(result.map((d) => d.id)).toEqual(["1", "2"]);
  });

  it("filterDocumentsByClient acepta un Set además de un array iterable", () => {
    const result = filterDocumentsByClient(docs, "client-a", new Set(["case-a"]));
    expect(result.map((d) => d.id)).toEqual(["1", "2"]);
  });

  it("filterDocumentsByClient no incluye documentos de expedientes ajenos ni sin relación", () => {
    const result = filterDocumentsByClient(docs, "client-b", []);
    expect(result.map((d) => d.id)).toEqual(["3"]);
  });

  it("filterDocumentsByCase solo incluye documentos de ese expediente exacto", () => {
    expect(filterDocumentsByCase(docs, "case-a").map((d) => d.id)).toEqual(["2"]);
    expect(filterDocumentsByCase(docs, "case-b").map((d) => d.id)).toEqual(["4"]);
    expect(filterDocumentsByCase(docs, "case-inexistente")).toEqual([]);
  });
});
