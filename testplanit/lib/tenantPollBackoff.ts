// lib/tenantPollBackoff.ts
//
// Adaptive per-tenant poll backoff shared by the multi-tenant worker poll
// loops (webhook outbox poller, audit Loop B CDC supervisor). Those loops
// sweep every configured tenant database each cycle; on a fleet where most
// tenants are idle or hibernated that keeps hundreds of idle Postgres
// backends alive and puts a permanent CPU floor under the connection pooler.
//
// A tenant whose polls keep coming back empty doubles its own poll interval
// (base × 2^misses) up to a ceiling, and snaps back to every-cycle polling on
// the first poll that finds work — so an active tenant is indistinguishable
// from the fixed-cadence behaviour, a draining backlog is never throttled
// mid-drain, and the latency cost is bounded and paid only on the first event
// after a quiet period. Errors back off the same way an empty poll does, so an
// unreachable tenant database is not hammered every cycle.

export interface TenantPollBackoffOptions {
  /** Poll interval for an active tenant (zero consecutive empty polls). */
  baseIntervalMs: number;
  /** Interval ceiling for a fully backed-off idle tenant. */
  maxIntervalMs: number;
  /** Clock override for tests. */
  now?: () => number;
}

export interface TenantPollBackoff {
  /** Whether this tenant is due for a poll this cycle. */
  shouldPoll(tenantId: string): boolean;
  /** Record a poll that found no work (or failed): lengthen this tenant's interval. */
  recordEmpty(tenantId: string): void;
  /** Record a poll that found work: snap back to every-cycle polling. */
  recordWork(tenantId: string): void;
  /** Drop state for tenants no longer in the active set. */
  prune(activeTenantIds: Iterable<string>): void;
  /** Clear all state (tests). */
  reset(): void;
}

interface BackoffState {
  consecutiveEmptyPolls: number;
  nextEligibleAt: number;
}

/** Exponent cap; with any sane base the ceiling is reached long before this. */
const MAX_MISSES = 30;

export function createTenantPollBackoff(
  options: TenantPollBackoffOptions
): TenantPollBackoff {
  const { baseIntervalMs, maxIntervalMs } = options;
  // Resolved per call (not captured) so vitest fake timers are honoured even
  // when the backoff instance was created before vi.useFakeTimers() ran.
  const now = options.now ?? (() => Date.now());
  const state = new Map<string, BackoffState>();

  return {
    shouldPoll(tenantId: string): boolean {
      const entry = state.get(tenantId);
      return !entry || now() >= entry.nextEligibleAt;
    },

    recordEmpty(tenantId: string): void {
      const misses = Math.min(
        (state.get(tenantId)?.consecutiveEmptyPolls ?? 0) + 1,
        MAX_MISSES
      );
      const interval = Math.min(baseIntervalMs * 2 ** misses, maxIntervalMs);
      state.set(tenantId, {
        consecutiveEmptyPolls: misses,
        nextEligibleAt: now() + interval,
      });
    },

    recordWork(tenantId: string): void {
      state.delete(tenantId);
    },

    prune(activeTenantIds: Iterable<string>): void {
      const active = new Set(activeTenantIds);
      for (const tenantId of state.keys()) {
        if (!active.has(tenantId)) {
          state.delete(tenantId);
        }
      }
    },

    reset(): void {
      state.clear();
    },
  };
}
