import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RequirementTraceabilityData } from "~/app/api/projects/[projectId]/requirements/traceability/route";
import { PdfRenderer } from "./pdfHelpers";

// --- Hoisted mocks ---
const { mockLogDataExport } = vi.hoisted(() => ({
  mockLogDataExport: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/services/auditClient", () => ({
  logDataExport: mockLogDataExport,
}));

import { useExportRequirementTraceabilityPdf } from "./useExportRequirementTraceabilityPdf";

function buildData(
  overrides?: Partial<RequirementTraceabilityData>
): RequirementTraceabilityData {
  return {
    projectId: 42,
    projectName: "Demo Project",
    generatedAt: "2026-08-20T12:00:00.000Z",
    rows: [
      // Coverage gap: a requirement with zero covering cases. `caseId`
      // is null, distinct from the "not run" row below.
      {
        requirementId: 1,
        requirementKey: "REQ-1",
        requirementTitle: "Enrol domestic students",
        requirementPath: "Enrolments > Enrol domestic students",
        caseId: null,
        caseName: null,
        caseProjectId: null,
        caseProjectName: null,
        statusName: null,
        statusColor: null,
        executedAt: null,
        linkedCaseCount: 0,
        coverageStatus: "UNCOVERED",
      },
      // A covering case with a real, colored latest result.
      {
        requirementId: 2,
        requirementKey: "REQ-2",
        requirementTitle: "Enrol international students",
        requirementPath: "Enrolments > Enrol international students",
        caseId: 10,
        caseName: "Login works",
        caseProjectId: 5,
        caseProjectName: "QA Project",
        statusName: "Passed",
        statusColor: "#22c55e",
        executedAt: "2026-08-18T09:00:00.000Z",
        linkedCaseCount: 1,
        coverageStatus: "PASSED",
      },
      // A covering case with no in-scope execution — "Not run". Has a
      // non-null caseId, unlike the coverage gap above.
      {
        requirementId: 3,
        requirementKey: "REQ-3",
        requirementTitle: "Enrol transfer students",
        requirementPath: "Enrolments > Enrol transfer students",
        caseId: 11,
        caseName: "Case with no run",
        caseProjectId: 5,
        caseProjectName: "QA Project",
        statusName: null,
        statusColor: null,
        executedAt: null,
        linkedCaseCount: 1,
        coverageStatus:
          "NOT_RUN" as RequirementTraceabilityData["rows"][number]["coverageStatus"],
      },
    ],
    ...overrides,
  };
}

function buildFetchMock(data: RequirementTraceabilityData, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: async () => data,
  });
}

describe("useExportRequirementTraceabilityPdf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLogDataExport.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches the traceability route once and renders through PdfRenderer", async () => {
    const data = buildData();
    global.fetch = buildFetchMock(data);
    // jsPDF's save() writes a real file when run under Node/jsdom rather
    // than triggering a browser download, so it is stubbed here to keep
    // the test hermetic — this does not hide the seam under test, which
    // is the renderer call sequence asserted below.
    const saveSpy = vi
      .spyOn(PdfRenderer.prototype, "save")
      .mockImplementation(() => {});
    const tableSpy = vi.spyOn(PdfRenderer.prototype, "renderTable");

    const { result } = renderHook(() =>
      useExportRequirementTraceabilityPdf({ projectId: 42 })
    );

    await act(async () => {
      await result.current.handleExport();
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/projects/42/requirements/traceability"
    );
    expect(tableSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });

  it("renders the three-way result cell: uncovered, a real status, and not run", async () => {
    const data = buildData();
    global.fetch = buildFetchMock(data);
    vi.spyOn(PdfRenderer.prototype, "save").mockImplementation(() => {});
    const tableSpy = vi.spyOn(PdfRenderer.prototype, "renderTable");

    const { result } = renderHook(() =>
      useExportRequirementTraceabilityPdf({ projectId: 42 })
    );

    await act(async () => {
      await result.current.handleExport();
    });

    expect(tableSpy).toHaveBeenCalledTimes(1);
    const rows = tableSpy.mock.calls[0][0].rows;
    expect(rows).toHaveLength(3);

    // Row 1: the coverage gap (null caseId) — "Uncovered", amber.
    expect(rows[0][2]).toEqual([{ text: "Uncovered", color: [217, 119, 6] }]);
    // Row 2: a covering case with a real status — that status's own color.
    expect(rows[1][2]).toEqual([{ text: "Passed", color: [34, 197, 94] }]);
    // Row 3: a covering case with no in-scope execution — "Not run", a
    // DIFFERENT token from the coverage gap above even though both read
    // as "nothing happened" at a glance.
    expect(rows[2][2]).toEqual([{ text: "Not run", color: [156, 163, 175] }]);
  });

  it("calls setReportMeta before any body content", async () => {
    const data = buildData();
    global.fetch = buildFetchMock(data);
    vi.spyOn(PdfRenderer.prototype, "save").mockImplementation(() => {});
    const metaSpy = vi.spyOn(PdfRenderer.prototype, "setReportMeta");
    const titleSpy = vi.spyOn(PdfRenderer.prototype, "renderTitle");

    const { result } = renderHook(() =>
      useExportRequirementTraceabilityPdf({ projectId: 42 })
    );

    await act(async () => {
      await result.current.handleExport();
    });

    expect(metaSpy).toHaveBeenCalledTimes(1);
    expect(titleSpy).toHaveBeenCalledTimes(1);
    expect(metaSpy.mock.invocationCallOrder[0]).toBeLessThan(
      titleSpy.mock.invocationCallOrder[0]
    );
  });

  it("logs a data-export audit entry without awaiting it", async () => {
    const data = buildData();
    global.fetch = buildFetchMock(data);
    vi.spyOn(PdfRenderer.prototype, "save").mockImplementation(() => {});

    let resolveAudit: () => void = () => {};
    mockLogDataExport.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveAudit = resolve;
        })
    );

    const { result } = renderHook(() =>
      useExportRequirementTraceabilityPdf({ projectId: 42 })
    );

    // handleExport's own promise resolves here even though the audit
    // call's promise is deliberately left pending — proof the audit call
    // is void-ed rather than awaited.
    await act(async () => {
      await result.current.handleExport();
    });

    expect(mockLogDataExport).toHaveBeenCalledWith(
      expect.objectContaining({
        exportType: "PDF",
        entityType: "requirement",
        recordCount: data.rows.length,
        projectId: 42,
      })
    );

    resolveAudit();
  });

  it("clears the exporting flag when the fetch rejects", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network down"));

    const { result } = renderHook(() =>
      useExportRequirementTraceabilityPdf({ projectId: 42 })
    );

    expect(result.current.isExporting).toBe(false);

    await expect(
      act(async () => {
        await result.current.handleExport();
      })
    ).resolves.toBeUndefined();

    expect(result.current.isExporting).toBe(false);
  });
});
