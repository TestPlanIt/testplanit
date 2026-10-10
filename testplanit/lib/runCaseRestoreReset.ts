/**
 * A run case that is restored after being removed comes back untested.
 *
 * Removing a case from a run soft-deletes its row together with its results
 * and iterations. Every path that put the case back used to flip `isDeleted`
 * alone, so the row kept the status, timing and iteration counts of results
 * that no longer exist — the run page showed "Passed" with nothing behind it.
 * The MCP server reset those fields itself; this hook does it for every
 * writer, and brings the case's iterations back untested with it.
 */

export type RunCaseRestoreClient = {
  testRunCases: {
    findMany(args: {
      where: Record<string, unknown>;
      select: { id: true; repositoryCaseId: true };
    }): Promise<Array<{ id: number; repositoryCaseId: number }>>;
  };
  testRunCaseIteration: {
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
};

export const RUN_CASE_RESTORE_RESET = {
  statusId: null,
  isCompleted: false,
  startedAt: null,
  completedAt: null,
  elapsed: null,
  passedIterations: 0,
  failedIterations: 0,
  skippedIterations: 0,
} as const;

const ITERATION_RESTORE_RESET = {
  isDeleted: false,
  statusId: null,
  isCompleted: false,
  startedAt: null,
  completedAt: null,
  elapsed: null,
} as const;

const idOf = (value: unknown): number | undefined =>
  typeof value === "number" ? value : undefined;

const isRestore = (data: unknown): data is Record<string, unknown> =>
  !!data &&
  typeof data === "object" &&
  (data as { isDeleted?: unknown }).isDeleted === false;

type NestedEntry = {
  where?: Record<string, unknown>;
  update?: unknown;
  data?: unknown;
};

/**
 * Call before a TestRunCases or TestRuns write. Rewrites the restore so the
 * rows that are currently removed come back reset, and returns the follow-up
 * that restores their iterations, to run once the write has committed.
 * Returns null when the write restores nothing.
 */
export async function prepareRunCaseRestore(
  model: string,
  operation: string,
  args: unknown,
  client: RunCaseRestoreClient
): Promise<(() => Promise<void>) | null> {
  const restoredIds: number[] = [];

  if (model === "TestRunCases") {
    const payload = args as {
      where?: Record<string, unknown>;
      data?: unknown;
      update?: unknown;
    };
    const branch = operation === "upsert" ? payload?.update : payload?.data;
    if (
      (operation === "update" ||
        operation === "updateMany" ||
        operation === "upsert") &&
      isRestore(branch)
    ) {
      const targeted = await client.testRunCases.findMany({
        where: payload.where ?? {},
        select: { id: true, repositoryCaseId: true },
      });
      const removed = await client.testRunCases.findMany({
        where: { AND: [payload.where ?? {}, { isDeleted: true }] },
        select: { id: true, repositoryCaseId: true },
      });
      // One data object serves every targeted row, so the reset is applied
      // only when every row it reaches is a removed one; a mixed batch keeps
      // its live rows' progress and merely un-deletes the rest.
      if (removed.length > 0 && removed.length === targeted.length) {
        Object.assign(branch, RUN_CASE_RESTORE_RESET);
      }
      restoredIds.push(...removed.map((r) => r.id));
    }
  } else if (
    model === "TestRuns" &&
    (operation === "update" || operation === "upsert")
  ) {
    const payload = args as {
      where?: { id?: unknown };
      data?: { testCases?: Record<string, unknown> };
      update?: { testCases?: Record<string, unknown> };
    };
    const runId = idOf(payload?.where?.id);
    const nested = (operation === "upsert" ? payload?.update : payload?.data)
      ?.testCases;
    if (runId !== undefined && nested) {
      // Nested writes that may un-delete a run case: upsert (the run page's
      // add-cases save) and update entries. Each names the case by the
      // run/case unique key or by id.
      const entries: Array<{ entry: NestedEntry; branch: unknown }> = [];
      for (const e of [nested.upsert].flat()) {
        if (e && typeof e === "object") {
          entries.push({
            entry: e as NestedEntry,
            branch: (e as NestedEntry).update,
          });
        }
      }
      for (const e of [nested.update].flat()) {
        if (e && typeof e === "object") {
          entries.push({
            entry: e as NestedEntry,
            branch: (e as NestedEntry).data,
          });
        }
      }
      const restoring = entries.filter(({ branch }) => isRestore(branch));
      if (restoring.length > 0) {
        const caseIds = restoring
          .map(({ entry }) => caseIdOfKey(entry.where))
          .filter((id): id is number => id !== undefined);
        const rowIds = restoring
          .map(({ entry }) => idOf(entry.where?.id))
          .filter((id): id is number => id !== undefined);
        const removed = await client.testRunCases.findMany({
          where: {
            testRunId: runId,
            isDeleted: true,
            OR: [
              ...(caseIds.length
                ? [{ repositoryCaseId: { in: caseIds } }]
                : []),
              ...(rowIds.length ? [{ id: { in: rowIds } }] : []),
            ],
          },
          select: { id: true, repositoryCaseId: true },
        });
        const removedByCase = new Map(
          removed.map((r) => [r.repositoryCaseId, r.id])
        );
        const removedById = new Set(removed.map((r) => r.id));
        for (const { entry, branch } of restoring) {
          const caseId = caseIdOfKey(entry.where);
          const rowId = idOf(entry.where?.id);
          const hit =
            (caseId !== undefined && removedByCase.has(caseId)) ||
            (rowId !== undefined && removedById.has(rowId));
          if (hit)
            Object.assign(
              branch as Record<string, unknown>,
              RUN_CASE_RESTORE_RESET
            );
        }
        restoredIds.push(...removed.map((r) => r.id));
      }
    }
  }

  if (restoredIds.length === 0) return null;
  return async () => {
    await client.testRunCaseIteration.updateMany({
      where: { testRunCaseId: { in: restoredIds }, isDeleted: true },
      data: { ...ITERATION_RESTORE_RESET },
    });
  };
}

function caseIdOfKey(
  where: Record<string, unknown> | undefined
): number | undefined {
  const key = where?.testRunId_repositoryCaseId as
    { repositoryCaseId?: unknown } | undefined;
  return idOf(key?.repositoryCaseId) ?? idOf(where?.repositoryCaseId);
}
