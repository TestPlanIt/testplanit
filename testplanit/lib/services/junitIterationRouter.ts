import type { Prisma } from "@prisma/client";

import {
  computeWorstOfStatus,
  type RollupStatus,
} from "~/lib/services/iterationRollup";

/**
 * JUnit iteration router (INT-02).
 *
 * Routes a single per-test-case automation result to the correct
 * `TestRunCaseIteration` row when the JUnit XML carries a
 * `<property name="iteration" value="N"/>` child on the `<testcase>`.
 *
 * Two responsibilities live here:
 *
 *   1. `extractIterationIndex(metadata, configuredNames)` — pure helper that
 *      pulls the 1-indexed iteration value out of the parsed library
 *      `metadata` object. Matches any of the configured names
 *      case-insensitively (D-01); falls back to `["iteration"]` when the
 *      caller passes an empty array (so projects with the default config
 *      work with zero setup). Returns `null` when the property is absent or
 *      the value can't be parsed as a positive integer — that triggers the
 *      D-03 legacy back-compat path in the route.
 *
 *   2. `routeToIteration(tx, args)` — performs the upsert + status rollup
 *      for the resolved iteration. Wrapped in a try/catch at the caller so
 *      the `IterationCapExceededError` it throws for `iterationIndex > 5000`
 *      can be translated to a 422 response (T-06-01-03) without polluting
 *      the legacy path.
 *
 * The cap mirrors Phase 3 ITER-06 cardinality guard: 5000 iterations per
 * test-run case is the hard refuse. The check runs BEFORE any DB I/O so an
 * adversarial XML upload of `value="999999999"` can't trigger millions of
 * row writes before failing.
 *
 * Race-safety: the upsert on the `@@unique([testRunCaseId, rowIndex])`
 * composite key collapses concurrent CI imports racing on the same
 * iteration value (Pitfall 2 from research). Two parallel imports of the
 * same iteration index produce exactly one row.
 *
 * The function expects to be called inside an existing transaction (or
 * with a raw `prisma` client passed as `tx` — both satisfy the
 * `Prisma.TransactionClient` shape in this codebase). It does NOT open
 * its own transaction; the caller owns the boundary so the iteration write
 * commits atomically with the surrounding JUnitTestResult write.
 */

/**
 * Hard cap on the per-test-case iteration index (T-06-01-03).
 *
 * Exported so the route handler, the helper itself, and tests all reference
 * the same constant — a future bump only needs to change this line.
 */
export const ITERATION_INDEX_CAP = 5000;

/**
 * Thrown by `routeToIteration` when `iterationIndex > ITERATION_INDEX_CAP`.
 * The caller catches this specific error type and translates it to a 422
 * response with the localized `api.testResults.import.iterationCapExceeded`
 * message body.
 */
export class IterationCapExceededError extends Error {
  public readonly iterationIndex: number;
  public readonly cap: number;

  constructor(iterationIndex: number, cap: number) {
    super(`iteration index ${iterationIndex} exceeds cap of ${cap}`);
    this.name = "IterationCapExceededError";
    this.iterationIndex = iterationIndex;
    this.cap = cap;
  }
}

/**
 * Pure helper — returns the first parseable iteration value found in
 * `metadata` whose key (case-insensitively) matches any entry of
 * `configuredNames`, or `null` if no such property exists or the value
 * isn't a positive integer.
 *
 * `Object.entries` is used deliberately (not `for...in`) so only the
 * caller's own enumerable properties are considered — prototype keys
 * cannot be reached (defense-in-depth against T-06-01-05).
 *
 * @param metadata Parsed JUnit `<property>` map from the test-results-parser
 *                 library. May be undefined when no `<property>` children
 *                 exist on the `<testcase>`.
 * @param configuredNames The project's `junitIterationPropertyNames` array.
 *                        Empty array falls back to `["iteration"]` so
 *                        callers can pass the column value verbatim.
 */
export function extractIterationIndex(
  metadata: Record<string, string> | undefined,
  configuredNames: readonly string[]
): number | null {
  if (!metadata) return null;
  const names = configuredNames.length > 0 ? configuredNames : ["iteration"];
  const lowered = names.map((n) => n.toLowerCase());

  for (const [key, value] of Object.entries(metadata)) {
    if (!lowered.includes(key.toLowerCase())) continue;
    const n = parseInt(String(value), 10);
    if (Number.isFinite(n) && n >= 1) {
      return n;
    }
  }
  return null;
}

