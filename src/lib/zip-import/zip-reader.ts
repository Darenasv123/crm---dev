/**
 * zip-import/zip-reader.ts
 *
 * Lee un archivo ZIP usando JSZip y devuelve las entradas como RawZipEntry[].
 * Aplica las validaciones de seguridad de ZIP bomb y límites globales.
 * Solo se ejecuta en el cliente (browser) para el análisis de vista previa.
 */

import JSZip from "jszip";
import {
  MAX_ZIP_SIZE_BYTES,
  ZIP_SECURITY_LIMITS,
  detectZipBomb,
  validateEntryPath,
} from "./security";
import type { RawZipEntry } from "./analyzer";

export interface ReadZipResult {
  entries: RawZipEntry[];
  /** Errores de seguridad que abortan la lectura */
  fatalError: string | null;
  /** Advertencias no fatales */
  warnings: string[];
}

/**
 * Lee un File ZIP y extrae sus entradas de forma segura.
 *
 * @throws {Error} si el ZIP está corrupto o no es un ZIP válido.
 */
export async function readZipFile(file: File): Promise<ReadZipResult> {
  const warnings: string[] = [];

  if (file.size > MAX_ZIP_SIZE_BYTES) {
    return {
      entries: [],
      fatalError: "El archivo ZIP supera el límite de 1 GB.",
      warnings: [],
    };
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    throw new Error("El archivo ZIP está corrupto o no es válido.");
  }

  const allFiles = Object.values(zip.files);

  // Límite de entradas
  if (allFiles.length > ZIP_SECURITY_LIMITS.MAX_ENTRIES) {
    return {
      entries: [],
      fatalError: `El ZIP contiene demasiadas entradas (${allFiles.length}). Máximo permitido: ${ZIP_SECURITY_LIMITS.MAX_ENTRIES}.`,
      warnings: [],
    };
  }

  const entries: RawZipEntry[] = [];
  let totalUncompressed = 0;

  for (const zipObj of allFiles) {
    const path = zipObj.name.replace(/\\/g, "/");
    const isDirectory = zipObj.dir;

    if (zipObj.unsafeOriginalName) {
      const originalPathCheck = validateEntryPath(zipObj.unsafeOriginalName);
      if (!originalPathCheck.safe) {
        return { entries: [], fatalError: originalPathCheck.reason, warnings: [] };
      }
    }

    // JSZip conserva estos tamaños en metadatos internos de cada entrada.
    const data = (
      zipObj as JSZip.JSZipObject & {
        _data?: { compressedSize?: number; uncompressedSize?: number };
      }
    )._data;
    const compressedSize: number = data?.compressedSize ?? 0;
    const uncompressedSize: number = data?.uncompressedSize ?? 0;

    // ZIP bomb check
    if (detectZipBomb({ compressedSize, uncompressedSize })) {
      return {
        entries: [],
        fatalError: `Posible ZIP bomb detectado en "${path}". Ratio de compresión excesivo.`,
        warnings: [],
      };
    }

    totalUncompressed += uncompressedSize;

    if (totalUncompressed > ZIP_SECURITY_LIMITS.MAX_UNCOMPRESSED_BYTES) {
      return {
        entries: [],
        fatalError: `El contenido descomprimido supera el límite de ${Math.round(ZIP_SECURITY_LIMITS.MAX_UNCOMPRESSED_BYTES / 1024 / 1024)} MB.`,
        warnings: [],
      };
    }

    // Excluir symlinks (JSZip los marca como unixPermissions con bit 0xa000)
    const unixPermissions = zipObj.unixPermissions;
    if (typeof unixPermissions === "number" && (unixPermissions & 0xf000) === 0xa000) {
      warnings.push(`Enlace simbólico ignorado: "${path}".`);
      continue;
    }

    entries.push({
      path,
      isDirectory,
      size: uncompressedSize,
      getData: isDirectory
        ? undefined
        : async () => {
            const buffer = await zipObj.async("arraybuffer");
            return buffer;
          },
    });
  }

  return { entries, fatalError: null, warnings };
}
