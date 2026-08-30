// The share-redirect parameter contract: entityConfig → URL params
// (serializer) and URL params → per-type builder state (parser). The
// seams under test are the generic serialization rules, the
// iteration-matrix filters expansion, and the parser's type gating —
// a param must only hydrate the state its report type owns.

import { describe, expect, it } from "vitest";
import {
  buildSharedReportSearchParams,
  parsePerTypeReportParams,
  PER_TYPE_REPORT_PARAM_DEFAULTS,
} from "./reportShareParams";

describe("buildSharedReportSearchParams", () => {
  it("serializes scalars, joins scalar arrays, and JSON-encodes objects", () => {
    const params = buildSharedReportSearchParams({
      reportType: "test-execution",
      startDate: "2026-01-01T00:00:00.000Z",
      dimensions: ["project", "user"],
      metrics: ["testResultCount"],
      dimensionFilters: { project: [1, 2] },
      page: 1,
      pageSize: 25,
    });

    expect(params.get("reportType")).toBe("test-execution");
    expect(params.get("startDate")).toBe("2026-01-01T00:00:00.000Z");
    expect(params.get("dimensions")).toBe("project,user");
    expect(params.get("metrics")).toBe("testResultCount");
    expect(JSON.parse(params.get("dimensionFilters")!)).toEqual({
      project: [1, 2],
    });
    expect(params.get("page")).toBe("1");
    expect(params.get("pageSize")).toBe("25");
  });

  it("drops projectId, null/undefined, empty strings, arrays, and objects", () => {
    const params = buildSharedReportSearchParams({
      reportType: "flaky-tests",
      projectId: 370,
      startDate: null,
      endDate: undefined,
      sortColumn: "",
      requirementIds: [],
      dimensionFilters: {},
    });

    expect([...params.keys()]).toEqual(["reportType"]);
  });

  it("carries per-type params without enumeration — booleans included", () => {
    const params = buildSharedReportSearchParams({
      reportType: "requirement-coverage-gaps",
      requirementIds: [4451, 12],
      includeNotRun: false,
      consecutiveRuns: 7,
      snapshotId: 42,
    });

    expect(params.get("requirementIds")).toBe("4451,12");
    expect(params.get("includeNotRun")).toBe("false");
    expect(params.get("consecutiveRuns")).toBe("7");
    expect(params.get("snapshotId")).toBe("42");
  });

  it("JSON-encodes arrays containing null so no member is mangled", () => {
    const params = buildSharedReportSearchParams({
      reportType: "automation-trends",
      automated: [1, null],
    });

    expect(params.get("automated")).toBe("[1,null]");
  });

  it("expands the iteration-matrix filters object into the matrix page's params", () => {
    const params = buildSharedReportSearchParams({
      reportType: "iteration-matrix",
      filters: {
        statusIds: [3, 4],
        configIds: [9],
        datasetIds: [],
        dateFrom: "2026-02-01",
        dateTo: undefined,
      },
    });

    expect(params.getAll("status")).toEqual(["3", "4"]);
    expect(params.getAll("config")).toEqual(["9"]);
    expect(params.getAll("dataset")).toEqual([]);
    expect(params.get("startDate")).toBe("2026-02-01");
    expect(params.get("endDate")).toBeNull();
    expect(params.get("filters")).toBeNull();
  });

  it("returns empty params for a malformed config", () => {
    expect(buildSharedReportSearchParams(null).toString()).toBe("");
    expect(buildSharedReportSearchParams("nope").toString()).toBe("");
    expect(buildSharedReportSearchParams([1]).toString()).toBe("");
  });
});

