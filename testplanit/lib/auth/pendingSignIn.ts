/**
 * Sign-in steps a session can still owe after its cookie has been issued: an
 * SSO or magic-link sign-in gets its session before the second factor is
 * checked, and a forced password change comes after sign-in.
 */
export type PendingSignInStep =
  "two_factor" | "two_factor_setup" | "password_change";

interface SignInStepClaims {
  twoFactorRequired?: boolean;
  twoFactorVerified?: boolean;
  twoFactorSetupRequired?: boolean;
  mustChangePassword?: boolean;
}

/** The step a session token still owes, most restrictive first. */
export function getPendingSignInStep(
  token: SignInStepClaims | null | undefined
): PendingSignInStep | null {
  if (!token) return null;
  if (token.twoFactorRequired && !token.twoFactorVerified) return "two_factor";
  if (token.twoFactorSetupRequired) return "two_factor_setup";
  if (token.mustChangePassword) return "password_change";
  return null;
}

// The forced password change page reads the policy and posts the new password.
const PASSWORD_CHANGE_API =
  /^\/api\/users\/[^/]+\/(force-change-password|password-policy)$/;

/**
 * Whether an API path stays open to a session that owes `step`. Routes under
 * /api/auth never reach this check; they are how every step is completed.
 */
export function isApiOpenDuringSignInStep(
  pathname: string,
  step: PendingSignInStep
): boolean {
  return step === "password_change" && PASSWORD_CHANGE_API.test(pathname);
}
