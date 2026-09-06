export declare const SOURCE_MIGRATION_RELATIVE_PATH: string;
export declare const EXPECTED_SOURCE_SHA256: string;
export declare const PROJECTION_ALGORITHM_VERSION: string;
export declare const EXPECTED_PROJECTED_SHA256: string;

export declare const BLOCK_START_ANCHOR: string;
export declare const BLOCK_END_ANCHOR: string;
export declare const NEXT_STATEMENT_ANCHOR: string;
export declare const REQUIRED_REMOVED_BLOCK_SUBSTRINGS: string[];

export declare class ProjectionError extends Error {
  constructor(message: string);
}

export interface ExtractedProjection {
  projectedText: string;
  projectedBytes: number;
  projectedSha256: string;
  bytesRemoved: number;
  removedBlock: string;
}

export interface ProjectionResult extends ExtractedProjection {
  sourcePath: string;
  sourceBytes: number;
  sourceSha256: string;
}

export declare function extractProjection(text: string): ExtractedProjection;

export declare function buildProjection(options?: { repoRoot?: string }): ProjectionResult;

export interface WrittenProjection {
  path: string;
  sha256: string;
}

export declare function writeProjectionToTempFile(
  projection: ProjectionResult,
  options?: { tmpDir?: string },
): WrittenProjection;
