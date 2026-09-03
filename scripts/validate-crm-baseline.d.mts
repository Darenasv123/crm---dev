export declare const MIGRATIONS_DIR: string;
export declare const SELF_HOSTED_DIR: string;

export declare const BASELINE_FILENAME: string;
export declare const FIRST_HISTORICAL_FILENAME: string;

export declare const EXPECTED_HISTORICAL_COUNT: number;
export declare const EXPECTED_TOTAL_COUNT_WITH_BASELINE: number;
export declare const EXPECTED_MANIFEST_V1_SHA256: string;

export declare const CORE_TABLES: string[];

export interface NamedPattern {
  name: string;
  pattern: RegExp;
}

export declare const FORBIDDEN_PLATFORM_PATTERNS: NamedPattern[];
export declare const FORBIDDEN_STORAGE_PROVISIONING_PATTERNS: NamedPattern[];
export declare const FORBIDDEN_PRODUCTION_IDENTIFIERS: string[];
export declare const SECRET_LOOK_PATTERNS: NamedPattern[];
export declare const ROLE_METADATA_ESCALATION_PATTERN: RegExp;

export interface ManifestResult {
  count: number;
  sha256: string;
  filenames: string[];
}

export declare function computeManifest(dir: string, filenames: string[]): ManifestResult;

export declare function stripSqlComments(text: string): string;
export declare function normalizeSql(text: string): string;
export declare function extractFunctionSource(text: string, functionName: string): string | null;
export declare function extractTriggerSource(text: string, triggerName: string): string | null;

export interface BaselineCheckResult {
  id: string;
  description: string;
  passed: boolean;
  detail: string;
}

export declare function validateBaseline(options?: { repoRoot?: string }): BaselineCheckResult[];
export declare function computeManifestV2(options?: { repoRoot?: string }): ManifestResult;
