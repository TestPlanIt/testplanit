import { TestPlanItHttpError } from "./http.js";

/**
 * MCP tool-result error envelope.
 *
 * The SDK accepts either a thrown exception (which it auto-converts) OR an
 * explicit return value with `isError: true`. We use the explicit form so
 * tool handlers control the agent-visible message verbatim — no SDK
 * stack-trace leakage and no opaque "An error occurred" wrappers.
 *
 * Reference: 05-RESEARCH.md § Don't Hand-Roll row "Tool error formatting".
 */
export interface ToolErrorResult {
  isError: true;
  content: Array<{ type: "text"; text: string }>;
  // Index signature satisfies the MCP SDK's CallToolResult contract, which
  // permits arbitrary string keys (e.g., `_meta`, future fields). Without
  // this, `registerTool`'s callback rejects our return type.
  [x: string]: unknown;
}

/**
 * Friendly translations for every known errorCode emitted by
 * `lib/api-token-auth.ts` (host side, post plan 05-01).
 *
 * The READ_ONLY_TOKEN message is the T-05-01 mitigation surface — it MUST
 * name both the scope (`mode:read`) and the human concept (`read-only`) so
 * agents can self-correct when a Phase 6+ write tool returns 403.
 */
const ERROR_CODE_MESSAGES: Record<string, string> = {
  NO_TOKEN:
    "No API token provided. Set TESTPLANIT_API_TOKEN in the environment.",
  INVALID_FORMAT:
    "API token format is invalid. Tokens must start with 'tpi_'.",
  INVALID_TOKEN:
    "API token is not recognized. Verify the token in your TestPlanIt profile.",
  EXPIRED_TOKEN:
    "API token has expired. Mint a new token in your TestPlanIt profile.",
  INACTIVE_TOKEN:
    "API token is inactive. Re-enable or replace it in your TestPlanIt profile.",
  INACTIVE_USER:
    "The user associated with this token is inactive. Contact a TestPlanIt admin.",
  API_ACCESS_DISABLED:
    "API access is disabled for this user. Contact a TestPlanIt admin.",
  READ_ONLY_TOKEN:
    "This token is read-only (mode:read scope). Create a new token without the mode:read scope to perform write operations.",
};

/**
 * Defense-in-depth scrub: redact any `tpi_<token>` substring that may have
 * leaked into an error message before we hand the text to the agent
 * (WR-03 / T-05-06b). The api.ts layer already avoids interpolating
 * env.apiToken into messages, but a future regression — or a host echoing
 * a header verbatim — would otherwise leak through `mapHttpErrorToToolResult`.
 *
 * Matches the `tpi_` prefix followed by URL-safe token characters; pasted
 * tokens, base64url-suffixed tokens, and shorter prefixes all collapse to
 * the literal string `tpi_***`.
 */
const TOKEN_PATTERN = /tpi_[A-Za-z0-9_-]+/g;

function redactTokens(text: string): string {
  return text.replace(TOKEN_PATTERN, "tpi_***");
}

/**
 * Translate any thrown error from a tool handler into the MCP tool-result
 * error envelope. Three paths:
 *
 *  1. `TestPlanItHttpError` with a known `code`: friendly template, code
 *     appended in parentheses for log-grep traceability.
 *  2. `TestPlanItHttpError` with an unknown / missing code: generic
 *     "Request failed: <message> (HTTP <status>)" fallback.
 *  3. Any other `Error`: "Network or runtime error: <message>" fallback.
 *  4. Non-Error throwable: "Unknown error".
 *
 * The friendly templates are fixed strings, NOT echoes of `err.message`,
 * so a token-bearing message accidentally constructed upstream cannot leak
 * the raw token through this layer (T-05-06 defense in depth). The fallback
 * paths DO interpolate `err.message`, so the final text is run through
 * `redactTokens` as a belt-and-suspenders scrub (WR-03).
 */
export function mapHttpErrorToToolResult(err: unknown): ToolErrorResult {
  if (err instanceof TestPlanItHttpError) {
    const code = err.code;
    const friendly = code ? ERROR_CODE_MESSAGES[code] : undefined;
    const rawText = friendly
      ? `${friendly} (${code})`
      : `Request failed: ${err.message} (HTTP ${err.statusCode ?? "unknown"})`;
    return { isError: true, content: [{ type: "text", text: redactTokens(rawText) }] };
  }
  if (err instanceof Error) {
    return {
      isError: true,
      content: [
        { type: "text", text: redactTokens(`Network or runtime error: ${err.message}`) },
      ],
    };
  }
  return {
    isError: true,
    content: [{ type: "text", text: "Unknown error" }],
  };
}
