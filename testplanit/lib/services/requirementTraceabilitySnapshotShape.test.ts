import { describe, expect, it } from "vitest";

import type {
  RequirementCoverageBreakdown,
  RequirementCoveringCase,
} from "~/lib/services/requirementCoverage";
import {
  buildTraceabilityRows,
  type RequirementNode,
} from "~/lib/services/requirementTraceabilityExport";
import {
  diffSnapshotEntries,
  expandSnapshotEntries,
  groupTraceabilityRows,
  scopeSnapshotEntries,
  summarizeCoverageChanges,
  summarizeSnapshotEntries,
  type SnapshotEntryRecord,
} from "./requirementTraceabilitySnapshotShape";

// A forest with every shape the fold/unfold has to preserve: a root with
// two covering cases (one cross-project, one never run), an uncovered
// child, a nested grandchild covered by inheritance, and a standalone
// failed requirement — so a single-row-per-requirement bug, a lost
// gap row, a dropped case field, or a broken ordering all show up.
const nodes: RequirementNode[] = [
  {
    id: 1,
    name: "REQ-1",
    title: "Enrolments",
    externalUrl: null,
    parentId: null,
    issueTypeName: "Epic",
    issueTypeIconUrl: null,
    priority: "High",
    externalPriority: null,
    status: "Open",
    externalStatus: null,
    integrationId: null,
    requirementDetachedAt: null,
    createdAt: "2026-01-05T00:00:00.000Z",
  },
  {
    id: 2,
    name: "REQ-2",
    title: "Waitlist",
    externalUrl: null,
    parentId: 1,
  },
  {
    id: 3,
    name: "REQ-3",
    title: "Overflow",
    externalUrl: null,
    parentId: 2,
  },
  {
    id: 4,
    name: "REQ-4",
    title: "Billing",
    externalUrl: null,
    parentId: null,
  },
];

function breakdown(
  status: RequirementCoverageBreakdown["status"],
  linkedCaseCount: number
): RequirementCoverageBreakdown {
  return {
    linkedCaseCount,
    crossProjectCaseCount: 0,
    directCaseCount: linkedCaseCount,
    directCrossProjectCaseCount: 0,
    passed: 0,
    failed: 0,
    inProgress: 0,
    notRun: 0,
    uncovered: linkedCaseCount === 0 ? 1 : 0,
    untested: 0,
    statuses: [],
    status,
  } as unknown as RequirementCoverageBreakdown;
}

function coveringCase(
  overrides: Partial<RequirementCoveringCase> & {
    caseId: number;
    caseName: string;
  }
): RequirementCoveringCase {
  return {
    projectId: 10,
    projectName: "Alpha",
    automated: false,
    source: null,
    hasParameters: false,
    lastStatusName: null,
    lastStatusColor: null,
    lastStatusIsSuccess: null,
    lastStatusIsFailure: null,
    lastExecutedAt: null,
    lastTestRunId: null,
    ...overrides,
  };
}

const coverage = new Map<number, RequirementCoverageBreakdown>([
  [1, breakdown("NOT_RUN", 3)],
  [2, breakdown("UNCOVERED", 0)],
  [3, breakdown("PASSED", 1)],
  [4, breakdown("FAILED", 1)],
]);

const coveringCases = new Map<number, RequirementCoveringCase[]>([
  [
    1,
    [
      coveringCase({
        caseId: 100,
        caseName: "Zeta login",
        lastStatusName: "Passed",
        lastStatusColor: "#22c55e",
        lastStatusIsSuccess: true,
        lastStatusIsFailure: false,
        lastExecutedAt: "2026-02-01T10:00:00.000Z",
        lastTestRunId: 7,
        automated: true,
        source: "pytest",
      }),
      coveringCase({
        caseId: 101,
        caseName: "Alpha signup",
        projectId: 20,
        projectName: "Beta",
        hasParameters: true,
      }),
      coveringCase({
        caseId: 102,
        caseName: "Mid checkout",
        lastStatusName: "Passed",
        lastStatusColor: "#22c55e",
        lastStatusIsSuccess: true,
        lastStatusIsFailure: false,
        lastExecutedAt: "2026-02-02T10:00:00.000Z",
        lastTestRunId: 8,
      }),
    ],
  ],
  [
    3,
    [
      coveringCase({
        caseId: 102,
        caseName: "Mid checkout",
        lastStatusName: "Passed",
        lastStatusColor: "#22c55e",
        lastStatusIsSuccess: true,
        lastStatusIsFailure: false,
        lastExecutedAt: "2026-02-02T10:00:00.000Z",
        lastTestRunId: 8,
      }),
    ],
  ],
  [
    4,
    [
      coveringCase({
        caseId: 200,
        caseName: "Invoice totals",
        lastStatusName: "Failed",
        lastStatusColor: "#dc2626",
        lastStatusIsSuccess: false,
        lastStatusIsFailure: true,
        lastExecutedAt: "2026-02-03T10:00:00.000Z",
        lastTestRunId: 9,
      }),
    ],
  ],
]);

