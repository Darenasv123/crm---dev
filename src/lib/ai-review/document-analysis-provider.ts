import { z } from "zod";

export const documentAnalysisInputSchema = z.object({
  documentId: z.string().min(1),
  fileName: z.string().min(1),
  extractedText: z.string().optional(),
  language: z.string().default("es"),
});

export const documentClassificationSchema = z.object({
  documentType: z.string(),
  documentDate: z.string().date().nullable(),
  confidenceScore: z.number().min(0).max(1),
});

export const documentEntitySchema = z.object({
  people: z.array(
    z.object({
      fullName: z.string(),
      role: z.string(),
      confidenceScore: z.number().min(0).max(1),
    }),
  ),
  caseNumber: z.string().nullable(),
});

export const documentEventSchema = z.object({
  events: z.array(
    z.object({
      date: z.string().date(),
      type: z.string(),
      title: z.string(),
      sourcePage: z.number().int().positive().nullable(),
      confidenceScore: z.number().min(0).max(1),
    }),
  ),
});

export const folderAnalysisSchema = z.object({
  probableClient: z.object({ name: z.string() }),
  probableCases: z.array(z.object({ caseNumber: z.string(), caseType: z.string() })),
  summary: z.string(),
  conflicts: z.array(z.string()),
  missingInformation: z.array(z.string()),
  confidenceScore: z.number().min(0).max(1),
});

export type DocumentAnalysisInput = z.infer<typeof documentAnalysisInputSchema>;
export type DocumentClassificationResult = z.infer<typeof documentClassificationSchema>;
export type DocumentEntityResult = z.infer<typeof documentEntitySchema>;
export type DocumentEventResult = z.infer<typeof documentEventSchema>;
export type FolderAnalysisResult = z.infer<typeof folderAnalysisSchema>;
export interface FolderAnalysisInput {
  folderId: string;
  documentIds: string[];
}

export interface DocumentAnalysisProvider {
  classifyDocument(input: DocumentAnalysisInput): Promise<DocumentClassificationResult>;
  extractEntities(input: DocumentAnalysisInput): Promise<DocumentEntityResult>;
  extractEvents(input: DocumentAnalysisInput): Promise<DocumentEventResult>;
  consolidateFolder(input: FolderAnalysisInput): Promise<FolderAnalysisResult>;
}

export abstract class UnconfiguredDocumentAnalysisProvider implements DocumentAnalysisProvider {
  constructor(private readonly providerName: string) {}
  protected unavailable(): never {
    throw new Error(`${this.providerName} está preparado como contrato, pero no está conectado.`);
  }
  async classifyDocument(): Promise<DocumentClassificationResult> {
    return this.unavailable();
  }
  async extractEntities(): Promise<DocumentEntityResult> {
    return this.unavailable();
  }
  async extractEvents(): Promise<DocumentEventResult> {
    return this.unavailable();
  }
  async consolidateFolder(): Promise<FolderAnalysisResult> {
    return this.unavailable();
  }
}

export class GeminiDocumentAnalysisProvider extends UnconfiguredDocumentAnalysisProvider {
  constructor() {
    super("Gemini");
  }
}

export class OpenAIDocumentAnalysisProvider extends UnconfiguredDocumentAnalysisProvider {
  constructor() {
    super("OpenAI");
  }
}
