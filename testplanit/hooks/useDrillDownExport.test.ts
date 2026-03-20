import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDrillDownExport } from "./useDrillDownExport";

// --- Hoisted mocks ---
const { mockUnparse } = vi.hoisted(() => ({
  mockUnparse: vi.fn(() => "col1,col2\nval1,val2"),
}));

const { mockLogDataExport } = vi.hoisted(() => ({
  mockLogDataExport: vi.fn(),
}));

const { mockToHumanReadable } = vi.hoisted(() => ({
  mockToHumanReadable: vi.fn((ms: number) => `${ms}ms`),
}));

vi.mock("papaparse", () => ({
  default: { unparse: mockUnparse },
  unparse: mockUnparse,
}));

vi.mock("~/lib/services/auditClient", () => ({
  logDataExport: mockLogDataExport,
}));

vi.mock("~/utils/duration", () => ({
  toHumanReadable: mockToHumanReadable,
}));

// Mock date-fns format to return predictable values
vi.mock("date-fns", () => ({
  format: vi.fn((_date: Date, fmt: string) => {
    if (fmt === "yyyy-MM-dd HH:mm:ss") return "2024-01-15 10:30:00";
    if (fmt === "yyyy-MM-dd") return "2024-01-15";
    if (fmt === "yyyy-MM-dd-HHmmss") return "2024-01-15-103000";
    return "2024-01-15";
  }),
}));

// --- Helpers ---

const sampleContext = {
  metricId: "testResults",
  metricLabel: "Test Results",
  metricValue: 42,
  reportType: "test-execution",
  mode: "project" as const,
  projectId: 1,
  dimensions: {},
};

const mockT = (key: string) => key.split(".").pop() ?? key;

const buildFetchMock = (data: any[], hasMore = false) => {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data, hasMore }),
  });
};

