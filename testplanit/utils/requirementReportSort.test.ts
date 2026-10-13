import { describe, expect, it } from "vitest";

import { sortRequirementReportRows } from "./requirementReportSort";

// The virtualized DataTable is manualSorting — the caller owns row order —
// so this module IS the requirement reports' sort. See the module header.

function row(overrides: Record<string, unknown>) {
  return {
    requirementKey: "REQ-?",
    requirementTitle: null,
    requirementParentPath: "",
    testCaseId: null,
    testCaseName: null,
    caseProjectName: null,
    lastStatusName: null,
    lastExecutedAt: null,
    coverageStatus: "UNCOVERED",
    ...overrides,
  };
}

describe("sortRequirementReportRows", () => {
  const rows = [
    row({
      requirementKey: "B-REQ",
      coverageStatus: "PASSED",
      testCaseId: 2,
      testCaseName: "Case B",
      lastStatusName: "Passed",
      lastExecutedAt: "2026-08-02T00:00:00.000Z",
      caseProjectName: "Web",
    }),
    row({
      requirementKey: "A-REQ",
      coverageStatus: "FAILED",
      testCaseId: 1,
      testCaseName: "Case A",
      lastStatusName: "Failed",
      lastExecutedAt: "2026-08-03T00:00:00.000Z",
      caseProjectName: "Cloud",
    }),
    row({ requirementKey: "C-REQ", coverageStatus: "UNCOVERED" }),
  ];

  it("returns the rows untouched with no sort or an unknown column", () => {
    expect(sortRequirementReportRows(rows, null)).toBe(rows);
    expect(
      sortRequirementReportRows(rows, { column: "nope", direction: "asc" })
    ).toBe(rows);
  });

  it("never mutates the input array", () => {
    const before = [...rows];
    sortRequirementReportRows(rows, {
      column: "requirement",
      direction: "desc",
    });
    expect(rows).toEqual(before);
  });

  it("sorts by requirement display text in both directions", () => {
    const asc = sortRequirementReportRows(rows, {
      column: "requirement",
      direction: "asc",
    });
    expect(asc.map((r) => r.requirementKey)).toEqual([
      "A-REQ",
      "B-REQ",
      "C-REQ",
    ]);

    const desc = sortRequirementReportRows(rows, {
      column: "requirement",
      direction: "desc",
    });
    expect(desc.map((r) => r.requirementKey)).toEqual([
      "C-REQ",
      "B-REQ",
      "A-REQ",
    ]);
  });

  it("sorts the coverage column by the classification ladder's severity, not alphabetically", () => {
    const asc = sortRequirementReportRows(rows, {
      column: "coverage",
      direction: "asc",
    });
    // UNCOVERED < FAILED < NOT_RUN < PASSED — alphabetical would put
    // FAILED first.
    expect(asc.map((r) => r.coverageStatus)).toEqual([
      "UNCOVERED",
      "FAILED",
      "PASSED",
    ]);
  });

  it("sorts the test case column by the NAME it displays, never the numeric id", () => {
    // Case ids are ordered opposite to the names, so an id-based sort
    // would invert this expectation.
    const withInvertedIds = [
      rows[0], // Case B, id 2
      row({ testCaseId: 9, testCaseName: "Case A" }),
    ];
    const asc = sortRequirementReportRows(withInvertedIds, {
      column: "testCaseId",
      direction: "asc",
    });
    expect(asc.map((r) => r.testCaseName)).toEqual(["Case A", "Case B"]);
  });

  it("sorts executedAt as an instant, with never-run rows first ascending", () => {
    const asc = sortRequirementReportRows(rows, {
      column: "executedAt",
      direction: "asc",
    });
    expect(asc.map((r) => r.lastExecutedAt)).toEqual([
      null,
      "2026-08-02T00:00:00.000Z",
      "2026-08-03T00:00:00.000Z",
    ]);
  });

  it("sorts the project column by project name", () => {
    const desc = sortRequirementReportRows(rows, {
      column: "project",
      direction: "desc",
    });
    expect(desc.map((r) => r.caseProjectName)).toEqual(["Web", "Cloud", null]);
  });
});

describe("coverage-changes columns", () => {
  const changeRows = [
    {
      requirementKey: "A",
      changeKind: "UNCHANGED",
      previousCoverageStatus: "PASSED",
      currentCoverageStatus: "PASSED",
      previousLinkedCaseCount: 2,
      currentLinkedCaseCount: 2,
      casesAdded: 0,
      casesRemoved: 0,
      resultsChanged: 0,
    },
    {
      requirementKey: "B",
      changeKind: "REMOVED",
      previousCoverageStatus: "FAILED",
      currentCoverageStatus: null,
      previousLinkedCaseCount: 1,
      currentLinkedCaseCount: null,
      casesAdded: 0,
      casesRemoved: 1,
      resultsChanged: 0,
    },
    {
      requirementKey: "C",
      changeKind: "COVERAGE_CHANGED",
      previousCoverageStatus: "UNCOVERED",
      currentCoverageStatus: "NOT_RUN",
      previousLinkedCaseCount: 0,
      currentLinkedCaseCount: 3,
      casesAdded: 3,
      casesRemoved: 0,
      resultsChanged: 0,
    },
  ];

  it("sorts the change column most-consequential first, never alphabetically", () => {
    const asc = sortRequirementReportRows(changeRows, {
      column: "change",
      direction: "asc",
    });
    expect(asc.map((r) => r.requirementKey)).toEqual(["B", "C", "A"]);
  });

  it("sorts a side's coverage by the severity ladder with the absent side last", () => {
    const asc = sortRequirementReportRows(changeRows, {
      column: "currentCoverage",
      direction: "asc",
    });
    expect(asc.map((r) => r.requirementKey)).toEqual(["C", "A", "B"]);
  });

  it("sorts the numeric change columns numerically", () => {
    const desc = sortRequirementReportRows(changeRows, {
      column: "casesAdded",
      direction: "desc",
    });
    expect(desc.map((r) => r.requirementKey)).toEqual(["C", "A", "B"]);
    const linked = sortRequirementReportRows(changeRows, {
      column: "currentLinkedCases",
      direction: "asc",
    });
    // A missing "after" count sorts before every real count ascending.
    expect(linked.map((r) => r.requirementKey)).toEqual(["B", "A", "C"]);
  });
});
