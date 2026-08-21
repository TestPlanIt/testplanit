import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  baseDb: {
    $queryRaw: vi.fn(),
  },
}));

import { baseDb } from "~/lib/db";
import { calculateMilestoneCompletion } from "./milestoneSummary";

/**
 * `calculateMilestoneCompletion` first fetches the milestone's non-deleted
 * runs (split into regular vs. automated by `testRunType`), then queries
 * completion for each half independently:
 *   1. TestRuns (id, testRunType) — the split
 *   2. Manual completion (only if there are regular run ids) — TestRunCases
 *   3. Automated completion (only if there are automated run ids) — JUnitTestResult
 *
 * `Promise.all` starts the manual call before the automated one, so mocking
 * `$queryRaw` with a fixed call-order sequence is safe.
 */
const mockQueryRaw = baseDb.$queryRaw as unknown as ReturnType<typeof vi.fn>;

describe("calculateMilestoneCompletion", () => {
  beforeEach(() => {
    mockQueryRaw.mockReset();
  });

  it("returns 0 when the milestone has no runs at all", async () => {
    mockQueryRaw.mockResolvedValueOnce([]); // TestRuns split — nothing

    const rate = await calculateMilestoneCompletion([485]);

    expect(rate).toBe(0);
    // Neither the manual nor automated completion query should even run.
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
  });

  it("computes completion from TestRunCases.statusId for manual (REGULAR) runs", async () => {
    mockQueryRaw
      .mockResolvedValueOnce([{ id: 1, testRunType: "REGULAR" }]) // split
      .mockResolvedValueOnce([{ total: BigInt(10), completed: BigInt(4) }]); // manual completion

    const rate = await calculateMilestoneCompletion([485]);

    expect(rate).toBe(40);
    expect(mockQueryRaw).toHaveBeenCalledTimes(2);
  });

  // Regression test for the bug where automated (JUnit/TestNG/Mocha/etc.) run
  // cases never get a status denormalized onto TestRunCases.statusId — their
  // real outcome lives in JUnitTestResult instead — so the milestone
  // completion % used to read every automated case as permanently incomplete,
  // even after the run finished.
  it("computes completion from JUnitTestResult for automated runs, not TestRunCases.statusId", async () => {
    mockQueryRaw
      .mockResolvedValueOnce([{ id: 2, testRunType: "MOCHA" }]) // split
      .mockResolvedValueOnce([{ total: BigInt(500), completed: BigInt(500) }]); // automated completion (all passed)

    const rate = await calculateMilestoneCompletion([594]);

    expect(rate).toBe(100);
    expect(mockQueryRaw).toHaveBeenCalledTimes(2);
  });

  it("combines manual and automated runs into a single completion percentage", async () => {
    mockQueryRaw
      .mockResolvedValueOnce([
        { id: 1, testRunType: "REGULAR" },
        { id: 2, testRunType: "MOCHA" },
      ]) // split
      .mockResolvedValueOnce([{ total: BigInt(10), completed: BigInt(2) }]) // manual: 2/10
      .mockResolvedValueOnce([{ total: BigInt(90), completed: BigInt(88) }]); // automated: 88/90

    const rate = await calculateMilestoneCompletion([485]);

    // (2 + 88) / (10 + 90) = 90%
    expect(rate).toBe(90);
    expect(mockQueryRaw).toHaveBeenCalledTimes(3);
  });

  it("caps completion at 100%", async () => {
    mockQueryRaw
      .mockResolvedValueOnce([{ id: 1, testRunType: "REGULAR" }])
      .mockResolvedValueOnce([{ total: BigInt(5), completed: BigInt(5) }]);

    const rate = await calculateMilestoneCompletion([485]);

    expect(rate).toBe(100);
  });
});
