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

const runCellCountPreflightMock = vi.fn();
vi.mock("~/lib/matrix/matrixCellCount", () => ({
  runCellCountPreflight: (...args: unknown[]) =>
    runCellCountPreflightMock(...args),
}));

vi.mock("~/lib/prisma", () => ({
  prisma: { __marker: "rawPrisma" },
}));

import { getServerSession } from "next-auth";

import { POST } from "./route";

const mockSession = { user: { id: "u1", name: "Tester" } };

const buildPost = (
  projectId: string,
  body: unknown
): [NextRequest, { params: Promise<{ projectId: string }> }] => {
  const url = `http://localhost/api/projects/${projectId}/matrix/cell-count`;
  const req = new NextRequest(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
  return [req, { params: Promise.resolve({ projectId }) }];
};

describe("POST /api/projects/[projectId]/matrix/cell-count", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("returns 400 when projectId is negative", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);
    const [req, ctx] = buildPost("-1", { filters: {} });
    const res = await POST(req, ctx);
    expect(res.status).toBe(400);
  });

  it("returns 400 when projectId is zero", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);
    const [req, ctx] = buildPost("0", { filters: {} });
    const res = await POST(req, ctx);
    expect(res.status).toBe(400);
  });

  it("returns 403 when the project read-gate denies access", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);
    projectsFindFirstMock.mockResolvedValue(null);
    const [req, ctx] = buildPost("42", { filters: {} });
    const res = await POST(req, ctx);
    expect(res.status).toBe(403);
    // Preflight MUST NOT run when the read-gate fails.
    expect(runCellCountPreflightMock).not.toHaveBeenCalled();
  });

  it("returns 422 with details when filter body is malformed", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);
    projectsFindFirstMock.mockResolvedValue({ id: 42 });
    const [req, ctx] = buildPost("42", {
      filters: { statusIds: ["not-a-number"] },
    });
    const res = await POST(req, ctx);
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("Invalid filters");
    expect(json.details).toBeDefined();
  });

  it("returns the preflight result when valid", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);
    projectsFindFirstMock.mockResolvedValue({ id: 42 });
    const result = {
      cellCount: 250,
      willRefuse: false,
      threshold: 10000,
      axisCounts: {
        caseCount: 5,
        configCount: 50,
        perCaseMaxIterations: [{ caseId: 1, maxIterations: 1 }],
      },
    };
    runCellCountPreflightMock.mockResolvedValue(result);

    const [req, ctx] = buildPost("42", { filters: {} });
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual(result);

    // Must be called with raw prisma (not enhanced db).
    const args = runCellCountPreflightMock.mock.calls[0];
    expect(args[0]).toEqual({ __marker: "rawPrisma" });
    expect(args[1]).toBe(42);
  });

  it("passes filter values through to the preflight helper", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);
    projectsFindFirstMock.mockResolvedValue({ id: 42 });
    runCellCountPreflightMock.mockResolvedValue({
      cellCount: 0,
      willRefuse: false,
      threshold: 10000,
      axisCounts: {
        caseCount: 0,
        configCount: 0,
        perCaseMaxIterations: [],
      },
    });

    const [req, ctx] = buildPost("42", {
      filters: {
        statusIds: [1, 2],
        configIds: [3],
        datasetIds: [4],
        dateFrom: "2026-04-01T00:00:00.000Z",
        dateTo: "2026-05-01T00:00:00.000Z",
      },
    });
    await POST(req, ctx);
    const args = runCellCountPreflightMock.mock.calls[0];
    expect(args[2]).toEqual({
      statusIds: [1, 2],
      configIds: [3],
      datasetIds: [4],
      dateFrom: "2026-04-01T00:00:00.000Z",
      dateTo: "2026-05-01T00:00:00.000Z",
    });
  });

  it("returns 500 when the preflight helper throws", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);
    projectsFindFirstMock.mockResolvedValue({ id: 42 });
    runCellCountPreflightMock.mockRejectedValue(new Error("DB blew up"));

    const [req, ctx] = buildPost("42", { filters: {} });
    const res = await POST(req, ctx);
    expect(res.status).toBe(500);
  });
});
