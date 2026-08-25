import { supabase } from "@/lib/supabase";

/**
 * Cliente de navegador para la integración de Google Drive.
 *
 * Este archivo NUNCA maneja tokens de Drive: el access token y el refresh
 * token viven solo en el servidor. Por eso no se usa Google Picker (que
 * exigiría entregar un access token al navegador) sino el navegador de
 * carpetas propio, alimentado por /api/google-drive/folders.
 */

export type GoogleDriveStatus = {
  configured: boolean;
  connected: boolean;
  accountEmail?: string | null;
  rootFolderConfigured?: boolean;
  rootFolderName?: string | null;
  /** Solo para reabrir el navegador en la carpeta actual; no se muestra. */
  rootFolderId?: string | null;
  status?: string;
  lastSyncedAt?: string | null;
  lastError?: string | null;
};

export type DriveFolderEntry = { id: string; name: string; driveId: string | null };

export type DriveFolderListing = {
  current: { id: string; name: string; parentId: string | null };
  folders: DriveFolderEntry[];
};

export type DriveOnboardingPreview = {
  rootFolderName: string;
  linked: Array<{ clientId: string; clientName: string; folderId: string; folderName: string }>;
  suggested: Array<{
    clientId: string;
    clientName: string;
    folderId: string;
    folderName: string;
    matchType: "exact" | "normalized" | "manual";
  }>;
  ambiguous: Array<{
    clientId: string;
    clientName: string;
    candidates: Array<{ id: string; name: string }>;
  }>;
  clientsWithoutFolder: Array<{ clientId: string; clientName: string }>;
  foldersWithoutClient: Array<{ id: string; name: string }>;
  availableFolders: Array<{ id: string; name: string }>;
};

export type DriveMappingInput = {
  clientId: string;
  driveFolderId: string;
  matchType: "exact" | "normalized" | "manual";
};

async function authenticatedHeaders() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Inicia sesión para continuar.");
  return {
    authorization: `Bearer ${session.access_token}`,
    "content-type": "application/json",
  };
}

async function apiRequest<T>(path: string, options: RequestInit = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { ...(await authenticatedHeaders()), ...options.headers },
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `La solicitud falló (${response.status}).`);
  return body;
}

export function getGoogleDriveStatus() {
  return apiRequest<GoogleDriveStatus>("/api/google-drive/status");
}

export async function beginGoogleDriveConnection() {
  const result = await apiRequest<{ authorizationUrl: string }>("/api/google-drive/connect", {
    method: "POST",
  });
  window.location.assign(result.authorizationUrl);
}

export function disconnectGoogleDrive() {
  return apiRequest<{ disconnected: boolean }>("/api/google-drive/disconnect", { method: "POST" });
}

export function listGoogleDriveFolders(parentId?: string | null) {
  const query = parentId ? `?${new URLSearchParams({ parentId })}` : "";
  return apiRequest<DriveFolderListing>(`/api/google-drive/folders${query}`);
}

export function setGoogleDriveRootFolder(folderId: string) {
  return apiRequest<{ rootFolderName: string; rootFolderId: string; unchanged: boolean }>(
    "/api/google-drive/root-folder",
    { method: "POST", body: JSON.stringify({ folderId }) },
  );
}

export function getGoogleDriveOnboardingPreview() {
  return apiRequest<DriveOnboardingPreview>("/api/google-drive/onboarding/preview");
}

export function applyGoogleDriveMappings(mappings: DriveMappingInput[]) {
  return apiRequest<{ created: number; unchanged: number }>("/api/google-drive/onboarding/apply", {
    method: "POST",
    body: JSON.stringify({ mappings }),
  });
}
