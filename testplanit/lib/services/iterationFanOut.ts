import type { Prisma } from "@prisma/client";

/**
 * Iteration fan-out service.
 *
 * Materializes the snapshot + iteration rows for every parameterized
 * TestRunCase belonging to a given TestRun. The "all-or-nothing at run
 * creation" decision (Phase 3 CONTEXT.md decision 2) means this helper is
 * always called inside a single Prisma transaction — either by the
 * synchronous `/api/test-runs/[runId]/generate-iterations` route or by the
 * `iterationGenerationWorker` BullMQ processor.
 *
 * Key invariants enforced here:
 *   1. Snapshot is the historical record. The dataset rows captured into
 *      `TestRunCaseDataSetSnapshot.rowsJson` are the source of truth for
 *      the run; subsequent edits to the source DataSet must NEVER affect
 *      iteration playback (ITER-01).
 *   2. Each iteration row carries its own `valuesJson` (a copy of the
 *      snapshot row), so future per-iteration value overrides (ITER-07)
 *      mutate only that row without touching the snapshot.
 *   3. The schema field for ordering is `rowIndex` — NOT iterationOrder.
 *      Using the wrong name fails at runtime with column-not-found.
 *   4. Counters (`totalIterations`) are written transactionally. Pass/fail
 *      counters stay at zero until iteration results land (Wave 2, Task 6).
 *   5. Idempotency at the run level is the CALLER's responsibility — this
 *      helper trusts that no snapshot or iteration rows already exist for
 *      the targeted TestRunCases. The route enforces this by only calling
 *      materializeIterations on freshly-created TestRunCases.
 *
 * Cross-project safety: the dataset query is filtered by `projectId =
 * testRun.projectId` per the Phase 1 carry-forward (DataSet @@deny does
 * not block cross-project READS, only create/update).
 */

export interface MaterializeIterationsResult {
  /** Total iteration rows materialized across all parameterized run-cases */
  iterationCount: number;
  /** Number of TestRunCases that had hasParameters=true */
  parameterizedRunCaseCount: number;
  /** Per-run-case counts; same length as parameterizedRunCaseCount */
  perRunCase: Array<{
    testRunCaseId: number;
    iterationCount: number;
    snapshotId: number;
  }>;
}

/**
 * Optional progress callback. Called periodically with cumulative counts
 * so the BullMQ worker can emit job.updateProgress({processed, total})
 * without coupling the helper to the queue API.
 *
 * The cadence is controlled by the caller via `progressIntervalCases`
 * (default: every 50 cases).
 */
export type MaterializeProgressCallback = (info: {
  processedCases: number;
  totalCases: number;
  iterationsSoFar: number;
}) => void | Promise<void>;

export interface MaterializeIterationsOptions {
  /** Emit progress every N cases processed (default: 50) */
  progressIntervalCases?: number;
  /** Optional progress callback (worker hooks job.updateProgress here) */
  onProgress?: MaterializeProgressCallback;
}

/**
 * Fan out every parameterized TestRunCase for the given run.
 *
 * Loads each TestRunCase row whose RepositoryCase has hasParameters=true,
 * snapshots the case's parameters + dataset rows, then materializes one
 * TestRunCaseIteration per row. All writes happen inside the caller-owned
 * transaction `tx`.
 *
 * The caller MUST own the transaction. This helper does not start one
 * because the route layer needs to combine fan-out with other writes
 * (e.g., audit emission, downstream notifications) atomically.
 *
 * @returns counts for the route to surface in its response payload.
 */
