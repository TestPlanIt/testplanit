import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  baseDb: {
    $queryRaw: vi.fn(),
  },
}));

import { baseDb } from "~/lib/db";
import { calculateMilestoneCompletion } from "./milestoneSummary";

/**
 * `calculateMilestoneCompletion` delegates to the effective-case-status
 * accessor, which issues a single per-milestone query counting manual
 * run-cases from TestRunCases and automated runs from JUnitTestResult
 * (each half from the table that actually holds its outcome).
 */
const mockQueryRaw = baseDb.$queryRaw as unknown as ReturnType<typeof vi.fn>;

describe("calculateMilestoneCompletion", () => {
  beforeEach(() => {
    mockQueryRaw.mockReset();
  });

  it("returns 0 when the milestones have no run-cases at all", async () => {
    mockQueryRaw.mockResolvedValueOnce([]); // no milestone has a population

    const rate = await calculateMilestoneCompletion([485]);

    expect(rate).toBe(0);
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
  });

  it("computes the percentage from the accessor's combined counts", async () => {
    // The SQL already merges the manual (TestRunCases) and automated
    // (JUnitTestResult) halves per milestone; the service just does the math.
    mockQueryRaw.mockResolvedValueOnce([
      { milestoneId: 485, total: BigInt(10), completed: BigInt(4) },
    ]);

    const rate = await calculateMilestoneCompletion([485]);

    expect(rate).toBe(40);
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
  });

  it("sums counts across a descendant rollup before computing the rate", async () => {
    mockQueryRaw.mockResolvedValueOnce([
      { milestoneId: 485, total: BigInt(10), completed: BigInt(2) },
      { milestoneId: 594, total: BigInt(90), completed: BigInt(88) },
    ]);

    const rate = await calculateMilestoneCompletion([485, 594]);

    // (2 + 88) / (10 + 90) = 90%
    expect(rate).toBe(90);
  });

  it("caps completion at 100%", async () => {
    mockQueryRaw.mockResolvedValueOnce([
      { milestoneId: 485, total: BigInt(5), completed: BigInt(5) },
    ]);

    const rate = await calculateMilestoneCompletion([485]);

    expect(rate).toBe(100);
  });
});
