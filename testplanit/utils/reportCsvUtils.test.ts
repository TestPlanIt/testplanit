import { describe, expect, it } from "vitest";
import {
  buildReportCsvRows,
  getBaseReportType,
  reportCsvFileName,
} from "./reportCsvUtils";

// Bare-key translator: returns the key (with {count} interpolated) so tests
// assert on stable header keys instead of localized strings.
const t = (key: string, values?: Record<string, unknown>) =>
  values && "count" in values ? `${key}:${values.count}` : key;

const base = {
  isCrossProject: false,
  locale: "en",
  t,
};

describe("getBaseReportType", () => {
  it("strips the cross-project- prefix", () => {
    expect(getBaseReportType("cross-project-flaky-tests")).toBe("flaky-tests");
    expect(getBaseReportType("flaky-tests")).toBe("flaky-tests");
  });
});

describe("reportCsvFileName", () => {
  it("builds a timestamped filename", () => {
    const name = reportCsvFileName(
      "flaky-tests",
      new Date("2026-06-11T14:15:30")
    );
    expect(name).toBe("flaky-tests-2026-06-11-141530.csv");
  });
});

describe("buildReportCsvRows", () => {
  it("returns [] for empty input", () => {
    expect(
      buildReportCsvRows({ ...base, reportType: "flaky-tests", rows: [] })
    ).toEqual([]);
  });

  it("flaky-tests: name, flips, and joined last-N statuses", () => {
    const rows = [
      {
        testCaseName: "Login",
        flipCount: 3,
        executions: [
          { statusName: "Passed" },
          { statusName: "Failed" },
          { statusName: "Passed" },
        ],
      },
    ];
    const [row] = buildReportCsvRows({
      ...base,
      reportType: "flaky-tests",
      rows,
      consecutiveRuns: 2,
    });
    expect(row["reports.dimensions.testCase"]).toBe("Login");
    expect(row["reports.ui.flakyTests.flips"]).toBe(3);
    // Only `consecutiveRuns` (2) statuses, joined.
    expect(row["reports.ui.flakyTests.lastNResults:2"]).toBe("Passed Failed");
  });

  it("flaky-tests cross-project: adds a Project column", () => {
    const [row] = buildReportCsvRows({
      ...base,
      isCrossProject: true,
      reportType: "cross-project-flaky-tests",
      rows: [{ testCaseName: "X", flipCount: 1, project: { name: "Proj A" } }],
    });
    expect(row["reports.dimensions.project"]).toBe("Proj A");
  });

  it("test-case-health: translates status, formats stale/pass-rate", () => {
    const [row] = buildReportCsvRows({
      ...base,
      reportType: "test-case-health",
      rows: [
        {
          testCaseName: "Case 1",
          healthStatus: "never_executed",
          isStale: false,
          healthScore: 80,
          lastExecutedAt: null,
          totalExecutions: 0,
          passRate: 0,
        },
      ],
    });
    expect(row["reports.ui.testCaseHealth.status"]).toBe(
      "reports.ui.testCaseHealth.healthStatus.neverExecuted"
    );
    expect(row["reports.ui.testCaseHealth.healthStatus.stale"]).toBe(
      "common.no"
    );
    expect(row["reports.ui.testCaseHealth.lastExecuted"]).toBe(
      "reports.ui.testCaseHealth.never"
    );
    // No executions → pass rate blank.
    expect(row["reports.ui.testCaseHealth.passRate"]).toBe("");
  });

  it("test-case-health: pass rate shown as % when executed", () => {
    const [row] = buildReportCsvRows({
      ...base,
      reportType: "test-case-health",
      rows: [
        {
          testCaseName: "Case 2",
          healthStatus: "healthy",
          isStale: true,
          healthScore: 90,
          lastExecutedAt: "2026-06-01T10:00:00Z",
          totalExecutions: 10,
          passRate: 50,
        },
      ],
    });
    expect(row["reports.ui.testCaseHealth.passRate"]).toBe("50%");
    expect(row["reports.ui.testCaseHealth.healthStatus.stale"]).toBe(
      "common.yes"
    );
  });

  it("issue-test-coverage: combines key + title, falls back to Not Tested", () => {
    const [row] = buildReportCsvRows({
      ...base,
      reportType: "issue-test-coverage",
      rows: [
        {
          externalKey: "TPI-12",
          issueTitle: "Test Issue",
          testCaseName: "Login case",
          issueStatus: "To Do",
          issuePriority: "Medium",
          lastStatusName: null,
          lastExecutedAt: null,
        },
      ],
    });
    expect(row["reports.ui.issueTestCoverage.issue"]).toBe(
      "TPI-12: Test Issue"
    );
    expect(row["reports.ui.issueTestCoverage.lastStatus"]).toBe(
      "reports.ui.issueTestCoverage.notTested"
    );
  });

  it("execution-log: maps top-level execution fields", () => {
    const [row] = buildReportCsvRows({
      ...base,
      reportType: "execution-log",
      rows: [
        {
          testCaseName: "Case",
          testRunName: "Run 1",
          status: { name: "Passed" },
          executedBy: { name: "Alice" },
          executedAt: "2026-06-01T10:00:00Z",
          elapsed: 0,
        },
      ],
    });
    expect(row["reports.dimensions.testRun"]).toBe("Run 1");
    expect(row["common.actions.status"]).toBe("Passed");
    expect(row["common.fields.executedBy"]).toBe("Alice");
    expect(row["common.fields.duration"]).toBe(""); // 0 → blank
  });

  it("custom report: dimension values + formatted metric values", () => {
    const [row] = buildReportCsvRows({
      ...base,
      reportType: "test-execution",
      rows: [
        {
          user: { id: 1, name: "Bob" },
          "Test Results Count": 42,
          "Pass Rate (%)": 87.5,
        },
      ],
      dimensions: [{ value: "user", label: "User" }],
      metrics: [
        { value: "testResults", label: "Test Results" },
        { value: "passRate", label: "Pass Rate" },
      ],
    });
    expect(row["User"]).toBe("Bob");
    expect(row["Test Results"]).toBe(42);
    expect(row["Pass Rate"]).toBe("87.5%");
  });

  it("custom report: date dimension uses UTC (no off-by-one) and elapsed is seconds", () => {
    const [row] = buildReportCsvRows({
      ...base,
      reportType: "test-execution",
      rows: [
        {
          // UTC midnight — must stay 03-28 regardless of the runner's timezone.
          date: { executedAt: "2025-03-28T00:00:00.000Z" },
          "Avg. Elapsed Time": 60, // seconds
        },
      ],
      dimensions: [{ value: "date", label: "Date" }],
      metrics: [{ value: "avgElapsedTime", label: "Avg. Elapsed Time" }],
    });
    expect(row["Date"]).toBe("2025-03-28");
    expect(row["Avg. Elapsed Time"]).toBe("1 minute");
  });

  it("custom report: zero-duration metric is a blank cell, not a hyphen", () => {
    const [row] = buildReportCsvRows({
      ...base,
      reportType: "test-execution",
      rows: [{ "Avg. Elapsed Time": 0, "Total Elapsed Time": 0 }],
      metrics: [
        { value: "avgElapsedTime", label: "Avg. Elapsed Time" },
        { value: "totalElapsedTime", label: "Total Elapsed Time" },
      ],
    });
    // A "-" here would get a leading apostrophe from papaparse escapeFormulae.
    expect(row["Avg. Elapsed Time"]).toBe("");
    expect(row["Total Elapsed Time"]).toBe("");
  });

  it("custom report: null dimension object yields empty string", () => {
    const [row] = buildReportCsvRows({
      ...base,
      reportType: "test-execution",
      rows: [{ status: null, "Test Results Count": 0 }],
      dimensions: [{ value: "status", label: "Status" }],
      metrics: [{ value: "testResults", label: "Test Results" }],
    });
    expect(row["Status"]).toBe("");
    expect(row["Test Results"]).toBe(0);
  });
});

