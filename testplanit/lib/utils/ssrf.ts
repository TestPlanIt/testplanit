/**
 * SSRF-safe fetch utility.
 *
 * Protects against Server-Side Request Forgery (SSRF) attacks by:
 * 1. Blocking non-HTTP(S) protocols
 * 2. Resolving DNS and validating the resolved IP against private/internal ranges
 * 3. Pinning the TCP connection to the pre-resolved IP (prevents DNS rebinding)
 * 4. Validating each redirect destination with the same rules
 * 5. Enforcing Content-Type restrictions (only text/html allowed)
 * 6. Enforcing a streaming 5MB size cap
 */

import * as dns from "node:dns/promises";
import * as https from "node:https";
import * as http from "node:http";

// ─── Constants ──────────────────────────────────────────────────────────────

/** Maximum allowed response body size (5MB). */
export const MAX_PAGE_BYTES = 5 * 1024 * 1024;

/** Per-request fetch timeout in milliseconds (10 seconds). */
export const FETCH_TIMEOUT_MS = 10_000;

/** Maximum number of HTTP redirects to follow. */
export const MAX_REDIRECTS = 5;

// ─── Error Class ─────────────────────────────────────────────────────────────

/**
 * Thrown when ssrfSafeFetch detects a potential SSRF attack or policy violation.
 */
export class SsrfError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "PROTOCOL_NOT_ALLOWED"
      | "PRIVATE_IP"
      | "DNS_RESOLUTION_FAILED"
      | "INVALID_CONTENT_TYPE"
      | "CONTENT_TOO_LARGE"
      | "REDIRECT_PRIVATE_IP"
      | "TOO_MANY_REDIRECTS"
      | "FETCH_FAILED"
  ) {
    super(message);
    this.name = "SsrfError";
  }
}

// ─── IP Validation ────────────────────────────────────────────────────────────

/**
 * Returns true if the given IP address is in a private, loopback, link-local,
 * or cloud-metadata range that should never be reached from the public internet.
 *
 * Accepts both IPv4 and IPv6 addresses (as strings). Does NOT accept hostnames —
 * always resolve DNS first and pass the resolved IP address.
 */
export function isPrivateOrInternalIp(ip: string): boolean {
  const lower = ip.toLowerCase();

  // IPv4 exact matches
  if (lower === "127.0.0.1" || lower === "0.0.0.0") {
    return true;
  }

  // IPv6 loopback and link-local
  if (lower === "::1" || lower === "[::1]") {
    return true;
  }

  // IPv6 link-local (fe80::/10)
  if (lower.startsWith("fe80:")) {
    return true;
  }

  // IPv6 Unique Local Addresses (fc00::/7 covers both fc00:: and fd00::)
  if (lower.startsWith("fc") || lower.startsWith("fd")) {
    return true;
  }

  // Cloud metadata and internal DNS names
  if (
    lower === "169.254.169.254" ||
    lower === "metadata.google.internal" ||
    lower.endsWith(".internal")
  ) {
    return true;
  }

  // Private IPv4 ranges (RFC 1918 + loopback + link-local)
  const privatePatterns = [
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
    /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/,
    /^192\.168\.\d{1,3}\.\d{1,3}$/,
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
    /^169\.254\.\d{1,3}\.\d{1,3}$/,
  ];

  for (const pattern of privatePatterns) {
    if (pattern.test(lower)) {
      return true;
    }
  }

  return false;
}

// ─── SSRF-Safe Fetch ─────────────────────────────────────────────────────────

interface SsrfFetchOptions {
  /** Allow HTTP (in addition to HTTPS). Default: false. */
  allowHttp?: boolean;
  /** Maximum response body size in bytes. Default: MAX_PAGE_BYTES (5MB). */
  maxBytes?: number;
  /** Request timeout in milliseconds. Default: FETCH_TIMEOUT_MS (10s). */
  timeoutMs?: number;
}

interface SsrfFetchResult {
  /** Decoded response body text. */
  body: string;
  /** Final URL after any redirects. */
  finalUrl: string;
  /** Content-Type header value from the final response. */
  contentType: string;
}

/**
 * Resolves the hostname and validates the IP is not private/internal.
 * Returns the resolved IP address string.
 */