describe("parsePerTypeReportParams", () => {
  it("returns the control defaults when no params are present", () => {
    const state = parsePerTypeReportParams(
      new URLSearchParams(),
      "requirement-coverage-gaps"
    );
    expect(state).toEqual(PER_TYPE_REPORT_PARAM_DEFAULTS);
  });

  it("hydrates flaky-tests params, capping flipThreshold below the run count", () => {
    const state = parsePerTypeReportParams(
      new URLSearchParams(
        "consecutiveRuns=6&flipThreshold=9&automatedFilter=manual"
      ),
      "cross-project-flaky-tests"
    );
    expect(state.consecutiveRuns).toBe(6);
    expect(state.flipThreshold).toBe(5);
    expect(state.flakyAutomatedFilter).toBe("manual");
    // Health owns its own copy of the shared body key.
    expect(state.healthAutomatedFilter).toBe("all");
  });

  it("hydrates test-case-health params including its automatedFilter", () => {
    const state = parsePerTypeReportParams(
      new URLSearchParams(
        "staleDaysThreshold=60&minExecutionsForRate=3&lookbackDays=180" +
          "&automatedFilter=automated&healthStatusFilter=always_failing&staleFilter=stale"
      ),
      "test-case-health"
    );
    expect(state.staleDaysThreshold).toBe(60);
    expect(state.minExecutionsForRate).toBe(3);
    expect(state.lookbackDays).toBe(180);
    expect(state.healthAutomatedFilter).toBe("automated");
    expect(state.healthStatusFilter).toBe("always_failing");
    expect(state.healthStaleFilter).toBe("stale");
    expect(state.flakyAutomatedFilter).toBe("all");
  });

  it("ignores params a report type does not own", () => {
    const state = parsePerTypeReportParams(
      new URLSearchParams("consecutiveRuns=6&requirementIds=4451"),
      "test-case-health"
    );
    expect(state.consecutiveRuns).toBe(10);
    expect(state.requirementIds).toEqual([]);
  });

  it("hydrates the requirement scope and coverage states, discarding junk", () => {
    const state = parsePerTypeReportParams(
      new URLSearchParams(
        "requirementIds=4451,12,0,-3,4451,abc&coverageStates=UNCOVERED,BOGUS,NOT_RUN"
      ),
      "requirement-traceability"
    );
    expect(state.requirementIds).toEqual([4451, 12]);
    expect(state.requirementCoverageStates).toEqual(["UNCOVERED", "NOT_RUN"]);
  });

  it("restores the gaps report's explicit includeNotRun=false", () => {
    const off = parsePerTypeReportParams(
      new URLSearchParams("includeNotRun=false"),
      "requirement-coverage-gaps"
    );
    expect(off.includeNotRunDebt).toBe(false);
    const absent = parsePerTypeReportParams(
      new URLSearchParams(),
      "requirement-coverage-gaps"
    );
    expect(absent.includeNotRunDebt).toBe(true);
  });

  it("hydrates automation-trends filters from both list encodings", () => {
    const state = parsePerTypeReportParams(
      new URLSearchParams(
        "dateGrouping=monthly&projectIds=1,2&templateIds=7&automated=" +
          encodeURIComponent("[1,null]") +
          "&dynamicFieldFilters=" +
          encodeURIComponent('{"12":["red","blue"],"13":[]}')
      ),
      "automation-trends"
    );
    expect(state.dateGrouping).toBe("monthly");
    expect(state.trendsFilterValues.projects).toEqual([1, 2]);
    expect(state.trendsFilterValues.templates).toEqual([7]);
    expect(state.trendsFilterValues.automated).toEqual([1, null]);
    expect(state.trendsFilterValues["dynamic_12"]).toEqual(["red", "blue"]);
    expect(state.trendsFilterValues["dynamic_13"]).toBeUndefined();
  });

  it("falls back to defaults on invalid values", () => {
    const state = parsePerTypeReportParams(
      new URLSearchParams(
        "consecutiveRuns=-2&flipThreshold=zap&automatedFilter=sideways"
      ),
      "flaky-tests"
    );
    expect(state.consecutiveRuns).toBe(10);
    expect(state.flipThreshold).toBe(5);
    expect(state.flakyAutomatedFilter).toBe("all");
  });
});
