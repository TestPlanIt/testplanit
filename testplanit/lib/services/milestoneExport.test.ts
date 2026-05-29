import { describe, expect, it } from "vitest";
import type { MilestoneSegment } from "~/lib/services/milestoneSummary";
import {
  aggregateStatusCounts,
  groupTestRunContributors,
  mapSessionContributors,
  milestoneStatusLabel,
  shapeReviewDecisions,
} from "./milestoneExport";

const seg = (over: Partial<MilestoneSegment>): MilestoneSegment => ({
  id: "x",
  type: "test-run",
  sourceId: 1,
  sourceName: "Run A",
  statusId: 1,
  statusName: "Passed",
  colorValue: "#22c55e",
  elapsed: 0,
  estimate: 0,
  isPending: false,
  itemCount: 1,
  statusOrder: 1,
  ...over,
});

describe("milestoneStatusLabel", () => {
  it("prefers completed over started", () => {
    expect(milestoneStatusLabel({ isCompleted: true, isStarted: true })).toBe(
      "Completed"
    );
  });
  it("reports in-progress when started but not completed", () => {
    expect(milestoneStatusLabel({ isCompleted: false, isStarted: true })).toBe(
      "In Progress"
    );
  });
  it("reports not-started otherwise", () => {
    expect(milestoneStatusLabel({ isCompleted: false, isStarted: false })).toBe(
      "Not Started"
    );
  });
});

describe("aggregateStatusCounts", () => {
  it("sums itemCount per status and tallies executed vs total", () => {
    const result = aggregateStatusCounts([
      seg({ statusName: "Passed", itemCount: 3, isPending: false }),
      seg({ statusName: "Failed", itemCount: 2, isPending: false }),
      seg({ statusName: "Untested", itemCount: 4, isPending: true }),
    ]);
    expect(result.totalItems).toBe(9);
    expect(result.executedItems).toBe(5);
    const passed = result.statusCounts.find((s) => s.statusName === "Passed");
    expect(passed?.count).toBe(3);
  });

  it("merges duplicate status names across segments", () => {
    const result = aggregateStatusCounts([
      seg({ statusName: "Passed", itemCount: 2 }),
      seg({ statusName: "Passed", itemCount: 5 }),
    ]);
    expect(result.statusCounts).toHaveLength(1);
    expect(result.statusCounts[0].count).toBe(7);
  });

  it("defaults missing itemCount to 1", () => {
    const result = aggregateStatusCounts([
      seg({ statusName: "Passed", itemCount: undefined }),
    ]);
    expect(result.totalItems).toBe(1);
  });
});

describe("groupTestRunContributors", () => {
  it("groups segments into one row per run with its status breakdown", () => {
    const runs = groupTestRunContributors([
      seg({
        sourceId: 1,
        sourceName: "Run A",
        statusName: "Passed",
        itemCount: 2,
        elapsed: 120,
      }),
      seg({
        sourceId: 1,
        sourceName: "Run A",
        statusName: "Failed",
        itemCount: 1,
        isPending: false,
        elapsed: 60,
      }),
      seg({
        sourceId: 2,
        sourceName: "Run B",
        statusName: "Untested",
        itemCount: 3,
        isPending: true,
        elapsed: 0,
      }),
    ]);
    expect(runs).toHaveLength(2);
    const runA = runs.find((r) => r.id === 1)!;
    expect(runA.name).toBe("Run A");
    expect(runA.totalItems).toBe(3);
    expect(runA.executedItems).toBe(3);
    expect(runA.elapsed).toBe(180);
    expect(runA.statusCounts).toHaveLength(2);
    const runB = runs.find((r) => r.id === 2)!;
    expect(runB.executedItems).toBe(0);
  });
});

describe("mapSessionContributors", () => {
  it("maps each session segment to a contributor row", () => {
    const sessions = mapSessionContributors([
      seg({
        type: "session",
        sourceId: 10,
        sourceName: "Exploratory",
        statusName: "Completed",
        isPending: false,
        elapsed: 90,
      }),
    ]);
    expect(sessions).toEqual([
      {
        id: 10,
        name: "Exploratory",
        statusName: "Completed",
        colorValue: "#22c55e",
        isPending: false,
        elapsed: 90,
      },
    ]);
  });
});

describe("shapeReviewDecisions", () => {
  const names = new Map<string, string>([
    ["RUN:1", "Q2 Release Regression"],
    ["SESSION:5", "Smoke Session"],
  ]);

  it("resolves entity names and decider, drops CASE-scoped requests", () => {
    const decisions = shapeReviewDecisions(
      [
        {
          entityType: "RUN",
          entityId: 1,
          status: "APPROVED",
          decidedAt: "2026-05-15T00:00:00.000Z",
          decisionComment: "LGTM",
          decidedBy: { name: "Jane Doe" },
        },
        {
          entityType: "CASE",
          entityId: 9,
          status: "APPROVED",
          decidedAt: null,
          decisionComment: null,
          decidedBy: null,
        },
        {
          entityType: "SESSION",
          entityId: 5,
          status: "PENDING",
          decidedAt: null,
          decisionComment: null,
          decidedBy: null,
        },
      ],
      names
    );

    expect(decisions).toHaveLength(2);
    const run = decisions.find((d) => d.entityType === "RUN")!;
    expect(run.entityName).toBe("Q2 Release Regression");
    expect(run.decidedByName).toBe("Jane Doe");
    expect(run.decidedAt).toBe("2026-05-15T00:00:00.000Z");

    const session = decisions.find((d) => d.entityType === "SESSION")!;
    expect(session.entityName).toBe("Smoke Session");
    expect(session.decidedByName).toBeNull();
  });

  it("falls back to #id when the name lookup misses", () => {
    const decisions = shapeReviewDecisions(
      [
        {
          entityType: "RUN",
          entityId: 99,
          status: "REJECTED",
          decidedAt: null,
          decisionComment: null,
          decidedBy: null,
        },
      ],
      names
    );
    expect(decisions[0].entityName).toBe("#99");
  });
});
