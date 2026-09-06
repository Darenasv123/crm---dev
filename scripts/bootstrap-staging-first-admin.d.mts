export declare const STAGING_PROJECT_REF: string;
export declare const STAGING_HOST: string;
export declare const DENYLIST_HOST_SUBSTRINGS: string[];
export declare const DENYLIST_REF_SUBSTRINGS: string[];
export declare const MIN_PASSWORD_LENGTH: number;
export declare const EMAIL_MUST_CONTAIN_SUBSTRING: string;
export declare const EXECUTION_CONFIRMATION_VALUE: string;
export declare const MIGRATION_WINDOW_CONFIRMATION_VALUE: string;
export declare const DRY_RUN_TRUE_VALUE: string;
export declare const AUTH_LOOKUP_PAGE_SIZE: number;
export declare const AUTH_LOOKUP_MAX_PAGES: number;

export declare class BootstrapGuardError extends Error {
  constructor(message: string);
}

export interface TargetGuardResult {
  ok: boolean;
  errors: string[];
}

export declare function validateTargetGuard(
  env: Record<string, string | undefined>,
): TargetGuardResult;

export declare function validateExecutionConfirmation(
  env: Record<string, string | undefined>,
): TargetGuardResult;

export declare function validateMigrationWindowConfirmation(
  env: Record<string, string | undefined>,
): TargetGuardResult;

export declare function validatePassword(password: string | undefined): void;
export declare function validateEmail(email: string | undefined): string;

export interface AuthUserLookupResult {
  id: string;
  email?: string;
}

export declare function findExistingAuthUserByEmail(
  adminClient: unknown,
  email: string,
  options?: { perPage?: number; maxPages?: number },
): Promise<AuthUserLookupResult | null>;

export interface CreateUserPayload {
  email: string;
  password: string;
  email_confirm: true;
  user_metadata: {
    full_name: string;
    initials: string;
    phone: string;
  };
}

export declare function buildCreateUserPayload(input: {
  email: string;
  password: string;
  fullName: string;
  phone?: string;
}): CreateUserPayload;

export interface ProfileRowShape {
  id: string;
  role: string;
  status: string;
}

export declare function verifyInitialProfileShape(
  profileRow: ProfileRowShape | null,
  expectedId: string,
): void;

export type BootstrapOutcome =
  | { outcome: "ABORTED_TARGET_GUARD"; errors: string[] }
  | { outcome: "ABORTED_EXECUTION_NOT_CONFIRMED"; errors: string[] }
  | { outcome: "ABORTED_MIGRATION_WINDOW_NOT_CONFIRMED"; errors: string[] }
  | { outcome: "ABORTED_PRESTATE_NOT_EMPTY"; reason: string }
  | { outcome: "ABORTED_PRESTATE_ADMIN_EXISTS"; reason: string }
  | {
      outcome: "BOOTSTRAP_PARTIAL_AUTH_USER_EXISTS";
      userId: string;
      email: string;
      reason: string;
    }
  | { outcome: "DRY_RUN_OK"; wouldCreateEmail: string; reason: string }
  | { outcome: "ABORTED_CREATE_USER_FAILED"; reason: string }
  | { outcome: "CREATED"; userId: string; email: string }
  | { outcome: "COMPENSATED"; scope: "CURRENT_RUN"; reason: string; deletedUserId: string }
  | {
      outcome: "BOOTSTRAP_PARTIAL_USER_CREATED";
      scope: "CURRENT_RUN";
      userId: string;
      reason: string;
      compensationError: string;
      manualRecoverySteps: string[];
    };

export declare function bootstrapFirstAdmin(args: {
  adminClient: unknown;
  env: Record<string, string | undefined>;
  password: string;
  email: string;
  fullName: string;
  phone?: string;
}): Promise<BootstrapOutcome>;
