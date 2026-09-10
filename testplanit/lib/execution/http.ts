import { assertSsrfSafeResolved, isSsrfSafe } from "~/utils/ssrf";
import { getAllowedPrivateHosts } from "~/lib/utils/ssrf";

/**
 * Outbound HTTP for CI dispatch. Every request is SSRF-checked twice (parse
 * time and resolved address), never follows redirects (a dispatch is a POST
 * that must not be replayed to a second host), times out, and caps the body
 * it reads. Errors carry a user-safe message and never include credentials.
 */

export const CI_HTTP_TIMEOUT_MS = 15_000;
export const CI_MAX_BODY_BYTES = 64 * 1024;

export type CiRequestErrorCode = "BLOCKED" | "TIMEOUT" | "NETWORK" | "REDIRECT";

export class CiRequestError extends Error {
  constructor(
    message: string,
    public readonly code: CiRequestErrorCode
  ) {
    super(message);
    this.name = "CiRequestError";
  }
}

export interface CiResponse {
  status: number;
  ok: boolean;
  text: string;
  headers: Headers;
  json<T = unknown>(): T | null;
}

/**
 * Validate a user-configured URL the same way the git adapters do: http(s)
 * only, no private or internal addresses unless the operator allow-listed the
 * host in ALLOWED_PRIVATE_HOSTS. Returns the normalised href.
 */
export function assertOutboundUrlAllowed(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new CiRequestError("Invalid URL", "BLOCKED");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new CiRequestError("URL must use http or https", "BLOCKED");
  }
  if (!isSsrfSafe(parsed.href)) {
    const allowed = getAllowedPrivateHosts();
    if (!allowed.has(parsed.hostname.toLowerCase())) {
      throw new CiRequestError(
        `Request blocked: "${parsed.hostname}" is a private or internal address. Add it to ALLOWED_PRIVATE_HOSTS to allow it.`,
        "BLOCKED"
      );
    }
  }
  let href = parsed.href;
  if (!url.endsWith("/") && href.endsWith("/")) href = href.slice(0, -1);
  return href;
}

async function readCapped(response: Response): Promise<string> {
  const body = response.body;
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (received < CI_MAX_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.byteLength;
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
  }
  const merged = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  return merged.subarray(0, CI_MAX_BODY_BYTES).toString("utf8");
}

export async function ciRequest(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<CiResponse> {
  const safeUrl = assertOutboundUrlAllowed(url);
  try {
    await assertSsrfSafeResolved(safeUrl);
  } catch (err) {
    throw new CiRequestError(
      err instanceof Error ? err.message : "Request blocked",
      "BLOCKED"
    );
  }

  const { timeoutMs, ...rest } = init;
  let response: Response;
  try {
    response = await fetch(safeUrl, {
      ...rest,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs ?? CI_HTTP_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new CiRequestError(
        "The provider did not respond in time",
        "TIMEOUT"
      );
    }
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new CiRequestError(
        "The provider did not respond in time",
        "TIMEOUT"
      );
    }
    throw new CiRequestError(
      `Could not reach the provider: ${err instanceof Error ? err.message : String(err)}`,
      "NETWORK"
    );
  }

  if (response.status >= 300 && response.status < 400) {
    throw new CiRequestError(
      `The provider redirected the request (HTTP ${response.status}); redirects are not followed`,
      "REDIRECT"
    );
  }

  const text = await readCapped(response);
  return {
    status: response.status,
    ok: response.ok,
    text,
    headers: response.headers,
    json<T = unknown>(): T | null {
      if (!text) return null;
      try {
        return JSON.parse(text) as T;
      } catch {
        return null;
      }
    },
  };
}
