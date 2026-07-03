/**
 * Abstract base class for git repository file-listing adapters.
 * Used for fetching repository file trees for AI context assembly.
 * Does NOT extend BaseAdapter (which is for issue tracking, not git file fetching).
 */

import {
  assertSsrfSafeResolved,
  createPinnedDispatcher,
  isSsrfSafe,
} from "~/utils/ssrf";
import { getAllowedPrivateHosts } from "~/lib/utils/ssrf";

/** fetch() RequestInit plus undici's `dispatcher` (absent from the DOM types). */
type FetchInit = RequestInit & { dispatcher?: unknown };

export interface RepoFileEntry {
  path: string;
  size: number; // bytes; 0 if provider doesn't return size
  type: "file";
}

export interface TestConnectionResult {
  success: boolean;
  error?: string;
  defaultBranch?: string;
}

export interface ListFilesResult {
  files: RepoFileEntry[];
  truncated?: boolean; // true if provider returned incomplete results (GitHub limit)
}

export abstract class GitRepoAdapter {
  protected rateLimitDelay: number = 500; // ms between requests (baseline)
  protected lastRequestTime: number = 0;
  protected maxRetries: number = 3;
  protected retryDelay: number = 1000;
  protected requestTimeout: number = 30000; // 30 seconds
  // Longest a single request will block waiting out a rate-limit window before
  // giving up. Brief/secondary limits (short reset) are absorbed transparently;
  // primary limits (reset minutes away) fail fast with an actionable message
  // rather than hanging an interactive request for minutes.
  protected maxRateLimitWaitMs: number = 15_000;

  // Populated from response headers to drive adaptive throttling
  private rateLimitRemaining: number | null = null;
  private rateLimitResetAt: number | null = null; // Unix seconds

  /**
   * Optional hook fired just before sleeping to wait out a rate limit. Lets a
   * caller (e.g. the preview SSE stream) surface "retrying in Ns" progress to
   * the user instead of leaving them on a silent spinner.
   */
  onRateLimitWait?: (waitSeconds: number, attempt: number) => void;

  /**
   * Seconds until the rate-limit window resets (from server headers).
   * Returns 0 if unknown or already reset.
   */
  get retryAfterSeconds(): number {
    if (!this.rateLimitResetAt) return 0;
    return Math.max(0, this.rateLimitResetAt - Math.floor(Date.now() / 1000));
  }

  /**
   * List all files in the repository for a given branch.
   * Returns paths and sizes only — no file content.
   */
  abstract listAllFiles(branch: string): Promise<ListFilesResult>;

  /**
   * List files scoped to specific base paths. Falls back to full listing
   * for providers that don't support path-scoped queries.
   * @param onProgress Optional callback invoked after each API page with the running file count.
   */
  async listFilesInPaths(
    branch: string,
    _basePaths: string[],
    _onProgress?: (filesFound: number) => void,
    _maxDepthByPath?: Record<string, number>
  ): Promise<ListFilesResult> {
    // Default: ignore basePaths and list everything.
    // Subclasses (e.g. Bitbucket) override for path-scoped listing.
    return this.listAllFiles(branch);
  }

  /**
   * Get the repository's default branch name.
   */
  abstract getDefaultBranch(): Promise<string>;

  /**
   * Test the connection with the provided credentials.
   * Should make a minimal authenticated API call.
   */
  abstract testConnection(): Promise<TestConnectionResult>;

  /**
   * Fetch raw text content of a single file at the given path and branch.
   */
  abstract getFileContent(path: string, branch: string): Promise<string>;

