export declare const MODES: string[];
export declare const DEFAULT_MODE: "drive-local";
export declare const DENYLIST_HOST_SUBSTRINGS: string[];
export declare const DENYLIST_REF_SUBSTRINGS: string[];
export declare const ALLOWED_HOSTS: string[];
export declare const EXPECTED_STAGING_PROJECT_REF_VAR: "EXPECTED_STAGING_SUPABASE_PROJECT_REF";
export declare const RUNTIME_CRITICAL_URL_VARS: string[];
export declare const RUNTIME_CRITICAL_SECRET_VARS: string[];
export declare const RUNTIME_CRITICAL_VARS: string[];

export declare function expectedStagingHost(ref: string): string;

export declare function isAllowedHost(
  host: string | null,
  mode: string,
  env: Record<string, string | undefined>,
): boolean;

export interface EffectiveEnvEvaluation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  checks: string[];
}

export declare function evaluateEffectiveEnv(
  env: Record<string, string | undefined>,
  mode?: string,
): EffectiveEnvEvaluation;

export declare function mergeEffectiveEnv(
  fileEnv: Record<string, string | undefined>,
  processEnv: Record<string, string | undefined>,
): Record<string, string | undefined>;
