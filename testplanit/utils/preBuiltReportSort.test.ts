import { describe, expect, it } from "vitest";
import { sortPreBuiltReportRows } from "./preBuiltReportSort";

describe("sortPreBuiltReportRows", () => {
  it("returns a NEW array in server order when no sort is configured", () => {
    const rows = [{ flipCount: 2 }, { flipCount: 9 }];
    const result = sortPreBuiltReportRows("flaky-tests", rows, null);
    expect(result).toEqual(rows);
    expect(result).not.toBe(rows);
  });

  it("sorts matching-property columns raw (the generic rule)", () => {
    const rows = [{ flipCount: 2 }, { flipCount: 9 }, { flipCount: 5 }];
    const result = sortPreBuiltReportRows("flaky-tests", rows, {
      column: "flipCount",
      direction: "desc",
    });
    expect(result.map((r) => r.flipCount)).toEqual([9, 5, 2]);
  });

  it("sorts the project column by project NAME, not the object", () => {
    const rows = [
      { project: { id: 9, name: "Zeta" } },
      { project: { id: 1, name: "Alpha" } },
      { project: undefined },
    ];
    const result = sortPreBuiltReportRows("test-case-health", rows, {
      column: "project",
      direction: "asc",
    });
    // The missing project coerces to "" and sorts first ascending.
    expect(result.map((r) => r.project?.name)).toEqual([
      undefined,
      "Alpha",
      "Zeta",
    ]);
  });

  // issue-test-coverage's Issue/Test Case columns render NAMES; their ids
  // point at internal numeric ids. The override is what keeps a sort from
  // ordering rows by database id while looking alphabetical-ish.
  it("issue-test-coverage: the issueId column sorts by the displayed issue name", () => {
    const rows = [
      { issueId: 1, issueName: "PROJ-9" },
      { issueId: 900, issueName: "PROJ-1" },
      { issueId: 5, issueName: "PROJ-5" },
    ];
    const result = sortPreBuiltReportRows("issue-test-coverage", rows, {
      column: "issueId",
      direction: "asc",
    });
    expect(result.map((r) => r.issueName)).toEqual([
      "PROJ-1",
      "PROJ-5",
      "PROJ-9",
    ]);
  });

  it("issue-test-coverage: the testCaseId column sorts by the displayed case name", () => {
    const rows = [
      { testCaseId: 3, testCaseName: "charlie" },
      { testCaseId: 400, testCaseName: "alpha" },
      { testCaseId: 20, testCaseName: "bravo" },
    ];
    const result = sortPreBuiltReportRows(
      "cross-project-issue-test-coverage",
      rows,
      { column: "testCaseId", direction: "asc" }
    );
    expect(result.map((r) => r.testCaseName)).toEqual([
      "alpha",
      "bravo",
      "charlie",
    ]);
  });

  it("test-case-health: healthStatus sorts by the worst-first severity rank, not alphabetically", () => {
    const rows = [
      { healthStatus: "healthy" },
      { healthStatus: "always_passing" },
      { healthStatus: "always_failing" },
      { healthStatus: "never_executed" },
    ];
    const result = sortPreBuiltReportRows("test-case-health", rows, {
      column: "healthStatus",
      direction: "asc",
    });
    expect(result.map((r) => r.healthStatus)).toEqual([
      "always_failing",
      "never_executed",
      "healthy",
      "always_passing",
    ]);
  });

  it("keeps nulls LAST under either direction — an empty cell is an absence, not a smallest value", () => {
    const rows = [
      { lastExecutedAt: null },
      { lastExecutedAt: "2026-08-01T00:00:00Z" },
      { lastExecutedAt: "2026-01-01T00:00:00Z" },
    ];
    for (const direction of ["asc", "desc"] as const) {
      const result = sortPreBuiltReportRows("test-case-health", rows, {
        column: "lastExecutedAt",
        direction,
      });
      expect(result[result.length - 1].lastExecutedAt).toBeNull();
    }
  });

  it("leaves rows in server order for a column id with no backing property (stable no-op)", () => {
    const rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const result = sortPreBuiltReportRows("requirement-traceability", rows, {
      column: "requirement",
      direction: "desc",
    });
    expect(result.map((r) => r.id)).toEqual([1, 2, 3]);
  });
});
