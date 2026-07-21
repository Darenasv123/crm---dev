import { demoCase, demoClient, demoTimeline } from "@/lib/legal/demo-data";
import {
  documentAnalysisInputSchema,
  documentClassificationSchema,
  documentEntitySchema,
  documentEventSchema,
  folderAnalysisSchema,
  type DocumentAnalysisInput,
  type DocumentAnalysisProvider,
  type FolderAnalysisInput,
} from "./document-analysis-provider";

export class MockDocumentAnalysisProvider implements DocumentAnalysisProvider {
  async classifyDocument(input: DocumentAnalysisInput) {
    const parsed = documentAnalysisInputSchema.parse(input);
    const lowerName = parsed.fileName.toLowerCase();
    const documentType = lowerName.includes("sentencia")
      ? "sentencia"
      : lowerName.includes("demanda")
        ? "demanda"
        : "documento procesal";
    return documentClassificationSchema.parse({
      documentType,
      documentDate: lowerName.includes("sentencia") ? "2025-06-20" : null,
      confidenceScore: 0.94,
    });
  }

  async extractEntities(input: DocumentAnalysisInput) {
    documentAnalysisInputSchema.parse(input);
    return documentEntitySchema.parse({
      people: [
        {
          fullName: demoClient.name,
          role: "Demandante",
          documentNumber: demoClient.documentNumber,
          confidenceScore: 0.98,
        },
        {
          fullName: demoCase.defendant,
          role: "Demandado",
          documentNumber: null,
          confidenceScore: 0.88,
        },
      ],
      caseNumber: demoCase.caseNumber,
    });
  }

  async extractEvents(input: DocumentAnalysisInput) {
    documentAnalysisInputSchema.parse(input);
    return documentEventSchema.parse({
      events: demoTimeline.map((event, index) => ({
        date: event.date,
        type: event.title,
        title: event.title,
        sourcePage: index + 1,
        confidenceScore: 0.9,
      })),
    });
  }

  async consolidateFolder(input: FolderAnalysisInput) {
    if (!input.folderId || input.documentIds.length === 0) {
      throw new Error("La carpeta demostrativa debe incluir documentos.");
    }
    return folderAnalysisSchema.parse({
      probableClient: { name: demoClient.name, documentNumber: demoClient.documentNumber },
      probableCases: [{ caseNumber: demoCase.caseNumber, caseType: demoCase.caseType }],
      summary: "Expediente de alimentos con sentencia y liquidación pendiente de actualización.",
      conflicts: ["La fecha de notificación de la sentencia requiere revisión humana."],
      missingInformation: ["Correo de la contraparte", "Constancia de notificación completa"],
      confidenceScore: 0.91,
    });
  }
}
