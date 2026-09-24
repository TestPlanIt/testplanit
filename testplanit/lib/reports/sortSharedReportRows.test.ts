import { describe, expect, it } from "vitest";
import {
  sharedReportSortValue,
  sortSharedReportRows,
} from "./sortSharedReportRows";

const metrics = [{ value: "testResults", label: "Test Results Count" }];

const rows = [
  { status: { id: 2, name: "Passed" }, "Test Results Count": 69558 },
  { status: { id: 3, name: "Blocked" }, "Test Results Count": 63 },
  { status: { id: 4, name: "Failed" }, "Test Results Count": 46906 },
  { status: null, "Test Results Count": 39 },
];

describe("sharedReportSortValue", () => {
  it("reads a metric through its label key", () => {
    expect(sharedReportSortValue(rows[0], "testResults", metrics)).toBe(69558);
  });

  it("reads a dimension object by its name", () => {
    expect(sharedReportSortValue(rows[0], "status", metrics)).toBe("Passed");
  });

  it("reads a plain key when there is no matching metric", () => {
    expect(sharedReportSortValue({ count: 5 }, "count", metrics)).toBe(5);
  });
});

describe("sortSharedReportRows", () => {
  it("sorts a metric column numerically in both directions", () => {
    const asc = sortSharedReportRows(
      rows,
      { column: "testResults", direction: "asc" },
      metrics
    );
    expect(asc.map((r) => r["Test Results Count"])).toEqual([
      39, 63, 46906, 69558,
    ]);

    const desc = sortSharedReportRows(
      rows,
      { column: "testResults", direction: "desc" },
      metrics
    );
    expect(desc.map((r) => r["Test Results Count"])).toEqual([
      69558, 46906, 63, 39,
    ]);
  });

  it("sorts a dimension by name and keeps missing values last", () => {
    const asc = sortSharedReportRows(
      rows,
      { column: "status", direction: "asc" },
      metrics
    );
    expect(asc.map((r) => r.status?.name ?? null)).toEqual([
      "Blocked",
      "Failed",
      "Passed",
      null,
    ]);

    const desc = sortSharedReportRows(
      rows,
      { column: "status", direction: "desc" },
      metrics
    );
    expect(desc.map((r) => r.status?.name ?? null)).toEqual([
      "Passed",
      "Failed",
      "Blocked",
      null,
    ]);
  });

  it("compares numeric strings as numbers", () => {
    const sorted = sortSharedReportRows(
      [{ v: "10" }, { v: "9" }, { v: "100" }],
      { column: "v", direction: "asc" },
      []
    );
    expect(sorted.map((r) => r.v)).toEqual(["9", "10", "100"]);
  });

  it("returns the original order without a sort", () => {
    expect(sortSharedReportRows(rows, null, metrics)).toEqual(rows);
  });
});
