import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  projectJUnitResultOntoRunCase,
  promoteRunToHybrid,
} from "./hybridRunProjection";

function makeClient(overrides: {
  run?: { id: number; testRunType: string; isDeleted?: boolean } | null;
  runCase?: { id: number; totalIterations: number } | null;
}) {
  return {
    testRuns: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    jUnitTestSuite: {
      findUnique: vi.fn().mockResolvedValue(
        overrides.run === null
          ? { testRun: null }
          : {
              testRun: {
                isDeleted: false,
                ...(overrides.run ?? { id: 7, testRunType: "REGULAR" }),
              },
            }
      ),
    },
    testRunCases: {
      findFirst: vi
        .fn()
        .mockResolvedValue(
          overrides.runCase === undefined
            ? { id: 99, totalIterations: 0 }
            : overrides.runCase
        ),
      update: vi.fn().mockResolvedValue({}),
    },
  };
}

const RESULT = { testSuiteId: 3, repositoryCaseId: 11, statusId: 5 };

describe("promoteRunToHybrid", () => {
  it("flips only a live REGULAR run and reports whether a row changed", async () => {
    const client = makeClient({});
    await expect(promoteRunToHybrid(client, 7)).resolves.toBe(true);
    expect(client.testRuns.updateMany).toHaveBeenCalledWith({
      where: { id: 7, testRunType: "REGULAR", isDeleted: false },
      data: { testRunType: "HYBRID" },
    });

    client.testRuns.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(promoteRunToHybrid(client, 7)).resolves.toBe(false);
  });
});

describe("projectJUnitResultOntoRunCase", () => {
  beforeEach(() => vi.clearAllMocks());

  it("promotes a REGULAR run and writes the status onto its run-case", async () => {
    const client = makeClient({});
    await projectJUnitResultOntoRunCase(client, RESULT);

    expect(client.testRuns.updateMany).toHaveBeenCalledTimes(1);
    expect(client.testRunCases.findFirst).toHaveBeenCalledWith({
      where: { testRunId: 7, repositoryCaseId: 11, isDeleted: false },
      select: { id: true, totalIterations: true },
    });
    expect(client.testRunCases.update).toHaveBeenCalledWith({
      where: { id: 99 },
      data: {
        statusId: 5,
        isCompleted: true,
        completedAt: expect.any(Date),
      },
    });
  });

  it("does not re-promote a run that is already HYBRID", async () => {
    const client = makeClient({ run: { id: 7, testRunType: "HYBRID" } });
    await projectJUnitResultOntoRunCase(client, RESULT);
    expect(client.testRuns.updateMany).not.toHaveBeenCalled();
    expect(client.testRunCases.update).toHaveBeenCalledTimes(1);
  });

  it.each(["JUNIT", "TESTNG", "XUNIT", "NUNIT", "MSTEST", "MOCHA", "CUCUMBER"])(
    "leaves a pure automated %s run alone",
    async (testRunType) => {
      const client = makeClient({ run: { id: 7, testRunType } });
      await projectJUnitResultOntoRunCase(client, RESULT);
      expect(client.testRuns.updateMany).not.toHaveBeenCalled();
      expect(client.testRunCases.findFirst).not.toHaveBeenCalled();
      expect(client.testRunCases.update).not.toHaveBeenCalled();
    }
  );

  it("skips a run-case that has iterations — the iteration rollup owns its status", async () => {
    const client = makeClient({ runCase: { id: 99, totalIterations: 3 } });
    await projectJUnitResultOntoRunCase(client, RESULT);
    expect(client.testRunCases.update).not.toHaveBeenCalled();
  });

  it("skips when the case is not in the run", async () => {
    const client = makeClient({ runCase: null });
    await projectJUnitResultOntoRunCase(client, RESULT);
    expect(client.testRunCases.update).not.toHaveBeenCalled();
  });

  it("still promotes but writes nothing when the result carries no status", async () => {
    const client = makeClient({});
    await projectJUnitResultOntoRunCase(client, { ...RESULT, statusId: null });
    expect(client.testRuns.updateMany).toHaveBeenCalledTimes(1);
    expect(client.testRunCases.findFirst).not.toHaveBeenCalled();
  });

  it("is a no-op for a result with no repository case, or a deleted / missing run", async () => {
    const noCase = makeClient({});
    await projectJUnitResultOntoRunCase(noCase, {
      ...RESULT,
      repositoryCaseId: null,
    });
    expect(noCase.jUnitTestSuite.findUnique).not.toHaveBeenCalled();

    const deleted = makeClient({
      run: { id: 7, testRunType: "REGULAR", isDeleted: true },
    });
    await projectJUnitResultOntoRunCase(deleted, RESULT);
    expect(deleted.testRuns.updateMany).not.toHaveBeenCalled();

    const missing = makeClient({ run: null });
    await projectJUnitResultOntoRunCase(missing, RESULT);
    expect(missing.testRuns.updateMany).not.toHaveBeenCalled();
  });
});
