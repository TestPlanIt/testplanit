// lib/db/routingContext.ts
//
// Per-request / per-job async context that steers read/write routing in the
// Kysely dialect (lib/db/readWriteDialect.ts). Deliberately a pure
// AsyncLocalStorage leaf module with NO database imports (mirrors
// lib/tenantContext.ts) so it can be imported from workers, request handlers,
// and the dialect without dragging in the ORM.
//
// Safe-by-default: reads only reach a replica when they run inside a routing
// frame that opted in. A read with NO routing frame (any code path not wrapped
// below) stays on the primary — so an un-wrapped write-then-read path can never
// serve a stale replica read.
//
// Four routing controls, in precedence order (see readWriteDialect):
//   forcePrimary   — pin ALL reads to the primary (withPrimary / cookie-honored
//                    request). Read-after-write when strong freshness is needed.
//   wroteInContext — set automatically by the dialect after any write in this
//                    context, so the rest of the request/job reads its own
//                    writes from the primary.
//   forceReplica   — route eligible reads (incl. raw SELECTs) to a replica
//                    (withReplica) for known read-only, lag-tolerant paths.
//   autoReplica    — automatically route plain SELECTs to a replica in this
//                    frame (the app's read requests). Off for worker jobs, which
//                    process just-written data and would risk cross-process lag;
//                    a read-heavy worker opts specific reads in with withReplica.
//
// Writes and transactions always go to the primary regardless of these flags.

import { AsyncLocalStorage } from "async_hooks";

export interface DbRoutingContext {
  /** Pin every read to the primary. */
  forcePrimary: boolean;
  /** Route eligible reads (including raw SELECTs) to a replica. */
  forceReplica: boolean;
  /** Automatically route plain SELECTs in this frame to a replica. */
  autoReplica: boolean;
  /** Set by the dialect once a write runs in this context. */
  wroteInContext: boolean;
}

const storage = new AsyncLocalStorage<DbRoutingContext>();

/** Current routing context, or undefined outside any run* wrapper. */
export function getRoutingContext(): DbRoutingContext | undefined {
  return storage.getStore();
}

/**
 * Establish a fresh routing frame for a request or worker job. Enables
 * auto-pin-after-write: once any write runs, subsequent reads in this async
 * scope go to the primary.
 *
 * Options:
 *   - `autoReplica: true` — offload this frame's plain SELECTs to a replica
 *     (the app's read requests). Default false (framed, but reads stay on the
 *     primary unless explicitly wrapped in withReplica) — the safe default for
 *     worker jobs.
 *   - `forcePrimary: true` — additionally pin from the start (e.g. when the
 *     request carried the stickiness cookie).
 *
 * Idempotent-safe to nest: a nested call starts its own frame, so a
 * withPrimary/withReplica block inside a request is independent of the outer
 * request frame's flags.
 */
export function runWithDbRouting<T>(
  fn: () => T,
  init?: Partial<
    Pick<DbRoutingContext, "forcePrimary" | "forceReplica" | "autoReplica">
  >
): T {
  return storage.run(
    {
      forcePrimary: init?.forcePrimary ?? false,
      forceReplica: init?.forceReplica ?? false,
      autoReplica: init?.autoReplica ?? false,
      wroteInContext: false,
    },
    fn
  );
}

/**
 * Force all reads in `fn` to the primary. Use for read-after-write flows that
 * must see the latest committed state (or any path where replica lag is
 * unacceptable). Writes already go to the primary.
 */
export function withPrimary<T>(fn: () => T): T {
  return storage.run(
    {
      forcePrimary: true,
      forceReplica: false,
      autoReplica: false,
      wroteInContext: false,
    },
    fn
  );
}

/**
 * Route eligible reads in `fn` to a replica — including raw SELECTs
 * ($queryRaw / sql``) which are otherwise kept on the primary. Only wrap
 * read-only, replication-lag-tolerant work (e.g. reporting/aggregation reads).
 * Any write inside still goes to the primary.
 */
export function withReplica<T>(fn: () => T): T {
  return storage.run(
    {
      forcePrimary: false,
      forceReplica: true,
      autoReplica: false,
      wroteInContext: false,
    },
    fn
  );
}

/**
 * Called by the routing dialect when a write executes, so the rest of the
 * current context reads its own writes from the primary. No-op outside a
 * routing frame.
 */
export function markWroteInContext(): void {
  const ctx = storage.getStore();
  if (ctx) ctx.wroteInContext = true;
}
