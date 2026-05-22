import type { Prisma } from "@prisma/client";

import { applyMapping } from "~/lib/utils/datasetMapping";

// Re-export the pure mapping helpers for ergonomic server-side usage. The
// canonical implementation lives in `~/lib/utils/datasetMapping`. Client
// consumers MUST import directly from that module so the bundler does not
// pull this file (and its Prisma types) into the client bundle.
export { applyMapping, SKIP_SENTINEL } from "~/lib/utils/datasetMapping";

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
      isDeleted: false,
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

  // Resolve the iteration source. Owner-wins: if the case has an owner
  // dataset we use it and never look at the shared assignment, even when
  // both exist. The owner-only path stays bit-for-bit identical to the
  // pre-Shared-Datasets behavior (the new sourceVersionId column is
  // additive and nullable; for owner-only it is always null).
  //
  // Step A: explicit projectId filter on DataSet read. The DataSet @@deny
  // only enforces same-project on create/update, not read.
  const ownerDataset = await tx.dataSet.findFirst({
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

  type ResolvedSourceRow = {
    sourceRowId: number;
    rowIndex: number;
    label: string | null;
    valuesJson: Record<string, unknown>;
  };
  type ResolvedSource = {
    id: number;
    name: string;
    rows: ResolvedSourceRow[];
    pinnedVersionId: number | null;
  };

  let resolvedSource: ResolvedSource | null = null;

  if (ownerDataset) {
    resolvedSource = {
      id: ownerDataset.id,
      name: ownerDataset.name,
      rows: ownerDataset.rows.map((row) => ({
        sourceRowId: row.id,
        rowIndex: row.rowIndex,
        label: row.label,
        valuesJson: (row.valuesJson ?? {}) as Record<string, unknown>,
      })),
      pinnedVersionId: null,
    };
  } else {
    // Step B: no owner dataset — see if the case has a shared-dataset
    // assignment. The schema enforces at most one assignment per case
    // (CaseSharedDataSetAssignment.caseId is @unique).
    const assignment = await tx.caseSharedDataSetAssignment.findUnique({
      where: { caseId: repositoryCaseId },
      select: {
        sharedDataSetId: true,
        pinnedVersionId: true,
        mappingJson: true,
        sharedDataSet: {
          select: { id: true, name: true, projectId: true, version: true },
        },
      },
    });

    // Defense-in-depth cross-project check. The schema @@deny prevents
    // creating an assignment whose dataset lives in another project, but
    // this resolver runs against the unenhanced client (orchestration
    // path) so we re-check at read time.
    if (assignment && assignment.sharedDataSet.projectId === projectId) {
      const targetVersion = assignment.pinnedVersionId
        ? await tx.dataSetVersion.findUnique({
            where: { id: assignment.pinnedVersionId },
            select: { id: true, rowsJson: true },
          })
        : await tx.dataSetVersion.findFirst({
            where: { dataSetId: assignment.sharedDataSetId },
            orderBy: { version: "desc" },
            select: { id: true, rowsJson: true },
          });

      if (targetVersion) {
        const mapping = (assignment.mappingJson ?? {}) as Record<
          string,
          string
        >;
        const versionRows = (targetVersion.rowsJson ?? []) as Array<unknown>;
        const mappedRows: ResolvedSourceRow[] = versionRows.map((row, idx) => {
          // DataSetVersion.rowsJson can store either the augmented snapshot
          // shape ({ valuesJson, label, ... }) or a flat raw-row object.
          // Detect the augmented shape and unwrap.
          const isAugmented =
            typeof row === "object" &&
            row !== null &&
            "valuesJson" in row &&
            typeof (row as Record<string, unknown>).valuesJson === "object" &&
            (row as Record<string, unknown>).valuesJson !== null;
          const raw = isAugmented
            ? ((row as Record<string, unknown>).valuesJson as Record<
                string,
                unknown
              >)
            : ((row ?? {}) as Record<string, unknown>);
          const label =
            typeof row === "object" &&
            row !== null &&
            "label" in row &&
            typeof (row as Record<string, unknown>).label === "string"
              ? ((row as Record<string, unknown>).label as string)
              : null;
          return {
            sourceRowId: idx,
            rowIndex: idx,
            label,
            valuesJson: applyMapping(raw, mapping),
          };
        });
        resolvedSource = {
          id: assignment.sharedDataSetId,
          name: assignment.sharedDataSet.name,
          rows: mappedRows,
          pinnedVersionId: targetVersion.id,
        };
      }
    }
  }

  // Snapshot rows are the resolved-source rows directly. Iterations FK to
  // the snapshot, so we must insert it first.
  const snapshotRows: ResolvedSourceRow[] = resolvedSource?.rows ?? [];

  const snapshot = await tx.testRunCaseDataSetSnapshot.create({
    data: {
      testRunCaseId,
      sourceDataSetId: resolvedSource?.id ?? null,
      sourceDataSetName: resolvedSource?.name ?? "(no dataset)",
      sourceVersionId: resolvedSource?.pinnedVersionId ?? null,
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

  // Update the run-case counter. passedIterations / failedIterations /
  // skippedIterations are written explicitly as 0 so fresh runs start
  // with a documented contract (the column default already provides 0,
  // but the explicit write survives any future default change).
  await tx.testRunCases.update({
    where: { id: testRunCaseId },
    data: {
      totalIterations: snapshotRows.length,
      passedIterations: 0,
      failedIterations: 0,
      skippedIterations: 0,
    },
  });

  return { snapshotId: snapshot.id, iterationCount: snapshotRows.length };
}
