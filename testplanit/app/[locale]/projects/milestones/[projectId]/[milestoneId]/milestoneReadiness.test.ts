import { describe, expect, it } from "vitest";
import type { CoverageBreakdown } from "~/app/api/milestones/[milestoneId]/members/coverage/route";
import {
  aggregateMilestoneReadiness,
  rollupIssueReadiness,
} from "./milestoneReadiness";

const bd = (partial: Partial<CoverageBreakdown>): CoverageBreakdown => ({
  linkedCaseCount: 0,
  passed: 0,
  failed: 0,
  inProgress: 0,
  notRun: 0,
  uncovered: false,
  statuses: [],
  untested: 0,
  ...partial,
});

describe("rollupIssueReadiness", () => {
  it("classifies an issue with no coverage entry as uncovered", () => {
    expect(rollupIssueReadiness(undefined)).toBe("uncovered");
  });

  it("classifies an issue with zero linked cases as uncovered", () => {
    expect(
      rollupIssueReadiness(bd({ linkedCaseCount: 0, uncovered: true }))
    ).toBe("uncovered");
  });

  it("is worst-wins: any failure outranks passes/in-progress/not-run", () => {
    expect(
      rollupIssueReadiness(
        bd({ linkedCaseCount: 3, passed: 1, failed: 1, inProgress: 1 })
      )
    ).toBe("failed");
  });

  it("reads in-progress when there are no failures but work is running", () => {
    expect(
      rollupIssueReadiness(bd({ linkedCaseCount: 2, passed: 1, inProgress: 1 }))
    ).toBe("inProgress");
  });

  it("reads not-run when some case still lacks a completed result", () => {
    expect(
      rollupIssueReadiness(bd({ linkedCaseCount: 2, passed: 1, notRun: 1 }))
    ).toBe("notRun");
  });

  it("reads not-run when the issue has cases but none were executed in scope", () => {
    expect(rollupIssueReadiness(bd({ linkedCaseCount: 2, notRun: 2 }))).toBe(
      "notRun"
    );
  });

  it("reads passed only when every linked case passed", () => {
    expect(rollupIssueReadiness(bd({ linkedCaseCount: 3, passed: 3 }))).toBe(
      "passed"
    );
  });
});

describe("aggregateMilestoneReadiness", () => {
  it("returns an empty rollup (percentReady 0) when there are no member issues", () => {
    expect(aggregateMilestoneReadiness({}, [])).toEqual({
      total: 0,
      passed: 0,
      failed: 0,
      inProgress: 0,
      notRun: 0,
      uncovered: 0,
      percentReady: 0,
    });
  });

  it("counts each state and computes percentReady = passed / total", () => {
    const coverage = {
      1: bd({ linkedCaseCount: 2, passed: 2 }), // passed
      2: bd({ linkedCaseCount: 2, passed: 1, failed: 1 }), // failed
      3: bd({ linkedCaseCount: 1, notRun: 1 }), // notRun
      4: bd({ linkedCaseCount: 0, uncovered: true }), // uncovered
    };
    const result = aggregateMilestoneReadiness(coverage, [1, 2, 3, 4]);
    expect(result).toEqual({
      total: 4,
      passed: 1,
      failed: 1,
      inProgress: 0,
      notRun: 1,
      uncovered: 1,
      percentReady: 25,
    });
  });

  it("treats a member issue missing from the coverage map as uncovered", () => {
    const result = aggregateMilestoneReadiness(
      { 1: bd({ linkedCaseCount: 1, passed: 1 }) },
      [1, 2]
    );
    expect(result.passed).toBe(1);
    expect(result.uncovered).toBe(1);
    expect(result.percentReady).toBe(50);
  });

  it("rounds percentReady to the nearest integer", () => {
    // 1 of 3 passing → 33.33% → 33
    const coverage = {
      1: bd({ linkedCaseCount: 1, passed: 1 }),
      2: bd({ linkedCaseCount: 1, notRun: 1 }),
      3: bd({ linkedCaseCount: 1, notRun: 1 }),
    };
    expect(aggregateMilestoneReadiness(coverage, [1, 2, 3]).percentReady).toBe(
      33
    );
  });
});
