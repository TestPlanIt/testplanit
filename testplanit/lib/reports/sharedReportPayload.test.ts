import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/config/reportTypes", () => ({
  getProjectReportTypes: vi.fn(() => [
    { id: "test-execution", endpoint: "/api/report-builder/test-execution" },
    { id: "execution-log", endpoint: "/api/report-builder/execution-log" },
    {
      id: "iteration-matrix",
      endpoint: "/api/report-builder/iteration-matrix",
    },
    {
      id: "automation-candidates",
      endpoint: "/api/reports/automation-candidates",
    },
  ]),
  getCrossProjectReportTypes: vi.fn(() => [
    {
      id: "cross-project-test-execution",
      endpoint: "/api/report-builder/cross-project-test-execution",
    },
  ]),
}));

import { frozenReportMeta } from "./frozenReportMeta";
import {
  buildSharedReportPayload,
  callerAuthHeaders,
  findReportType,
} from "./sharedReportPayload";

const mockFetch = vi.fn();

function respond(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

const metadata = {
  dimensions: [{ id: "status", label: "Status" }],
  metrics: [{ id: "testResults", label: "Test Results Count" }],
};

describe("buildSharedReportPayload", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    mockFetch.mockReset();
    global.fetch = mockFetch;
    process.env = { ...originalEnv };
    delete process.env.INTERNAL_APP_URL;
    delete process.env.PORT;
    process.env.NEXTAUTH_URL = "http://app.test";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("rejects a missing config and an unknown report type", async () => {
    await expect(
      buildSharedReportPayload({ config: null, projectId: 1, authHeaders: {} })
    ).resolves.toMatchObject({ ok: false, status: 400 });
    await expect(
      buildSharedReportPayload({
        config: { reportType: "nope" },
        projectId: 1,
        authHeaders: {},
      })
    ).resolves.toMatchObject({ ok: false, status: 400 });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("builds a dynamic report with labelled dimensions and metrics", async () => {
    const rows = [{ status: { name: "Passed" }, "Test Results Count": 3 }];
    mockFetch
      .mockResolvedValueOnce(respond(metadata))
      .mockResolvedValueOnce(
        respond({ results: rows, allResults: rows, totalCount: 1 })
      );

    const result = await buildSharedReportPayload({
      config: {
        reportType: "test-execution",
        dimensions: ["status"],
        metrics: ["testResults"],
        pageSize: 10,
      },
      projectId: 7,
      authHeaders: { cookie: "session=1" },
    });

    expect(result).toEqual({
      ok: true,
      payload: {
        results: rows,
        chartData: rows,
        dimensions: [{ value: "status", label: "Status" }],
        metrics: [{ value: "testResults", label: "Test Results Count" }],
        pagination: { totalCount: 1, page: 1, pageSize: "All" },
      },
    });

    const [metadataUrl, metadataInit] = mockFetch.mock.calls[0];
    expect(metadataUrl).toBe(
      "http://app.test/api/report-builder/test-execution?projectId=7"
    );
    expect(metadataInit.headers).toEqual({ cookie: "session=1" });

    const [reportUrl, reportInit] = mockFetch.mock.calls[1];
    expect(reportUrl).toBe("http://app.test/api/report-builder/test-execution");
    expect(reportInit.headers).toMatchObject({
      "Content-Type": "application/json",
      cookie: "session=1",
    });
    // Shared reports always fetch every row, for the share's project.
    expect(JSON.parse(reportInit.body)).toMatchObject({
      projectId: 7,
      page: 1,
      pageSize: "All",
      dimensions: ["status"],
    });
    expect(JSON.parse(reportInit.body)).not.toHaveProperty("reportType");
  });

  it("falls back to the raw id when metadata has no label", async () => {
    mockFetch
      .mockResolvedValueOnce(respond({ dimensions: [], metrics: [] }))
      .mockResolvedValueOnce(respond({ results: [] }));

    const result = await buildSharedReportPayload({
      config: {
        reportType: "test-execution",
        dimensions: ["status"],
        metrics: ["testResults"],
      },
      projectId: null,
      authHeaders: {},
    });

    expect(result.ok && result.payload.dimensions).toEqual([
      { value: "status", label: "status" },
    ]);
    expect(mockFetch.mock.calls[0][0]).toBe(
      "http://app.test/api/report-builder/test-execution"
    );
  });

  it("uses the data rows and status breakdown of a pre-built report", async () => {
    const data = [{ id: 1 }, { id: 2 }];
    const statusBreakdown = [{ status: "Passed", count: 2 }];
    mockFetch
      .mockResolvedValueOnce(respond(metadata))
      .mockResolvedValueOnce(respond({ data, statusBreakdown, total: 2 }));

    const result = await buildSharedReportPayload({
      config: { reportType: "execution-log", dimensions: [], metrics: [] },
      projectId: 7,
      authHeaders: {},
    });

    expect(result).toMatchObject({
      ok: true,
      payload: {
        results: data,
        chartData: statusBreakdown,
        dimensions: [],
        metrics: [],
        pagination: { totalCount: 2 },
      },
    });
  });

  it("passes the iteration matrix and automation candidates through", async () => {
    mockFetch
      .mockResolvedValueOnce(respond({}))
      .mockResolvedValueOnce(
        respond({
          caseAxis: ["c"],
          configAxis: ["k"],
          cells: [["c:k", 1]],
          cellCount: 1,
          statusMap: { 1: "Passed" },
        })
      )
      .mockResolvedValueOnce(respond({}))
      .mockResolvedValueOnce(respond({ snapshot: { id: 9 } }));

    const matrix = await buildSharedReportPayload({
      config: { reportType: "iteration-matrix", filters: {} },
      projectId: 7,
      authHeaders: {},
    });
    expect(matrix.ok && matrix.payload.matrixAxes).toEqual({
      caseAxis: ["c"],
      configAxis: ["k"],
      cells: [["c:k", 1]],
      cellCount: 1,
      statusMap: { 1: "Passed" },
    });
    expect(matrix.ok && matrix.payload.results).toEqual([]);

    const candidates = await buildSharedReportPayload({
      config: { reportType: "automation-candidates" },
      projectId: 7,
      authHeaders: {},
    });
    expect(
      candidates.ok && candidates.payload.automationCandidatesSnapshot
    ).toEqual({ id: 9 });
  });

  it("carries specialized report fields", async () => {
    mockFetch.mockResolvedValueOnce(respond(metadata)).mockResolvedValueOnce(
      respond({
        data: [],
        projects: [{ id: 1 }],
        dateGrouping: "weekly",
        consecutiveRuns: 8,
        totalFlakyTests: 4,
      })
    );

    const result = await buildSharedReportPayload({
      config: { reportType: "execution-log" },
      projectId: 7,
      authHeaders: {},
    });

    expect(result).toMatchObject({
      ok: true,
      payload: {
        projects: [{ id: 1 }],
        dateGrouping: "weekly",
        consecutiveRuns: 8,
        totalFlakyTests: 4,
      },
    });
  });

  it("returns the report route's status and error when a fetch fails", async () => {
    mockFetch.mockResolvedValueOnce(
      respond({ error: "Forbidden" }, false, 403)
    );
    await expect(
      buildSharedReportPayload({
        config: { reportType: "test-execution", dimensions: [], metrics: [] },
        projectId: 7,
        authHeaders: {},
      })
    ).resolves.toEqual({ ok: false, status: 403, error: "Forbidden" });

    mockFetch.mockResolvedValueOnce(respond(metadata)).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("not json");
      },
    });
    await expect(
      buildSharedReportPayload({
        config: { reportType: "test-execution", dimensions: [], metrics: [] },
        projectId: 7,
        authHeaders: {},
      })
    ).resolves.toEqual({
      ok: false,
      status: 500,
      error: "Failed to build report",
    });
  });

  it("calls the server's own address rather than NEXTAUTH_URL in the image", async () => {
    process.env.PORT = "3000";
    process.env.HOSTNAME = "container-1";
    mockFetch
      .mockResolvedValueOnce(respond(metadata))
      .mockResolvedValueOnce(respond({ results: [] }));

    await buildSharedReportPayload({
      config: { reportType: "test-execution", dimensions: [], metrics: [] },
      projectId: null,
      authHeaders: {},
    });

    expect(mockFetch.mock.calls[0][0]).toBe(
      "http://container-1:3000/api/report-builder/test-execution"
    );
  });
});

