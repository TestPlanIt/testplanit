/**
 * Resolve a server-returned error to a localized string for display in
 * the client UI.
 *
 * Server actions and API routes that produce **user-actionable**
 * validation errors (form input the user can fix — invalid email,
 * required field, etc.) return BOTH:
 *
 *   - `errorCode`: a stable, fully-qualified i18n key
 *                  (e.g. `"errors.validation.emailRequired"`).
 *   - `error`:     the legacy English message, kept as a fallback so
 *                  pre-i18n call sites and old clients still display
 *                  something readable.
 *
 * This helper looks up `errorCode` via the supplied translator and
 * falls back to `error` (or the caller-supplied default) if the
 * translation is missing or `errorCode` is absent. Pass an
 * unscoped `useTranslations()` so the full key paths resolve.
 *
 * Out of scope by project policy: diagnostic / non-actionable
 * server errors keep `error` only and surface in English. See the
 * `feedback_server_errors_stay_english` memory.
 */
// next-intl's translator narrows `key` to a generated literal-union of
// namespaced keys; server-returned `errorCode` values are dynamic strings
// the type-checker can't statically know. Accept the translator as
// `unknown`-callable here and cast at the call site to avoid forcing
// callers to pre-cast.
type TranslateFn = (key: any, params?: any) => string;

interface ServerErrorPayload {
  errorCode?: string;
  error?: string;
}

export function translateServerError(
  t: TranslateFn,
  result: ServerErrorPayload | null | undefined,
  fallback?: string
): string {
  if (!result) return fallback ?? "";
  const code = result.errorCode;
  if (code) {
    try {
      const translated = t(code);
      // next-intl returns the key when no translation exists. In that
      // case prefer the explicit English fallback over the raw key.
      if (translated && translated !== code) {
        return translated;
      }
    } catch {
      // Translator threw (missing key in strict mode) — fall through.
    }
  }
  return result.error ?? fallback ?? "";
}
