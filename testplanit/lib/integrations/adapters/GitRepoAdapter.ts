/**
 * Abstract base class for git repository file-listing adapters.
 * Used for fetching repository file trees for AI context assembly.
 * Does NOT extend BaseAdapter (which is for issue tracking, not git file fetching).
 */

import { isSsrfSafe } from "~/utils/ssrf";

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

  // Populated from response headers to drive adaptive throttling
  private rateLimitRemaining: number | null = null;
  private rateLimitResetAt: number | null = null; // Unix seconds

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
    basePaths: string[],
    onProgress?: (filesFound: number) => void
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

      try {
        const safeUrl = this.sanitizeUrl(url);

        const response = await fetch(safeUrl, {
          ...options,
          signal: controller.signal,
        });

        // Track rate limit state from response headers for adaptive throttling
        const remaining = response.headers.get("X-RateLimit-Remaining");
        const reset = response.headers.get("X-RateLimit-Reset");
        const retryAfter = response.headers.get("Retry-After");
        if (remaining !== null) this.rateLimitRemaining = parseInt(remaining);
        if (reset !== null) this.rateLimitResetAt = parseInt(reset);
        // Retry-After (secondary rate limits) overrides the reset time
        if (retryAfter !== null)
          this.rateLimitResetAt = Math.floor(Date.now() / 1000) + parseInt(retryAfter);

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
              this.rateLimitResetAt =
                Math.floor(Date.now() / 1000) + 60;
            }

            let suffix = "";
            if (retryAfter) {
              const secs = parseInt(retryAfter);
              suffix = secs >= 60
                ? ` Try again in ${Math.ceil(secs / 60)} minute${Math.ceil(secs / 60) !== 1 ? "s" : ""}.`
                : ` Try again in ${secs} seconds.`;
            } else if (reset) {
              const resetDate = new Date(parseInt(reset) * 1000);
              const minutesLeft = Math.ceil(
                (resetDate.getTime() - Date.now()) / 60_000
              );
              suffix = minutesLeft > 0
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

        return (await response.json()) as T;
      } finally {
        clearTimeout(timeoutId);
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
      throw new Error(
        "Request blocked: URL targets a private or internal address"
      );
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

  protected async applyRateLimit(): Promise<void> {
    const now = Date.now();

    // Exponential backoff as remaining budget shrinks.
    // Thresholds double the delay at each step so we naturally slow to a crawl
    // before exhausting the quota rather than slamming the wall at 0.
    let delay = this.rateLimitDelay;
    if (this.rateLimitRemaining !== null) {
      if (this.rateLimitRemaining < 10) {
        // Nearly exhausted — wait until the window resets
        const waitMs = this.rateLimitResetAt
          ? this.rateLimitResetAt * 1000 - now
          : 30_000;
        delay = Math.max(delay, waitMs > 0 ? waitMs : 0);
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
      // Rate limits: applyRateLimit() in the next makeRequest call will
      // handle the long pause; just wait a short backoff here.
      const backoff = this.retryDelay * Math.pow(2, attempt);
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
    default:
      throw new Error(`Unknown git provider: ${provider}`);
  }
}