  /**
   * HTTP request with timeout via AbortController.
   * Throws on non-2xx status codes.
   */
  protected async makeRequest<T>(
    url: string,
    options: RequestInit = {}
  ): Promise<T> {
    await this.applyRateLimit();

    return this.executeWithRetry(async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.requestTimeout
      );
      let dispatcher: ReturnType<typeof createPinnedDispatcher> | undefined;

      try {
        const safeUrl = this.sanitizeUrl(url);
        // Resolve DNS, verify the IP is not private, and pin the connection to
        // that exact IP so fetch() cannot re-resolve to a different (private)
        // address between the check and the connect (DNS-rebinding TOCTOU).
        const pinnedIp = await assertSsrfSafeResolved(safeUrl);
        dispatcher = pinnedIp ? createPinnedDispatcher(pinnedIp) : undefined;

        const init: FetchInit = {
          ...options,
          signal: controller.signal,
          redirect: "manual", // prevent redirect-based SSRF bypass
        };
        if (dispatcher) init.dispatcher = dispatcher;
        const response = await fetch(safeUrl, init);

        // If the server redirects, validate the target before following
        if (response.status >= 300 && response.status < 400) {
          return this.followSafeRedirect<T>(
            response,
            options,
            controller.signal,
            "json"
          );
        }

        // Track rate limit state from response headers for adaptive throttling
        this.trackRateLimitHeaders(response);
        const remaining = response.headers.get("X-RateLimit-Remaining");
        const reset = response.headers.get("X-RateLimit-Reset");
        const retryAfter = response.headers.get("Retry-After");

        if (!response.ok) {
          // Handle rate limiting: 429 is always a rate limit; 403 with
          // exhausted quota is also treated as one.
          const isRateLimited =
            response.status === 429 ||
            (response.status === 403 &&
              (remaining === "0" || retryAfter !== null));

          if (isRateLimited) {
            // Force adaptive throttling to pause until the window resets
            this.rateLimitRemaining = 0;
            if (!this.rateLimitResetAt) {
              // No reset header — default to 60s from now
              this.rateLimitResetAt = Math.floor(Date.now() / 1000) + 60;
            }

            let suffix = "";
            if (retryAfter) {
              const secs = parseInt(retryAfter);
              suffix =
                secs >= 60
                  ? ` Try again in ${Math.ceil(secs / 60)} minute${Math.ceil(secs / 60) !== 1 ? "s" : ""}.`
                  : ` Try again in ${secs} seconds.`;
            } else if (reset) {
              const resetDate = new Date(parseInt(reset) * 1000);
              const minutesLeft = Math.ceil(
                (resetDate.getTime() - Date.now()) / 60_000
              );
              suffix =
                minutesLeft > 0
                  ? ` Try again in ${minutesLeft} minute${minutesLeft !== 1 ? "s" : ""}.`
                  : ` Try again shortly.`;
            } else {
              suffix = " Try again in a few minutes.";
            }
            throw new Error(`Rate limit exceeded.${suffix}`);
          }
          const errorText = await response.text().catch(() => "");
          throw new Error(
            `HTTP ${response.status} ${response.statusText}: ${errorText.slice(0, 200)}`
          );
        }

        // Read as text and parse ourselves so a non-JSON body (e.g. a path that
        // resolves to a file instead of a directory listing) surfaces a clear,
        // actionable error rather than a raw JSON.parse SyntaxError.
        const rawBody = await response.text();
        try {
          return JSON.parse(rawBody) as T;
        } catch {
          const contentType = response.headers.get("content-type") ?? "";
          const preview = rawBody.trim().slice(0, 80);
          throw new Error(
            `Expected a JSON response but received non-JSON content` +
              (contentType ? ` (content-type: ${contentType})` : "") +
              `. This usually means the requested path points to a file ` +
              `rather than a directory listing.` +
              (preview
                ? ` Response began with: ${JSON.stringify(preview)}`
                : "")
          );
        }
      } finally {
        clearTimeout(timeoutId);
        // Release the pinned connection pool. Fire-and-forget: undici keeps an
        // in-flight response alive until its body has been read.
        dispatcher?.close().catch(() => {});
      }
    });
  }

  /**
   * Same as makeRequest but returns plain text instead of JSON.
   * Shares the same rate-limit header parsing and retry logic.
   */
  protected async makeTextRequest(
    url: string,
    options: RequestInit = {}
  ): Promise<string> {
    await this.applyRateLimit();

    return this.executeWithRetry(async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.requestTimeout
      );
      let dispatcher: ReturnType<typeof createPinnedDispatcher> | undefined;

      try {
        const safeUrl = this.sanitizeUrl(url);
        // Validate + pin the connection to the resolved IP (DNS-rebinding guard).
        const pinnedIp = await assertSsrfSafeResolved(safeUrl);
        dispatcher = pinnedIp ? createPinnedDispatcher(pinnedIp) : undefined;

        const init: FetchInit = {
          ...options,
          signal: controller.signal,
          redirect: "manual",
        };
        if (dispatcher) init.dispatcher = dispatcher;
        const response = await fetch(safeUrl, init);

        if (response.status >= 300 && response.status < 400) {
          return this.followSafeRedirect<string>(
            response,
            options,
            controller.signal,
            "text"
          );
        }

        // Track rate limit state from response headers
        this.trackRateLimitHeaders(response);
        const remaining = response.headers.get("X-RateLimit-Remaining");
        const retryAfter = response.headers.get("Retry-After");

        if (!response.ok) {
          const isRateLimited =
            response.status === 429 ||
            (response.status === 403 &&
              (remaining === "0" || retryAfter !== null));

          if (isRateLimited) {
            this.rateLimitRemaining = 0;
            if (!this.rateLimitResetAt) {
              this.rateLimitResetAt = Math.floor(Date.now() / 1000) + 60;
            }
            throw new Error(`Rate limit exceeded.`);
          }
          const errorText = await response.text().catch(() => "");
          throw new Error(
            `HTTP ${response.status} ${response.statusText}: ${errorText.slice(0, 200)}`
          );
        }

        return await response.text();
      } finally {
        clearTimeout(timeoutId);
        // Release the pinned connection pool. Fire-and-forget: undici keeps an
        // in-flight response alive until its body has been read.
        dispatcher?.close().catch(() => {});
      }
    });
  }

  /**
   * Validate a URL is safe for server-side requests (blocks private/internal addresses).
   * Returns the parsed+normalized URL so callers use the validated value for
   * fetch — this breaks the taint chain for static analysis (CodeQL).
   */
  protected sanitizeUrl(url: string): string {
    const parsed = new URL(url);
    if (!isSsrfSafe(parsed.href)) {
      // Check operator-level allowlist for self-hosted providers (Gitea, etc.)
      const allowedPrivateHosts = getAllowedPrivateHosts();

      if (!allowedPrivateHosts.has(parsed.hostname.toLowerCase())) {
        throw new Error(
          `Request blocked: URL targets a private or internal address. ` +
            `To allow this, add "${parsed.hostname}" to the ALLOWED_PRIVATE_HOSTS environment variable.`
        );
      }
    }
    // new URL() adds a trailing slash to origin-only URLs (e.g. "https://gitlab.com"
    // becomes "https://gitlab.com/"). Preserve the original's trailing-slash behavior
    // so base URLs don't produce double-slashes during path concatenation.
    let result = parsed.href;
    if (!url.endsWith("/") && result.endsWith("/")) {
      result = result.slice(0, -1);
    }
    return result;
  }

  /**
   * Follow a single redirect after validating the Location URL against SSRF rules.
   * Only one hop is allowed — a second redirect throws.
   */
  private async followSafeRedirect<T>(
    response: Response,
    options: RequestInit,
    signal: AbortSignal,
    mode: "json" | "text"
  ): Promise<T> {
    const location = response.headers.get("Location");
    if (!location) {
      throw new Error(`Redirect (${response.status}) with no Location header`);
    }

    // Resolve relative redirects against the original request URL
    const redirectUrl = this.sanitizeUrl(new URL(location, response.url).href);
    const pinnedIp = await assertSsrfSafeResolved(redirectUrl);
    const dispatcher = pinnedIp ? createPinnedDispatcher(pinnedIp) : undefined;

    try {
      const init: FetchInit = {
        ...options,
        signal,
        redirect: "error", // no further redirects
      };
      if (dispatcher) init.dispatcher = dispatcher;
      const redirectResponse = await fetch(redirectUrl, init);

      this.trackRateLimitHeaders(redirectResponse);

      if (!redirectResponse.ok) {
        const errorText = await redirectResponse.text().catch(() => "");
        throw new Error(
          `HTTP ${redirectResponse.status} ${redirectResponse.statusText}: ${errorText.slice(0, 200)}`
        );
      }

      return mode === "json"
        ? ((await redirectResponse.json()) as T)
        : ((await redirectResponse.text()) as T);
    } finally {
      dispatcher?.close().catch(() => {});
    }
  }

  /**
   * Extract rate-limit headers from a response and update internal state.
   */
  private trackRateLimitHeaders(response: Response): void {
    const remaining = response.headers.get("X-RateLimit-Remaining");
    const reset = response.headers.get("X-RateLimit-Reset");
    const retryAfter = response.headers.get("Retry-After");
    if (remaining !== null) this.rateLimitRemaining = parseInt(remaining);
    if (reset !== null) this.rateLimitResetAt = parseInt(reset);
    if (retryAfter !== null)
      this.rateLimitResetAt =
        Math.floor(Date.now() / 1000) + parseInt(retryAfter);
  }

  protected async applyRateLimit(): Promise<void> {
    const now = Date.now();

    // Exponential backoff as remaining budget shrinks.
    // Thresholds double the delay at each step so we naturally slow to a crawl
    // before exhausting the quota rather than slamming the wall at 0.
    let delay = this.rateLimitDelay;
    if (this.rateLimitRemaining !== null) {
      if (this.rateLimitRemaining < 10) {
        // Nearly exhausted — wait until the window resets, but never block
        // longer than maxRateLimitWaitMs. If the reset is further out than
        // that, let the request proceed and surface a fast rate-limit error
        // (handled by executeWithRetry) instead of hanging for minutes.
        const waitMs = this.rateLimitResetAt
          ? this.rateLimitResetAt * 1000 - now
          : 30_000;
        delay = Math.max(
          delay,
          Math.min(waitMs > 0 ? waitMs : 0, this.maxRateLimitWaitMs)
        );
      } else if (this.rateLimitRemaining < 50) {
        delay = Math.max(delay, 8_000);
      } else if (this.rateLimitRemaining < 100) {
        delay = Math.max(delay, 4_000);
      } else if (this.rateLimitRemaining < 200) {
        delay = Math.max(delay, 2_000);
      } else if (this.rateLimitRemaining < 500) {
        delay = Math.max(delay, 1_000);
      }
    }

    const elapsed = now - this.lastRequestTime;
    if (elapsed < delay) {
      await new Promise((r) => setTimeout(r, delay - elapsed));
    }
    this.lastRequestTime = Date.now();
  }

  protected async executeWithRetry<T>(
    fn: () => Promise<T>,
    retriesLeft: number = this.maxRetries,
    attempt: number = 0
  ): Promise<T> {
    try {
      return await fn();
    } catch (err: any) {
      if (retriesLeft <= 0) throw err;
      // Don't retry client errors (4xx) except rate limits
      const isRateLimit = err.message?.includes("Rate limit exceeded");
      if (
        !isRateLimit &&
        err.message?.includes("HTTP 4") &&
        !err.message?.includes("HTTP 429")
      ) {
        throw err;
      }

      let backoff: number;
      if (isRateLimit) {
        // Honor the server's reset window (parsed from Retry-After /
        // X-RateLimit-Reset). The plain exponential backoff is far too short
        // for a real rate limit — retrying after a few seconds just hits the
        // wall again. If the window is further out than we're willing to block
        // this request, don't burn retries: let the actionable "try again in N
        // minutes" error propagate now.
        const resetMs = this.retryAfterSeconds * 1000;
        if (resetMs > this.maxRateLimitWaitMs) throw err;
        backoff = Math.max(resetMs, this.retryDelay * Math.pow(2, attempt));
        this.onRateLimitWait?.(Math.ceil(backoff / 1000), attempt);
      } else {
        backoff = this.retryDelay * Math.pow(2, attempt);
      }
      // Small additive jitter so batched retries don't fire in lockstep
      backoff += Math.floor(Math.random() * 250);
      await new Promise((r) => setTimeout(r, backoff));
      return this.executeWithRetry(fn, retriesLeft - 1, attempt + 1);
    }
  }
}

