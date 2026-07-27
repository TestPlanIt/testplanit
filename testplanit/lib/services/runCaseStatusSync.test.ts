import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  syncRunCaseStatusAfterResultEdit,
  syncRunCaseStatusAfterResultRemoval,
} from "./runCaseStatusSync";

/**
 * Statuses used across the fixtures. Only the (isSuccess, isFailure,
 * isCompleted) triplet and `order` matter to the rollup; names are cosmetic.
 */
const STATUSES = [
  {
    id: 1,
    systemName: "untested",
    isSuccess: false,
    isFailure: false,
    isCompleted: false,
    order: 0,
  },
  {
    id: 2,
    systemName: "passed",
    isSuccess: true,
    isFailure: false,
    isCompleted: true,
    order: 1,
  },
  {
    id: 3,
    systemName: "failed",
    isSuccess: false,
    isFailure: true,
    isCompleted: true,
    order: 2,
  },
  {
    id: 4,
    systemName: "skipped",
    isSuccess: false,
    isFailure: false,
    isCompleted: true,
    order: 3,
  },
];

const statusById = (id: number | null) =>
  id == null ? null : (STATUSES.find((s) => s.id === id) ?? null);

function makeTx() {
  return {
    testRunResults: { findFirst: vi.fn() },
    testRunCases: {
      update: vi.fn().mockResolvedValue({}),
      findUnique: vi
        .fn()
        .mockResolvedValue({ testRun: { testRunType: "REGULAR" } }),
    },
    testRunCaseIteration: {
      update: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
    },
    status: { findMany: vi.fn().mockResolvedValue(STATUSES) },
  };
}

describe("syncRunCaseStatusAfterResultEdit", () => {
  let tx: ReturnType<typeof makeTx>;

  beforeEach(() => {
    tx = makeTx();
  });

  describe("non-parameterized (legacy) path", () => {
    it("writes the edited status onto the run case when the edited result is the latest", async () => {
      tx.testRunResults.findFirst.mockResolvedValue({ id: 99 });

      await syncRunCaseStatusAfterResultEdit(tx, {
        testRunCaseId: 850743,
        resultId: 99,
        iterationId: null,
        statusId: 3,
      });

      expect(tx.testRunCases.update).toHaveBeenCalledWith({
        where: { id: 850743 },
        data: { statusId: 3 },
      });
      // Legacy path never touches iterations.
      expect(tx.testRunCaseIteration.update).not.toHaveBeenCalled();
    });

    it("orders by executedAt then id and ignores soft-deleted results", async () => {
      tx.testRunResults.findFirst.mockResolvedValue({ id: 99 });

      await syncRunCaseStatusAfterResultEdit(tx, {
        testRunCaseId: 10,
        resultId: 99,
        iterationId: null,
        statusId: 2,
      });

      expect(tx.testRunResults.findFirst).toHaveBeenCalledWith({
        where: { testRunCaseId: 10, isDeleted: false },
        orderBy: [{ executedAt: "desc" }, { id: "desc" }],
        select: { id: true },
      });
    });

    it("leaves the run case alone when an older attempt is edited", async () => {
      // A newer attempt exists, so it — not the edited row — speaks for the case.
      tx.testRunResults.findFirst.mockResolvedValue({ id: 100 });

      await syncRunCaseStatusAfterResultEdit(tx, {
        testRunCaseId: 10,
        resultId: 99,
        iterationId: null,
        statusId: 3,
      });

      expect(tx.testRunCases.update).not.toHaveBeenCalled();
    });

    it("is a no-op when no live result remains", async () => {
      tx.testRunResults.findFirst.mockResolvedValue(null);

      await syncRunCaseStatusAfterResultEdit(tx, {
        testRunCaseId: 10,
        resultId: 99,
        iterationId: null,
        statusId: 3,
      });

      expect(tx.testRunCases.update).not.toHaveBeenCalled();
    });
  });

  describe("parameterized (iteration) path", () => {
    const iterations = (statusIds: Array<number | null>) =>
      statusIds.map((id) => ({ statusId: id, status: statusById(id) }));

    it("re-points the edited iteration and rolls the case up to the failure", async () => {
      // Iteration 500 was just edited passed -> failed; 501 stayed passed.
      tx.testRunCaseIteration.findMany.mockResolvedValue(iterations([3, 2]));

      await syncRunCaseStatusAfterResultEdit(tx, {
        testRunCaseId: 10,
        resultId: 99,
        iterationId: 500,
        statusId: 3,
      });

      expect(tx.testRunCaseIteration.update).toHaveBeenCalledWith({
        where: { id: 500 },
        data: { statusId: 3 },
      });
      expect(tx.testRunCases.update).toHaveBeenCalledWith({
        where: { id: 10 },
        data: {
          statusId: 3,
          passedIterations: 1,
          failedIterations: 1,
          skippedIterations: 0,
        },
      });
    });

    it("rolls back to passed when the last failing iteration is edited away", async () => {
      tx.testRunCaseIteration.findMany.mockResolvedValue(iterations([2, 2, 4]));

      await syncRunCaseStatusAfterResultEdit(tx, {
        testRunCaseId: 10,
        resultId: 99,
        iterationId: 500,
        statusId: 2,
      });

      expect(tx.testRunCases.update).toHaveBeenCalledWith({
        where: { id: 10 },
        data: {
          statusId: 2,
          passedIterations: 2,
          failedIterations: 0,
          skippedIterations: 1,
        },
      });
    });

    it("never recomputes totalIterations (owned by fan-out)", async () => {
      tx.testRunCaseIteration.findMany.mockResolvedValue(iterations([3]));

      await syncRunCaseStatusAfterResultEdit(tx, {
        testRunCaseId: 10,
        resultId: 99,
        iterationId: 500,
        statusId: 3,
      });

      const data = tx.testRunCases.update.mock.calls[0][0].data;
      expect(data).not.toHaveProperty("totalIterations");
    });

    it("falls back to the edited status when the case has no live iterations", async () => {
      tx.testRunCaseIteration.findMany.mockResolvedValue([]);

      await syncRunCaseStatusAfterResultEdit(tx, {
        testRunCaseId: 10,
        resultId: 99,
        iterationId: 500,
        statusId: 3,
      });

      // computeWorstOfStatus returns the first untested status for an empty
      // list, so the fallback only applies when no status resolves at all.
      expect(tx.testRunCases.update).toHaveBeenCalledWith({
        where: { id: 10 },
        data: {
          statusId: 1,
          passedIterations: 0,
          failedIterations: 0,
          skippedIterations: 0,
        },
      });
    });

    it("does not consult the result table on the iteration path", async () => {
      tx.testRunCaseIteration.findMany.mockResolvedValue(iterations([3]));

      await syncRunCaseStatusAfterResultEdit(tx, {
        testRunCaseId: 10,
        resultId: 99,
        iterationId: 500,
        statusId: 3,
      });

      expect(tx.testRunResults.findFirst).not.toHaveBeenCalled();
    });
  });
});

