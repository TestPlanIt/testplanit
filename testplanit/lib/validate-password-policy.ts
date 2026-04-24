/**
 * Password policy validation utility (ENFORCE-05, D-01, D-02).
 *
 * Validates a plaintext password against the tenant's RegistrationSettings
 * policy rules. Returns an array of typed violations so callers can surface
 * specific error messages to users. An empty array means the password is
 * compliant.
 *
 * All checks run server-side only — the function is never exported to the
 * client bundle. Violations carry a machine-readable `rule` + structured
 * `params` so clients can localize the message (GitHub #227); the shared type
 * lives in `lib/password-policy-messages.ts` to stay client-safe.
 */

import { isPasswordInHistory } from "~/lib/password-history";
import type { PolicyViolation } from "~/lib/password-policy-messages";
import { db } from "~/server/db";

export type { PolicyViolation } from "~/lib/password-policy-messages";

/**
 * Validate `plaintext` against the configured password policy for the current
 * tenant.
 *
 * @param userId    - ID of the user changing their password (used for history check)
 * @param plaintext - The candidate password in plaintext (NOT a hash)
 * @returns Array of PolicyViolation objects. Empty array = no violations.
 */
export async function validatePasswordPolicy(
  userId: string,
  plaintext: string
): Promise<PolicyViolation[]> {
  const settings = await db.registrationSettings.findFirst({
    select: {
      minPasswordLength: true,
      requireUppercase: true,
      requireLowercase: true,
      requireNumbers: true,
      requiredSpecialChars: true,
      passwordHistoryDepth: true,
    },
  });

  if (!settings) {
    return [];
  }

  const violations: PolicyViolation[] = [];

  if (plaintext.length < settings.minPasswordLength) {
    violations.push({
      rule: "minLength",
      params: { count: settings.minPasswordLength },
    });
  }

  if (settings.requireUppercase && !/[A-Z]/.test(plaintext)) {
    violations.push({ rule: "uppercase" });
  }

  if (settings.requireLowercase && !/[a-z]/.test(plaintext)) {
    violations.push({ rule: "lowercase" });
  }

  if (settings.requireNumbers && !/[0-9]/.test(plaintext)) {
    violations.push({ rule: "numbers" });
  }

  if (settings.requiredSpecialChars) {
    const escaped = settings.requiredSpecialChars.replace(
      /[-[\]{}()*+?.,\\^$|#\s]/g,
      "\\$&"
    );
    const specialCharRegex = new RegExp("[" + escaped + "]");
    if (!specialCharRegex.test(plaintext)) {
      violations.push({
        rule: "specialChars",
        params: { chars: settings.requiredSpecialChars },
      });
    }
  }

  if (settings.passwordHistoryDepth > 0) {
    const inHistory = await isPasswordInHistory(
      userId,
      plaintext,
      settings.passwordHistoryDepth
    );
    if (inHistory) {
      violations.push({
        rule: "history",
        params: { depth: settings.passwordHistoryDepth },
      });
    }
  }

  return violations;
}
