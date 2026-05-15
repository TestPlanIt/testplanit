import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

const projectsFindFirstMock = vi.fn();
const userFindUniqueMock = vi.fn();

vi.mock("~/lib/auth/utils", () => ({
  getEnhancedDb: vi.fn(async () => ({
    projects: { findFirst: projectsFindFirstMock },
    user: { findUnique: userFindUniqueMock },
  })),
}));

const runMatrixAggregationMock = vi.fn();

vi.mock("~/lib/matrix/matrixAggregation", async () => {
  // Real MatrixCellCapExceededError class so the route's `instanceof` check
  // matches what the test throws below.
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
  prisma: { __marker: "rawPrisma" },
}));

import { getServerSession } from "next-auth";

import { MatrixCellCapExceededError } from "~/lib/matrix/matrixAggregation";

import { POST } from "./route";

const mockSession = { user: { id: "u1", name: "Tester" } };

const buildPost = (
  projectId: string,
  body: unknown
): [NextRequest, { params: Promise<{ projectId: string }> }] => {
  const url = `http://localhost/api/projects/${projectId}/matrix/aggregate`;
  const req = new NextRequest(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
  return [req, { params: Promise.resolve({ projectId }) }];
};

describe("POST /api/projects/[projectId]/matrix/aggregate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: user has no special role permissions (sensitive read denied).
    userFindUniqueMock.mockResolvedValue({
      id: "u1",
      access: "USER",
      role: { rolePermissions: [{ canReadSensitive: false }] },
    });
  });

  it("returns 401 when there is no session", async () => {
    (getServerSession as any).mockResolvedValue(null);
    const [req, ctx] = buildPost("1", { filters: {} });
    const res = await POST(req, ctx);
    expect(res.status).toBe(401);
  });

  it("returns 400 when projectId is non-numeric", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);
    const [req, ctx] = buildPost("not-a-number", { filters: {} });
    const res = await POST(req, ctx);
    expect(res.status).toBe(400);
  });

  it("returns 403 when the project read-gate denies access", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);
    projectsFindFirstMock.mockResolvedValue(null);
    const [req, ctx] = buildPost("42", { filters: {} });
    const res = await POST(req, ctx);
    expect(res.status).toBe(403);
    expect(runMatrixAggregationMock).not.toHaveBeenCalled();
  });

  it("returns 422 with details when filter body is malformed", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);
    projectsFindFirstMock.mockResolvedValue({ id: 42 });
    const [req, ctx] = buildPost("42", {
      filters: { statusIds: ["bogus"] },
    });
    const res = await POST(req, ctx);
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("Invalid filters");
    expect(json.details).toBeDefined();
  });

  it("returns 422 cell-cap shape when MatrixCellCapExceededError thrown", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);
    projectsFindFirstMock.mockResolvedValue({ id: 42 });
    runMatrixAggregationMock.mockImplementation(() => {
      throw new MatrixCellCapExceededError({
        cellCount: 12345,
        willRefuse: true,
        threshold: 50000,
        axisCounts: {
          caseCount: 100,
          configCount: 100,
          perCaseMaxIterations: [{ caseId: 1, maxIterations: 1 }],
        },
      });
    });

    const [req, ctx] = buildPost("42", { filters: {} });
    const res = await POST(req, ctx);
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("cell_cap_exceeded");
    expect(json.cellCount).toBe(12345);
    expect(json.threshold).toBe(50000);
    expect(json.axisCounts).toEqual({
      caseCount: 100,
      configCount: 100,
      perCaseMaxIterations: [{ caseId: 1, maxIterations: 1 }],
    });
  });

  it("returns 200 with cells serialized as Array.from(map.entries()) on success", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);
    projectsFindFirstMock.mockResolvedValue({ id: 42 });
    const cellsMap = new Map<string, unknown>([
      [
        "1|2|0",
        {
          caseId: 1,
          configId: 2,
          rowIndex: 0,
          iterationCount: 1,
          pass: 1,
          fail: 0,
          notRun: 0,
          other: 0,
          worstOfStatusId: 7,
          mostRecentCompletedAt: "2026-05-01T00:00:00.000Z",
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

    const [req, ctx] = buildPost("42", { filters: {} });
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.cells)).toBe(true);
    expect(json.cells).toHaveLength(1);
    expect(json.cells[0][0]).toBe("1|2|0");
    expect(json.cells[0][1].caseId).toBe(1);
    expect(json.cellCount).toBe(1);
  });

  it("derives viewerCanReadSensitive=false for a USER without canReadSensitive permission", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);
    projectsFindFirstMock.mockResolvedValue({ id: 42 });
    userFindUniqueMock.mockResolvedValue({
      id: "u1",
      access: "USER",
      role: { rolePermissions: [{ canReadSensitive: false }] },
    });
    runMatrixAggregationMock.mockResolvedValue({
      caseAxis: [],
      configAxis: [],
      cells: new Map(),
      cellCount: 0,
      statusMap: {},
    });

    const [req, ctx] = buildPost("42", { filters: {} });
    await POST(req, ctx);
    const args = runMatrixAggregationMock.mock.calls[0];
    expect(args[3]).toBe(false);
  });

  it("derives viewerCanReadSensitive=true for an ADMIN even without role permission row", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);
    projectsFindFirstMock.mockResolvedValue({ id: 42 });
    userFindUniqueMock.mockResolvedValue({
      id: "u1",
      access: "ADMIN",
      role: null,
    });
    runMatrixAggregationMock.mockResolvedValue({
      caseAxis: [],
      configAxis: [],
      cells: new Map(),
      cellCount: 0,
      statusMap: {},
    });

    const [req, ctx] = buildPost("42", { filters: {} });
    await POST(req, ctx);
    const args = runMatrixAggregationMock.mock.calls[0];
    expect(args[3]).toBe(true);
  });

  it("derives viewerCanReadSensitive=true for a USER whose role has canReadSensitive=true", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);
    projectsFindFirstMock.mockResolvedValue({ id: 42 });
    userFindUniqueMock.mockResolvedValue({
      id: "u1",
      access: "USER",
      role: {
        rolePermissions: [
          { canReadSensitive: false },
          { canReadSensitive: true },
        ],
      },
    });
    runMatrixAggregationMock.mockResolvedValue({
      caseAxis: [],
      configAxis: [],
      cells: new Map(),
      cellCount: 0,
      statusMap: {},
    });

    const [req, ctx] = buildPost("42", { filters: {} });
    await POST(req, ctx);
    const args = runMatrixAggregationMock.mock.calls[0];
    expect(args[3]).toBe(true);
  });

  it("uses raw prisma (not enhanced db) for the aggregation call", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);
    projectsFindFirstMock.mockResolvedValue({ id: 42 });
    runMatrixAggregationMock.mockResolvedValue({
      caseAxis: [],
      configAxis: [],
      cells: new Map(),
      cellCount: 0,
      statusMap: {},
    });

    const [req, ctx] = buildPost("42", { filters: {} });
    await POST(req, ctx);
    const args = runMatrixAggregationMock.mock.calls[0];
    expect(args[0]).toEqual({ __marker: "rawPrisma" });
    expect(args[1]).toBe(42);
  });

  it("returns 500 on unexpected aggregation failure", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);
    projectsFindFirstMock.mockResolvedValue({ id: 42 });
    runMatrixAggregationMock.mockRejectedValue(new Error("boom"));

    const [req, ctx] = buildPost("42", { filters: {} });
    const res = await POST(req, ctx);
    expect(res.status).toBe(500);
  });
});