async function resolveAndValidate(
  hostname: string,
  errorCodeForPrivate: "PRIVATE_IP" | "REDIRECT_PRIVATE_IP"
): Promise<string> {
  let address: string;
  try {
    const result = await dns.lookup(hostname);
    address = result.address;
  } catch (err) {
    throw new SsrfError(
      `DNS resolution failed for ${hostname}: ${err instanceof Error ? err.message : String(err)}`,
      "DNS_RESOLUTION_FAILED"
    );
  }

  if (isPrivateOrInternalIp(address)) {
    throw new SsrfError(
      `Resolved IP ${address} for host ${hostname} is in a private/internal range`,
      errorCodeForPrivate
    );
  }

  return address;
}

/**
 * Creates a custom HTTP(S) Agent that pins the outgoing connection to a
 * specific pre-resolved IP address, bypassing any further DNS lookups.
 * This prevents DNS rebinding attacks.
 */
function createPinnedAgent(
  protocol: "https:" | "http:",
  resolvedIp: string
): https.Agent | http.Agent {
  // Node's Agent calls lookup as: lookup(hostname, options, callback)
  // In Node 24, the default options include { all: true }, which means the
  // callback expects (err, results[]) not (err, address, family). We must
  // detect this and respond with the correct shape.
  const lookup = (
    _hostname: string,
    options: Record<string, unknown>,
    cb: (...args: unknown[]) => void
  ) => {
    if (options && options.all) {
      // Node expects: cb(null, [{address, family}, ...])
      cb(null, [{ address: resolvedIp, family: 4 }]);
    } else {
      // Node expects: cb(null, address, family)
      cb(null, resolvedIp, 4);
    }
  };

  const agentOpts = { lookup } as Record<string, unknown>;
  if (protocol === "https:") {
    return new https.Agent(agentOpts as https.AgentOptions);
  }
  return new http.Agent(agentOpts as http.AgentOptions);
}

/**
 * Performs a single HTTP(S) request using Node.js http/https modules with a
 * pre-pinned agent. Does NOT follow redirects automatically.
 *
 * Uses http.request/https.request (NOT global fetch) because these natively
 * support the `agent` option. The custom Agent's `lookup` callback returns the
 * pre-resolved IP, ensuring the TCP connection is made to the validated address.
 * This prevents DNS rebinding attacks where an attacker could change a hostname's
 * DNS record between our validation and the actual connection.
 */
async function fetchWithPinnedAgent(
  urlString: string,
  resolvedIp: string,
  protocol: "https:" | "http:",
  timeoutMs: number
): Promise<Response> {
  const agent = createPinnedAgent(protocol, resolvedIp);
  const url = new URL(urlString);

  return new Promise<Response>((resolve, reject) => {
    const requestFn = protocol === "https:" ? https.request : http.request;

    const req = requestFn(
      url,
      {
        agent,
        timeout: timeoutMs,
        headers: {
          "User-Agent": "TestPlanIt/1.0",
          Accept: "text/html, */*",
        },
      },
      (res) => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(res.headers)) {
          if (value) {
            headers.set(key, Array.isArray(value) ? value.join(", ") : value);
          }
        }

        const readable = new ReadableStream<Uint8Array>({
          start(controller) {
            res.on("data", (chunk: Buffer) => {
              controller.enqueue(new Uint8Array(chunk));
            });
            res.on("end", () => {
              controller.close();
            });
            res.on("error", (err) => {
              controller.error(err);
            });
          },
        });

        resolve(
          new Response(readable, {
            status: res.statusCode ?? 200,
            statusText: res.statusMessage ?? "",
            headers,
          })
        );
      }
    );

    req.on("error", (err) => {
      reject(
        new SsrfError(
          `Fetch failed for ${urlString}: ${err.message}`,
          "FETCH_FAILED"
        )
      );
    });

    req.on("timeout", () => {
      req.destroy();
      reject(
        new SsrfError(
          `Request timed out after ${timeoutMs}ms for ${urlString}`,
          "FETCH_FAILED"
        )
      );
    });

    req.end();
  });
}

/**
 * Reads the response body as a stream with a size cap.
 * Uses getReader() to read incrementally — never buffers the full body.
 */
