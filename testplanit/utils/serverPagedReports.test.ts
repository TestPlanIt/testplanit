import { describe, expect, it } from "vitest";
import { isServerPagedReport, serverPageSize } from "./serverPagedReports";

describe("serverPagedReports", () => {
  it("pages the server-paged reports, in both project and cross-project forms", () => {
    expect(serverPageSize("execution-log")).toBe(100);
    expect(serverPageSize("cross-project-execution-log")).toBe(100);
    expect(serverPageSize("test-case-health")).toBe(250);
    expect(serverPageSize("cross-project-test-case-health")).toBe(250);
    expect(serverPageSize("issue-test-coverage")).toBe(250);
    expect(serverPageSize("cross-project-issue-test-coverage")).toBe(250);
    expect(serverPageSize("requirement-traceability")).toBe(250);
    expect(serverPageSize("cross-project-requirement-traceability")).toBe(250);
    expect(serverPageSize("requirement-coverage-gaps")).toBe(250);
    expect(serverPageSize("requirement-coverage-changes")).toBe(250);
    expect(isServerPagedReport("cross-project-test-case-health")).toBe(true);
  });

  it("leaves every other report as a full-set fetch", () => {
    for (const type of [
      "flaky-tests",
      "automation-trends",
      "impact-analysis",
      "test-execution",
      null,
      undefined,
      "",
    ]) {
      expect(serverPageSize(type)).toBeNull();
      expect(isServerPagedReport(type)).toBe(false);
    }
  });
});
