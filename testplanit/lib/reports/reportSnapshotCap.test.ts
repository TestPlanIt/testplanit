import { afterEach, describe, expect, it } from "vitest";
import {
  countSnapshotRows,
  DEFAULT_REPORT_SNAPSHOT_MAX_ROWS,
  getReportSnapshotMaxRows,
  truncateSnapshotPayload,
} from "./reportSnapshotCap";
import type { SharedReportPayload } from "./sharedReportPayload";

function payload(overrides: Partial<SharedReportPayload> = {}) {
  return {
    results: [],
    chartData: [],
    dimensions: [],
    metrics: [],
    pagination: { totalCount: 0, page: 1, pageSize: "All" as const },
    ...overrides,
  } as SharedReportPayload;
}

describe("getReportSnapshotMaxRows", () => {
  afterEach(() => {
    delete process.env.REPORT_SNAPSHOT_MAX_ROWS;
  });

  it("defaults when unset", () => {
    expect(getReportSnapshotMaxRows()).toBe(DEFAULT_REPORT_SNAPSHOT_MAX_ROWS);
  });

  it("reads a positive integer", () => {
    process.env.REPORT_SNAPSHOT_MAX_ROWS = "500";
    expect(getReportSnapshotMaxRows()).toBe(500);
  });

  it.each(["0", "-3", "lots", ""])("falls back for %j", (value) => {
    process.env.REPORT_SNAPSHOT_MAX_ROWS = value;
    expect(getReportSnapshotMaxRows()).toBe(DEFAULT_REPORT_SNAPSHOT_MAX_ROWS);
  });
});

describe("countSnapshotRows", () => {
  it("takes the largest of table rows, chart points and matrix cells", () => {
    expect(
      countSnapshotRows(
        payload({ results: [1, 2], chartData: [1, 2, 3, 4] as any[] })
      )
    ).toBe(4);
    expect(
      countSnapshotRows(
        payload({ matrixAxes: { cells: [[1], [2], [3]], cellCount: 3 } })
      )
    ).toBe(3);
  });
});

describe("truncateSnapshotPayload", () => {
  it("cuts every row array and leaves the rest alone", () => {
    const original = payload({
      results: [1, 2, 3] as any[],
      chartData: [1, 2, 3] as any[],
      pagination: { totalCount: 3, page: 1, pageSize: "All" },
      matrixAxes: {
        caseAxis: ["a"],
        cells: [[1], [2], [3]],
        cellCount: 3,
      },
    });

    const cut = truncateSnapshotPayload(original, 2);

    expect(cut.results).toEqual([1, 2]);
    expect(cut.chartData).toEqual([1, 2]);
    expect(cut.matrixAxes.cells).toEqual([[1], [2]]);
    expect(cut.matrixAxes.cellCount).toBe(2);
    expect(cut.matrixAxes.caseAxis).toEqual(["a"]);
    // The true total stays visible alongside the truncated rows.
    expect(cut.pagination.totalCount).toBe(3);
    expect(original.results).toHaveLength(3);
  });
});
