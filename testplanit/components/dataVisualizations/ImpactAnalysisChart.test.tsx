import { describe, expect, it } from "vitest";
import { summarizeImpactAnalyses } from "./ImpactAnalysisChart";

const row = (o: Partial<any>) => ({
  pinnedCaseCount: 1,
  affectedCaseCount: 1,
  acceptedCaseCount: 1,
  testRun: null,
  outcome: "no_run",
  createdAt: "2026-09-10T00:00:00Z",
  trigger: "manual",
  ...o,
});

describe("summarizeImpactAnalyses", () => {
  it("counts composed runs, failing runs among executed ones, the median selection and accepted share", () => {
    const s = summarizeImpactAnalyses([
      row({
        testRun: { id: 1 },
        outcome: "failed",
        pinnedCaseCount: 4,
        affectedCaseCount: 4,
        acceptedCaseCount: 4,
      }),
      row({ testRun: { id: 2 }, outcome: "passed" }),
      row({
        testRun: { id: 3 },
        outcome: "not_executed",
        acceptedCaseCount: 0,
      }),
      row({}),
    ] as any);
    expect(s).toEqual({
      total: 4,
      composed: 3,
      composedPct: 75,
      withFailures: 1,
      withFailuresPct: 50,
      medianAffected: 2,
      acceptedPct: 43,
    });
  });

  it("returns zeros for no data", () => {
    expect(summarizeImpactAnalyses([])).toEqual({
      total: 0,
      composed: 0,
      composedPct: 0,
      withFailures: 0,
      withFailuresPct: 0,
      medianAffected: 0,
      acceptedPct: 0,
    });
  });
});
