import valkeyConnection from "~/lib/valkey";
import { currentTenantScope } from "~/lib/tenantContext";

/**
 * Per-project dispatch throttle. A CI dispatch is not free for the provider
 * (each one starts a job), so a runaway script or a double-clicking user is
 * capped at a modest number of starts per window. Falls back to an
 * in-memory counter when Valkey is unavailable (single-pod dev).
 */
export const DISPATCH_RATE_LIMIT = 30;
export const DISPATCH_RATE_WINDOW_SECONDS = 10 * 60;

const fallback = new Map<string, { count: number; resetAt: number }>();

export interface DispatchRateResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

function windowKey(projectId: number): { key: string; resetAt: number } {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % DISPATCH_RATE_WINDOW_SECONDS);
  const resetAt = windowStart + DISPATCH_RATE_WINDOW_SECONDS;
  return {
    key: `execdispatch:${currentTenantScope()}:${projectId}:${windowStart}`,
    resetAt,
  };
}

export async function checkDispatchRateLimit(
  projectId: number
): Promise<DispatchRateResult> {
  if (process.env.DISABLE_API_RATE_LIMIT === "true") {
    return {
      allowed: true,
      remaining: DISPATCH_RATE_LIMIT,
      resetAt: windowKey(projectId).resetAt,
    };
  }
  const { key, resetAt } = windowKey(projectId);

  if (valkeyConnection) {
    try {
      const count = await valkeyConnection.incr(key);
      if (count === 1) {
        await valkeyConnection.expire(key, DISPATCH_RATE_WINDOW_SECONDS + 5);
      }
      return {
        allowed: count <= DISPATCH_RATE_LIMIT,
        remaining: Math.max(0, DISPATCH_RATE_LIMIT - count),
        resetAt,
      };
    } catch (err) {
      console.warn(
        "[execution/rateLimit] Valkey error, falling back to in-memory:",
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  const entry = fallback.get(key) ?? { count: 0, resetAt };
  entry.count += 1;
  fallback.set(key, entry);
  // Opportunistic cleanup of stale windows.
  const nowSec = Math.floor(Date.now() / 1000);
  for (const [k, v] of fallback) {
    if (v.resetAt < nowSec) fallback.delete(k);
  }
  return {
    allowed: entry.count <= DISPATCH_RATE_LIMIT,
    remaining: Math.max(0, DISPATCH_RATE_LIMIT - entry.count),
    resetAt,
  };
}

/** @internal for tests */
export function _resetDispatchRateLimitForTesting(): void {
  fallback.clear();
}
