/**
 * Client-safe types + translation helper for password policy violations.
 *
 * `lib/validate-password-policy.ts` runs server-side only (it reads from `db`),
 * so the shared types live here instead — allowing both server and client code
 * to import `PolicyViolation` without pulling server-only deps into the client
 * bundle.
 */

export type PolicyRule =
  | "minLength"
  | "uppercase"
  | "lowercase"
  | "numbers"
  | "specialChars"
  | "history";

export interface PolicyViolationParams {
  count?: number;
  chars?: string;
  depth?: number;
}

export interface PolicyViolation {
  rule: PolicyRule;
  params?: PolicyViolationParams;
}

/**
 * Translate a single violation to a localized string using the caller's
 * `useTranslations()` function. Reuses the existing `passwordStrength.*` keys
 * that `PasswordStrengthIndicator` already displays as a checklist.
 *
 * `t` is typed loosely (`any`) because `next-intl`'s `Translator` generic
 * narrows keys to the message schema, which can't be expressed in a shared
 * helper. next-intl still logs a runtime warning if a key is missing.
 */
type Translator = (
  key: any,
  values?: Record<string, string | number>
) => string;

export function translatePolicyViolation(
  violation: PolicyViolation,
  t: Translator
): string {
  const { rule, params } = violation;
  switch (rule) {
    case "minLength":
      return t("passwordStrength.minLength", { count: params?.count ?? 0 });
    case "uppercase":
      return t("passwordStrength.uppercase");
    case "lowercase":
      return t("passwordStrength.lowercase");
    case "numbers":
      return t("passwordStrength.numbers");
    case "specialChars":
      return t("passwordStrength.specialChars", { chars: params?.chars ?? "" });
    case "history":
      return t("passwordStrength.history", { depth: params?.depth ?? 0 });
  }
}
