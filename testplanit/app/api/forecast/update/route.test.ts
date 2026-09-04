import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/server/auth", () => ({ getServerAuthSession: vi.fn() }));
vi.mock("~/lib/api-token-auth", () => ({ authenticateApiToken: vi.fn() }));
vi.mock("~/lib/db", () => ({ baseDb: { user: { findUnique: vi.fn() } } }));
vi.mock("~/lib/zenstack", () => ({ getAuthDb: vi.fn() }));
vi.mock("~/services/forecastService", () => ({
  updateRepositoryCaseForecast: vi.fn(),
}));

import { authenticateApiToken } from "~/lib/api-token-auth";
import { baseDb } from "~/lib/db";
import { getAuthDb } from "~/lib/zenstack";
import { getServerAuthSession } from "~/server/auth";
import { updateRepositoryCaseForecast } from "~/services/forecastService";
import { GET } from "./route";

const mockedSession = vi.mocked(getServerAuthSession);
const mockedTokenAuth = vi.mocked(authenticateApiToken);
const mockedFindUser = vi.mocked(baseDb.user.findUnique);
const mockedGetAuthDb = vi.mocked(getAuthDb);
const mockedUpdate = vi.mocked(updateRepositoryCaseForecast);

function createRequest(caseId?: string): NextRequest {
  const url = new URL("http://localhost/api/forecast/update");
  if (caseId !== undefined) url.searchParams.set("caseId", caseId);
  return {
    url: url.toString(),
    nextUrl: url,
    headers: new Headers(),
  } as unknown as NextRequest;
}

function visibleCases(ids: number[]) {
  return {
    repositoryCases: {
      findFirst: vi.fn(async ({ where }: { where: { id: number } }) =>
        ids.includes(where.id) ? { id: where.id } : null
      ),
    },
  } as unknown as Awaited<ReturnType<typeof getAuthDb>>;
}

describe("GET /api/forecast/update", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFindUser.mockResolvedValue({ id: "user-1" } as never);
    mockedGetAuthDb.mockResolvedValue(visibleCases([42]));
    mockedUpdate.mockResolvedValue({} as never);
  });

  it("rejects callers with neither a session nor an API token", async () => {
    mockedSession.mockResolvedValue(null);
    mockedTokenAuth.mockResolvedValue({
      authenticated: false,
      error: "Missing token",
      errorCode: "MISSING_TOKEN",
    } as never);

    const res = await GET(createRequest("42"));

    expect(res.status).toBe(401);
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("accepts a bearer token when there is no session", async () => {
    mockedSession.mockResolvedValue(null);
    mockedTokenAuth.mockResolvedValue({
      authenticated: true,
      userId: "user-1",
    } as never);

    const res = await GET(createRequest("42"));

    expect(res.status).toBe(200);
    expect(mockedUpdate).toHaveBeenCalledWith(42);
  });

  it("returns 400 for a missing or non-numeric caseId", async () => {
    mockedSession.mockResolvedValue({ user: { id: "user-1" } } as never);

    expect((await GET(createRequest())).status).toBe(400);
    expect((await GET(createRequest("abc"))).status).toBe(400);
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("returns 404 when the case is not visible to the caller", async () => {
    mockedSession.mockResolvedValue({ user: { id: "user-1" } } as never);

    const res = await GET(createRequest("7"));

    expect(res.status).toBe(404);
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("recomputes the forecast for a visible case", async () => {
    mockedSession.mockResolvedValue({ user: { id: "user-1" } } as never);

    const res = await GET(createRequest("42"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(mockedUpdate).toHaveBeenCalledWith(42);
  });

  it("reports a service failure as 500", async () => {
    mockedSession.mockResolvedValue({ user: { id: "user-1" } } as never);
    mockedUpdate.mockRejectedValue(new Error("boom"));

    const res = await GET(createRequest("42"));

    expect(res.status).toBe(500);
  });
});