/**
 * Factory: instantiate the correct GitRepoAdapter for a given provider.
 * credentials and settings shapes match the CodeRepository DB record.
 */
export function createGitRepoAdapter(
  provider: string,
  credentials: Record<string, string>,
  settings: Record<string, string> | null | undefined
): GitRepoAdapter {
  // Import lazily to avoid circular deps — dynamic requires are fine in Node.js/Next.js API routes
  switch (provider) {
    case "GITHUB": {
      const { GitHubRepoAdapter } = require("./GitHubRepoAdapter");
      return new GitHubRepoAdapter(credentials, settings);
    }
    case "GITLAB": {
      const { GitLabRepoAdapter } = require("./GitLabRepoAdapter");
      return new GitLabRepoAdapter(credentials, settings);
    }
    case "BITBUCKET": {
      const { BitbucketRepoAdapter } = require("./BitbucketRepoAdapter");
      return new BitbucketRepoAdapter(credentials, settings);
    }
    case "AZURE_DEVOPS": {
      const { AzureDevOpsRepoAdapter } = require("./AzureDevOpsRepoAdapter");
      return new AzureDevOpsRepoAdapter(credentials, settings);
    }
    case "GITEA": {
      const { GiteaRepoAdapter } = require("./GiteaRepoAdapter");
      return new GiteaRepoAdapter(credentials, settings);
    }
    default:
      throw new Error(`Unknown git provider: ${provider}`);
  }
}
