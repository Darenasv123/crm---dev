export interface DriveFolder {
  id: string;
  name: string;
  parentId: string | null;
  path: string;
}

export interface DriveFile {
  id: string;
  folderId: string;
  name: string;
  mimeType: string;
  size: number;
  modifiedAt?: string;
}

export interface DriveProvider {
  listFolders(parentFolderId: string): Promise<DriveFolder[]>;
  listFiles(folderId: string): Promise<DriveFile[]>;
  getFileMetadata(fileId: string): Promise<DriveFile>;
  downloadFile(fileId: string): Promise<ArrayBuffer>;
  exportGoogleDocument(fileId: string, mimeType: string): Promise<ArrayBuffer>;
}

export class ProviderNotConfiguredError extends Error {
  constructor(provider: string) {
    super(`${provider} todavía no está configurado para esta fase.`);
    this.name = "ProviderNotConfiguredError";
  }
}

export class GoogleDriveProvider implements DriveProvider {
  async listFolders(): Promise<DriveFolder[]> {
    throw new ProviderNotConfiguredError("Google Drive");
  }
  async listFiles(): Promise<DriveFile[]> {
    throw new ProviderNotConfiguredError("Google Drive");
  }
  async getFileMetadata(): Promise<DriveFile> {
    throw new ProviderNotConfiguredError("Google Drive");
  }
  async downloadFile(): Promise<ArrayBuffer> {
    throw new ProviderNotConfiguredError("Google Drive");
  }
  async exportGoogleDocument(): Promise<ArrayBuffer> {
    throw new ProviderNotConfiguredError("Google Drive");
  }
}
