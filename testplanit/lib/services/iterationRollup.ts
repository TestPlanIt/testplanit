/**
 * Worst-of status rollup for parameterized test-case iterations.
 *
 * Shared helper for every endpoint that rolls up a parameterized
 * test-run case's status from its iterations:
 *   - `/api/test-runs/submit-result` — single-iteration result writes
 *   - `/api/repository/test-runs/[runId]/cases/[caseId]/iterations/bulk-skip`
 *     — atomic multi-iteration skip
 *
 * The case-level status is the WORST status across all live iterations
 * under the case.
 *
 * Status names are admin-defined and not reliable. The only signal we can
 * trust is the (isSuccess, isFailure, isCompleted) triplet, plus the
 * reserved `systemName='untested'` row used as the fallback for iterations
 * that have no status yet.
 *
 * Tier order (worst → best):
 *
 *   Tier 4: isFailure=true                                    (failure)
 *   Tier 3: !isCompleted && !isFailure                        (incomplete)
 *   Tier 2: isCompleted && !isSuccess && !isFailure           (skipped)
 *   Tier 1: isSuccess=true                                    (passed)
 *
 * Within a tier, ties break on `Status.order` (admin-defined ranking,
 * higher wins). Iterations whose `statusId` is null fall back to the
 * seeded `untested` row.
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
 * Tier number derived from the flag triplet. Higher = worse.
 * Anything that doesn't fit a known pattern (e.g. isSuccess=true AND
 * isFailure=true, which shouldn't happen) lands in tier 0 — it won't
 * override any well-formed status.
 */
function tierFor(status: RollupStatus | undefined): number {
  if (!status) return 0;
  if (status.isFailure) return 4;
  if (!status.isCompleted) return 3;
  if (status.isCompleted && !status.isSuccess && !status.isFailure) return 2;
  if (status.isSuccess) return 1;
  return 0;
}

export function computeWorstOfStatus(
  iterations: RollupIteration[],
  statusMap: Map<number, RollupStatus>
): number | null {
  if (iterations.length === 0) return null;

  let untestedStatus: RollupStatus | undefined;
  for (const status of statusMap.values()) {
    if (status.systemName === "untested") {
      untestedStatus = status;
      break;
    }
  }

  let worst: RollupStatus | undefined;
  let worstTier = -1;

  for (const it of iterations) {
    const status =
      it.statusId == null ? untestedStatus : statusMap.get(it.statusId);
    const tier = tierFor(status);
    if (tier > worstTier) {
      worstTier = tier;
      worst = status;
    } else if (
      tier === worstTier &&
      status &&
      worst &&
      status.order > worst.order
    ) {
      worst = status;
    }
  }

  if (!worst) {
    return iterations[0].statusId;
  }
  return worst.id;
}
