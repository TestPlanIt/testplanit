/**
 * Keeps the denormalized `TestRunCases.statusId` in sync when an existing
 * result is edited in place.
 *
 * `TestRunCases.statusId` is the column every run-level view reads: the donut
 * counts and per-status totals in `getRegularRunSummary`, the per-case status
 * chip in the run detail page, and the run/case exports. It is NOT derived at
 * read time — `submit-result` writes it on every submission (directly on the
 * legacy path, via the worst-of rollup on the parameterized path).
 *
 * `edit-result` used to write only the `TestRunResults` row, so an in-place
 * edit left that column holding the pre-edit outcome. The Test Result History
 * (which reads the result rows) showed the new status while the run still
 * showed the old one — a case edited Passed → Failed kept reporting green.
 *
 * These helpers close that gap by re-deriving the case status after an edit
 * using the same rules `submit-result` applies when recording one.
 */

import {
  computeWorstOfStatus,
  type RollupStatus,
} from "~/lib/services/iterationRollup";
import { isAutomatedTestRunType } from "~/utils/testResultTypes";

/**
 * Minimal structural shape of the client used here — accepts both the
 * singleton and a `TxClient`. Callers pass their active transaction so the
 * status sync commits (or rolls back) with the result write itself.
 */
type SyncTx = {
  testRunResults: { findFirst: (args: any) => Promise<any> };
  testRunCases: {
    update: (args: any) => Promise<any>;
    findUnique: (args: any) => Promise<any>;
  };
  testRunCaseIteration: {
    update: (args: any) => Promise<any>;
    findMany: (args: any) => Promise<any[]>;
  };
  status: { findMany: (args: any) => Promise<any[]> };
};

export interface SyncRunCaseStatusAfterResultEditParams {
  testRunCaseId: number;
  /** The result row that was just edited. */
  resultId: number;
  /** The edited result's iteration, or null for a non-parameterized case. */
  iterationId: number | null;
  /** The status the result was edited to. */
  statusId: number;
}

/**
 * Re-derives and persists `TestRunCases.statusId` (plus the iteration
 * counters, when parameterized) after a result's status was edited.
 *
 * Must be called inside the same transaction as the result update.
 */
export async function syncRunCaseStatusAfterResultEdit(
  tx: SyncTx,
  params: SyncRunCaseStatusAfterResultEditParams
): Promise<void> {
  const { testRunCaseId, resultId, iterationId, statusId } = params;

  if (iterationId != null) {
    // Parameterized path: the result belongs to one iteration, so re-point
    // that iteration at the edited status and roll the case up from ALL live
    // iterations — the same two steps `submit-result` performs on record.
    await tx.testRunCaseIteration.update({
      where: { id: iterationId },
      data: { statusId },
    });
    await rollupRunCaseFromIterations(tx, testRunCaseId, statusId);
    return;
  }

  // Legacy (non-parameterized) path: `submit-result` overwrites the case
  // status on every submission, so the column always mirrors the most recent
  // result. Editing an OLDER attempt must therefore leave it alone — only the
  // latest result still speaks for the case.
  const latest = await tx.testRunResults.findFirst({
    where: { testRunCaseId, isDeleted: false },
    orderBy: [{ executedAt: "desc" }, { id: "desc" }],
    select: { id: true },
  });
  if (!latest || latest.id !== resultId) return;

  await tx.testRunCases.update({
    where: { id: testRunCaseId },
    data: { statusId },
  });
}

/**
 * Re-derives `TestRunCases.statusId` after a result was soft-deleted or
 * restored, falling back to whatever live results remain — the previous
 * attempt, or "untested" (null) when the last one is gone.
 *
 * Unlike the edit path this is deliberately **skipped for automated runs**.
 * A manual edit states an explicit outcome for a specific result, so writing
 * it through is right for any run type; a removal instead has to *infer* the
 * replacement, and on JUnit-family runs the case status is owned by the import
 * pipeline (`/api/test-results/import`, `junitIterationRouter`) across attempts
 * rather than by the newest result row. Inferring there would fight the
 * importer — ~900 automated cases in the current DB legitimately hold a status
 * that is not their newest result's. Those runs are left to the importer, which
 * rewrites the status on the next import.
 *
 * Must be called inside the same transaction as the delete/restore.
 */
