import { describe, expect, it } from "vitest";
import {
  aggregateIssueRows,
  summarizeIssueTestCoverage,
} from "./issueTestCoverageSummary";

// Three issues over five flat rows (issue 1 has three linked cases, so
// three rows carrying the same issue-level counts).
const rows = [
  {
    issueId: 1,
    linkedTestCases: 3,
    passedTestCases: 1,
    failedTestCases: 1,
    untestedTestCases: 1,
  },
  {
    issueId: 1,
    linkedTestCases: 3,
    passedTestCases: 1,
    failedTestCases: 1,
    untestedTestCases: 1,
  },
  {
    issueId: 1,
    linkedTestCases: 3,
    passedTestCases: 1,
    failedTestCases: 1,
    untestedTestCases: 1,
  },
  {
    issueId: 2,
    linkedTestCases: 1,
    passedTestCases: 1,
    failedTestCases: 0,
    untestedTestCases: 0,
  },
  {
    issueId: 3,
    linkedTestCases: 12,
    passedTestCases: 0,
    failedTestCases: 0,
    untestedTestCases: 12,
  },
];

describe("summarizeIssueTestCoverage", () => {
  it("dedupes rows to issues, first row wins", () => {
    expect(aggregateIssueRows(rows).map((r) => r.issueId)).toEqual([1, 2, 3]);
    expect(aggregateIssueRows([null, undefined, { issueId: null }])).toEqual(
      []
    );
  });

  it("totals once per issue and classifies issues the way the chart's tiles do", () => {
    const s = summarizeIssueTestCoverage(rows);
    expect(s.totalIssues).toBe(3);
    expect(s.totalLinkedTests).toBe(16);
    expect(s.totalPassed).toBe(2);
    expect(s.totalFailed).toBe(1);
    expect(s.totalUntested).toBe(13);
    expect(s.issuesWithFailures).toBe(1);
    expect(s.issuesAllPassing).toBe(1);
    expect(s.issuesWithUntested).toBe(2);
    // 2 / (2 + 1) = 67%
    expect(s.overallPassRate).toBe(67);
    expect(s.maxLinkedTests).toBe(12);
    expect(s.maxUntestedTests).toBe(12);
  });

  it("buckets issues into the chart's bubbles by linked and untested counts and status", () => {
    const s = summarizeIssueTestCoverage(rows);
    expect(s.bubbles).toEqual(
      expect.arrayContaining([
        { linkedTests: 2.5, untestedTests: 2.5, status: "failed", count: 1 },
        { linkedTests: 2.5, untestedTests: 2.5, status: "passing", count: 1 },
        { linkedTests: 15, untestedTests: 15, status: "untested", count: 1 },
      ])
    );
    expect(s.bubbles).toHaveLength(3);
  });

  it("returns zeros and unit axes for no rows", () => {
    const s = summarizeIssueTestCoverage([]);
    expect(s.totalIssues).toBe(0);
    expect(s.overallPassRate).toBe(0);
    expect(s.maxLinkedTests).toBe(1);
    expect(s.maxUntestedTests).toBe(1);
    expect(s.bubbles).toEqual([]);
  });
});
