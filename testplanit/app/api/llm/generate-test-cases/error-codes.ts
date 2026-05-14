/**
 * Stable error codes emitted by the test-case-generation SSE stream.
 *
 * The wizard dispatches localized error UI off the `code` field. Codes
 * decouple presentation from the English `message` payload, which previously
 * had to flow through fragile substring matching to pick a category — that
 * approach broke as soon as the server-emitted text was translated.
 *
 * Categories:
 *  - LLM provider categories mirror the upstream failure modes the wizard
 *    surfaces with distinct titles/suggestions.
 *  - Route-specific codes (`project_not_found`, `no_integration`,
 *    `invalid_request`) cover errors that originate before the LLM call.
 *  - `generic` is the catch-all when classification fails.
 */
export type LlmStreamErrorCode =
  | "overloaded"
  | "quota"
  | "timeout"
  | "unauthorized"
  | "forbidden"
  | "network"
  | "generic"
  | "project_not_found"
  | "no_integration"
  | "invalid_request";

/**
 * Classify a free-form English error string from an LLM provider into a
 * stable `LlmStreamErrorCode`. Only used server-side; the wizard reads the
 * code directly. Kept as a fallback for older clients that still need to
 * categorize legacy `message`-only error events.
 */
export function classifyLlmStreamError(text: string): LlmStreamErrorCode {
  const norm = (text ?? "").toLowerCase();
  const has = (token: string): boolean => norm.includes(token.toLowerCase());

  if (has("overload") || has("busy") || has("capacity")) return "overloaded";
  if (has("quota") || has("rate limit") || (has("limit") && !has("unlimited")))
    return "quota";
  if (has("timeout") || has("timed out") || has("504")) return "timeout";
  if (
    has("401") ||
    has("unauthorized") ||
    has("invalid api key") ||
    has("invalid key")
  )
    return "unauthorized";
  if (
    has("403") ||
    has("forbidden") ||
    has("permission") ||
    has("insufficient")
  )
    return "forbidden";
  if (
    has("network") ||
    has("fetch") ||
    has("dns") ||
    has("econnreset") ||
    has("eai_again") ||
    has("socket")
  )
    return "network";

  return "generic";
}