export async function materializeIterations(
  testRunId: number,
  tx: Prisma.TransactionClient,
  options: MaterializeIterationsOptions = {}
): Promise<MaterializeIterationsResult> {
  const progressIntervalCases = Math.max(
    1,
    options.progressIntervalCases ?? 50
  );

  // 1. Resolve the run's projectId once. Used as the cross-project filter
  //    on every dataset query below.
  const run = await tx.testRuns.findUnique({
    where: { id: testRunId },
    select: { id: true, projectId: true },
  });
  if (!run) {
    throw new Error(`TestRun ${testRunId} not found`);
  }

  // 2. Fetch every parameterized TestRunCase for the run.
  //    A case is parameterized iff its RepositoryCase.hasParameters is true.
  //    We do not pre-filter on dataset existence — a parameterized case with
  //    no dataset attached materializes a snapshot with an empty rowsJson and
  //    zero iterations (callers can decide to surface that in the UI).
  const runCases = await tx.testRunCases.findMany({
    where: {
      testRunId,
      repositoryCase: { hasParameters: true, isDeleted: false },
    },
    select: {
      id: true,
      repositoryCaseId: true,
      repositoryCase: {
        select: {
          id: true,
          name: true,
          projectId: true,
        },
      },
    },
    orderBy: { id: "asc" },
  });

  const result: MaterializeIterationsResult = {
    iterationCount: 0,
    parameterizedRunCaseCount: runCases.length,
    perRunCase: [],
  };

  // Early-out: nothing to materialize. Caller sees iterationCount=0 and
  // can short-circuit any downstream fan-out follow-ups.
  if (runCases.length === 0) {
    if (options.onProgress) {
      await options.onProgress({
        processedCases: 0,
        totalCases: 0,
        iterationsSoFar: 0,
      });
    }
    return result;
  }

  for (let i = 0; i < runCases.length; i++) {
    const rc = runCases[i];
    const perCase = await materializeForOneCase(
      run.projectId,
      rc.id,
      rc.repositoryCaseId,
      tx
    );
    result.iterationCount += perCase.iterationCount;
    result.perRunCase.push({
      testRunCaseId: rc.id,
      iterationCount: perCase.iterationCount,
      snapshotId: perCase.snapshotId,
    });

    // Emit progress at the configured cadence and on the final iteration.
    if (
      options.onProgress &&
      ((i + 1) % progressIntervalCases === 0 || i === runCases.length - 1)
    ) {
      await options.onProgress({
        processedCases: i + 1,
        totalCases: runCases.length,
        iterationsSoFar: result.iterationCount,
      });
    }
  }

  return result;
}

/**
 * Materialize the snapshot + iteration rows for ONE TestRunCase.
 *
 * Internal helper — exported for the live-DB integration test only.
 * Production callers go through `materializeIterations`.
 */
export async function materializeForOneCase(
  projectId: number,
  testRunCaseId: number,
  repositoryCaseId: number,
  tx: Prisma.TransactionClient
): Promise<{ snapshotId: number; iterationCount: number }> {
  // Fetch case parameters (live, not snapshotted versions). The schema
  // for parameters lives on RepositoryCases.parameters (TestCaseParameter
  // rows); we capture the minimal redaction-relevant fields.
  const parameters = await tx.testCaseParameter.findMany({
    where: { testCaseId: repositoryCaseId, isDeleted: false },
    orderBy: { order: "asc" },
    select: {
      name: true,
      type: true,
      sensitive: true,
      required: true,
      defaultValue: true,
      order: true,
    },
  });

  // Phase 1 carry-forward: explicit projectId filter on DataSet read.
  // The DataSet @@deny only enforces same-project on create/update.
  const dataset = await tx.dataSet.findFirst({
    where: {
      ownerCaseId: repositoryCaseId,
      projectId,
      isDeleted: false,
    },
    select: {
      id: true,
      name: true,
      rows: {
        where: { isDeleted: false },
        orderBy: { rowIndex: "asc" },
        select: {
          id: true,
          rowIndex: true,
          label: true,
          valuesJson: true,
        },
      },
    },
  });

  // Snapshot rows are deep copies of the dataset rows, augmented with the
  // source row's id and rowIndex so future audit / diff surfaces can
  // correlate back to the originating DataSetRow.
  const snapshotRows = (dataset?.rows ?? []).map((row) => ({
    sourceRowId: row.id,
    rowIndex: row.rowIndex,
    label: row.label,
    valuesJson: row.valuesJson ?? {},
  }));

  // Snapshot first — must precede iteration inserts so we can FK-reference it.
  const snapshot = await tx.testRunCaseDataSetSnapshot.create({
    data: {
      testRunCaseId,
      sourceDataSetId: dataset?.id ?? null,
      sourceDataSetName: dataset?.name ?? "(no dataset)",
      parametersJson: parameters as unknown as Prisma.InputJsonValue,
      rowsJson: snapshotRows as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  });

  // Materialize iterations. `rowIndex` is the schema field for ordering
  // (NOT iterationOrder — see schema.zmodel:2590).
  if (snapshotRows.length > 0) {
    await tx.testRunCaseIteration.createMany({
      data: snapshotRows.map((row, idx) => ({
        testRunCaseId,
        rowIndex: idx,
        label: row.label,
        valuesJson: row.valuesJson as Prisma.InputJsonValue,
        dataSetSnapshotId: snapshot.id,
      })),
    });
  }

  // Update the run-case counter. passedIterations / failedIterations stay
  // at their default (0); they're populated as iteration results land in
  // Task 6 (Wave 2).
  await tx.testRunCases.update({
    where: { id: testRunCaseId },
    data: { totalIterations: snapshotRows.length },
  });

  return { snapshotId: snapshot.id, iterationCount: snapshotRows.length };
}