describe("syncRunCaseStatusAfterResultRemoval", () => {
  let tx: ReturnType<typeof makeTx>;

  beforeEach(() => {
    tx = makeTx();
  });

  it("falls back to the surviving result's status", async () => {
    // The newest result was deleted; the previous attempt (Failed) survives.
    tx.testRunResults.findFirst.mockResolvedValue({ statusId: 3 });

    await syncRunCaseStatusAfterResultRemoval(tx, {
      testRunCaseId: 850743,
      iterationId: null,
    });

    expect(tx.testRunCases.update).toHaveBeenCalledWith({
      where: { id: 850743 },
      data: { statusId: 3 },
    });
  });

  it("clears the case back to untested when the last result is removed", async () => {
    tx.testRunResults.findFirst.mockResolvedValue(null);

    await syncRunCaseStatusAfterResultRemoval(tx, {
      testRunCaseId: 10,
      iterationId: null,
    });

    expect(tx.testRunCases.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { statusId: null },
    });
  });

  it("skips automated runs, whose status the import pipeline owns", async () => {
    tx.testRunCases.findUnique.mockResolvedValue({
      testRun: { testRunType: "JUNIT" },
    });

    await syncRunCaseStatusAfterResultRemoval(tx, {
      testRunCaseId: 10,
      iterationId: null,
    });

    expect(tx.testRunCases.update).not.toHaveBeenCalled();
    expect(tx.testRunResults.findFirst).not.toHaveBeenCalled();
  });

  it("is a no-op when the run case no longer exists", async () => {
    tx.testRunCases.findUnique.mockResolvedValue(null);

    await syncRunCaseStatusAfterResultRemoval(tx, {
      testRunCaseId: 10,
      iterationId: null,
    });

    expect(tx.testRunCases.update).not.toHaveBeenCalled();
  });

  it("re-points the iteration at its surviving result and re-rolls the case", async () => {
    tx.testRunResults.findFirst.mockResolvedValue({ statusId: 2 });
    tx.testRunCaseIteration.findMany.mockResolvedValue([
      { statusId: 2, status: statusById(2) },
      { statusId: 2, status: statusById(2) },
    ]);

    await syncRunCaseStatusAfterResultRemoval(tx, {
      testRunCaseId: 10,
      iterationId: 500,
    });

    expect(tx.testRunCaseIteration.update).toHaveBeenCalledWith({
      where: { id: 500 },
      data: { statusId: 2 },
    });
    expect(tx.testRunCases.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: {
        statusId: 2,
        passedIterations: 2,
        failedIterations: 0,
        skippedIterations: 0,
      },
    });
  });

  it("clears the iteration back to incomplete when its last result is removed", async () => {
    tx.testRunResults.findFirst.mockResolvedValue(null);
    tx.testRunCaseIteration.findMany.mockResolvedValue([
      { statusId: null, status: null },
    ]);

    await syncRunCaseStatusAfterResultRemoval(tx, {
      testRunCaseId: 10,
      iterationId: 500,
    });

    expect(tx.testRunCaseIteration.update).toHaveBeenCalledWith({
      where: { id: 500 },
      data: { statusId: null, isCompleted: false, completedAt: null },
    });
    // All iterations unrecorded → the rollup returns the untested status.
    expect(tx.testRunCases.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: {
        statusId: 1,
        passedIterations: 0,
        failedIterations: 0,
        skippedIterations: 0,
      },
    });
  });
});