describe("useDrillDownExport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock document methods used during CSV download
    global.URL.createObjectURL = vi.fn(() => "blob:test-url");
    global.URL.revokeObjectURL = vi.fn();
    vi.spyOn(document.body, "appendChild").mockImplementation((el) => el);
    vi.spyOn(document.body, "removeChild").mockImplementation((el) => el);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should initialize with isExporting=false", () => {
    const { result } = renderHook(() =>
      useDrillDownExport({ context: sampleContext, t: mockT })
    );

    expect(result.current.isExporting).toBe(false);
  });

  it("should expose exportToCSV function", () => {
    const { result } = renderHook(() =>
      useDrillDownExport({ context: sampleContext, t: mockT })
    );

    expect(typeof result.current.exportToCSV).toBe("function");
  });

  it("should not export when context is null", async () => {
    global.fetch = vi.fn();

    const { result } = renderHook(() =>
      useDrillDownExport({ context: null, t: mockT })
    );

    await act(async () => {
      await result.current.exportToCSV();
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockUnparse).not.toHaveBeenCalled();
    expect(result.current.isExporting).toBe(false);
  });

  it("should set isExporting=true during export and reset after", async () => {
    global.fetch = buildFetchMock([{ id: 1, status: { name: "Passed" } }]);

    const { result } = renderHook(() =>
      useDrillDownExport({ context: sampleContext, t: mockT })
    );

    expect(result.current.isExporting).toBe(false);

    await act(async () => {
      await result.current.exportToCSV();
    });

    expect(result.current.isExporting).toBe(false);
  });

  it("should call fetch to get records for export", async () => {
    global.fetch = buildFetchMock([{ id: 1 }]);

    const { result } = renderHook(() =>
      useDrillDownExport({ context: sampleContext, t: mockT })
    );

    await act(async () => {
      await result.current.exportToCSV();
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/report-builder/drill-down",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("should call Papa.unparse to generate CSV", async () => {
    global.fetch = buildFetchMock([{ id: 1 }]);

    const { result } = renderHook(() =>
      useDrillDownExport({ context: sampleContext, t: mockT })
    );

    await act(async () => {
      await result.current.exportToCSV();
    });

    expect(mockUnparse).toHaveBeenCalledTimes(1);
    expect(mockUnparse).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ delimiter: ",", header: true })
    );
  });

  it("should trigger file download via anchor element", async () => {
    global.fetch = buildFetchMock([{ id: 1 }]);

    const linkEl = document.createElement("a");
    const clickSpy = vi.spyOn(linkEl, "click").mockImplementation(() => {});
    vi.spyOn(document, "createElement").mockReturnValue(linkEl as any);

    const { result } = renderHook(() =>
      useDrillDownExport({ context: sampleContext, t: mockT })
    );

    await act(async () => {
      await result.current.exportToCSV();
    });

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(global.URL.createObjectURL).toHaveBeenCalled();
    expect(global.URL.revokeObjectURL).toHaveBeenCalled();
  });

  it("should log audit export after successful export", async () => {
    global.fetch = buildFetchMock([{ id: 1 }]);

    const { result } = renderHook(() =>
      useDrillDownExport({ context: sampleContext, t: mockT })
    );

    await act(async () => {
      await result.current.exportToCSV();
    });

    expect(mockLogDataExport).toHaveBeenCalledWith(
      expect.objectContaining({
        exportType: "DrillDown-CSV",
        entityType: sampleContext.metricId,
        projectId: sampleContext.projectId,
      })
    );
  });

  it("should paginate fetch calls when hasMore=true", async () => {
    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      const hasMore = callCount === 1; // First call returns more, second doesn't
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: [{ id: callCount }], hasMore }),
      });
    });

    const { result } = renderHook(() =>
      useDrillDownExport({ context: sampleContext, t: mockT })
    );

    await act(async () => {
      await result.current.exportToCSV();
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("should transform testResults records to expected CSV columns", async () => {
    const record = {
      testRunCase: { repositoryCase: { name: "Login Test" } },
      testRun: { name: "Sprint 1 Run", configuration: { name: "Chrome" } },
      status: { name: "Passed" },
      executedBy: { name: "Alice" },
      executedAt: "2024-01-15T10:30:00Z",
      elapsed: 5000,
      notes: null,
    };

    global.fetch = buildFetchMock([record]);

    const { result } = renderHook(() =>
      useDrillDownExport({ context: sampleContext, t: mockT })
    );

    await act(async () => {
      await result.current.exportToCSV();
    });

    const csvData = (mockUnparse.mock.calls[0] as any[])[0] as Record<string, any>[];
    expect(csvData).toHaveLength(1);
    // The keys use translation function output
    expect(Object.keys(csvData[0])).toContain("testCases");
    expect(Object.keys(csvData[0])).toContain("testRuns");
    expect(Object.keys(csvData[0])).toContain("status");
  });

  it("should transform testRuns records with progress metrics", async () => {
    const record = {
      name: "Sprint Run",
      state: { name: "Active" },
      createdBy: { name: "Bob" },
      startedAt: "2024-01-15T10:00:00Z",
      passed: 10,
      failed: 2,
      blocked: 1,
      untested: 5,
      milestone: null,
    };

    global.fetch = buildFetchMock([record]);

    const contextTestRuns = { ...sampleContext, metricId: "testRuns" };
    const { result } = renderHook(() =>
      useDrillDownExport({ context: contextTestRuns, t: mockT })
    );

    await act(async () => {
      await result.current.exportToCSV();
    });

    const csvData = (mockUnparse.mock.calls[0] as any[])[0] as Record<string, any>[];
    expect(csvData).toHaveLength(1);
    expect(csvData[0]["Progress"]).toBe("13/18");
    expect(csvData[0]["Passed"]).toBe(10);
    expect(csvData[0]["Failed"]).toBe(2);
  });

  it("should handle empty data and produce empty CSV rows", async () => {
    global.fetch = buildFetchMock([]);

    const { result } = renderHook(() =>
      useDrillDownExport({ context: sampleContext, t: mockT })
    );

    await act(async () => {
      await result.current.exportToCSV();
    });

    const csvData = (mockUnparse.mock.calls[0] as any[])[0] as any[];
    expect(csvData).toHaveLength(0);
  });

  it("should rethrow fetch errors and reset isExporting", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({}),
    });

    const { result } = renderHook(() =>
      useDrillDownExport({ context: sampleContext, t: mockT })
    );

    await expect(
      act(async () => {
        await result.current.exportToCSV();
      })
    ).rejects.toThrow();

    expect(result.current.isExporting).toBe(false);
  });

  it("should include dimension values in generated filename", async () => {
    const contextWithDimensions = {
      ...sampleContext,
      dimensions: {
        user: { id: 1, name: "Alice Smith" },
        status: { id: 2, name: "Passed" },
      },
    };

    global.fetch = buildFetchMock([{ id: 1 }]);

    const linkEl = document.createElement("a");
    vi.spyOn(document, "createElement").mockReturnValue(linkEl as any);
    vi.spyOn(linkEl, "click").mockImplementation(() => {});

    const { result } = renderHook(() =>
      useDrillDownExport({ context: contextWithDimensions, t: mockT })
    );

    await act(async () => {
      await result.current.exportToCSV();
    });

    // The download attribute should include dimension info
    expect(linkEl.download).toContain("drill-down");
    expect(linkEl.download).toContain("alice-smith");
    expect(linkEl.download).toContain("passed");
    expect(linkEl.download).toContain(".csv");
  });
});
