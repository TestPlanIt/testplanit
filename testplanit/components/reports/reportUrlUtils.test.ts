import { describe, expect, it } from "vitest";
import {
  buildCleanReportUrlParams,
  isUrlInSyncWithReportType,
  resolveSyncedActiveTab,
  resolveSyncedReportType,
  resolveTabChange,
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

describe("resolveSyncedActiveTab", () => {
  const preBuilt = ["automation-trends", "flaky-tests"];

  it("does NOT revert the tab while our navigation is in flight (the bounce bug)", () => {
    // User ran a custom report, then clicked Reports: activeTab is optimistically
    // "reports" and pending is "reports", but router.replace hasn't landed so the
    // URL still says tab=builder. The effect must leave activeTab alone.
    expect(
      resolveSyncedActiveTab({
        urlTab: "builder",
        urlReportType: "test-execution",
        pendingTab: "reports",
        activeTab: "reports",
        preBuiltReportIds: preBuilt,
      })
    ).toEqual({ nextTab: null, clearPending: false });
  });

  it("clears the pending marker once the URL catches up to the navigated tab", () => {
    expect(
      resolveSyncedActiveTab({
        urlTab: "reports",
        urlReportType: "automation-trends",
        pendingTab: "reports",
        activeTab: "reports",
        preBuiltReportIds: preBuilt,
      })
    ).toEqual({ nextTab: null, clearPending: true });
  });

  it("honors a genuine URL tab change when nothing is in flight (back/forward)", () => {
    expect(
      resolveSyncedActiveTab({
        urlTab: "builder",
        urlReportType: "test-execution",
        pendingTab: null,
        activeTab: "reports",
        preBuiltReportIds: preBuilt,
      })
    ).toEqual({ nextTab: "builder", clearPending: false });
  });

  it("is a no-op when the URL tab already matches activeTab", () => {
    expect(
      resolveSyncedActiveTab({
        urlTab: "reports",
        urlReportType: "automation-trends",
        pendingTab: null,
        activeTab: "reports",
        preBuiltReportIds: preBuilt,
      })
    ).toEqual({ nextTab: null, clearPending: false });
  });

  it('infers "reports" from a pre-built reportType when the URL has no tab', () => {
    expect(
      resolveSyncedActiveTab({
        urlTab: null,
        urlReportType: "automation-trends",
        pendingTab: null,
        activeTab: "builder",
        preBuiltReportIds: preBuilt,
      })
    ).toEqual({ nextTab: "reports", clearPending: false });
  });

  it('infers "builder" from a custom reportType when the URL has no tab', () => {
    expect(
      resolveSyncedActiveTab({
        urlTab: null,
        urlReportType: "test-execution",
        pendingTab: null,
        activeTab: "reports",
        preBuiltReportIds: preBuilt,
      })
    ).toEqual({ nextTab: "builder", clearPending: false });
  });

  it("leaves activeTab unchanged when the URL has neither tab nor reportType", () => {
    expect(
      resolveSyncedActiveTab({
        urlTab: null,
        urlReportType: null,
        pendingTab: null,
        activeTab: "reports",
        preBuiltReportIds: preBuilt,
      })
    ).toEqual({ nextTab: null, clearPending: false });
  });
});

describe("resolveTabChange", () => {
  const preBuilt = ["automation-trends", "flaky-tests"];
  const custom = ["test-execution", "repository-stats"];

  it("switching to Reports picks a PRE-BUILT report, not the previous custom one", () => {
    // The bug: switching tabs left reportType on the custom "test-execution",
    // so the Reports tab still showed it. The target report must be pre-built.
    const result = resolveTabChange({
      newTab: "reports",
      preBuiltReportIds: preBuilt,
      customReportIds: custom,
    });

    expect(result).toEqual({ tab: "reports", reportType: "automation-trends" });
    expect(custom).not.toContain(result.reportType);
  });

  it("switching to Report Builder picks a custom report", () => {
    expect(
      resolveTabChange({
        newTab: "builder",
        preBuiltReportIds: preBuilt,
        customReportIds: custom,
      })
    ).toEqual({ tab: "builder", reportType: "test-execution" });
  });

  it("falls back to a known default when the target tab's list is empty", () => {
    expect(
      resolveTabChange({
        newTab: "reports",
        preBuiltReportIds: [],
        customReportIds: custom,
      })
    ).toEqual({ tab: "reports", reportType: "automation-trends" });
    expect(
      resolveTabChange({
        newTab: "builder",
        preBuiltReportIds: preBuilt,
        customReportIds: [],
      })
    ).toEqual({ tab: "builder", reportType: "test-execution" });
  });

  it("ignores a blank first id and uses the fallback", () => {
    expect(
      resolveTabChange({
        newTab: "reports",
        preBuiltReportIds: ["  "],
        customReportIds: custom,
      })
    ).toEqual({ tab: "reports", reportType: "automation-trends" });
  });
});

describe("resolveSyncedReportType", () => {
  const valid = ["automation-trends", "flaky-tests", "test-execution"];

  it("does NOT revert reportType while our navigation is in flight (stale URL)", () => {
    // Optimistically switched to a pre-built report, but router.replace hasn't
    // landed so the URL still names the old custom report. Must not revert.
    expect(
      resolveSyncedReportType({
        urlReportType: "test-execution",
        pendingReportType: "automation-trends",
        currentReportType: "automation-trends",
        validReportTypeIds: valid,
      })
    ).toEqual({ nextReportType: null, clearPending: false });
  });

  it("clears the pending marker once the URL catches up", () => {
    expect(
      resolveSyncedReportType({
        urlReportType: "automation-trends",
        pendingReportType: "automation-trends",
        currentReportType: "automation-trends",
        validReportTypeIds: valid,
      })
    ).toEqual({ nextReportType: null, clearPending: true });
  });

  it("honors a genuine valid URL change when nothing is in flight (back/forward)", () => {
    expect(
      resolveSyncedReportType({
        urlReportType: "flaky-tests",
        pendingReportType: null,
        currentReportType: "automation-trends",
        validReportTypeIds: valid,
      })
    ).toEqual({ nextReportType: "flaky-tests", clearPending: false });
  });

  it("ignores an unknown report type in the URL", () => {
    expect(
      resolveSyncedReportType({
        urlReportType: "not-a-real-report",
        pendingReportType: null,
        currentReportType: "automation-trends",
        validReportTypeIds: valid,
      })
    ).toEqual({ nextReportType: null, clearPending: false });
  });

  it("is a no-op when the URL report type already matches state", () => {
    expect(
      resolveSyncedReportType({
        urlReportType: "automation-trends",
        pendingReportType: null,
        currentReportType: "automation-trends",
        validReportTypeIds: valid,
      })
    ).toEqual({ nextReportType: null, clearPending: false });
  });
});
