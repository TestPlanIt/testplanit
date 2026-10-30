import { describe, expect, it } from "vitest";
import { isServerPagedReport, serverPageSize } from "./serverPagedReports";

describe("serverPagedReports", () => {
  it("pages execution-log and test-case-health, in both project and cross-project forms", () => {
    expect(serverPageSize("execution-log")).toBe(100);
    expect(serverPageSize("cross-project-execution-log")).toBe(100);
    expect(serverPageSize("test-case-health")).toBe(250);
    expect(serverPageSize("cross-project-test-case-health")).toBe(250);
    expect(isServerPagedReport("cross-project-test-case-health")).toBe(true);
  });

  it("leaves every other report as a full-set fetch", () => {
    for (const type of [
      "flaky-tests",
      "issue-test-coverage",
      "cross-project-requirement-traceability",
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
