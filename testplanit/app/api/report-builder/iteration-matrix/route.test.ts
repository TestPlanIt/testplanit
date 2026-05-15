import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

const projectsFindFirstMock = vi.fn();
vi.mock("~/lib/auth/utils", () => ({
  getEnhancedDb: vi.fn(async () => ({
    projects: { findFirst: projectsFindFirstMock },
  })),
}));

const userFindUniqueMock = vi.fn();
const runMatrixAggregationMock = vi.fn();

vi.mock("~/lib/matrix/matrixAggregation", async () => {
  class MatrixCellCapExceededError extends Error {
    public readonly result: any;
    constructor(result: any) {
      super("cell cap exceeded");
      this.name = "MatrixCellCapExceededError";
      this.result = result;
    }
  }
  return {
    runMatrixAggregation: (...args: unknown[]) =>
      runMatrixAggregationMock(...args),
    MatrixCellCapExceededError,
  };
});

vi.mock("~/lib/prisma", () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => userFindUniqueMock(...args) },
  },
}));

import { getServerSession } from "next-auth";

import { MatrixCellCapExceededError } from "~/lib/matrix/matrixAggregation";

import { POST } from "./route";

const mockSession = { user: { id: "u1", name: "Tester" } };

const buildPost = (body: unknown): NextRequest => {
  const url = "http://localhost/api/report-builder/iteration-matrix";
  return new NextRequest(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
};

describe("POST /api/report-builder/iteration-matrix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userFindUniqueMock.mockResolvedValue({
      id: "u1",
      access: "USER",
      role: { rolePermissions: [{ canReadSensitive: false }] },
    });
  });

  it("returns 401 when there is no session", async () => {
    (getServerSession as any).mockResolvedValue(null);
    const res = await POST(buildPost({ projectId: 1, filters: {} }));
    expect(res.status).toBe(401);
  });

  it("returns 422 when projectId is missing from the body", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);
    const res = await POST(buildPost({ filters: {} }));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("Invalid body");
  });

  it("returns 422 when projectId is non-positive", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);
    const res = await POST(buildPost({ projectId: 0, filters: {} }));
    expect(res.status).toBe(422);
  });

  it("returns 422 when filters are malformed", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);
    const res = await POST(
      buildPost({ projectId: 42, filters: { statusIds: ["bogus"] } })
    );
    expect(res.status).toBe(422);
  });

  it("returns 403 when the project read-gate denies access (forged projectId)", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);
    projectsFindFirstMock.mockResolvedValue(null);
    const res = await POST(buildPost({ projectId: 9999, filters: {} }));
    expect(res.status).toBe(403);
    expect(runMatrixAggregationMock).not.toHaveBeenCalled();
  });

  it("returns 422 cell-cap shape when MatrixCellCapExceededError thrown", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);
    projectsFindFirstMock.mockResolvedValue({ id: 42 });
    runMatrixAggregationMock.mockImplementation(() => {
      throw new MatrixCellCapExceededError({
        cellCount: 11000,
        willRefuse: true,
        threshold: 10000,
        axisCounts: {
          caseCount: 100,
          configCount: 100,
          perCaseMaxIterations: [],
        },
      });
    });

    const res = await POST(buildPost({ projectId: 42, filters: {} }));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("cell_cap_exceeded");
    expect(json.cellCount).toBe(11000);
  });

  it("returns the same shape as the dedicated aggregate route on success", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);
    projectsFindFirstMock.mockResolvedValue({ id: 42 });
    const cellsMap = new Map<string, unknown>([
      [
        "1|2|0",
        {
          caseId: 1,
          configId: 2,
          rowIndex: 0,
          iterationCount: 0,
          pass: 0,
          fail: 0,
          notRun: 0,
          other: 0,
          worstOfStatusId: null,
          mostRecentCompletedAt: null,
          iterations: [],
        },
      ],
    ]);
    runMatrixAggregationMock.mockResolvedValue({
      caseAxis: [
        { caseId: 1, caseName: "A", hasParameters: false, paramRows: [] },
      ],
      configAxis: [{ configId: 2, configName: "Chrome" }],
      cells: cellsMap,
      cellCount: 1,
      statusMap: {},
    });

    const res = await POST(buildPost({ projectId: 42, filters: {} }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty("caseAxis");
    expect(json).toHaveProperty("configAxis");
    expect(json).toHaveProperty("cells");
    expect(json).toHaveProperty("cellCount", 1);
    expect(json).toHaveProperty("statusMap");
    expect(Array.isArray(json.cells)).toBe(true);
    expect(json.cells[0][0]).toBe("1|2|0");
  });

  it("Lock C invariant: imports runMatrixAggregation directly, no HTTP fetch indirection", async () => {
    // Smoking-gun assertion: if Lock C ever regresses (the proxy starts
    // HTTP-fetching the dedicated route), this test would break because
    // global fetch is not mocked and would 404 against localhost. By
    // asserting the mock helper IS invoked with raw prisma we guarantee
    // the proxy bypasses HTTP entirely.
    (getServerSession as any).mockResolvedValue(mockSession);
    projectsFindFirstMock.mockResolvedValue({ id: 42 });
    runMatrixAggregationMock.mockResolvedValue({
      caseAxis: [],
      configAxis: [],
      cells: new Map(),
      cellCount: 0,
      statusMap: {},
    });

    await POST(buildPost({ projectId: 42, filters: {} }));
    expect(runMatrixAggregationMock).toHaveBeenCalledTimes(1);
    const args = runMatrixAggregationMock.mock.calls[0];
    // First arg is prisma (mocked to the export-shaped object), second is
    // projectId, third is filters, fourth is viewerCanReadSensitive.
    expect(args[1]).toBe(42);
    expect(args[2]).toEqual({});
    expect(typeof args[3]).toBe("boolean");
  });
});
