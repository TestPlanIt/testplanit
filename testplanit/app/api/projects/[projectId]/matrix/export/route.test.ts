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

vi.mock("~/lib/db", () => ({
  baseDb: {
    user: { findUnique: (...args: unknown[]) => userFindUniqueMock(...args) },
  },
}));

import { getServerSession } from "next-auth";

import { MatrixCellCapExceededError } from "~/lib/matrix/matrixAggregation";

import { GET } from "./route";

const mockSession = { user: { id: "u1", name: "Tester" } };

const buildGet = (
  projectId: string,
  qs = ""
): [NextRequest, { params: Promise<{ projectId: string }> }] => {
  const url = `http://localhost/api/projects/${projectId}/matrix/export${qs}`;
  const req = new NextRequest(url, { method: "GET" });
  return [req, { params: Promise.resolve({ projectId }) }];
};

/**
 * Build an `AxesShape`-shaped fixture suitable for asserting CSV emit.
 * One parameterized case (with a `password` parameter) × one config × one
 * paramRow with a value that begins with `=` so the formula-injection guard
 * shows up in the output.
 */
function buildHappyAxes() {
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
        mostRecentCompletedAt: "2026-05-01T08:30:00.000Z",
        iterations: [
          {
            id: 100,
            label: "iter-0",
            statusId: 7,
            runId: 999,
            runName: "May Run",
          },
        ],
      },
    ],
  ]);
  return {
    caseAxis: [
      {
        caseId: 1,
        caseName: "Login",
        hasParameters: true,
        paramRows: [
          {
            index: 0,
            label: "creds",
            values: { username: "alice", password: "=cmd|notepad" },
          },
        ],
        parameters: [
          { name: "username", type: "STRING", sensitive: false },
          { name: "password", type: "STRING", sensitive: false },
        ],
      },
    ],
    configAxis: [{ configId: 2, configName: "Chrome" }],
    cells: cellsMap,
    cellCount: 1,
    statusMap: {
      7: {
        id: 7,
        name: "Passed",
        isSuccess: true,
        isFailure: false,
        isCompleted: true,
        order: 1,
        colorValue: "#00ff00",
      },
    },
  };
}

