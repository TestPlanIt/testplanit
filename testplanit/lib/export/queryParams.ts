/**
 * Shared query-parameter parsing for the NDJSON export endpoints.
 *
 * All three endpoints (test-run-results, repository-cases, audit-log) take
 * the same `since` / `cursor` / `pageSize` triplet. The cursor format is a
 * tuple of (sort-key string, integer id) base64url-encoded — works for any
 * sort key encoded as a string (ISO-8601 timestamp, lexicographic name, etc.).
 *
 * Keeping the parsers here means a future change (e.g. raising the page-size
 * cap, switching to RFC 3339 UTC offsets) lands in one place and we don't
 * end up with three slightly-divergent implementations.
 */

export const DEFAULT_PAGE_SIZE = 1000;
export const MAX_PAGE_SIZE = 5000;

/**
 * Composite cursor: a sort-key plus an id tiebreaker. The id is `string |
 * number` because some entities (AuditLog) use cuid string IDs while others
 * (TestRunResults, RepositoryCases) use auto-increment integers.
 */
export interface Cursor {
  k: string; // sort key (timestamp ISO-8601 or other string)
  i: string | number; // id (stable tiebreaker)
}

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

export function decodeCursor(raw: string | null): Cursor | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(Buffer.from(raw, "base64url").toString("utf-8"));
    if (
      typeof obj?.k === "string" &&
      (typeof obj?.i === "number" || typeof obj?.i === "string")
    ) {
      return obj;
    }
  } catch {
    /* fall through */
  }
  return null;
}

export function parsePageSize(raw: string | null): number {
  if (!raw) return DEFAULT_PAGE_SIZE;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(n, MAX_PAGE_SIZE);
}

export function parseSince(raw: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Build the `(sortCol, id) > (cursor.k, cursor.i)` strict-forward WHERE
 * filter for cursor pagination. The sort column is named at call time so
 * each endpoint can plug in its own column (`executedAt`, `updatedAt`, etc.).
 */
export function cursorWhere(
  sortColumn: string,
  cursor: Cursor
): Record<string, unknown> {
  const cursorDate = new Date(cursor.k);
  // Date.parse will succeed for ISO-8601 keys; for non-date sort keys callers
  // pass the raw string through unchanged via the OR/eq path.
  const sortVal: Date | string = Number.isNaN(cursorDate.getTime())
    ? cursor.k
    : cursorDate;
  return {
    OR: [
      { [sortColumn]: { gt: sortVal } },
      { [sortColumn]: sortVal, id: { gt: cursor.i } },
    ],
  };
}

/** Build the standard manifest header line. */
export function buildManifest(args: {
  resource: string;
  since: Date | null;
  pageSize: number;
  projectId: number | null;
}): Record<string, unknown> {
  return {
    type: "manifest",
    schemaVersion: 1,
    resource: args.resource,
    exportedAt: new Date().toISOString(),
    since: args.since ? args.since.toISOString() : null,
    pageSize: args.pageSize,
    projectId: args.projectId,
  };
}

/** Build the standard trailer line. */
export function buildTrailer(args: {
  count: number;
  cursor: string | null;
}): Record<string, unknown> {
  return { type: "end", count: args.count, cursor: args.cursor };
}
