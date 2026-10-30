import { describe, expect, it } from "vitest";
import {
  summarizeRequirementCoverageTiles,
  summarizeRequirementDebt,
  summarizeRequirementTraceability,
  TOP_HIERARCHY_LIMIT,
} from "./requirementReportSummaries";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("summarizeRequirementTraceability", () => {
  // Requirement 1 (root "A") covered by two cases -> two rows, one
  // requirement; requirement 2 under root A, failed; requirement 3 is a
  // root of its own, uncovered.
  const rows = [
    {
      requirementId: 1,
      requirementKey: "A",
      requirementTitle: "Alpha",
      requirementParentPath: "",
      coverageStatus: "PASSED",
      requirementRootId: 1,
    },
    {
      requirementId: 1,
      requirementKey: "A",
      requirementTitle: "Alpha",
      requirementParentPath: "",
      coverageStatus: "PASSED",
      requirementRootId: 1,
    },
    {
      requirementId: 2,
      requirementKey: "A-1",
      requirementTitle: "Child",
      requirementParentPath: "A: Alpha",
      coverageStatus: "FAILED",
      requirementRootId: 1,
    },
    {
      requirementId: 3,
      requirementKey: "B",
      requirementTitle: null,
      requirementParentPath: "",
      coverageStatus: "UNCOVERED",
    },
  ];

  it("counts distinct requirements per state and in the tiles", () => {
    const s = summarizeRequirementTraceability(rows);
    expect(s.stateCounts).toEqual({ PASSED: 1, FAILED: 1, UNCOVERED: 1 });
    expect(s.tiles).toEqual({
      total: 3,
      covered: 2,
      counts: { PASSED: 1, FAILED: 1, NOT_RUN: 0, UNCOVERED: 1 },
    });
    expect(summarizeRequirementCoverageTiles(rows)).toEqual(s.tiles);
  });

  it("groups requirements by top-level root, largest first, linking the root's id", () => {
    const s = summarizeRequirementTraceability(rows);
    expect(s.groups).toEqual([
      {
        label: "A: Alpha",
        counts: { PASSED: 1, FAILED: 1 },
        total: 2,
        requirementId: 1,
      },
      { label: "B", counts: { UNCOVERED: 1 }, total: 1, requirementId: 3 },
    ]);
    expect(s.foldedCount).toBe(0);
  });

  it("folds the roots past the top limit into one unlabelled group", () => {
    const many = Array.from({ length: TOP_HIERARCHY_LIMIT + 3 }, (_, i) => ({
      requirementId: i + 1,
      requirementKey: `R${i + 1}`,
      requirementTitle: null,
      requirementParentPath: "",
      coverageStatus: i % 2 ? "PASSED" : "UNCOVERED",
    }));
    const s = summarizeRequirementTraceability(many);
    expect(s.groups).toHaveLength(TOP_HIERARCHY_LIMIT + 1);
    const other = s.groups[s.groups.length - 1];
    expect(other.label).toBe("");
    expect(other.total).toBe(3);
    expect(s.foldedCount).toBe(3);
  });
});

describe("summarizeRequirementDebt", () => {
  const now = Date.UTC(2026, 9, 30);
  const daysAgo = (n: number) => new Date(now - n * DAY_MS).toISOString();
  const rows = [
    {
      requirementId: 1,
      requirementKey: "A",
      requirementTitle: "Alpha",
      requirementParentPath: "",
      coverageStatus: "UNCOVERED",
      requirementStatus: "Open",
      requirementCreatedAt: daysAgo(10),
    },
    {
      requirementId: 2,
      requirementKey: "A-1",
      requirementTitle: null,
      requirementParentPath: "A: Alpha",
      coverageStatus: "NOT_RUN",
      requirementStatus: "Done",
      requirementCreatedAt: daysAgo(30),
      requirementRootId: 1,
    },
    {
      requirementId: 3,
      requirementKey: "B",
      requirementTitle: null,
      requirementParentPath: "",
      coverageStatus: "UNCOVERED",
      requirementStatus: " CLOSED ",
      requirementCreatedAt: daysAgo(400),
    },
    {
      requirementId: 4,
      requirementKey: "C",
      requirementTitle: null,
      requirementParentPath: "",
      coverageStatus: "UNCOVERED",
      requirementStatus: null,
      requirementCreatedAt: null,
    },
  ];

  it("counts debt states and the closed-requirement slice with the display heuristic", () => {
    const s = summarizeRequirementDebt(rows, now);
    expect(s.counts).toEqual({
      total: 4,
      uncovered: 3,
      notRun: 1,
      onClosed: 2,
    });
  });

  it("groups debt by root and buckets it by age with boundaries landing in the higher bucket", () => {
    const s = summarizeRequirementDebt(rows, now);
    expect(s.hierarchyGroups[0]).toEqual({
      label: "A: Alpha",
      counts: { UNCOVERED: 1, NOT_RUN: 1 },
      total: 2,
      requirementId: 1,
    });
    expect(s.foldedCount).toBe(0);
    expect(s.otherTotal).toBe(0);
    expect(s.ageBuckets.map((b) => [b.label, b.total])).toEqual([
      ["ageUnder30", 1],
      ["age30to90", 1], // exactly 30 days lands in the higher bucket
      ["age90to180", 0],
      ["age180to365", 0],
      ["ageOver365", 1],
    ]);
    // The row without a creation date is in no age bucket.
    expect(s.ageBuckets.reduce((sum, b) => sum + b.total, 0)).toBe(3);
  });
});
