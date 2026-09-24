import { describe, expect, it, vi } from "vitest";

vi.mock("@/actions/share-links", () => ({
  auditShareLinkCreation: vi.fn(),
  prepareShareLinkData: vi.fn(),
}));

import {
  buildSavedReportConfig,
  savedReportHref,
  savedReportProjectId,
  type SavedReport,
} from "./useSavedReports";

function report(overrides: Partial<SavedReport> = {}): SavedReport {
  return {
    id: "r1",
    shareKey: "key-1",
    title: "Weekly",
    description: null,
    config: { reportType: "flaky-tests", consecutiveRuns: 8, projectId: 7 },
    projectId: 7,
    frozen: null,
    ...overrides,
  };
}

describe("savedReportProjectId", () => {
  it("reads a numeric or numeric-string project id", () => {
    expect(savedReportProjectId({ projectId: 7 })).toBe(7);
    expect(savedReportProjectId({ projectId: "7" })).toBe(7);
  });

  it("treats a missing or invalid id as cross-project", () => {
    expect(savedReportProjectId({ reportType: "x" })).toBeNull();
    expect(savedReportProjectId({ projectId: 0 })).toBeNull();
    expect(savedReportProjectId(null)).toBeNull();
  });
});

describe("buildSavedReportConfig", () => {
  it("stamps the page's project onto a project report", () => {
    expect(
      buildSavedReportConfig({ reportType: "a", projectId: 99 }, 7)
    ).toEqual({ reportType: "a", projectId: 7 });
  });

  it("drops any project from a cross-project report", () => {
    expect(
      buildSavedReportConfig({ reportType: "a", projectId: 99 }, null)
    ).toEqual({ reportType: "a" });
  });
});

describe("savedReportHref", () => {
  it("opens a live project report on the project Reports page", () => {
    const href = savedReportHref(report());
    expect(href.startsWith("/projects/reports/7?")).toBe(true);
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.get("reportType")).toBe("flaky-tests");
    expect(params.get("consecutiveRuns")).toBe("8");
    expect(params.has("projectId")).toBe(false);
    expect(params.get("savedReport")).toBe("r1");
  });

  it("opens a live cross-project report on the admin Reports page", () => {
    const href = savedReportHref(
      report({ projectId: null, config: { reportType: "x" } })
    );
    expect(href).toBe("/admin/reports?reportType=x&savedReport=r1");
  });

  it("opens a frozen report in the share viewer", () => {
    expect(
      savedReportHref(
        report({ frozen: { capturedAt: new Date(), truncated: false } })
      )
    ).toBe("/share/key-1");
  });
});
