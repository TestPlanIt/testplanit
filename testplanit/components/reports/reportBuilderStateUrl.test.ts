import { describe, expect, it } from "vitest";
import {
  applyLegacyReportUrlParams,
  buildReportBuilderStateConfig,
  hasReportSelectionInUrl,
  parseLegacyReportUrlParams,
  REPORT_STATE_URL_KEY,
  stripReportSelectionParams,
} from "./reportUrlUtils";

describe("buildReportBuilderStateConfig", () => {
  const dimensions = [{ value: "testRun" }, { value: "status" }];
  const metrics = [{ value: "testCaseCount" }];

  it("captures dimension and metric ids in order", () => {
    expect(
      buildReportBuilderStateConfig({
        dimensions,
        metrics,
        dimensionValueFilters: {},
      })
    ).toEqual({
      dimensions: ["testRun", "status"],
      metrics: ["testCaseCount"],
    });
  });

  it("persists filter ids only for selected dimensions and drops empty lists", () => {
    const config = buildReportBuilderStateConfig({
      dimensions,
      metrics,
      dimensionValueFilters: {
        testRun: [
          { id: 1, name: "Run 1" } as any,
          { id: 2, name: "Run 2" } as any,
        ],
        status: [],
        milestone: [{ id: 9 }],
      },
    });
    expect(config.dimensionFilters).toEqual({ testRun: [1, 2] });
  });

  it("serializes the date range as ISO strings and omits an open end", () => {
    const from = new Date("2026-09-01T00:00:00Z");
    expect(
      buildReportBuilderStateConfig({
        dimensions,
        metrics,
        dateRange: { from },
        dimensionValueFilters: {},
      })
    ).toMatchObject({ startDate: from.toISOString() });
    expect(
      buildReportBuilderStateConfig({
        dimensions,
        metrics,
        dateRange: { from, to: new Date("2026-09-30T00:00:00Z") },
        dimensionValueFilters: {},
      })
    ).toMatchObject({
      startDate: from.toISOString(),
      endDate: "2026-09-30T00:00:00.000Z",
    });
  });
});

describe("parseLegacyReportUrlParams", () => {
  it("returns null when no legacy key is present", () => {
    expect(
      parseLegacyReportUrlParams(
        new URLSearchParams("reportType=test-execution&tab=builder&state=abc")
      )
    ).toBeNull();
  });

  it("reads a spelled-out selection into the state config shape", () => {
    const params = new URLSearchParams({
      dimensions: "testRun,status",
      metrics: "testCaseCount",
      startDate: "2026-09-01T00:00:00.000Z",
      endDate: "2026-09-30T00:00:00.000Z",
      dimensionFilters: JSON.stringify({ testRun: [1, "2"], status: [] }),
    });
    expect(parseLegacyReportUrlParams(params)).toEqual({
      dimensions: ["testRun", "status"],
      metrics: ["testCaseCount"],
      startDate: "2026-09-01T00:00:00.000Z",
      endDate: "2026-09-30T00:00:00.000Z",
      dimensionFilters: { testRun: [1, "2"] },
    });
  });

  it("accepts the older { id } object form and ignores malformed filters", () => {
    expect(
      parseLegacyReportUrlParams(
        new URLSearchParams({
          dimensions: "testRun",
          dimensionFilters: JSON.stringify({
            testRun: [{ id: 5, name: "Run" }, { id: null }, ""],
          }),
        })
      )
    ).toEqual({
      dimensions: ["testRun"],
      metrics: [],
      dimensionFilters: { testRun: [5] },
    });

    expect(
      parseLegacyReportUrlParams(
        new URLSearchParams({
          dimensions: "testRun",
          dimensionFilters: "{oops",
        })
      )
    ).toEqual({ dimensions: ["testRun"], metrics: [] });
  });
});

describe("applyLegacyReportUrlParams", () => {
  it("round-trips through parseLegacyReportUrlParams", () => {
    const config = {
      dimensions: ["testRun"],
      metrics: ["testCaseCount", "passRate"],
      startDate: "2026-09-01T00:00:00.000Z",
      dimensionFilters: { testRun: [1, 2, 3] },
    };
    const params = new URLSearchParams("reportType=test-execution&endDate=x");
    applyLegacyReportUrlParams(params, config);
    expect(params.get("endDate")).toBeNull();
    expect(parseLegacyReportUrlParams(params)).toEqual(config);
  });

  it("clears stale date and filter keys when the selection has none", () => {
    const params = new URLSearchParams({
      startDate: "a",
      endDate: "b",
      dimensionFilters: "{}",
    });
    applyLegacyReportUrlParams(params, {
      dimensions: ["status"],
      metrics: ["testCaseCount"],
    });
    expect(params.get("startDate")).toBeNull();
    expect(params.get("endDate")).toBeNull();
    expect(params.get("dimensionFilters")).toBeNull();
  });
});

describe("stripReportSelectionParams / hasReportSelectionInUrl", () => {
  it("removes the state id and every legacy key, keeping navigation params", () => {
    const params = new URLSearchParams({
      reportType: "test-execution",
      tab: "builder",
      page: "1",
      [REPORT_STATE_URL_KEY]: "abc",
      dimensions: "status",
      metrics: "testCaseCount",
      startDate: "x",
      endDate: "y",
      dimensionFilters: "{}",
    });
    stripReportSelectionParams(params);
    expect([...params.keys()].sort()).toEqual(["page", "reportType", "tab"]);
  });

  it("detects a pending auto-run from either URL form", () => {
    expect(hasReportSelectionInUrl(new URLSearchParams("state=abc"))).toBe(
      true
    );
    expect(
      hasReportSelectionInUrl(
        new URLSearchParams("dimensions=status&metrics=testCaseCount")
      )
    ).toBe(true);
    expect(
      hasReportSelectionInUrl(new URLSearchParams("dimensions=status"))
    ).toBe(false);
    expect(hasReportSelectionInUrl(new URLSearchParams("tab=builder"))).toBe(
      false
    );
  });
});
