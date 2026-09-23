import { describe, expect, it } from "vitest";
import { DURATION_SORT_COLUMNS, durationSortTerms } from "./durationSort";

describe("durationSortTerms", () => {
  it("sorts Estimate on its scalar with blanks last in both directions", () => {
    expect(durationSortTerms("estimate", "asc")).toEqual([
      { estimate: { sort: "asc", nulls: "last" } },
    ]);
    expect(durationSortTerms("estimate", "desc")).toEqual([
      { estimate: { sort: "desc", nulls: "last" } },
    ]);
  });

  it("sorts Forecast by the manual figure first, then the automated one", () => {
    expect(durationSortTerms("forecast", "desc")).toEqual([
      { forecastManual: { sort: "desc", nulls: "last" } },
      { forecastAutomated: { sort: "desc", nulls: "last" } },
    ]);
  });

  it("returns null for anything that is not a duration column", () => {
    expect(durationSortTerms("name", "asc")).toBeNull();
    expect(durationSortTerms("latestResults", "asc")).toBeNull();
    expect(durationSortTerms("4711", "asc")).toBeNull();
  });

  it("names exactly the columns it can build terms for", () => {
    for (const column of DURATION_SORT_COLUMNS) {
      expect(durationSortTerms(column, "asc")).not.toBeNull();
    }
    expect(DURATION_SORT_COLUMNS.has("elapsed")).toBe(false);
  });
});
