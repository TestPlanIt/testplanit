// lib/db/poolConfig.ts
//
// Single source of truth for the pg connection-pool settings shared by every
// runtime ZenStack client (the app client in lib/zenstack.ts and the
// per-tenant worker clients in lib/multiTenantDb.ts).
//
// Kept dependency-light (only reads process.env) so it can be imported from the
// Kysely routing dialect, the app client, and workers alike — same shape as
// replicaConfig.ts.
//
// Why this module exists: `new Pool({ connectionString })` with no options
// silently inherits node-postgres' defaults, and two of those defaults turned a
// slow-query incident into a full outage on 2026-07-23 —
//
//   max: 10                    → only 10 concurrent queries process-wide.
//   connectionTimeoutMillis: 0 → "wait forever" for a free slot.
//
// Once ten 17-25s queries held every slot, every other request queued behind
// them with no deadline, so the whole app hung while postgres itself sat idle
// at 3 of 100 connections. Unbounded queueing is the part that turns saturation
// into an outage: without a deadline nothing sheds load, and the queue only
// drains when someone restarts the process.

import type { PoolConfig } from "pg";

/** node-postgres' own default, kept explicit so the baseline is visible. */
const DEFAULT_MAX_CONNECTIONS = 20;
/** Max wait for a free pool slot before the query fails. 0 would mean forever. */
const DEFAULT_CONNECTION_TIMEOUT_MS = 10_000;
/** How long an unused client sits in the pool before it is closed. */
const DEFAULT_IDLE_TIMEOUT_MS = 10_000;

function readPositiveInt(
  raw: string | undefined,
  fallback: number,
  { allowZero = false } = {}
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < 0) return fallback;
  if (parsed === 0 && !allowZero) return fallback;
  return Math.floor(parsed);
}

/**
 * Pool size per process. Remember this is multiplied by the number of processes
 * pointing at the same database (web + workers, plus one pool per configured
 * read replica), and postgres' own `max_connections` is the ceiling for the
 * total. Default 20.
 */
export function getPoolMax(): number {
  return readPositiveInt(
    process.env.DATABASE_POOL_MAX,
    DEFAULT_MAX_CONNECTIONS
  );
}

/**
 * How long a query waits for a free pool slot before failing. Defaults to
 * 10000. Set to 0 to restore node-postgres' unbounded wait — which is what
 * allowed a slow-query burst to hang every route in the app, so prefer a finite
 * value. A request that fails here surfaces as a 500 in seconds instead of
 * hanging until the client gives up.
 */
export function getPoolConnectionTimeoutMs(): number {
  return readPositiveInt(
    process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS,
    DEFAULT_CONNECTION_TIMEOUT_MS,
    { allowZero: true }
  );
}

/** Idle-client eviction window. Defaults to 10000; 0 disables eviction. */
export function getPoolIdleTimeoutMs(): number {
  return readPositiveInt(
    process.env.DATABASE_POOL_IDLE_TIMEOUT_MS,
    DEFAULT_IDLE_TIMEOUT_MS,
    { allowZero: true }
  );
}

/**
 * Server-side per-statement deadline, in milliseconds. OPT-IN (unset = no
 * timeout, postgres' default) because this module is shared with the worker
 * clients, and workers legitimately run multi-minute statements — bulk import,
 * magic-select, milestone sync, Elasticsearch reindex. A blanket default here
 * would abort those mid-flight. Set DATABASE_STATEMENT_TIMEOUT_MS on the web
 * process only if you want runaway queries capped there.
 */
export function getStatementTimeoutMs(): number | undefined {
  const raw = process.env.DATABASE_STATEMENT_TIMEOUT_MS;
  if (raw === undefined || raw.trim() === "") return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
}

/**
 * The pg.Pool options every runtime client should be built with. Passed through
 * `createDialect(..., poolConfig)` so the primary pool and each replica pool are
 * configured identically.
 */
export function getPoolConfig(): Omit<PoolConfig, "connectionString"> {
  const statementTimeoutMs = getStatementTimeoutMs();
  return {
    max: getPoolMax(),
    connectionTimeoutMillis: getPoolConnectionTimeoutMs(),
    idleTimeoutMillis: getPoolIdleTimeoutMs(),
    ...(statementTimeoutMs !== undefined
      ? { statement_timeout: statementTimeoutMs }
      : {}),
  };
}
