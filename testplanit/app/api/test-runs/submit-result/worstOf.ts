/**
 * Worst-of status rollup for parameterized test-case iterations.
 *
 * Phase 3 Wave 2 (Task 6) — used by `/api/test-runs/submit-result` to update
 * `TestRunCases.statusId` after every iteration result write. The case-level
 * status is the WORST status across all live iterations under the case.
 *
 * Priority order (LOCKED in PLAN.md and CONTEXT.md):
 *
 *   Failed (isFailure=true) >
 *   Exception (isFailure=true, RUNS scope) >
 *   Blocked (systemName='blocked') >
 *   Retest (systemName='retest') >
 *   Untested (systemName='untested') >
 *   Skipped (isCompleted=true, isSuccess=false, isFailure=false) >
 *   Passed (isSuccess=true)
 *
 * Iterations whose `statusId` is null (not yet started) are treated as
 * "Untested" for rollup purposes — equivalent to having the seeded
 * `untested` Status row attached.
 *
 * The function is deliberately PURE: no Prisma, no I/O, no React. Callers
 * pass in the iteration list AND a status lookup map keyed by Status.id.
 * This keeps the helper unit-testable as a table-driven check; the route
 * handler is responsible for loading both inputs from the DB.
 *
 * It lives co-located with the route (not in lib/services/) per RESEARCH.md
 * Q12 — single callsite today, do not extract until a second appears.
 */

/**
 * Minimal Status shape needed for rollup. The route loads the full row but
 * the helper only needs the systemName / isSuccess / isFailure / isCompleted
 * triplet used in the priority map below.
 */
export interface RollupStatus {
  id: number;
  systemName: string | null;
  isSuccess: boolean;
  isFailure: boolean;
  isCompleted: boolean;
}

/**
 * Iteration shape — only `statusId` matters for the rollup. The route
 * supplies its own richer iteration rows; we narrow to this shape so tests
 * can build fixtures without wiring the full Prisma type.
 */
export interface RollupIteration {
  statusId: number | null;
}

/**
 * Numeric priority assigned to each known systemName. Higher = worse.
 * Failed sits at the top so a single failed iteration always wins.
 *
 * Anything not in this map is treated as the lowest priority (acts like
 * a never-set status — won't override any known systemName). Practically
 * the project's seeded Status table only ships these seven systemNames
 * (see prisma/seed.ts).
 */
const PRIORITY: Record<string, number> = {
  failed: 100,
  exception: 90,
  blocked: 80,
  retest: 70,
  untested: 60,
  skipped: 50,
  passed: 10,
};

/**
 * Look up the rank for a Status. Falls back to 0 (lowest known) when the
 * systemName is unrecognized — defensive against future Status rows that
 * predate this priority map.
 *
 * Iterations without a status (statusId === null) act as "untested" — the
 * caller passes the untested rank by lookup-or-default.
 */
function rankFor(status: RollupStatus | undefined): number {
  if (!status?.systemName) return 0;
  return PRIORITY[status.systemName] ?? 0;
}

/**
 * Compute the worst-of status across a set of iterations.
 *
 * @param iterations  All non-deleted iteration rows for the run-case.
 * @param statusMap   Map of every Status row keyed by id. Must include the
 *                    seeded `untested` row so iterations with no status fall
 *                    through to "untested" rather than producing null.
 * @returns           The Status.id that should be written to
 *                    TestRunCases.statusId, or null if the iteration list is
 *                    empty (defensive — PARAM-07 guarantees ≥1 iteration on
 *                    parameterized cases).
 */
export function computeWorstOfStatus(
  iterations: RollupIteration[],
  statusMap: Map<number, RollupStatus>
): number | null {
  if (iterations.length === 0) return null;

  // Resolve the seeded "untested" row once. Used as the fallback for
  // iterations whose statusId is null (not yet started).
  let untestedStatus: RollupStatus | undefined;
  for (const status of statusMap.values()) {
    if (status.systemName === "untested") {
      untestedStatus = status;
      break;
    }
  }

  let worst: RollupStatus | undefined;
  let worstRank = -1;

  for (const it of iterations) {
    const status =
      it.statusId == null ? untestedStatus : statusMap.get(it.statusId);
    const rank = rankFor(status);
    if (rank > worstRank) {
      worstRank = rank;
      worst = status;
    }
  }

  // If we never matched anything (e.g., empty statusMap, all unknown) fall
  // back to the first iteration's statusId — keeps the route's update from
  // erasing a previously-set rollup status with null.
  if (!worst) {
    return iterations[0].statusId;
  }
  return worst.id;
}