const liveRows = buildTraceabilityRows({
  requirements: nodes,
  coverage,
  coveringCases,
});

describe("groupTraceabilityRows / expandSnapshotEntries", () => {
  it("folds to one entry per requirement, in row order, with a gap row as an empty case list", () => {
    const entries = groupTraceabilityRows(liveRows);

    expect(entries.map((entry) => entry.requirementId)).toEqual([1, 2, 3, 4]);
    expect(entries[0].cases.map((c) => c.caseName)).toEqual([
      "Alpha signup",
      "Mid checkout",
      "Zeta login",
    ]);
    expect(entries[1]).toMatchObject({
      requirementKey: "REQ-2",
      requirementParentId: 1,
      requirementRootId: 1,
      requirementParentPath: "REQ-1",
      coverageStatus: "UNCOVERED",
      linkedCaseCount: 0,
      cases: [],
    });
    // Requirement-level context survives the fold verbatim.
    expect(entries[0]).toMatchObject({
      requirementIssueTypeName: "Epic",
      requirementPriority: "High",
      requirementStatus: "Open",
      requirementCreatedAt: "2026-01-05T00:00:00.000Z",
      requirementParentId: null,
    });
    // Case-level display metadata is carried, not defaulted away.
    expect(entries[0].cases.find((c) => c.caseId === 100)).toMatchObject({
      caseAutomated: true,
      caseSource: "pytest",
      statusName: "Passed",
      executedAt: "2026-02-01T10:00:00.000Z",
    });
    expect(entries[0].cases.find((c) => c.caseId === 101)).toMatchObject({
      caseProjectId: 20,
      caseProjectName: "Beta",
      caseHasParameters: true,
      statusName: null,
    });
  });

  it("round-trips: expanding the grouped entries reproduces the live rows exactly", () => {
    const entries = groupTraceabilityRows(liveRows);
    // Simulate the JSON persistence boundary — the entries table stores
    // `cases` as JSON and the loader hands back plain objects.
    const persisted: SnapshotEntryRecord[] = JSON.parse(
      JSON.stringify(entries)
    );

    expect(expandSnapshotEntries(persisted)).toEqual(liveRows);
  });

  it("re-sorts on expansion so stored order cannot leak into the matrix order", () => {
    const entries = groupTraceabilityRows(liveRows);
    const shuffled = [...entries].reverse().map((entry) => ({
      ...entry,
      cases: [...entry.cases].reverse(),
    }));

    expect(expandSnapshotEntries(shuffled)).toEqual(liveRows);
  });
});

describe("summarizeSnapshotEntries", () => {
  it("counts requirements per classified state and the requirement–case pairs", () => {
    expect(summarizeSnapshotEntries(groupTraceabilityRows(liveRows))).toEqual({
      requirementCount: 4,
      passedCount: 1,
      failedCount: 1,
      notRunCount: 1,
      uncoveredCount: 1,
      caseLinkCount: 5,
    });
  });
});

describe("scopeSnapshotEntries", () => {
  it("keeps the selected roots and their requirement descendants, using the frozen parent ids", () => {
    const entries = groupTraceabilityRows(liveRows);

    expect(
      scopeSnapshotEntries(entries, [2]).map((entry) => entry.requirementId)
    ).toEqual([2, 3]);
    expect(
      scopeSnapshotEntries(entries, [4]).map((entry) => entry.requirementId)
    ).toEqual([4]);
    expect(scopeSnapshotEntries(entries, [999])).toEqual([]);
  });

  it("leaves the captured paths untouched — a scoped view is still the record as captured", () => {
    const entries = groupTraceabilityRows(liveRows);
    const [child] = scopeSnapshotEntries(entries, [2]);
    expect(child.requirementParentPath).toBe("REQ-1");
  });
});