async function readBodyWithSizeCap(
  response: Response,
  maxBytes: number
): Promise<string> {
  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        reader.cancel().catch(() => {
          // ignore cancellation errors
        });
        throw new SsrfError(
          `Response body exceeds maximum allowed size of ${maxBytes} bytes`,
          "CONTENT_TOO_LARGE"
        );
      }
      chunks.push(value);
    }
  } finally {
    // Ensure reader is released even on error
    try {
      reader.releaseLock();
    } catch {
      // already released
    }
  }

  // Merge all chunks
  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(merged);
}

/**
 * Fetches the given URL safely, validating against SSRF attack vectors.
 *
 * Security guarantees:
 * - Only HTTPS URLs are allowed by default (HTTP requires `allowHttp: true`)
 * - file://, ftp://, and all other non-HTTP(S) protocols are blocked
 * - The hostname is DNS-resolved and the IP is validated against private/internal ranges
 * - TCP connections are pinned to the pre-resolved IP (DNS rebinding prevention)
 * - Every redirect destination is re-validated with the same rules
 * - Only text/html Content-Type responses are accepted
 * - Response body is capped at 5MB via streaming read
 *
 * @param urlString  The URL to fetch
 * @param options    Optional configuration overrides
 * @returns          { body, finalUrl, contentType } on success
 * @throws           SsrfError for any security policy violation
 */
export async function ssrfSafeFetch(
  urlString: string,
  options: SsrfFetchOptions = {}
): Promise<SsrfFetchResult> {
  const { allowHttp = false, maxBytes = MAX_PAGE_BYTES, timeoutMs = FETCH_TIMEOUT_MS } =
    options;

  let currentUrl = urlString;
  let redirectsRemaining = MAX_REDIRECTS;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    // a. Parse the URL
    let url: URL;
    try {
      url = new URL(currentUrl);
    } catch {
      throw new SsrfError(
        `Invalid URL: ${currentUrl}`,
        "PROTOCOL_NOT_ALLOWED"
      );
    }

    // b. Validate protocol
    const protocol = url.protocol;
    if (protocol !== "https:" && !(allowHttp && protocol === "http:")) {
      throw new SsrfError(
        `Protocol "${protocol}" is not allowed. Only HTTPS${allowHttp ? " and HTTP" : ""} are permitted.`,
        "PROTOCOL_NOT_ALLOWED"
      );
    }

    // c. DNS resolve and validate the IP
    // Use PRIVATE_IP for the first request, REDIRECT_PRIVATE_IP for redirects
    const isRedirect = currentUrl !== urlString;
    const resolvedIp = await resolveAndValidate(
      url.hostname,
      isRedirect ? "REDIRECT_PRIVATE_IP" : "PRIVATE_IP"
    );

    // d. Make the request with the pinned IP agent
    const response = await fetchWithPinnedAgent(
      currentUrl,
      resolvedIp,
      protocol as "https:" | "http:",
      timeoutMs
    );

    // e. Handle redirects manually
    if (
      response.status >= 300 &&
      response.status < 400 &&
      response.status !== 304
    ) {
      const location = response.headers.get("location");
      if (!location) {
        throw new SsrfError(
          `Redirect response (${response.status}) missing Location header`,
          "FETCH_FAILED"
        );
      }

      if (redirectsRemaining <= 0) {
        throw new SsrfError(
          `Exceeded maximum redirect limit of ${MAX_REDIRECTS}`,
          "TOO_MANY_REDIRECTS"
        );
      }

      redirectsRemaining--;

      // Resolve relative redirects against the current URL
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    // f. Check Content-Type — must be text/html
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) {
      throw new SsrfError(
        `Response Content-Type "${contentType}" is not allowed. Only text/html is accepted.`,
        "INVALID_CONTENT_TYPE"
      );
    }

    // g. Check Content-Length header early (before reading body)
    const contentLengthHeader = response.headers.get("content-length");
    if (contentLengthHeader !== null) {
      const contentLength = parseInt(contentLengthHeader, 10);
      if (!isNaN(contentLength) && contentLength > maxBytes) {
        throw new SsrfError(
          `Content-Length (${contentLength} bytes) exceeds maximum allowed size of ${maxBytes} bytes`,
          "CONTENT_TOO_LARGE"
        );
      }
    }

    // h. Read the body via streaming (enforces size cap incrementally)
    const body = await readBodyWithSizeCap(response, maxBytes);

    return {
      body,
      finalUrl: currentUrl,
      contentType,
    };
  }
}