describe("GET /api/projects/[projectId]/matrix/export", () => {
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
    const [req, ctx] = buildGet("1");
    const res = await GET(req, ctx);
    expect(res.status).toBe(401);
  });

  it("returns 400 when projectId is non-numeric", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);
    const [req, ctx] = buildGet("not-a-number");
    const res = await GET(req, ctx);
    expect(res.status).toBe(400);
  });

  it("returns 403 when the project read-gate denies access", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);
    projectsFindFirstMock.mockResolvedValue(null);
    const [req, ctx] = buildGet("42");
    const res = await GET(req, ctx);
    expect(res.status).toBe(403);
    expect(runMatrixAggregationMock).not.toHaveBeenCalled();
  });

  it("returns 422 when filters are malformed (e.g. invalid date)", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);
    projectsFindFirstMock.mockResolvedValue({ id: 42 });
    const [req, ctx] = buildGet("42", "?from=not-a-date");
    const res = await GET(req, ctx);
    expect(res.status).toBe(422);
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
          perCaseMaxIterations: [],
        },
      });
    });

    const [req, ctx] = buildGet("42");
    const res = await GET(req, ctx);
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("cell_cap_exceeded");
  });

  it("returns text/csv with attachment Content-Disposition on success", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);
    projectsFindFirstMock.mockResolvedValue({ id: 42 });
    runMatrixAggregationMock.mockResolvedValue(buildHappyAxes());

    const [req, ctx] = buildGet("42");
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    const cd = res.headers.get("content-disposition") ?? "";
    expect(cd.startsWith("attachment;")).toBe(true);
    expect(cd).toMatch(/filename="matrix-42-\d{4}-\d{2}-\d{2}\.csv"/);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("CSV body starts with a UTF-8 BOM", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);
    projectsFindFirstMock.mockResolvedValue({ id: 42 });
    runMatrixAggregationMock.mockResolvedValue(buildHappyAxes());

    const [req, ctx] = buildGet("42");
    const res = await GET(req, ctx);
    // Read raw bytes — `text()` may strip the BOM as a Unicode encoding marker.
    const buf = new Uint8Array(await res.arrayBuffer());
    // UTF-8 BOM is the 3-byte sequence EF BB BF.
    expect(buf[0]).toBe(0xef);
    expect(buf[1]).toBe(0xbb);
    expect(buf[2]).toBe(0xbf);
  });

  it("Lock B regression guard: header row uses bare parameter names (no `param.` prefix)", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);
    projectsFindFirstMock.mockResolvedValue({ id: 42 });
    runMatrixAggregationMock.mockResolvedValue(buildHappyAxes());

    const [req, ctx] = buildGet("42");
    const res = await GET(req, ctx);
    const body = await res.text();
    const firstLine = body.replace(/^﻿/, "").split("\n")[0];

    // Bare parameter names appear in the header.
    expect(firstLine).toContain("username");
    expect(firstLine).toContain("password");
    // The legacy `param.<name>` prefix MUST NOT appear (Lock B).
    expect(firstLine).not.toContain("param.username");
    expect(firstLine).not.toContain("param.password");
    // Static columns are present too.
    expect(firstLine).toContain("Case");
    expect(firstLine).toContain("Configuration");
    expect(firstLine).toContain("Parameter row label");
    expect(firstLine).toContain("Status");
    expect(firstLine).toContain("Recorded at");
    expect(firstLine).toContain("Run name");
    expect(firstLine).toContain("Run id");
  });

  it("T-05-04 regression guard: escapeFormulae prefixes `=cmd|notepad` with `'`", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);
    projectsFindFirstMock.mockResolvedValue({ id: 42 });
    runMatrixAggregationMock.mockResolvedValue(buildHappyAxes());

    const [req, ctx] = buildGet("42");
    const res = await GET(req, ctx);
    const body = await res.text();
    // The dangerous `=cmd|notepad` value should be quoted with a leading `'`
    // by Papa.unparse's escapeFormulae option.
    expect(body).toContain("'=cmd|notepad");
    // Sanity check: the raw formula-string MUST NOT appear unescaped at the
    // start of any cell.
    const lines = body.split("\n");
    for (const line of lines) {
      // No cell may start with an unescaped `=cmd...` after a comma boundary.
      expect(line.match(/(^|,)=cmd\|notepad/)).toBeNull();
    }
  });

  it("derives viewerCanReadSensitive=true for an ADMIN", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);
    projectsFindFirstMock.mockResolvedValue({ id: 42 });
    userFindUniqueMock.mockResolvedValue({
      id: "u1",
      access: "ADMIN",
      role: null,
    });
    runMatrixAggregationMock.mockResolvedValue(buildHappyAxes());

    const [req, ctx] = buildGet("42");
    await GET(req, ctx);
    const args = runMatrixAggregationMock.mock.calls[0];
    expect(args[3]).toBe(true);
  });

  it("parses repeated query params into the right filter shape", async () => {
    (getServerSession as any).mockResolvedValue(mockSession);
    projectsFindFirstMock.mockResolvedValue({ id: 42 });
    runMatrixAggregationMock.mockResolvedValue({
      caseAxis: [],
      configAxis: [],
      cells: new Map(),
      cellCount: 0,
      statusMap: {},
    });

    const qs =
      "?status=1&status=2&config=3&dataset=4&from=2026-04-01T00:00:00.000Z&to=2026-05-01T00:00:00.000Z";
    const [req, ctx] = buildGet("42", qs);
    await GET(req, ctx);
    const args = runMatrixAggregationMock.mock.calls[0];
    expect(args[2]).toEqual({
      statusIds: [1, 2],
      configIds: [3],
      datasetIds: [4],
      dateFrom: "2026-04-01T00:00:00.000Z",
      dateTo: "2026-05-01T00:00:00.000Z",
    });
  });
});
