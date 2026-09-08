/**
 * Valkey-backed API rate limiting for programmatic access.
 *
 * Uses a fixed-window counter aligned to hourly boundaries, stored in Valkey.
 * Falls back to in-memory counting if Valkey is unavailable.
 *
 * The hourly limit is resolved in this order:
 *   1. API_RATE_LIMIT — an explicit positive integer (requests/hour). Intended
 *      for self-hosted instances that want a limit beyond the tier presets.
 *   2. The TIER env var:
 *        essentials: 1,000 | team: 5,000 | professional: 10,000 | dedicated: 25,000
 *   3. DEFAULT_TIER when neither is set.
 */

import valkeyConnection from "./valkey";

const TIER_LIMITS: Record<string, number> = {
  essentials: 1_000,
  team: 5_000,
  professional: 10_000,
  dedicated: 25_000,
};

const DEFAULT_TIER = "professional";

const RATE_LIMIT_KEY_PREFIX = "ratelimit:api:global:";

/** TTL for each window key — 2 hours for safety margin */
const WINDOW_TTL_SECONDS = 7200;

export interface RateLimitResult {
  allowed: boolean;
  /** Maximum requests per hour for the current tier */
  limit: number;
  /** Remaining requests in the current window */
  remaining: number;
  /** Unix timestamp (seconds) when the current window resets */
  resetAt: number;
}

/** In-memory fallback counter: Map<hourTimestamp, requestCount> */
const fallbackCounts = new Map<number, number>();

/**
 * Returns the hourly rate limit.
 *
 * An explicit `API_RATE_LIMIT` (positive integer, requests/hour) overrides the
 * TIER presets — useful for self-hosted deployments that aren't bound by the
 * SaaS pricing tiers. Invalid values are ignored with a warning and fall back
 * to the TIER presets.
 */
export function getTierLimit(): number {
  const override = process.env.API_RATE_LIMIT?.trim();
  if (override) {
    // Accept only a plain positive integer (no decimals, signs, separators, or
    // scientific notation) so the configured value is unambiguous.
    if (/^\d+$/.test(override) && Number(override) > 0) {
      return Number(override);
    }
    console.warn(
      `[API Rate Limit] Ignoring invalid API_RATE_LIMIT="${override}"; ` +
        "expected a positive integer. Falling back to TIER presets."
    );
  }

  const tier = (process.env.TIER || DEFAULT_TIER).toLowerCase();
  return TIER_LIMITS[tier] ?? TIER_LIMITS[DEFAULT_TIER];
}

function getWindowInfo(): { key: string; window: number; resetAt: number } {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const window = Math.floor(nowSeconds / 3600);
  const resetAt = (window + 1) * 3600;
  const key = `${RATE_LIMIT_KEY_PREFIX}${window}`;
  return { key, window, resetAt };
}

/**
 * In-memory fallback when Valkey is unavailable.
 */
function checkFallback(): RateLimitResult {
  const limit = getTierLimit();
  const { window, resetAt } = getWindowInfo();

  // Lazy cleanup
  for (const k of fallbackCounts.keys()) {
    if (k < window - 1) fallbackCounts.delete(k);
  }

  const count = (fallbackCounts.get(window) ?? 0) + 1;
  fallbackCounts.set(window, count);

  return {
    allowed: count <= limit,
    limit,
    remaining: Math.max(0, limit - count),
    resetAt,
  };
}

/**
 * Checks the global API rate limit and increments the counter.
 *
 * Uses Valkey for distributed counting. Falls back to in-memory
 * if Valkey is unavailable.
 *
 * Returns whether the request is allowed along with rate limit metadata
 * suitable for `X-RateLimit-*` response headers.
 *
 * Set `DISABLE_API_RATE_LIMIT=true` to bypass rate limiting entirely.
 * Intended for isolated load-test and development environments —
 * never enable this in production.
 */
export async function checkApiRateLimit(): Promise<RateLimitResult> {
  const limit = getTierLimit();
  const { key, resetAt } = getWindowInfo();

  if (process.env.DISABLE_API_RATE_LIMIT === "true") {
    return { allowed: true, limit, remaining: limit, resetAt };
  }

  if (!valkeyConnection) {
    return checkFallback();
  }

  try {
    const count = await valkeyConnection.incr(key);

    // Set TTL on first increment so the key auto-expires
    if (count === 1) {
      await valkeyConnection.expire(key, WINDOW_TTL_SECONDS);
    }

    return {
      allowed: count <= limit,
      limit,
      remaining: Math.max(0, limit - count),
      resetAt,
    };
  } catch (error) {
    console.error(
      "[API Rate Limit] Valkey error, falling back to in-memory:",
      error
    );
    return checkFallback();
  }
}

/**
 * Resets the rate limit counter. Exported for testing only.
 * @internal
 */
export function _resetForTesting(): void {
  fallbackCounts.clear();
}
