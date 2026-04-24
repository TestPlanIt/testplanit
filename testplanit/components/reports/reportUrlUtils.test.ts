import { describe, expect, it } from "vitest";
import {
  buildCleanReportUrlParams,
  isUrlInSyncWithReportType,
} from "./reportUrlUtils";

describe("buildCleanReportUrlParams", () => {
  it("builds a URL with only reportType, tab, page, and pageSize — no stale params", () => {
    const params = buildCleanReportUrlParams({
      reportType: "automation-trends",
      tab: "reports",
    });

    expect(Array.from(params.keys()).sort()).toEqual([
      "page",
      "pageSize",
      "reportType",
      "tab",
    ]);
    expect(params.get("reportType")).toBe("automation-trends");
    expect(params.get("tab")).toBe("reports");
    expect(params.get("page")).toBe("1");
    expect(params.get("pageSize")).toBe("10");
  });

  it("drops dimension/metric/date params that a caller might have inherited", () => {
    // Simulate a caller that had old params in scope — they should not leak in.
    const params = buildCleanReportUrlParams({
      reportType: "test-execution",
      tab: "builder",
    });

    expect(params.get("dimensions")).toBeNull();
    expect(params.get("metrics")).toBeNull();
    expect(params.get("startDate")).toBeNull();
    expect(params.get("endDate")).toBeNull();
  });

  it("respects a numeric pageSize override", () => {
    const params = buildCleanReportUrlParams({
      reportType: "repository-stats",
      tab: "builder",
      pageSize: 25,
    });

    expect(params.get("pageSize")).toBe("25");
  });

  it('falls back to "10" for pageSize === "All"', () => {
    const params = buildCleanReportUrlParams({
      reportType: "repository-stats",
      tab: "builder",
      pageSize: "All",
    });

    expect(params.get("pageSize")).toBe("10");
  });

  it('falls back to "10" when pageSize is undefined', () => {
    const params = buildCleanReportUrlParams({
      reportType: "flaky-tests",
      tab: "reports",
    });

    expect(params.get("pageSize")).toBe("10");
  });
});

describe("isUrlInSyncWithReportType", () => {
  it("returns true when the URL reportType matches state", () => {
    expect(isUrlInSyncWithReportType("test-execution", "test-execution")).toBe(
      true
    );
  });

  it("returns false when URL still points at the previous reportType", () => {
    // Classic race: state has updated to "automation-trends" but router.replace
    // hasn't landed yet, so searchParams still has the OLD "repository-stats".
    expect(
      isUrlInSyncWithReportType("repository-stats", "automation-trends")
    ).toBe(false);
  });

  it("returns true when the URL has no reportType (initial load, nothing to conflict)", () => {
    expect(isUrlInSyncWithReportType(null, "test-execution")).toBe(true);
  });

  it("is case-sensitive — report type IDs are exact matches", () => {
    // The runtime values are lower-kebab-case and should match exactly.
    expect(isUrlInSyncWithReportType("Test-Execution", "test-execution")).toBe(
      false
    );
  });
});
