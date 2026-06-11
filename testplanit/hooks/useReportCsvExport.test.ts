import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useReportCsvExport } from "./useReportCsvExport";

const { mockUnparse } = vi.hoisted(() => ({
  mockUnparse: vi.fn((_rows: unknown) => "header\nvalue"),
}));
const { mockLogDataExport } = vi.hoisted(() => ({
  mockLogDataExport: vi.fn(),
}));

vi.mock("papaparse", () => ({
  default: { unparse: mockUnparse },
  unparse: mockUnparse,
}));
vi.mock("~/lib/services/auditClient", () => ({
  logDataExport: mockLogDataExport,
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
}));

describe("useReportCsvExport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.URL.createObjectURL = vi.fn(() => "blob:test-url");
    global.URL.revokeObjectURL = vi.fn();
    vi.spyOn(document.body, "appendChild").mockImplementation((el) => el);
    vi.spyOn(document.body, "removeChild").mockImplementation((el) => el);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("awaits getRows, serializes, downloads, and logs the export", async () => {
    const linkEl = document.createElement("a");
    const clickSpy = vi.spyOn(linkEl, "click").mockImplementation(() => {});
    vi.spyOn(document, "createElement").mockReturnValue(linkEl as any);

    const getRows = vi.fn(async () => [
      { testCaseName: "A", flipCount: 1, executions: [] },
      { testCaseName: "B", flipCount: 2, executions: [] },
    ]);

    const { result } = renderHook(() => useReportCsvExport());

    await act(async () => {
      await result.current.exportCsv({
        reportType: "flaky-tests",
        isCrossProject: false,
        getRows,
        consecutiveRuns: 5,
        projectId: 1,
      });
    });

    expect(getRows).toHaveBeenCalledTimes(1);
    expect(mockUnparse).toHaveBeenCalledTimes(1);
    // Two rows handed to the serializer.
    expect(mockUnparse.mock.calls[0][0]).toHaveLength(2);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(global.URL.createObjectURL).toHaveBeenCalled();
    expect(global.URL.revokeObjectURL).toHaveBeenCalled();
    expect(mockLogDataExport).toHaveBeenCalledWith(
      expect.objectContaining({
        exportType: "Report-CSV",
        entityType: "flaky-tests",
        recordCount: 2,
        projectId: 1,
      })
    );
    expect(result.current.isExporting).toBe(false);
  });

  it("resets isExporting even if getRows throws", async () => {
    const getRows = vi.fn(async () => {
      throw new Error("fetch failed");
    });
    const { result } = renderHook(() => useReportCsvExport());

    await act(async () => {
      await expect(
        result.current.exportCsv({
          reportType: "execution-log",
          isCrossProject: false,
          getRows,
        })
      ).rejects.toThrow("fetch failed");
    });

    expect(mockUnparse).not.toHaveBeenCalled();
    expect(result.current.isExporting).toBe(false);
  });
});
