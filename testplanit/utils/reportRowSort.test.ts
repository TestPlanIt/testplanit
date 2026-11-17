import { describe, expect, it } from "vitest";
import { sortReportRows } from "./reportRowSort";

const metricConfigs = [
  { id: "testResults", label: "Test Results Count" },
  { id: "passRate", label: "Pass Rate (%)" },
  { id: "avgElapsedTime", label: "Avg. Elapsed Time" },
];

describe("sortReportRows", () => {
  it("leaves the rows untouched without a column or with an unknown direction", () => {
    const rows = [{ "Pass Rate (%)": 2 }, { "Pass Rate (%)": 9 }];
    expect(
      sortReportRows(rows, { dimensions: [], metricConfigs }).map(
        (r) => r["Pass Rate (%)"]
      )
    ).toEqual([2, 9]);
    expect(
      sortReportRows(rows, {
        dimensions: [],
        metricConfigs,
        sortColumn: "passRate",
        sortDirection: "sideways",
      }).map((r) => r["Pass Rate (%)"])
    ).toEqual([2, 9]);
  });

  it("sorts a dimension column by its display name", () => {
    const rows = [
      { user: { id: 1, name: "Zed" } },
      { user: { id: 2, name: "Amy" } },
      { user: { id: 3, name: "Kim" } },
    ];
    const sorted = sortReportRows(rows, {
      dimensions: ["user"],
      metricConfigs,
      sortColumn: "user",
      sortDirection: "desc",
    });
    expect(sorted.map((r) => r.user.name)).toEqual(["Zed", "Kim", "Amy"]);
  });

  it("sorts the date dimension by its timestamp, whichever field carries it", () => {
    const rows = [
      { date: { executedAt: "2026-03-02T00:00:00.000Z" } },
      { date: { createdAt: "2026-01-15T00:00:00.000Z" } },
      { date: { executedAt: "2026-02-01T00:00:00.000Z" } },
    ];
    const sorted = sortReportRows(rows, {
      dimensions: ["date"],
      metricConfigs,
      sortColumn: "date",
      sortDirection: "asc",
    });
    expect(sorted.map((r) => r.date.executedAt ?? r.date.createdAt)).toEqual([
      "2026-01-15T00:00:00.000Z",
      "2026-02-01T00:00:00.000Z",
      "2026-03-02T00:00:00.000Z",
    ]);
  });

  it("reads a metric by its LABEL, found through the id ReportBuilder sends", () => {
    const rows = [
      { "Test Results Count": 5 },
      { "Test Results Count": 50 },
      { "Test Results Count": 1 },
    ];
    // "testResultCount" is the alias the builder maps "testResults" to.
    const sorted = sortReportRows(rows, {
      dimensions: ["user"],
      metricConfigs,
      sortColumn: "testResultCount",
      sortDirection: "desc",
    });
    expect(sorted.map((r) => r["Test Results Count"])).toEqual([50, 5, 1]);
  });

  it("falls back to the raw property for a column with no metric config", () => {
    const rows = [{ Passed: 3 }, { Passed: 1 }, { Passed: 2 }];
    const sorted = sortReportRows(rows, {
      dimensions: ["milestone"],
      metricConfigs: [],
      sortColumn: "Passed",
      sortDirection: "asc",
    });
    expect(sorted.map((r) => r.Passed)).toEqual([1, 2, 3]);
  });

  it("keeps empty cells last under either direction", () => {
    const rows = [
      { "Pass Rate (%)": null },
      { "Pass Rate (%)": 40 },
      { "Pass Rate (%)": 90 },
    ];
    const asc = sortReportRows([...rows], {
      dimensions: [],
      metricConfigs,
      sortColumn: "passRate",
      sortDirection: "asc",
    });
    expect(asc.map((r) => r["Pass Rate (%)"])).toEqual([40, 90, null]);
    const desc = sortReportRows([...rows], {
      dimensions: [],
      metricConfigs,
      sortColumn: "passRate",
      sortDirection: "desc",
    });
    expect(desc.map((r) => r["Pass Rate (%)"])).toEqual([90, 40, null]);
  });

  it("breaks metric ties on the date dimension when the report has one", () => {
    const rows = [
      { date: { createdAt: "2026-03-01T00:00:00.000Z" }, "Pass Rate (%)": 50 },
      { date: { createdAt: "2026-01-01T00:00:00.000Z" }, "Pass Rate (%)": 50 },
      { date: { createdAt: "2026-02-01T00:00:00.000Z" }, "Pass Rate (%)": 80 },
    ];
    const sorted = sortReportRows(rows, {
      dimensions: ["date"],
      metricConfigs,
      sortColumn: "passRate",
      sortDirection: "asc",
    });
    expect(sorted.map((r) => r.date.createdAt)).toEqual([
      "2026-01-01T00:00:00.000Z",
      "2026-03-01T00:00:00.000Z",
      "2026-02-01T00:00:00.000Z",
    ]);
  });
});
