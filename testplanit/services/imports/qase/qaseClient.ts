import * as dns from "node:dns/promises";
import {
  getAllowedPrivateHosts,
  isPrivateOrInternalIp,
} from "~/lib/utils/ssrf";

export const QASE_DEFAULT_API_HOST = "api.qase.io";
export const QASE_PAGE_SIZE = 100;

const MAX_ATTEMPTS = 5;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRY_WAIT_MS = 60_000;

export type QaseErrorCode =
  | "invalid_host"
  | "unauthorized"
  | "not_found"
  | "rate_limited"
  | "request_failed"
  | "bad_response";

export class QaseApiError extends Error {
  constructor(
    public readonly code: QaseErrorCode,
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = "QaseApiError";
  }
}

export interface QaseClientOptions {
  token: string;
  host?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  lookup?: (hostname: string) => Promise<string[]>;
}

export interface QasePage<T> {
  total: number;
  entities: T[];
}

type QueryValue = string | number | undefined;

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const defaultLookup = async (hostname: string) =>
  (await dns.lookup(hostname, { all: true })).map((entry) => entry.address);

/**
 * Accepts a bare host ("api.qase.io") or an https URL and returns the host,
 * with its port when one was given.
 */
export function normalizeQaseHost(input?: string | null): string {
  const raw = (input ?? "").trim();
  if (!raw) {
    return QASE_DEFAULT_API_HOST;
  }
  let url: URL;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    throw new QaseApiError("invalid_host", "The Qase API host is not valid.");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new QaseApiError(
      "invalid_host",
      "The Qase API host must be an https address without credentials."
    );
  }
  return url.host;
}

/**
 * Remaining requests and seconds until reset for the tightest policy in a
 * `RateLimit` header such as `"rpm";r=596;t=36, "burst";r=99;t=1`.
 */
export function parseRateLimit(
  header: string | null
): { remaining: number; resetSeconds: number } | null {
  if (!header) {
    return null;
  }
  let tightest: { remaining: number; resetSeconds: number } | null = null;
  for (const policy of header.split(",")) {
    const remaining = /;\s*r=(\d+)/.exec(policy);
    const reset = /;\s*t=(\d+)/.exec(policy);
    if (!remaining || !reset) {
      continue;
    }
    const entry = {
      remaining: Number(remaining[1]),
      resetSeconds: Number(reset[1]),
    };
    if (!tightest || entry.remaining < tightest.remaining) {
      tightest = entry;
    }
  }
  return tightest;
}

export class QaseClient {
  readonly host: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly lookup: (hostname: string) => Promise<string[]>;
  private hostChecked = false;
  private waitBeforeNextMs = 0;

  constructor(options: QaseClientOptions) {
    this.host = normalizeQaseHost(options.host);
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.lookup = options.lookup ?? defaultLookup;
  }

  private async assertHostAllowed(): Promise<void> {
    if (this.hostChecked) {
      return;
    }
    const hostname = new URL(`https://${this.host}`).hostname;
    if (!getAllowedPrivateHosts().has(hostname.toLowerCase())) {
      let addresses: string[];
      try {
        addresses = await this.lookup(hostname);
      } catch {
        throw new QaseApiError(
          "invalid_host",
          "The Qase API host could not be resolved."
        );
      }
      if (addresses.length === 0 || addresses.some(isPrivateOrInternalIp)) {
        throw new QaseApiError(
          "invalid_host",
          "The Qase API host resolves to a private or internal address."
        );
      }
    }
    this.hostChecked = true;
  }

  /** GET a v1 path and return its `result`. Retries rate limits and 5xx. */
  async get<T>(
    path: string,
    query: Record<string, QueryValue> = {}
  ): Promise<T> {
    await this.assertHostAllowed();

    const url = new URL(`https://${this.host}/v1/${path.replace(/^\//, "")}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    let lastError: QaseApiError | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (this.waitBeforeNextMs > 0) {
        const wait = this.waitBeforeNextMs;
        this.waitBeforeNextMs = 0;
        await this.sleep(wait);
      }

      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          headers: { Token: this.token, Accept: "application/json" },
          redirect: "error",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        lastError = new QaseApiError(
          "request_failed",
          `Qase could not be reached: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        this.waitBeforeNextMs = Math.min(
          1000 * 2 ** attempt,
          MAX_RETRY_WAIT_MS
        );
        continue;
      }

      const limit = parseRateLimit(response.headers.get("ratelimit"));
      if (limit && limit.remaining <= 1) {
        this.waitBeforeNextMs = Math.min(
          (limit.resetSeconds + 1) * 1000,
          MAX_RETRY_WAIT_MS
        );
      }

      if (response.status === 429) {
        const retryAfter = Number(response.headers.get("retry-after"));
        this.waitBeforeNextMs = Math.min(
          (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 10) *
            1000,
          MAX_RETRY_WAIT_MS
        );
        lastError = new QaseApiError(
          "rate_limited",
          "Qase's rate limit was reached.",
          429
        );
        continue;
      }

      if (response.status >= 500) {
        lastError = new QaseApiError(
          "request_failed",
          `Qase answered with status ${response.status}.`,
          response.status
        );
        this.waitBeforeNextMs = Math.min(
          1000 * 2 ** attempt,
          MAX_RETRY_WAIT_MS
        );
        continue;
      }

      if (response.status === 401 || response.status === 403) {
        throw new QaseApiError(
          "unauthorized",
          "Qase rejected the API token.",
          response.status
        );
      }
      if (response.status === 404) {
        throw new QaseApiError("not_found", "Qase did not find it.", 404);
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new QaseApiError(
          "bad_response",
          "Qase sent a response that is not JSON.",
          response.status
        );
      }
      const envelope = body as { status?: boolean; result?: T } | null;
      if (!response.ok || !envelope || envelope.status !== true) {
        throw new QaseApiError(
          "bad_response",
          `Qase answered with status ${response.status}.`,
          response.status
        );
      }
      return envelope.result as T;
    }

    throw (
      lastError ??
      new QaseApiError("request_failed", "The request to Qase failed.")
    );
  }

  /** Every page of a list endpoint, 100 records at a time. */
  async *pages<T>(
    path: string,
    query: Record<string, QueryValue> = {}
  ): AsyncGenerator<QasePage<T>> {
    let offset = 0;
    for (;;) {
      const result = await this.get<{
        total?: number;
        filtered?: number;
        entities?: T[];
      }>(path, { ...query, limit: QASE_PAGE_SIZE, offset });
      const entities = Array.isArray(result?.entities) ? result.entities : [];
      const total = result?.filtered ?? result?.total ?? entities.length;
      yield { total, entities };
      offset += entities.length;
      if (entities.length < QASE_PAGE_SIZE || offset >= total) {
        return;
      }
    }
  }
}
