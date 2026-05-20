/**
 * Status rollup for parameterized test-case iterations.
 *
 * Shared helper for every endpoint that rolls up a parameterized
 * test-run case's status from its iterations:
 *   - `/api/test-runs/submit-result` — single-iteration result writes
 *   - `/api/repository/test-runs/[runId]/cases/[caseId]/iterations/bulk-skip`
 *     — atomic multi-iteration skip
 *
 * Rollup rules (in order):
 *
 *   1. No iterations have a recorded result (all `statusId == null`)
 *      → return the FIRST "untested" status (isCompleted=false, !isSuccess,
 *        !isFailure) ordered by `Status.order` asc.
 *
 *   2. Any iteration has `isFailure=true`
 *      → among the failure-status iterations, return the statusId with the
 *        highest count. Tie-breaker: lowest `Status.order` wins.
 *
 *   3. No failures, but some iteration has `isSuccess=true`
 *      → among the success-status iterations, return the statusId with the
 *        highest count. Tie-breaker: lowest `Status.order` wins.
 *
 *   4. Some iterations have a recorded result but none are isSuccess or
 *      isFailure → among ALL recorded iterations, return the statusId with
 *      the highest count. Tie-breaker: lowest `Status.order` wins.
 *
 * Status names are admin-defined and never consulted; only the
 * (isSuccess, isFailure, isCompleted) triplet and `Status.order` matter.
 *
 * The function is PURE: no Prisma, no I/O. Callers pass the iteration
 * list and a Status lookup map keyed by id.
 */

export interface RollupStatus {
  id: number;
  systemName: string | null;
  isSuccess: boolean;
  isFailure: boolean;
  isCompleted: boolean;
  order: number;
}

export interface RollupIteration {
  statusId: number | null;
}

/**
 * Returns the statusId that appears most among `iters`, breaking ties
 * by the lowest `Status.order`. Iterations whose statusId isn't in the
 * statusMap are ignored. Returns null if `iters` is empty or no entries
 * resolve to a known status.
 */
function dominantStatusId(
  iters: RollupIteration[],
  statusMap: Map<number, RollupStatus>
): number | null {
  const counts = new Map<number, number>();
  for (const it of iters) {
    if (it.statusId == null) continue;
    if (!statusMap.has(it.statusId)) continue;
    counts.set(it.statusId, (counts.get(it.statusId) ?? 0) + 1);
  }
  if (counts.size === 0) return null;

  let bestId: number | null = null;
  let bestCount = -1;
  let bestOrder = Number.POSITIVE_INFINITY;
  for (const [statusId, count] of counts) {
    const status = statusMap.get(statusId);
    const order = status?.order ?? Number.POSITIVE_INFINITY;
    if (count > bestCount) {
      bestId = statusId;
      bestCount = count;
      bestOrder = order;
      continue;
    }
    if (count === bestCount && order < bestOrder) {
      bestId = statusId;
      bestOrder = order;
    }
  }
  return bestId;
}

/**
 * Returns the lowest-`order` status whose flag triplet matches "untested"
 * (not completed, not success, not failure). Returns null if no such
 * status exists in the project.
 */
function firstUntestedStatusId(
  statusMap: Map<number, RollupStatus>
): number | null {
  let bestId: number | null = null;
  let bestOrder = Number.POSITIVE_INFINITY;
  for (const status of statusMap.values()) {
    if (status.isCompleted || status.isSuccess || status.isFailure) continue;
    if (status.order < bestOrder) {
      bestId = status.id;
      bestOrder = status.order;
    }
  }
  return bestId;
}

export function computeWorstOfStatus(
  iterations: RollupIteration[],
  statusMap: Map<number, RollupStatus>
): number | null {
  // Iterations with a recorded result.
  const recorded = iterations.filter((it) => it.statusId != null);

  // Rule 1: no recorded results — fall back to the first untested status.
  if (recorded.length === 0) {
    return firstUntestedStatusId(statusMap);
  }

  // Rule 2: any failure → dominant failure status.
  const failures = recorded.filter(
    (it) => it.statusId != null && statusMap.get(it.statusId)?.isFailure
  );
  if (failures.length > 0) {
    return dominantStatusId(failures, statusMap);
  }

  // Rule 3: no failures but some successes → dominant success status.
  const successes = recorded.filter(
    (it) => it.statusId != null && statusMap.get(it.statusId)?.isSuccess
  );
  if (successes.length > 0) {
    return dominantStatusId(successes, statusMap);
  }

  // Rule 4: some recorded results, neither success nor failure → dominant
  // among all recorded.
  return dominantStatusId(recorded, statusMap);
}