// Converted from the Wave 0 title scaffold (COV-04, D-2).
describe("buildReportCsvRows (Phase 26 requirement report additions)", () => {
  it("builds requirement-coverage-gaps rows with localized headers", () => {
    const [row] = buildReportCsvRows({
      ...base,
      reportType: "requirement-coverage-gaps",
      rows: [
        {
          requirementId: 1,
          requirementKey: "REQ-1",
          requirementTitle: "Enrol domestic students",
          requirementPath: "Enrolments > Enrol domestic students",
          linkedCases: 0,
        },
      ],
    });

    // Header keys are the localized reports.ui.requirementCoverage.* keys,
    // never a dimension-derived label like "reports.dimensions.testCase" --
    // this is a pre-built report with no dimension/metric picker.
    expect(row["reports.ui.requirementCoverage.requirement"]).toBe(
      "REQ-1: Enrol domestic students"
    );
    expect(row["reports.ui.requirementCoverage.path"]).toBe(
      "Enrolments > Enrol domestic students"
    );
    expect(row["reports.ui.requirementCoverage.linkedCases"]).toBe(0);
  });

  it("builds requirement-traceability rows with localized headers", () => {
    const [row] = buildReportCsvRows({
      ...base,
      reportType: "requirement-traceability",
      rows: [
        {
          requirementId: 1,
          requirementKey: "REQ-1",
          requirementTitle: "Enrol domestic students",
          requirementPath: "Enrolments > Enrol domestic students",
          testCaseId: 55,
          testCaseName: "Enrol via portal",
          caseProjectId: 10,
          caseProjectName: "Enrolments",
          lastStatusName: "Passed",
          lastStatusColor: "#10b981",
          lastExecutedAt: "2026-08-20T12:00:00.000Z",
        },
      ],
    });

    expect(row["reports.ui.requirementCoverage.requirement"]).toBe(
      "REQ-1: Enrol domestic students"
    );
    expect(row["reports.ui.requirementCoverage.path"]).toBe(
      "Enrolments > Enrol domestic students"
    );
    expect(row["reports.ui.requirementCoverage.testCase"]).toBe(
      "Enrol via portal"
    );
    expect(row["reports.ui.requirementCoverage.result"]).toBe("Passed");
    // fmtDateTime formats in the test runner's local timezone (same as
    // execution-log's equivalent field, above) -- assert non-empty and
    // date-prefixed rather than hardcoding a timezone-dependent string.
    expect(row["reports.ui.requirementCoverage.executedAt"]).toMatch(
      /^2026-08-20 \d{2}:\d{2}:\d{2}$/
    );
    expect(row["reports.ui.requirementCoverage.project"]).toBe("Enrolments");
  });

  it("writes Uncovered rather than an empty cell for a null-case traceability row", () => {
    const [gapRow, notRunRow] = buildReportCsvRows({
      ...base,
      reportType: "requirement-traceability",
      rows: [
        {
          requirementId: 1,
          requirementKey: "REQ-1",
          requirementTitle: "Enrol domestic students",
          requirementPath: "Enrolments > Enrol domestic students",
          testCaseId: null,
          testCaseName: null,
          caseProjectId: null,
          caseProjectName: null,
          lastStatusName: null,
          lastStatusColor: null,
          lastExecutedAt: null,
        },
        {
          requirementId: 2,
          requirementKey: "REQ-2",
          requirementTitle: "Enrol international students",
          requirementPath: "Enrolments > Enrol international students",
          testCaseId: 56,
          testCaseName: "Enrol via agent",
          caseProjectId: 10,
          caseProjectName: "Enrolments",
          lastStatusName: null,
          lastStatusColor: null,
          lastExecutedAt: null,
        },
      ],
    });

    // The gap row (null testCaseId) writes the localized "Uncovered" label,
    // never an empty string -- a blank cell here would silently hide a
    // coverage gap in the exported spreadsheet (T-26-12-05).
    expect(gapRow["reports.ui.requirementCoverage.result"]).toBe(
      "reports.ui.requirementCoverage.uncovered"
    );
    expect(gapRow["reports.ui.requirementCoverage.result"]).not.toBe("");

    // Distinct from the gap row: a linked case with no status writes
    // "Not run", not "Uncovered" and not an empty string either.
    expect(notRunRow["reports.ui.requirementCoverage.result"]).toBe(
      "reports.ui.requirementCoverage.notRun"
    );
    expect(notRunRow["reports.ui.requirementCoverage.result"]).not.toBe(
      gapRow["reports.ui.requirementCoverage.result"]
    );
  });
});
