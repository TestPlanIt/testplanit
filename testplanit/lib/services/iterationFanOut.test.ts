/**
 * Mocked-tx unit tests for materializeIterations.
 *
 * Companion to iterationFanOut.integration.test.ts (which exercises a real
 * prisma.$transaction). This file covers:
 *   - The `rowIndex` (NOT iterationOrder) field name at the type level
 *   - Progress callback cadence math
 *   - Empty-result short-circuit (no parameterized cases)
 *   - Per-case JSON shape (parametersJson + rowsJson augmentation)
 *
 * These checks would NOT have caught the Phase 1 column-not-found bug
 * (mocked tx accepts any column name) — the integration test is the
 * authoritative gate. This file just gives fast feedback in CI.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { materializeIterations } from "./iterationFanOut";

interface MockTx {
  testRuns: { findUnique: ReturnType<typeof vi.fn> };
  testRunCases: {
    findMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  testCaseParameter: { findMany: ReturnType<typeof vi.fn> };
  dataSet: { findFirst: ReturnType<typeof vi.fn> };
  caseSharedDataSetAssignment: { findUnique: ReturnType<typeof vi.fn> };
  dataSetVersion: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
  };
  testRunCaseDataSetSnapshot: { create: ReturnType<typeof vi.fn> };
  testRunCaseIteration: { createMany: ReturnType<typeof vi.fn> };
}

function buildTx(overrides: Partial<MockTx> = {}): MockTx {
  return {
    testRuns: {
      findUnique: vi.fn().mockResolvedValue({ id: 1, projectId: 100 }),
    },
    testRunCases: {
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue(undefined),
    },
    testCaseParameter: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    dataSet: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    caseSharedDataSetAssignment: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    dataSetVersion: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    testRunCaseDataSetSnapshot: {
      create: vi.fn().mockResolvedValue({ id: 999 }),
    },
    testRunCaseIteration: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    ...overrides,
  };
}

describe("materializeIterations (mocked tx)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when the test run does not exist", async () => {
    const tx = buildTx({
      testRuns: { findUnique: vi.fn().mockResolvedValue(null) },
    });
    await expect(materializeIterations(1, tx as any)).rejects.toThrow(
      /TestRun 1 not found/
    );
  });

  it("returns iterationCount=0 and skips dataset queries when no parameterized cases exist", async () => {
    const tx = buildTx();
    const result = await materializeIterations(1, tx as any);
    expect(result).toEqual({
      iterationCount: 0,
      parameterizedRunCaseCount: 0,
      perRunCase: [],
    });
    expect(tx.dataSet.findFirst).not.toHaveBeenCalled();
    expect(tx.testRunCaseDataSetSnapshot.create).not.toHaveBeenCalled();
    expect(tx.testRunCaseIteration.createMany).not.toHaveBeenCalled();
  });

  it("uses rowIndex (NOT iterationOrder) when creating iterations", async () => {
    const tx = buildTx({
      testRunCases: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 50,
            repositoryCaseId: 200,
            repositoryCase: { id: 200, name: "C", projectId: 100 },
          },
        ]),
        update: vi.fn().mockResolvedValue(undefined),
      },
      dataSet: {
        findFirst: vi.fn().mockResolvedValue({
          id: 7,
          name: "ds",
          rows: [
            { id: 1, rowIndex: 0, label: "a", valuesJson: { x: 1 } },
            { id: 2, rowIndex: 1, label: "b", valuesJson: { x: 2 } },
          ],
        }),
      },
    });
    await materializeIterations(1, tx as any);
    expect(tx.testRunCaseIteration.createMany).toHaveBeenCalledTimes(1);
    const call = tx.testRunCaseIteration.createMany.mock.calls[0][0];
    expect(call.data).toEqual([
      expect.objectContaining({ rowIndex: 0, label: "a" }),
      expect.objectContaining({ rowIndex: 1, label: "b" }),
    ]);
    // Negative assertion — should never use iterationOrder.
    for (const row of call.data) {
      expect(row).not.toHaveProperty("iterationOrder");
    }
  });

  it("writes parametersJson and an augmented rowsJson to the snapshot", async () => {
    const tx = buildTx({
      testRunCases: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 50,
            repositoryCaseId: 200,
            repositoryCase: { id: 200, name: "C", projectId: 100 },
          },
        ]),
        update: vi.fn().mockResolvedValue(undefined),
      },
      testCaseParameter: {
        findMany: vi.fn().mockResolvedValue([
          {
            name: "u",
            type: "STRING",
            sensitive: false,
            required: true,
            defaultValue: null,
            order: 0,
          },
          {
            name: "p",
            type: "STRING",
            sensitive: true,
            required: true,
            defaultValue: null,
            order: 1,
          },
        ]),
      },
      dataSet: {
        findFirst: vi.fn().mockResolvedValue({
          id: 7,
          name: "myds",
          rows: [
            {
              id: 11,
              rowIndex: 0,
              label: "a",
              valuesJson: { u: "x", p: "secret" },
            },
          ],
        }),
      },
    });
    await materializeIterations(1, tx as any);
    expect(tx.testRunCaseDataSetSnapshot.create).toHaveBeenCalledTimes(1);
    const created = tx.testRunCaseDataSetSnapshot.create.mock.calls[0][0].data;
    expect(created.testRunCaseId).toBe(50);
    expect(created.sourceDataSetId).toBe(7);
    expect(created.sourceDataSetName).toBe("myds");
    expect(Array.isArray(created.parametersJson)).toBe(true);
    expect(created.parametersJson).toHaveLength(2);
    expect(Array.isArray(created.rowsJson)).toBe(true);
    expect(created.rowsJson).toEqual([
      {
        sourceRowId: 11,
        rowIndex: 0,
        label: "a",
        valuesJson: { u: "x", p: "secret" },
      },
    ]);
  });

  it("falls back to '(no dataset)' name when the case has no attached dataset", async () => {
    const tx = buildTx({
      testRunCases: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 50,
            repositoryCaseId: 200,
            repositoryCase: { id: 200, name: "C", projectId: 100 },
          },
        ]),
        update: vi.fn().mockResolvedValue(undefined),
      },
      dataSet: { findFirst: vi.fn().mockResolvedValue(null) },
    });
    await materializeIterations(1, tx as any);
    const created = tx.testRunCaseDataSetSnapshot.create.mock.calls[0][0].data;
    expect(created.sourceDataSetId).toBeNull();
    expect(created.sourceDataSetName).toBe("(no dataset)");
    expect(created.rowsJson).toEqual([]);
    // No iterations created when there are zero rows.
    expect(tx.testRunCaseIteration.createMany).not.toHaveBeenCalled();
  });

  it("updates TestRunCases.totalIterations to the row count for each case", async () => {
    const tx = buildTx({
      testRunCases: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 50,
            repositoryCaseId: 200,
            repositoryCase: { id: 200, name: "C", projectId: 100 },
          },
        ]),
        update: vi.fn().mockResolvedValue(undefined),
      },
      dataSet: {
        findFirst: vi.fn().mockResolvedValue({
          id: 7,
          name: "ds",
          rows: [
            { id: 1, rowIndex: 0, label: null, valuesJson: {} },
            { id: 2, rowIndex: 1, label: null, valuesJson: {} },
            { id: 3, rowIndex: 2, label: null, valuesJson: {} },
          ],
        }),
      },
    });
    await materializeIterations(1, tx as any);
    expect(tx.testRunCases.update).toHaveBeenCalledWith({
      where: { id: 50 },
      data: { totalIterations: 3, passedIterations: 0, failedIterations: 0, skippedIterations: 0 },
    });
  });

  it("invokes onProgress at the configured cadence and on the last case", async () => {
    const onProgress = vi.fn();
    const cases = Array.from({ length: 5 }).map((_, i) => ({
      id: i + 1,
      repositoryCaseId: 100 + i,
      repositoryCase: { id: 100 + i, name: `C${i}`, projectId: 100 },
    }));
    const tx = buildTx({
      testRunCases: {
        findMany: vi.fn().mockResolvedValue(cases),
        update: vi.fn().mockResolvedValue(undefined),
      },
      dataSet: {
        findFirst: vi.fn().mockResolvedValue({ id: 1, name: "ds", rows: [] }),
      },
    });
    await materializeIterations(1, tx as any, {
      progressIntervalCases: 2,
      onProgress,
    });
    // Cases 1..5, interval=2 → fires on cases 2 and 4 (cadence) plus case 5 (last).
    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress.mock.calls.map((c) => c[0].processedCases)).toEqual([
      2, 4, 5,
    ]);
  });
});
