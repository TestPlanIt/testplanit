import { describe, expect, it, vi } from "vitest";
import {
  mintReportBuilderStateId,
  reportBuilderStateConfigFromReportConfig,
  resolveReportBuilderStateId,
} from "./reportBuilderStateLink";

const customConfig = {
  reportType: "test-execution",
  dimensions: ["testRun", "status"],
  metrics: ["testCaseCount"],
  startDate: "2026-09-01T00:00:00.000Z",
  dimensionFilters: { testRun: [1, 2, 3], status: [] },
  includeTotals: true,
  projectId: 7,
};

function okFetch(id = "state-1") {
  return vi.fn(async () => ({ ok: true, json: async () => ({ id }) })) as any;
}

describe("reportBuilderStateConfigFromReportConfig", () => {
  it("picks the builder selection out of a stored request body", () => {
    expect(reportBuilderStateConfigFromReportConfig(customConfig)).toEqual({
      dimensions: ["testRun", "status"],
      metrics: ["testCaseCount"],
      startDate: "2026-09-01T00:00:00.000Z",
      dimensionFilters: { testRun: [1, 2, 3] },
    });
  });

  it("returns null for pre-built configs and non-objects", () => {
    expect(
      reportBuilderStateConfigFromReportConfig({
        reportType: "flaky-tests",
        consecutiveRuns: 8,
      })
    ).toBeNull();
    expect(
      reportBuilderStateConfigFromReportConfig({
        reportType: "flaky-tests",
        dimensions: [],
      })
    ).toBeNull();
    expect(reportBuilderStateConfigFromReportConfig(null)).toBeNull();
    expect(reportBuilderStateConfigFromReportConfig("x")).toBeNull();
  });
});

describe("mintReportBuilderStateId", () => {
  it("POSTs the selection and returns the row id", async () => {
    const fetchImpl = okFetch("abc");
    const id = await mintReportBuilderStateId(
      {
        projectId: 7,
        reportType: "test-execution",
        config: { dimensions: ["status"], metrics: ["testCaseCount"] },
      },
      fetchImpl
    );
    expect(id).toBe("abc");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/reports/state");
    expect(JSON.parse(init.body)).toEqual({
      projectId: 7,
      reportType: "test-execution",
      config: { dimensions: ["status"], metrics: ["testCaseCount"] },
    });
  });

  it("returns null on a failed response or a network error", async () => {
    const failing = vi.fn(async () => ({ ok: false })) as any;
    expect(
      await mintReportBuilderStateId(
        { reportType: "x", config: { dimensions: ["a"], metrics: [] } },
        failing
      )
    ).toBeNull();
    const throwing = vi.fn(async () => {
      throw new Error("offline");
    }) as any;
    expect(
      await mintReportBuilderStateId(
        { reportType: "x", config: { dimensions: ["a"], metrics: [] } },
        throwing
      )
    ).toBeNull();
  });
});

describe("resolveReportBuilderStateId", () => {
  it("skips configs with no selection or no report type without calling the API", async () => {
    const fetchImpl = okFetch();
    expect(
      await resolveReportBuilderStateId(
        { reportType: "flaky-tests" },
        7,
        fetchImpl
      )
    ).toBeNull();
    expect(
      await resolveReportBuilderStateId(
        { dimensions: ["status"] },
        7,
        fetchImpl
      )
    ).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("mints for a custom-report config", async () => {
    const fetchImpl = okFetch("s9");
    expect(await resolveReportBuilderStateId(customConfig, 7, fetchImpl)).toBe(
      "s9"
    );
  });
});
