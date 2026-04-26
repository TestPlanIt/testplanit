/**
 * Webhook token redaction (D-08).
 *
 * Tokens have shape `whk_<hex>` (32 random bytes → 64 hex chars). The prefix
 * plus the first 8 hex chars are retained for log correlation; the remaining
 * tail is replaced with the literal `…[redacted]`. Both helpers are pure and
 * synchronous so they can be wrapped around any console.* argument without
 * altering control flow.
 *
 * Phase 1 ships with redacted `console.*` because the codebase has no
 * structured logger today; promotion to a Pino redaction config is a captured
 * follow-up rather than a Phase 1 blocker.
 */

const TOKEN_PREFIX = "whk_";
const PREFIX_KEEP = 8; // hex chars retained after the prefix
const REDACTED = "…[redacted]";

/** Redact a bare token string. Returns input unchanged if not a `whk_` token. */
export function redactToken(input: string | null | undefined): string {
  if (!input) return "";
  if (!input.startsWith(TOKEN_PREFIX)) return input;
  const tail = input.slice(TOKEN_PREFIX.length);
  if (tail.length <= PREFIX_KEEP) {
    return `${TOKEN_PREFIX}${REDACTED}`;
  }
  return `${TOKEN_PREFIX}${tail.slice(0, PREFIX_KEEP)}${REDACTED}`;
}

/** Redact any `whk_<hex>` token segment inside an arbitrary string (URL, log line, …). */
export function redactWebhookUrl(input: string | null | undefined): string {
  if (!input) return "";
  return input.replace(/whk_[0-9a-f]+/gi, (match) => redactToken(match));
}
