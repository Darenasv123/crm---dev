/**
 * Feature flags for functionality that is code-complete but intentionally
 * disabled for a given release. Every flag here MUST be fail-closed: any
 * value other than the exact literal "true" (missing var, "false", empty
 * string, typo, etc.) resolves to disabled.
 */

/**
 * Password recovery ("Olvidé mi contraseña") is fully implemented
 * (resetPasswordForEmail + PASSWORD_RECOVERY + updateUser flow) but is
 * disabled for the initial self-hosted production release because the
 * self-hosted SMTP/GoTrue stack cannot currently deliver recovery emails
 * (POST /auth/v1/recover → HTTP 500 "Error sending recovery email").
 *
 * This is an infrastructure limitation, not a code defect — do not remove
 * the recovery routes, listeners, or tests. Flip
 * VITE_PASSWORD_RECOVERY_ENABLED=true once SMTP delivery is fixed.
 */
export function isPasswordRecoveryEnabled(): boolean {
  const raw = import.meta.env.VITE_PASSWORD_RECOVERY_ENABLED as string | undefined;
  return raw === "true";
}