export interface RouteToIterationArgs {
  testRunCaseId: number;
  iterationIndex: number;
  statusId: number;
  statusMap: Map<number, RollupStatus>;
}

export interface RouteToIterationResult {
  iterationId: number;
  /** True when the row was created by this call (D-02 auto-create marker). */
  autoCreated: boolean;
}

/**
 * Upserts the target `TestRunCaseIteration` row, applies the imported
 * status, and recomputes the case-level status + counter denormalizations
 * using the same `computeWorstOfStatus` helper the submit-result route uses.
 *
 * Throws `IterationCapExceededError` BEFORE any DB I/O when `iterationIndex`
 * exceeds the hard cap.
 *
 * @returns `{ iterationId, autoCreated }` so the caller can audit-log the
 *          routing decision and emit different progress messages for
 *          extended vs. updated rows.
 */
export async function routeToIteration(
  tx: Prisma.TransactionClient,
  args: RouteToIterationArgs
): Promise<RouteToIterationResult> {
  const { testRunCaseId, iterationIndex, statusId, statusMap } = args;

  // (0) CAP CHECK FIRST — before any tx call. Adversarial inputs must not
  //     trigger row writes (T-06-01-03 DoS mitigation).
  if (iterationIndex > ITERATION_INDEX_CAP) {
    throw new IterationCapExceededError(iterationIndex, ITERATION_INDEX_CAP);
  }

  // (1) Convert 1-indexed iteration value to 0-indexed rowIndex.
  const rowIndex = iterationIndex - 1;

  // (2) Upsert collapses concurrent CI imports racing on the same iteration
  //     value (Pitfall 2). `valuesJson={}` + `ciExtended=true` is the D-02
  //     auto-create marker — UI surfaces that read snapshotted values must
  //     handle the empty case.
  //
  //     WR-01: `autoCreated` derives from the row's `ciExtended` column
  //     (set on the `create` branch only) rather than a separate
  //     pre-upsert `findFirst` lookup. The pre-lookup approach was
  //     TOCTOU-prone — two concurrent importers could both observe
  //     `before === null` and both return `autoCreated: true` even
  //     though only one row was actually created. Reading `ciExtended`
  //     off the upsert result is post-write, so it reflects what the
  //     row actually is. (For a row originally created by an earlier
  //     CI extension, both calls accurately report
  //     `autoCreated: true` — the marker is "CI-extended", which the
  //     row remains.)
  const iteration = await tx.testRunCaseIteration.upsert({
    where: { testRunCaseId_rowIndex: { testRunCaseId, rowIndex } },
    create: {
      testRunCaseId,
      rowIndex,
      valuesJson: {},
      ciExtended: true,
      statusId,
    },
    update: { statusId },
    select: { id: true, ciExtended: true },
  });
  const autoCreated = iteration.ciExtended === true;

  // (3) Recompute the case-level status + denormalized counters using the
  //     same rule set as submit-result/route.ts (Phase 3 worst-of rollup +
  //     passed/failed/skipped counters). Diverging here would let the
  //     case-level status drift from the iteration set, breaking
  //     iteration-aware UIs.
  const iterations = await tx.testRunCaseIteration.findMany({
    where: { testRunCaseId, isDeleted: false },
    select: { statusId: true },
  });
  const rollupStatusId = computeWorstOfStatus(
    iterations.map((it) => ({ statusId: it.statusId })),
    statusMap
  );

  // Recompute counters by looking up each statusId through the map. Status
  // rows are admin-defined; the (isSuccess, isFailure, isCompleted) triplet
  // is the canonical classifier — never look at status names.
  let passedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  for (const it of iterations) {
    if (it.statusId == null) continue;
    const status = statusMap.get(it.statusId);
    if (!status) continue;
    if (status.isSuccess) {
      passedCount += 1;
    } else if (status.isFailure) {
      failedCount += 1;
    } else if (status.isCompleted) {
      // isCompleted && !isSuccess && !isFailure = skip-class (D-14).
      skippedCount += 1;
    }
  }

  await tx.testRunCases.update({
    where: { id: testRunCaseId },
    data: {
      // Fall back to the imported status if the rollup returns null
      // (defensive — should never happen with at least one recorded row).
      statusId: rollupStatusId ?? statusId,
      passedIterations: passedCount,
      failedIterations: failedCount,
      skippedIterations: skippedCount,
    },
  });

  return { iterationId: iteration.id, autoCreated };
}
