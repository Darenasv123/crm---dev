export type ImportStage =
  "inventory" | "document_processing" | "folder_consolidation" | "human_review" | "confirmation";

export interface ImportWorkItem {
  importJobId: string;
  stage: ImportStage;
  entityId?: string;
  attempt: number;
}

export interface BackgroundJobDispatcher {
  enqueue(item: ImportWorkItem): Promise<void>;
}

export interface ImportWorkflowRunner {
  start(importJobId: string): Promise<void>;
  resume(importJobId: string, stage: ImportStage): Promise<void>;
  cancel(importJobId: string): Promise<void>;
}

export class UnconfiguredBackgroundDispatcher implements BackgroundJobDispatcher {
  async enqueue(): Promise<void> {
    throw new Error(
      "El procesamiento en segundo plano se habilitará con Cloudflare Queues o Workflows.",
    );
  }
}
