import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  buildEligibleCasesWhere,
  filterEligibleCaseIds,
  getProjectExclusionFlag,
  isCaseEligibleForRun,
  softDeleteUnexecutedRunCasesForDraftRevert,
} from "./runCaseEligibility";

function buildTx(overrides: Partial<MockTx> = {}): MockTx {
  return {
    projects: { findUnique: vi.fn() },
    repositoryCases: { findUnique: vi.fn(), findMany: vi.fn() },
    workflows: { findUnique: vi.fn() },
    testRunCases: { updateMany: vi.fn() },
    ...overrides,
  };
}

interface MockTx {
  projects: { findUnique: ReturnType<typeof vi.fn> };
  repositoryCases: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  workflows: { findUnique: ReturnType<typeof vi.fn> };
  testRunCases: { updateMany: ReturnType<typeof vi.fn> };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildEligibleCasesWhere", () => {
  it("returns {} when the flag is off — safe to spread into any existing where", () => {
    expect(
      buildEligibleCasesWhere({
        project: { excludeNotStartedFromRuns: false },
      })
    ).toEqual({});
  });

  it("returns {} when project is null/undefined (defensive — never block on missing flag probe)", () => {
    expect(buildEligibleCasesWhere({ project: null })).toEqual({});
    expect(buildEligibleCasesWhere({ project: undefined })).toEqual({});
  });

  it("returns the NOT_STARTED-exclusion fragment when the flag is on", () => {
    expect(
      buildEligibleCasesWhere({
        project: { excludeNotStartedFromRuns: true },
      })
    ).toEqual({
      state: { workflowType: { not: "NOT_STARTED" } },
    });
  });
});

describe("getProjectExclusionFlag", () => {
  it("returns false when project not found (defensive default)", async () => {
    const tx = buildTx();
    tx.projects.findUnique.mockResolvedValue(null);
    expect(await getProjectExclusionFlag(tx as never, 42)).toBe(false);
  });

  it("returns the boolean from the project row when present", async () => {
    const tx = buildTx();
    tx.projects.findUnique.mockResolvedValue({
      excludeNotStartedFromRuns: true,
    });
    expect(await getProjectExclusionFlag(tx as never, 42)).toBe(true);
    expect(tx.projects.findUnique).toHaveBeenCalledWith({
      where: { id: 42 },
      select: { excludeNotStartedFromRuns: true },
    });
  });
});

describe("isCaseEligibleForRun", () => {
  it("returns true when the flag is off — no DB roundtrip on the case", async () => {
    const tx = buildTx();
    tx.projects.findUnique.mockResolvedValue({
      excludeNotStartedFromRuns: false,
    });
    expect(
      await isCaseEligibleForRun(tx as never, {
        projectId: 1,
        repositoryCaseId: 100,
      })
    ).toBe(true);
    expect(tx.repositoryCases.findUnique).not.toHaveBeenCalled();
  });

  it("returns true when the case is missing — don't mask 'case not found' as 'ineligible'", async () => {
    const tx = buildTx();
    tx.projects.findUnique.mockResolvedValue({
      excludeNotStartedFromRuns: true,
    });
    tx.repositoryCases.findUnique.mockResolvedValue(null);
    expect(
      await isCaseEligibleForRun(tx as never, {
        projectId: 1,
        repositoryCaseId: 100,
      })
    ).toBe(true);
  });

  it("returns true for IN_PROGRESS / DONE cases regardless of flag", async () => {
    const tx = buildTx();
    tx.projects.findUnique.mockResolvedValue({
      excludeNotStartedFromRuns: true,
    });
    tx.repositoryCases.findUnique.mockResolvedValue({
      state: { workflowType: "IN_PROGRESS" },
    });
    expect(
      await isCaseEligibleForRun(tx as never, {
        projectId: 1,
        repositoryCaseId: 100,
      })
    ).toBe(true);
  });

  it("returns false only when flag is on AND case state is NOT_STARTED", async () => {
    const tx = buildTx();
    tx.projects.findUnique.mockResolvedValue({
      excludeNotStartedFromRuns: true,
    });
    tx.repositoryCases.findUnique.mockResolvedValue({
      state: { workflowType: "NOT_STARTED" },
    });
    expect(
      await isCaseEligibleForRun(tx as never, {
        projectId: 1,
        repositoryCaseId: 100,
      })
    ).toBe(false);
  });
});

describe("filterEligibleCaseIds", () => {
  it("returns empty for empty input without any DB hit", async () => {
    const tx = buildTx();
    expect(
      await filterEligibleCaseIds(tx as never, {
        projectId: 1,
        repositoryCaseIds: [],
      })
    ).toEqual([]);
    expect(tx.projects.findUnique).not.toHaveBeenCalled();
  });

  it("passes through the input when the flag is off", async () => {
    const tx = buildTx();
    tx.projects.findUnique.mockResolvedValue({
      excludeNotStartedFromRuns: false,
    });
    expect(
      await filterEligibleCaseIds(tx as never, {
        projectId: 1,
        repositoryCaseIds: [10, 20, 30],
      })
    ).toEqual([10, 20, 30]);
    expect(tx.repositoryCases.findMany).not.toHaveBeenCalled();
  });

  it("drops NOT_STARTED ids and preserves input order", async () => {
    const tx = buildTx();
    tx.projects.findUnique.mockResolvedValue({
      excludeNotStartedFromRuns: true,
    });
    // Eligible (non-NOT_STARTED) ids returned from DB
    tx.repositoryCases.findMany.mockResolvedValue([{ id: 10 }, { id: 30 }]);
    expect(
      await filterEligibleCaseIds(tx as never, {
        projectId: 1,
        repositoryCaseIds: [10, 20, 30],
      })
    ).toEqual([10, 30]);
    expect(tx.repositoryCases.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          projectId: 1,
          isDeleted: false,
          state: { workflowType: { not: "NOT_STARTED" } },
        }),
      })
    );
  });

  it("scopes by projectId so it cannot leak ids from another project", async () => {
    const tx = buildTx();
    tx.projects.findUnique.mockResolvedValue({
      excludeNotStartedFromRuns: true,
    });
    tx.repositoryCases.findMany.mockResolvedValue([{ id: 10 }]);
    await filterEligibleCaseIds(tx as never, {
      projectId: 99,
      repositoryCaseIds: [10, 11],
    });
    const callArg = tx.repositoryCases.findMany.mock.calls[0][0];
    expect(callArg.where.projectId).toBe(99);
  });
});

