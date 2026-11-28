import bcrypt from "bcrypt";

/**
 * Whether a stored password is one the user chose. Those are bcrypt hashes;
 * accounts provisioned by an identity provider hold a random placeholder
 * instead, and a revoked password is null.
 */
export function hasRealPassword(
  password: string | null | undefined
): password is string {
  return (
    typeof password === "string" &&
    (password.startsWith("$2b$") || password.startsWith("$2a$"))
  );
}

/** Attempts allowed per user across every route that checks the password. */
export const CURRENT_PASSWORD_RATE_LIMIT = {
  windowMs: 15 * 60_000,
  maxAttempts: 10,
};

export type CurrentPasswordResult =
  "ok" | "invalid" | "rate_limited" | "not_set";

/**
 * Check a signed-in user's current password before a sensitive change.
 *
 * Every caller shares one per-user limit, so a stolen session cannot guess the
 * password on one route and use it on another. The sign-in lockout counter is
 * left alone: a stolen session must not be able to lock the owner out.
 */
export async function verifyCurrentPassword(
  userId: string,
  storedPassword: string | null | undefined,
  candidate: string | null | undefined
): Promise<CurrentPasswordResult> {
  if (!hasRealPassword(storedPassword)) return "not_set";
  if (!candidate) return "invalid";

  // Imported here so modules that only need hasRealPassword stay light.
  const { checkRateLimit } = await import("~/lib/auth-security");
  const allowed = await checkRateLimit(
    `current-password:${userId}`,
    CURRENT_PASSWORD_RATE_LIMIT
  );
  if (!allowed) return "rate_limited";

  return (await bcrypt.compare(candidate, storedPassword)) ? "ok" : "invalid";
}
