/**
 * Password policy validation utility (ENFORCE-05, D-01, D-02).
 *
 * Validates a plaintext password against the tenant's RegistrationSettings
 * policy rules. Returns an array of typed violations so callers can surface
 * specific error messages to users. An empty array means the password is
 * compliant.
 *
 * All checks run server-side only — the function is never exported to the
 * client bundle.
 */

import { isPasswordInHistory } from "~/lib/password-history";
import { db } from "~/server/db";

/**
 * A single policy violation describing which rule failed and a
 * human-readable message suitable for display in the UI.
 */
export interface PolicyViolation {
  /** Machine-readable rule identifier */
  rule: string;
  /** Human-readable violation message (per D-02) */
  message: string;
}

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

  // Length check
  if (plaintext.length < settings.minPasswordLength) {
    violations.push({
      rule: "minLength",
      message: `Password must be at least ${settings.minPasswordLength} characters`,
    });
  }

  // Uppercase check
  if (settings.requireUppercase && !/[A-Z]/.test(plaintext)) {
    violations.push({
      rule: "uppercase",
      message: "Password must contain at least one uppercase letter",
    });
  }

  // Lowercase check
  if (settings.requireLowercase && !/[a-z]/.test(plaintext)) {
    violations.push({
      rule: "lowercase",
      message: "Password must contain at least one lowercase letter",
    });
  }

  // Numbers check
  if (settings.requireNumbers && !/[0-9]/.test(plaintext)) {
    violations.push({
      rule: "numbers",
      message: "Password must contain at least one number",
    });
  }

  // Special characters check
  if (settings.requiredSpecialChars) {
    const escaped = settings.requiredSpecialChars.replace(
      /[-[\]{}()*+?.,\\^$|#\s]/g,
      "\\$&"
    );
    const specialCharRegex = new RegExp("[" + escaped + "]");
    if (!specialCharRegex.test(plaintext)) {
      violations.push({
        rule: "specialChars",
        message: `Password must contain at least one special character (${settings.requiredSpecialChars})`,
      });
    }
  }

  // Password history check
  if (settings.passwordHistoryDepth > 0) {
    const inHistory = await isPasswordInHistory(
      userId,
      plaintext,
      settings.passwordHistoryDepth
    );
    if (inHistory) {
      violations.push({
        rule: "history",
        message: `Password was used in your last ${settings.passwordHistoryDepth} passwords`,
      });
    }
  }

  return violations;
}
