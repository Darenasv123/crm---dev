export declare const SOURCE_FILE_RELATIVE_PATH: string;
export declare const ACL_PROVENANCE_FILE_RELATIVE_PATH: string;
export declare const EXPECTED_SOURCE_FILE_SHA256: string;
export declare const EXPECTED_ACL_PROVENANCE_FILE_SHA256: string;
export declare const EXPECTED_ACL_PROVENANCE_GRANT_LINES: string[];
export declare const EXPECTED_ACL_PROVENANCE_BLANKET_REVOKE_LINE: string;
export declare const EXPECTED_STAFF_FRAGMENT_SHA256: string;
export declare const EXPECTED_ADMIN_FRAGMENT_SHA256: string;

export interface TargetFunction {
  name: string;
  expectedFragmentSha256: string;
}

export declare const TARGET_FUNCTIONS: TargetFunction[];

export declare class ProjectionError extends Error {
  constructor(message: string);
}

export declare function extractFunctionFragment(text: string, functionName: string): string | null;

export declare function verifyAclProvenanceContent(aclProvenanceText: string): void;

export interface ExtractedFragment {
  name: string;
  text: string;
  sha256: string;
}

export interface AssembledProjection {
  fragments: ExtractedFragment[];
  projectedText: string;
}

export declare function extractAndAssemble(sourceText: string): AssembledProjection;

export interface ProjectionResult extends AssembledProjection {
  sourcePath: string;
  sourceBytes: number;
  sourceSha256: string;
  aclProvenancePath: string;
  aclProvenanceBytes: number;
  aclProvenanceSha256: string;
  projectedBytes: number;
  projectedSha256: string;
}

export declare function buildProjection(options?: { repoRoot?: string }): ProjectionResult;

export interface WrittenProjection {
  path: string;
  sha256: string;
}

export declare function writeProjectionToTempFile(
  projection: ProjectionResult,
  options?: { tmpDir?: string },
): WrittenProjection;
