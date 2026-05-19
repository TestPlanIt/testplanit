import { beforeEach, describe, expect, it, vi } from "vitest";

import { computeCellCount, runCellCountPreflight } from "./matrixCellCount";

describe("computeCellCount", () => {
  it("returns 0 for empty case input", () => {
    expect(computeCellCount({ perCaseMaxIterations: [], configCount: 5 })).toBe(
      0
    );
  });

  it("PARAM-07 floor: 5 cases x 2 configs with maxIterations=0 => 10 cells", () => {
    const perCaseMaxIterations = Array.from({ length: 5 }, (_, i) => ({
      caseId: i + 1,
      maxIterations: 0,
    }));
    expect(computeCellCount({ perCaseMaxIterations, configCount: 2 })).toBe(10);
  });

  it("mixed: [3, 5, 0] x 4 configs => (3 + 5 + 1) x 4 = 36", () => {
    expect(
      computeCellCount({
        perCaseMaxIterations: [
          { caseId: 1, maxIterations: 3 },
          { caseId: 2, maxIterations: 5 },
          { caseId: 3, maxIterations: 0 },
        ],
        configCount: 4,
      })
    ).toBe(36);
  });

  it("zero configs collapses to the (none) sentinel column count", () => {
    expect(
      computeCellCount({
        perCaseMaxIterations: [
          { caseId: 1, maxIterations: 3 },
          { caseId: 2, maxIterations: 5 },
        ],
        configCount: 0,
      })
    ).toBe(8);
  });

  it("right at the 50,000 threshold: not refused", () => {
    // 500 cases x 100 iterations x 1 config = 50,000.
    const perCaseMaxIterations = Array.from({ length: 500 }, (_, i) => ({
      caseId: i + 1,
      maxIterations: 100,
    }));
    expect(computeCellCount({ perCaseMaxIterations, configCount: 1 })).toBe(
      50000
    );
  });
});

describe("runCellCountPreflight", () => {
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      $queryRaw: vi.fn(),
    };
  });

  it("happy path under the cap: willRefuse=false", async () => {
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([{ case_count: 3n, config_count: 2n }])
      .mockResolvedValueOnce([
        { case_id: 1, max_iters: 3 },
        { case_id: 2, max_iters: 5 },
        { case_id: 3, max_iters: 0 },
      ]);

    const result = await runCellCountPreflight(mockPrisma, 99, {});
    expect(result.cellCount).toBe(18); // (3 + 5 + 1) x 2
    expect(result.willRefuse).toBe(false);
    expect(result.threshold).toBe(50000);
    expect(result.axisCounts.caseCount).toBe(3);
    expect(result.axisCounts.configCount).toBe(2);
    expect(result.axisCounts.perCaseMaxIterations).toEqual([
      { caseId: 1, maxIterations: 3 },
      { caseId: 2, maxIterations: 5 },
      { caseId: 3, maxIterations: 0 },
    ]);
  });

  it("exactly at 50,000: willRefuse=false (boundary inclusive)", async () => {
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([{ case_count: 500n, config_count: 1n }])
      .mockResolvedValueOnce(
        Array.from({ length: 500 }, (_, i) => ({
          case_id: i + 1,
          max_iters: 100,
        }))
      );
    const result = await runCellCountPreflight(mockPrisma, 1, {});
    expect(result.cellCount).toBe(50000);
    expect(result.willRefuse).toBe(false);
  });

  it("at 50,001: willRefuse=true", async () => {
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([{ case_count: 1n, config_count: 1n }])
      .mockResolvedValueOnce([{ case_id: 1, max_iters: 50001 }]);
    const result = await runCellCountPreflight(mockPrisma, 1, {});
    expect(result.cellCount).toBe(50001);
    expect(result.willRefuse).toBe(true);
  });

  it("zero rows: returns 0 cells, not refused", async () => {
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([{ case_count: 0n, config_count: 0n }])
      .mockResolvedValueOnce([]);
    const result = await runCellCountPreflight(mockPrisma, 1, {});
    expect(result.cellCount).toBe(0);
    expect(result.willRefuse).toBe(false);
    expect(result.axisCounts.caseCount).toBe(0);
    expect(result.axisCounts.configCount).toBe(0);
    expect(result.axisCounts.perCaseMaxIterations).toEqual([]);
  });

  it("threshold has the literal value 50000 (matches the type contract)", async () => {
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([{ case_count: 0n, config_count: 0n }])
      .mockResolvedValueOnce([]);
    const result = await runCellCountPreflight(mockPrisma, 1, {});
    expect(result.threshold).toBe(50000);
  });
});
