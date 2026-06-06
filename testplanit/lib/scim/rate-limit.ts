/**
 * Per-token rate-limit gate for SCIM bearer auth.
 *
 * Uses a fixed-window counter aligned to 1-second boundaries, stored in Valkey
 * with an in-memory fallback when no Valkey connection is configured. The cap
 * is the shared `SCIM_RPS_LIMIT` constant (50 RPS by default) — sized for the
 * common Okta/Entra bulk-sync shape (sustained ~10 RPS with occasional bursts
 * to ~30) so a misconfigured connector can never accidentally DoS the org.
 *
 * Design constraints:
 *
 *   - **Single point of control.** The gate is invoked from `requireScimBearer`
 *     after token validation succeeds. Every SCIM route — Users and Groups —
 *     inherits the gate by virtue of using the same bearer middleware.
 *
 *   - **Fail open on Valkey errors.** If the Valkey `INCR` throws we log a
 *     tagged stderr line (`[scim_rate_limit_fail_open]`) and return
 *     `{ allowed: true }`. The trade is intentional: a Valkey outage cannot
 *     brick all SCIM traffic, and the grep marker lets ops detect the silent
 *     bypass period in log aggregators.
 *
 *   - **`DISABLE_SCIM_RATE_LIMIT=true` test knob.** Short-circuits the gate
 *     entirely so the local-dev SCIM smoke harness and the Okta E2E lifecycle
 *     test do not trip the cap mid-run. Never default-enable this flag in
 *     production; the variable name is explicit and visible in deployment
 *     configs.
 *
 *   - **Key shape `ratelimit:scim:token:<tokenId>:<windowIndex>`.** `tokenId`
 *     is a cuid resolved from a trusted Prisma SELECT and is therefore
 *     structurally constrained, but the key is still constructed via template
 *     literal rather than concatenated string for grep-ability.
 */

import valkeyConnection from "~/lib/valkey";

import { SCIM_RPS_LIMIT } from "./constants";

const SCIM_RATE_LIMIT_KEY_PREFIX = "ratelimit:scim:token:";

/** Window length (seconds) for the fixed-window bucket. */
const WINDOW_SECONDS = 1;

/**
 * TTL applied to each Valkey key on first increment. Generous enough to
 * absorb clock drift and to leave the key around for ops inspection after
 * the window has closed, but short enough that idle tokens do not leave
 * piles of zero-value keys laying around.
 */
const WINDOW_TTL_SECONDS = 10;

/**
 * Shape returned from {@link checkScimTokenRateLimit}. The middleware uses
 * `allowed` for the gate decision and the remaining four numerics to populate
 * `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and
 * `X-RateLimit-Reset` on the 429 response.
 */
export interface ScimRateLimitResult {
  allowed: boolean;
  /** Maximum requests permitted per `WINDOW_SECONDS` window. */
  limit: number;
  /** Requests remaining in the current window after this call. */
  remaining: number;
  /** Unix timestamp (seconds) when the current window closes. */
  resetAt: number;
  /** Seconds the caller should wait before retrying on a 429. */
  retryAfterSeconds: number;
}

/** In-memory fallback when Valkey is unavailable. Keyed by `<tokenId>:<window>`. */
const fallbackCounts = new Map<string, number>();

interface WindowInfo {
  window: number;
  resetAt: number;
  key: string;
}

function getWindowInfo(tokenId: string): WindowInfo {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const window = Math.floor(nowSeconds / WINDOW_SECONDS);
  const resetAt = (window + 1) * WINDOW_SECONDS;
  const key = `${SCIM_RATE_LIMIT_KEY_PREFIX}${tokenId}:${window}`;
  return { window, resetAt, key };
}

/**
 * In-memory fallback when no Valkey connection is configured.
 *
 * Lazy-cleans entries from windows older than `current - 1` on every call so
 * the Map does not grow unbounded across many tokenIds over many windows.
 */
function checkFallback(tokenId: string): ScimRateLimitResult {
  const { window, resetAt } = getWindowInfo(tokenId);

  for (const k of fallbackCounts.keys()) {
    const colonIdx = k.lastIndexOf(":");
    if (colonIdx === -1) continue;
    const kWindow = Number(k.slice(colonIdx + 1));
    if (Number.isFinite(kWindow) && kWindow < window - 1) {
      fallbackCounts.delete(k);
    }
  }

  const mapKey = `${tokenId}:${window}`;
  const count = (fallbackCounts.get(mapKey) ?? 0) + 1;
  fallbackCounts.set(mapKey, count);

  return {
    allowed: count <= SCIM_RPS_LIMIT,
    limit: SCIM_RPS_LIMIT,
    remaining: Math.max(0, SCIM_RPS_LIMIT - count),
    resetAt,
    retryAfterSeconds: WINDOW_SECONDS,
  };
}

/**
 * Increment the per-token bucket and return the resulting rate-limit decision.
 *
 * Short-circuits to an allowed result when `DISABLE_SCIM_RATE_LIMIT=true`.
 * Uses Valkey `INCR` (plus `EXPIRE` on first hit) when a connection is
 * available, otherwise falls back to an in-memory Map. Fails open on any
 * Valkey error (logs `[scim_rate_limit_fail_open]` to stderr).
 */
export async function checkScimTokenRateLimit(
  tokenId: string
): Promise<ScimRateLimitResult> {
  const { resetAt, key } = getWindowInfo(tokenId);

  if (process.env.DISABLE_SCIM_RATE_LIMIT === "true") {
    return {
      allowed: true,
      limit: SCIM_RPS_LIMIT,
      remaining: SCIM_RPS_LIMIT,
      resetAt,
      retryAfterSeconds: WINDOW_SECONDS,
    };
  }

  if (!valkeyConnection) {
    return checkFallback(tokenId);
  }

  try {
    const count = await valkeyConnection.incr(key);

    if (count === 1) {
      await valkeyConnection.expire(key, WINDOW_TTL_SECONDS);
    }

    return {
      allowed: count <= SCIM_RPS_LIMIT,
      limit: SCIM_RPS_LIMIT,
      remaining: Math.max(0, SCIM_RPS_LIMIT - count),
      resetAt,
      retryAfterSeconds: WINDOW_SECONDS,
    };
  } catch (err) {
    console.error("[scim_rate_limit_fail_open]", err);
    return {
      allowed: true,
      limit: SCIM_RPS_LIMIT,
      remaining: SCIM_RPS_LIMIT,
      resetAt,
      retryAfterSeconds: WINDOW_SECONDS,
    };
  }
}

/**
 * Clear the in-memory fallback Map. Exported for testing only.
 * @internal
 */
export function _resetForTesting(): void {
  fallbackCounts.clear();
}
