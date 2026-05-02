/**
 * Webhook token redaction.
 *
 * Tokens have shape `whk_<hex>` (32 random bytes → 64 hex chars). The prefix
 * plus the first 8 hex chars are retained for log correlation; the remaining
 * tail is replaced with the literal `…[redacted]`. Both helpers are pure and
 * synchronous so they can be wrapped around any console.* argument without
 * altering control flow.
 *
 * Ships with redacted `console.*` because the codebase has no structured
 * logger today; promotion to a Pino redaction config is a captured follow-up.
 */

const TOKEN_PREFIX = "whk_";
const PREFIX_KEEP = 8; // hex chars retained after the prefix
const REDACTED = "…[redacted]";
const SAFE_CHARS_RE = /[^a-zA-Z0-9_\-]/g;
const PREVIEW_MAX = 16;

/**
 * Redact a bare token string for safe console.* logging.
 *
 * Sanitizes any non-`[A-Za-z0-9_-]` characters before logging so an attacker
 * who hits `/api/webhooks/<arbitrary>` with newlines or control chars can't
 * inject fake log entries (log-injection prevention). For valid
 * `whk_<hex>` tokens, retains the prefix plus the first 8 hex chars for
 * log correlation; for any other input, returns a sanitized truncated
 * preview so the receiver can log "no active config for token" without
 * trusting the wire string verbatim.
 */
export function redactToken(input: string | null | undefined): string {
  if (!input) return "";
  const safe = input.replace(SAFE_CHARS_RE, "_");
  if (!safe.startsWith(TOKEN_PREFIX)) {
    return (
      safe.slice(0, PREVIEW_MAX) + (safe.length > PREVIEW_MAX ? REDACTED : "")
    );
  }
  const tail = safe.slice(TOKEN_PREFIX.length);
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
