// lib/db/replicaConfig.ts
//
// Single source of truth for PostgreSQL read-replica routing configuration.
// Kept dependency-light (only reads process.env) so it can be imported from the
// Kysely routing dialect, the app client, workers, and request handlers alike.
//
// Opt-in: when DATABASE_REPLICA_URLS is unset/empty the whole feature is
// dormant and the app uses a single primary pool — byte-for-byte identical to a
// build without this module. See docs/docs/horizontal-read-scaling.md.

/** Name of the cookie that pins a browser's reads to the primary for a short
 *  window after a mutation (cross-request read-your-own-writes). Presence is
 *  the only signal; the value is not interpreted. */
export const PRIMARY_STICKY_COOKIE = "tpi_rw_primary";

/** Default cross-request primary-stickiness window, in milliseconds. */
const DEFAULT_PRIMARY_STICKY_MS = 5000;

/**
 * Parse DATABASE_REPLICA_URLS into an ordered list of replica connection
 * strings. Comma-separated; whitespace trimmed; empty entries dropped. Returns
 * an empty array when unset — the caller treats that as "routing disabled".
 */
export function getReplicaUrls(): string[] {
  const raw = process.env.DATABASE_REPLICA_URLS;
  if (!raw) return [];
  return raw
    .split(",")
    .map((url) => url.trim())
    .filter((url) => url.length > 0);
}

/**
 * Whether read/write splitting is active. True only when at least one replica
 * URL is configured. When false, callers keep the existing single-pool
 * PostgresDialect.
 */
export function isReplicaRoutingEnabled(): boolean {
  return getReplicaUrls().length > 0;
}

/**
 * Cross-request primary-stickiness window (cookie Max-Age), in milliseconds.
 * Defaults to 5000. A value of 0 disables the cookie tier (in-request
 * pin-after-write and the manual withPrimary/withReplica escape hatches still
 * apply). Non-numeric or negative values fall back to the default.
 */
export function getPrimaryStickyMs(): number {
  const raw = process.env.DATABASE_PRIMARY_STICKY_MS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_PRIMARY_STICKY_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_PRIMARY_STICKY_MS;
  return Math.floor(parsed);
}
