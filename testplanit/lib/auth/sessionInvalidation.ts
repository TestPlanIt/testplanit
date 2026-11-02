import type { AuthMethod } from "~/zenstack/models";

/**
 * True when the user's password was changed after the JWT was issued.
 *
 * A token with no timestamp was issued before the user's first-ever change
 * (nothing stamps passwordChangedAt at account creation), so it counts as
 * older than any stored value.
 */
export function passwordChangedSinceIssue(
  dbChangedAt: Date | string | null | undefined,
  tokenChangedAt: string | null | undefined
): boolean {
  if (!dbChangedAt) return false;
  if (!tokenChangedAt) return true;
  return new Date(dbChangedAt) > new Date(tokenChangedAt);
}

/**
 * Mirrors the session callback's mid-session guards against a user
 * projection (cached or fresh): a deactivated account, or — for
 * credential-based users only — a password changed since the token was
 * issued. Fields missing from an older cache entry never end a session.
 */
export function isSessionEnded(
  token: { passwordChangedAt?: string | null },
  user: {
    authMethod?: AuthMethod | null;
    passwordChangedAt?: string | null;
    isActive?: boolean;
  }
): boolean {
  if (user.isActive === false) return true;
  if (user.authMethod !== "INTERNAL" && user.authMethod !== "BOTH") {
    return false;
  }
  return passwordChangedSinceIssue(
    user.passwordChangedAt,
    token.passwordChangedAt
  );
}