export async function syncRunCaseStatusAfterResultRemoval(
  tx: SyncTx,
  params: { testRunCaseId: number; iterationId: number | null }
): Promise<void> {
  const { testRunCaseId, iterationId } = params;

  const runCase = await tx.testRunCases.findUnique({
    where: { id: testRunCaseId },
    select: { testRun: { select: { testRunType: true } } },
  });
  if (!runCase) return;
  if (isAutomatedTestRunType(runCase.testRun.testRunType)) return;

  if (iterationId != null) {
    // Re-point the iteration at its newest surviving result, or clear it back
    // to untested when the removal took the last one.
    const latestForIteration = await tx.testRunResults.findFirst({
      where: { iterationId, isDeleted: false },
      orderBy: [{ executedAt: "desc" }, { id: "desc" }],
      select: { statusId: true },
    });
    await tx.testRunCaseIteration.update({
      where: { id: iterationId },
      data: latestForIteration
        ? { statusId: latestForIteration.statusId }
        : { statusId: null, isCompleted: false, completedAt: null },
    });
    await rollupRunCaseFromIterations(tx, testRunCaseId, null);
    return;
  }

  const latest = await tx.testRunResults.findFirst({
    where: { testRunCaseId, isDeleted: false },
    orderBy: [{ executedAt: "desc" }, { id: "desc" }],
    select: { statusId: true },
  });

  // No live result left → back to untested. `TestRunCases.statusId` is
  // nullable and null is what the run views already render as
  // Untested/Pending, so this is the same state a never-executed case has.
  await tx.testRunCases.update({
    where: { id: testRunCaseId },
    data: { statusId: latest ? latest.statusId : null },
  });
}

/**
 * Recomputes a parameterized run-case's rolled-up status and its
 * passed/failed/skipped iteration counters from its live iterations.
 *
 * `totalIterations` is deliberately untouched: it is owned by fan-out
 * (`iterationFanOut`) and is not a function of recorded results.
 *
 * @param fallbackStatusId Written when the rollup yields null — i.e. no status
 *   resolved at all. The edit path passes the edited status; the removal path
 *   passes null (untested), since it has no outcome to assert.
 */
export async function rollupRunCaseFromIterations(
  tx: SyncTx,
  testRunCaseId: number,
  fallbackStatusId: number | null
): Promise<void> {
  const iterations = await tx.testRunCaseIteration.findMany({
    where: { testRunCaseId, isDeleted: false },
    select: {
      statusId: true,
      status: {
        select: {
          id: true,
          systemName: true,
          isSuccess: true,
          isFailure: true,
          isCompleted: true,
        },
      },
    },
  });

  const allStatuses = await tx.status.findMany({
    where: { isDeleted: false },
    select: {
      id: true,
      systemName: true,
      isSuccess: true,
      isFailure: true,
      isCompleted: true,
      order: true,
    },
  });
  const statusMap = new Map<number, RollupStatus>(
    allStatuses.map((s) => [
      s.id,
      {
        id: s.id,
        systemName: s.systemName,
        isSuccess: s.isSuccess,
        isFailure: s.isFailure,
        isCompleted: s.isCompleted,
        order: s.order,
      },
    ])
  );

  const rollupStatusId = computeWorstOfStatus(
    iterations.map((it) => ({ statusId: it.statusId })),
    statusMap
  );

  const passedCount = iterations.filter(
    (it) => it.status?.isSuccess === true
  ).length;
  const failedCount = iterations.filter(
    (it) => it.status?.isFailure === true
  ).length;
  const skippedCount = iterations.filter(
    (it) =>
      it.status != null &&
      it.status.isSuccess === false &&
      it.status.isFailure === false &&
      it.status.isCompleted === true
  ).length;

  await tx.testRunCases.update({
    where: { id: testRunCaseId },
    data: {
      statusId: rollupStatusId ?? fallbackStatusId,
      passedIterations: passedCount,
      failedIterations: failedCount,
      skippedIterations: skippedCount,
    },
  });
}