describe("softDeleteUnexecutedRunCasesForDraftRevert", () => {
  it("returns 0 and does no work when the project flag is off", async () => {
    const tx = buildTx();
    tx.projects.findUnique.mockResolvedValue({
      excludeNotStartedFromRuns: false,
    });
    const count = await softDeleteUnexecutedRunCasesForDraftRevert(
      tx as never,
      { projectId: 1, repositoryCaseId: 100, newStateId: 9 }
    );
    expect(count).toBe(0);
    expect(tx.workflows.findUnique).not.toHaveBeenCalled();
    expect(tx.testRunCases.updateMany).not.toHaveBeenCalled();
  });

  it("returns 0 when the new state is IN_PROGRESS / DONE (not a NOT_STARTED revert)", async () => {
    const tx = buildTx();
    tx.projects.findUnique.mockResolvedValue({
      excludeNotStartedFromRuns: true,
    });
    tx.workflows.findUnique.mockResolvedValue({ workflowType: "IN_PROGRESS" });
    const count = await softDeleteUnexecutedRunCasesForDraftRevert(
      tx as never,
      { projectId: 1, repositoryCaseId: 100, newStateId: 9 }
    );
    expect(count).toBe(0);
    expect(tx.testRunCases.updateMany).not.toHaveBeenCalled();
  });

  it("returns 0 when the new state row is missing (defensive)", async () => {
    const tx = buildTx();
    tx.projects.findUnique.mockResolvedValue({
      excludeNotStartedFromRuns: true,
    });
    tx.workflows.findUnique.mockResolvedValue(null);
    const count = await softDeleteUnexecutedRunCasesForDraftRevert(
      tx as never,
      { projectId: 1, repositoryCaseId: 100, newStateId: 9 }
    );
    expect(count).toBe(0);
    expect(tx.testRunCases.updateMany).not.toHaveBeenCalled();
  });

  it("soft-deletes unexecuted run-cases in open runs when flag+state align", async () => {
    const tx = buildTx();
    tx.projects.findUnique.mockResolvedValue({
      excludeNotStartedFromRuns: true,
    });
    tx.workflows.findUnique.mockResolvedValue({ workflowType: "NOT_STARTED" });
    tx.testRunCases.updateMany.mockResolvedValue({ count: 3 });

    const count = await softDeleteUnexecutedRunCasesForDraftRevert(
      tx as never,
      { projectId: 1, repositoryCaseId: 100, newStateId: 11 }
    );

    expect(count).toBe(3);
    expect(tx.testRunCases.updateMany).toHaveBeenCalledWith({
      where: {
        repositoryCaseId: 100,
        isDeleted: false,
        testRun: { isCompleted: false },
        results: { none: {} },
      },
      data: { isDeleted: true },
    });
  });

  it("preserves the executed-lock contract via results:{none:{}} (never matches rows with results)", async () => {
    const tx = buildTx();
    tx.projects.findUnique.mockResolvedValue({
      excludeNotStartedFromRuns: true,
    });
    tx.workflows.findUnique.mockResolvedValue({ workflowType: "NOT_STARTED" });
    tx.testRunCases.updateMany.mockResolvedValue({ count: 0 });

    await softDeleteUnexecutedRunCasesForDraftRevert(tx as never, {
      projectId: 1,
      repositoryCaseId: 100,
      newStateId: 11,
    });

    // The "executed-lock" guarantee lives in the predicate, not in caller code.
    // Asserting the predicate's exact shape here means a future "optimization"
    // that drops `results: { none: {} }` (e.g. for perf) breaks this test
    // before it can corrupt a recorded result.
    const args = tx.testRunCases.updateMany.mock.calls[0][0];
    expect(args.where.results).toEqual({ none: {} });
    expect(args.where.testRun).toEqual({ isCompleted: false });
  });

  it("returns 0 when updateMany matched no rows (case had no open-run trcs)", async () => {
    const tx = buildTx();
    tx.projects.findUnique.mockResolvedValue({
      excludeNotStartedFromRuns: true,
    });
    tx.workflows.findUnique.mockResolvedValue({ workflowType: "NOT_STARTED" });
    tx.testRunCases.updateMany.mockResolvedValue({ count: 0 });

    const count = await softDeleteUnexecutedRunCasesForDraftRevert(
      tx as never,
      { projectId: 1, repositoryCaseId: 100, newStateId: 11 }
    );
    expect(count).toBe(0);
  });
});
