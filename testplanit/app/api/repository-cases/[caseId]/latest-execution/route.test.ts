// Converted from the it.todo scaffold (27-01) by 27-06. Mirrors the
// co-located route unit-test convention this directory already uses
// (see ../../projects/[projectId]/requirements/[issueId]/covering-cases/route.test.ts):
// vi.mock of next-auth, ~/server/auth, ~/lib/authContext, ~/lib/db, the
// service module, then a makeRequest helper.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("~/server/auth", () => ({ authOptions: {} }));

vi.mock("~/lib/authContext", () => ({
  resolveViewerProjectScope: vi.fn(),
}));

vi.mock("~/lib/db", () => ({
  baseDb: {
    repositoryCases: { findFirst: vi.fn() },
  },
}));

vi.mock("~/lib/services/latestCaseResults", () => ({
  getCaseLatestExecutedAt: vi.fn(),
}));

import { getServerSession } from "next-auth";
import { resolveViewerProjectScope } from "~/lib/authContext";
import { baseDb } from "~/lib/db";
import { getCaseLatestExecutedAt } from "~/lib/services/latestCaseResults";

import { GET } from "./route";

const mockedSession = getServerSession as unknown as ReturnType<typeof vi.fn>;
const mockedResolveScope = resolveViewerProjectScope as unknown as ReturnType<
  typeof vi.fn
>;
const mockedFindFirst = baseDb.repositoryCases
  .findFirst as unknown as ReturnType<typeof vi.fn>;
const mockedGetLatestExecutedAt =
  getCaseLatestExecutedAt as unknown as ReturnType<typeof vi.fn>;

function makeRequest(caseId = "100"): NextRequest {
  return new NextRequest(
    `http://localhost/api/repository-cases/${caseId}/latest-execution`
  );
}

const params = (caseId = "100") => ({
  params: Promise.resolve({ caseId }),
});

describe("GET /api/repository-cases/[caseId]/latest-execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSession.mockResolvedValue({
      user: { id: "user-1", access: "USER" },
    });
    mockedFindFirst.mockResolvedValue({ id: 100, projectId: 5 });
    mockedResolveScope.mockResolvedValue([5]);
    mockedGetLatestExecutedAt.mockResolvedValue(new Map([[100, null]]));
  });

  it("returns 401 without a session", async () => {
    mockedSession.mockResolvedValue(null);

    const res = await GET(makeRequest(), params());

    expect(res.status).toBe(401);
    expect(mockedFindFirst).not.toHaveBeenCalled();
    expect(mockedGetLatestExecutedAt).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-integer case id", async () => {
    const res = await GET(makeRequest("not-a-number"), params("not-a-number"));

    expect(res.status).toBe(400);
    expect(mockedFindFirst).not.toHaveBeenCalled();
    expect(mockedGetLatestExecutedAt).not.toHaveBeenCalled();
  });

  it("returns 404 when the case does not exist or is soft-deleted", async () => {
    // Represents a missing OR soft-deleted case -- the pre-check binds
    // isDeleted: false into the query, so a real Postgres client would
    // return null for either case exactly as this mock does.
    mockedFindFirst.mockResolvedValue(null);

    const res = await GET(makeRequest(), params());

    expect(res.status).toBe(404);
    expect(mockedFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 100, isDeleted: false }),
      })
    );
    expect(mockedResolveScope).not.toHaveBeenCalled();
    expect(mockedGetLatestExecutedAt).not.toHaveBeenCalled();
  });

  it("answers an out-of-scope viewer with the same 404 a missing case gets", async () => {
    // Not 403: a 403/404 pair would let a caller outside the project
    // enumerate which case ids exist.
    mockedResolveScope.mockResolvedValue([6, 7]);

    const res = await GET(makeRequest(), params());

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Case not found" });
    expect(mockedGetLatestExecutedAt).not.toHaveBeenCalled();
  });

  it("returns 200 when the viewer's project scope includes the case's own project", async () => {
    mockedResolveScope.mockResolvedValue([5]);

    const res = await GET(makeRequest(), params());

    expect(res.status).toBe(200);
  });

  it("returns the case's latest executed_at from the shared latest-results CTE", async () => {
    mockedGetLatestExecutedAt.mockResolvedValue(
      new Map([[100, new Date("2026-08-01T00:00:00.000Z")]])
    );

    const res = await GET(makeRequest(), params());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      caseId: 100,
      lastExecutedAt: "2026-08-01T00:00:00.000Z",
    });
    expect(mockedGetLatestExecutedAt).toHaveBeenCalledWith([100]);
  });

  it("returns null lastExecutedAt for a case that has never been executed", async () => {
    mockedGetLatestExecutedAt.mockResolvedValue(new Map([[100, null]]));

    const res = await GET(makeRequest(), params());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ caseId: 100, lastExecutedAt: null });
  });
});
