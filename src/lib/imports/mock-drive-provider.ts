import { demoDriveFiles, demoDriveFolders } from "@/lib/legal/demo-data";
import type { DriveFile, DriveFolder, DriveProvider } from "./drive-provider";

export class MockDriveProvider implements DriveProvider {
  async listFolders(parentFolderId: string): Promise<DriveFolder[]> {
    return demoDriveFolders.filter((folder) => folder.parentId === parentFolderId);
  }

  async listFiles(folderId: string): Promise<DriveFile[]> {
    return demoDriveFiles
      .filter((file) => file.folderId === folderId)
      .map(({ id, folderId: parentId, name, mimeType, size }) => ({
        id,
        folderId: parentId,
        name,
        mimeType,
        size,
      }));
  }

  async getFileMetadata(fileId: string): Promise<DriveFile> {
    const file = demoDriveFiles.find((item) => item.id === fileId);
    if (!file) throw new Error("Archivo demostrativo no encontrado.");
    return {
      id: file.id,
      folderId: file.folderId,
      name: file.name,
      mimeType: file.mimeType,
      size: file.size,
    };
  }

  async downloadFile(fileId: string): Promise<ArrayBuffer> {
    await this.getFileMetadata(fileId);
    return new TextEncoder().encode(`Contenido simulado de ${fileId}`).buffer;
  }

  async exportGoogleDocument(fileId: string, mimeType: string): Promise<ArrayBuffer> {
    await this.getFileMetadata(fileId);
    return new TextEncoder().encode(`Exportación simulada ${fileId} como ${mimeType}`).buffer;
  }
}