describe("findReportType", () => {
  it("finds project and cross-project types", () => {
    expect(findReportType("test-execution")?.endpoint).toBe(
      "/api/report-builder/test-execution"
    );
    expect(findReportType("cross-project-test-execution")).toBeDefined();
    expect(findReportType("nope")).toBeUndefined();
  });
});

describe("callerAuthHeaders", () => {
  it("forwards only the caller's cookie and authorization", () => {
    const req = new Request("http://app.test", {
      headers: {
        cookie: "session=1",
        authorization: "Bearer tok",
        "x-other": "no",
      },
    });
    expect(callerAuthHeaders(req)).toEqual({
      cookie: "session=1",
      authorization: "Bearer tok",
    });
    expect(callerAuthHeaders(new Request("http://app.test"))).toEqual({});
  });
});

describe("frozenReportMeta", () => {
  it("serializes the capture details", () => {
    expect(
      frozenReportMeta({
        capturedAt: new Date("2026-09-24T10:00:00.000Z"),
        capturedBy: { name: "Morgan" },
        rowCount: 2,
        totalRowCount: 5,
        truncated: true,
      })
    ).toEqual({
      capturedAt: "2026-09-24T10:00:00.000Z",
      capturedByName: "Morgan",
      rowCount: 2,
      totalRowCount: 5,
      truncated: true,
    });
    expect(
      frozenReportMeta({
        capturedAt: new Date("2026-09-24T10:00:00.000Z"),
        capturedBy: null,
        rowCount: 0,
        totalRowCount: 0,
        truncated: false,
      }).capturedByName
    ).toBeNull();
  });
});
