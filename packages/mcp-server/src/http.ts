import type { EnvConfig } from "./env.js";

/**
 * Response shape from `GET /api/auth/whoami` — locked in lockstep with
 * plan 05-02. Field semantics (frozen contract):
 *  - `readOnly === scopes.includes("mode:read")`
 *  - `isAgent  === scopes.includes("client:mcp")`
 */
export interface WhoamiUser {
  id: string;
  name: string | null;
  email: string;
  scopes: string[];
  readOnly: boolean;
  isAgent: boolean;
}

/**
 * Result of `validateToken()`.
 *
 * The failure variant carries `code` (upstream errorCode such as
 * `READ_ONLY_TOKEN`, `EXPIRED_TOKEN`) and `statusCode` (HTTP status) so
 * downstream tools — plan 05-07's `whoami` and Phase 6+ write tools —
 * can construct `TestPlanItHttpError` without re-parsing the message
 * string. This shape is locked at plan 05-06 and consumed directly by
 * plan 05-07; do NOT widen retroactively.
 */
export type ValidateResult =
  | { ok: true; user: WhoamiUser }
  | { ok: false; message: string; code?: string; statusCode?: number };

/**
 * Error class carrying upstream HTTP status + errorCode for tool handlers.
 * Plan 05-07 throws this from the `whoami` tool when validateToken returns
 * `ok: false` so the MCP error mapping retains the upstream codes.
 */
export class TestPlanItHttpError extends Error {
  public statusCode?: number;
  public code?: string;
  constructor(
    message: string,
    opts?: { statusCode?: number; code?: string },
  ) {
    super(message);
    this.name = "TestPlanItHttpError";
    this.statusCode = opts?.statusCode;
    this.code = opts?.code;
  }
}

/**
 * Returns at most the `tpi_xxxx`-style 8-character prefix of the token for
 * safe diagnostics. Never returns the full token. T-05-06 mitigation.
 */
export function redactToken(token: string): string {
  return token.slice(0, 8) + "...";
}

const TIMEOUT_MS = 10000;

/**
 * Probe `GET /api/auth/whoami` with the configured Bearer token.
 *
 * Returns `{ ok: true, user }` on a 200 response with a valid JSON body.
 * Returns `{ ok: false, message, code?, statusCode? }` on any non-2xx,
 * unparseable body, or transport failure. The error message NEVER contains
 * the raw token — only the redacted prefix appears (T-05-06).
 */
export async function validateToken(
  env: EnvConfig,
): Promise<ValidateResult> {
  let response: Response;
  try {
    const url = new URL("/api/auth/whoami", env.apiUrl);
    response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${env.apiToken}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      message: `Network error contacting ${env.apiUrl}: ${message}`,
      // code + statusCode intentionally undefined — transport failure, not HTTP.
    };
  }

  const body = await response.text();

  if (!response.ok) {
    let code: string | undefined;
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed.code === "string") {
        code = parsed.code;
      }
    } catch {
      // Body is not JSON — code stays undefined.
    }
    return {
      ok: false,
      message: `HTTP ${response.status}${code ? ` (${code})` : ""}: token ${redactToken(env.apiToken)} rejected`,
      code,
      statusCode: response.status,
    };
  }

  try {
    const user = JSON.parse(body) as WhoamiUser;
    return { ok: true, user };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      message: `Failed to parse whoami response from ${env.apiUrl}: ${message}`,
    };
  }
}