describe("diffSnapshotEntries", () => {
  const baseline = groupTraceabilityRows(liveRows);

  function mutate(
    transform: (entries: SnapshotEntryRecord[]) => SnapshotEntryRecord[]
  ): SnapshotEntryRecord[] {
    return transform(JSON.parse(JSON.stringify(baseline)));
  }

  it("classifies every change kind by precedence and reports unchanged rows as UNCHANGED", () => {
    const comparison = mutate((entries) => {
      // REQ-1: same cases, one re-executed (RESULTS_CHANGED).
      entries[0].cases[2].executedAt = "2026-03-01T10:00:00.000Z";
      // REQ-2: gains a case and becomes NOT_RUN (COVERAGE_CHANGED wins
      // over the link change).
      entries[1].coverageStatus = "NOT_RUN";
      entries[1].linkedCaseCount = 1;
      entries[1].cases = [
        {
          caseId: 300,
          caseName: "New case",
          caseProjectId: 10,
          caseProjectName: "Alpha",
          caseAutomated: false,
          caseSource: null,
          caseHasParameters: false,
          statusName: null,
          statusColor: null,
          executedAt: null,
        },
      ];
      // REQ-3: swaps its one case for another but stays PASSED
      // (LINKS_CHANGED).
      entries[2].cases = [
        { ...entries[2].cases[0], caseId: 103, caseName: "Replacement" },
      ];
      // REQ-4 removed; REQ-5 added.
      return [
        ...entries.filter((entry) => entry.requirementId !== 4),
        {
          requirementId: 5,
          requirementKey: "REQ-5",
          requirementTitle: "Refunds",
          requirementPath: "REQ-5: Refunds",
          requirementParentPath: "",
          requirementParentId: null,
          requirementRootId: 5,
          requirementIssueTypeName: null,
          requirementIssueTypeIconUrl: null,
          requirementPriority: null,
          requirementStatus: null,
          requirementCreatedAt: null,
          requirementVersion: null,
          coverageStatus: "UNCOVERED",
          linkedCaseCount: 0,
          cases: [],
        },
      ];
    });

    const rows = diffSnapshotEntries(baseline, comparison);
    const byId = new Map(rows.map((row) => [row.requirementId, row]));

    expect(byId.get(1)).toMatchObject({
      changeKind: "RESULTS_CHANGED",
      previousCoverageStatus: "NOT_RUN",
      currentCoverageStatus: "NOT_RUN",
      casesAdded: 0,
      casesRemoved: 0,
      resultsChanged: 1,
    });
    expect(byId.get(2)).toMatchObject({
      changeKind: "COVERAGE_CHANGED",
      previousCoverageStatus: "UNCOVERED",
      currentCoverageStatus: "NOT_RUN",
      previousLinkedCaseCount: 0,
      currentLinkedCaseCount: 1,
      casesAdded: 1,
    });
    expect(byId.get(3)).toMatchObject({
      changeKind: "LINKS_CHANGED",
      casesAdded: 1,
      casesRemoved: 1,
      resultsChanged: 0,
    });
    expect(byId.get(4)).toMatchObject({
      changeKind: "REMOVED",
      previousCoverageStatus: "FAILED",
      currentCoverageStatus: null,
      currentLinkedCaseCount: null,
      casesRemoved: 1,
      requirementKey: "REQ-4",
    });
    expect(byId.get(5)).toMatchObject({
      changeKind: "ADDED",
      previousCoverageStatus: null,
      currentCoverageStatus: "UNCOVERED",
      previousLinkedCaseCount: null,
    });
    // Path order, removed rows interleaved by their captured path.
    expect(rows.map((row) => row.requirementKey)).toEqual([
      "REQ-1",
      "REQ-2",
      "REQ-3",
      "REQ-4",
      "REQ-5",
    ]);
  });

  it("is all-UNCHANGED against itself", () => {
    const rows = diffSnapshotEntries(
      baseline,
      mutate((e) => e)
    );
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.changeKind === "UNCHANGED")).toBe(true);
  });

  it("treats a link-count change with an identical visible case set as LINKS_CHANGED", () => {
    const comparison = mutate((entries) => {
      entries[0].linkedCaseCount = 4;
      return entries;
    });
    expect(
      diffSnapshotEntries(baseline, comparison).find(
        (row) => row.requirementId === 1
      )?.changeKind
    ).toBe("LINKS_CHANGED");
  });
});

describe("summarizeCoverageChanges", () => {
  it("counts kinds as a partition and the four transitions independently", () => {
    const rows = diffSnapshotEntries(
      groupTraceabilityRows(liveRows),
      (() => {
        const entries: SnapshotEntryRecord[] = JSON.parse(
          JSON.stringify(groupTraceabilityRows(liveRows))
        );
        entries[1].coverageStatus = "FAILED"; // UNCOVERED -> FAILED
        entries[3].coverageStatus = "PASSED"; // FAILED -> PASSED
        return entries;
      })()
    );

    const summary = summarizeCoverageChanges(rows);
    expect(summary.byKind).toMatchObject({
      COVERAGE_CHANGED: 2,
      UNCHANGED: 2,
      ADDED: 0,
      REMOVED: 0,
    });
    expect(summary).toMatchObject({
      newlyCovered: 1,
      newlyUncovered: 0,
      nowFailing: 1,
      noLongerFailing: 1,
    });
  });

  it("does not count a removed requirement as newly uncovered or no longer failing", () => {
    const rows = diffSnapshotEntries(groupTraceabilityRows(liveRows), []);
    const summary = summarizeCoverageChanges(rows);
    expect(summary.byKind.REMOVED).toBe(4);
    expect(summary.newlyUncovered).toBe(0);
    expect(summary.noLongerFailing).toBe(0);
  });
});
