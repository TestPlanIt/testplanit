import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `authenticateRunRequest` is the shared gate in front of every automated-
 * execution route. These tests pin the five decisions it makes: id validation,
 * auth passthrough, the token rate limit, run visibility (404, never 403), and
 * the write permission check — plus where the `mode:read` token gate actually
 * lives (see the last describe).
 */

vi.mock("~/server/auth", () => ({
  authOptions: {},
  getServerAuthSession: vi.fn(async () => null),
}));

vi.mock("~/lib/api-token-auth", () => ({
  authenticateRequest: vi.fn(),
  hasBearerToken: vi.fn(() => false),
}));

vi.mock("~/lib/api-rate-limit", () => ({
  checkApiRateLimit: vi.fn(async () => ({
    allowed: true,
    limit: 10000,
    remaining: 9999,
    resetAt: 1_700_003_600,
  })),
}));

// api-token-auth's own dependencies, mocked so the last describe can pull the
// REAL module in with `importActual` and exercise the read-only gate without a
// database or Valkey.
vi.mock("~/lib/api-token-cache", () => ({
  getCachedTokenInfo: vi.fn(),
  setCachedTokenInfo: vi.fn(),
  invalidateApiTokenCache: vi.fn(),
}));
vi.mock("~/lib/api-tokens", () => ({
  hashToken: vi.fn(() => "hashed"),
  isValidTokenFormat: vi.fn(() => true),
}));

vi.mock("~/lib/db", () => ({
  baseDb: {
    user: { findUnique: vi.fn() },
    testRuns: { findFirst: vi.fn() },
    apiToken: { update: vi.fn(async () => ({})) },
  },
}));

vi.mock("~/lib/zenstack", () => ({ getAuthDb: vi.fn() }));

vi.mock("~/lib/services/projectPermissions", () => ({
  userCanAddEditArea: vi.fn(async () => true),
}));

import { checkApiRateLimit } from "~/lib/api-rate-limit";
import { authenticateRequest, hasBearerToken } from "~/lib/api-token-auth";
import { baseDb } from "~/lib/db";
import { userCanAddEditArea } from "~/lib/services/projectPermissions";
import { getAuthDb } from "~/lib/zenstack";
import { authenticateRunRequest, isRouteResponse, parseId } from "./runAccess";

const mockSession = vi.mocked(
  (await import("~/server/auth")).getServerAuthSession
);
const mockAuthenticate = authenticateRequest as unknown as ReturnType<
  typeof vi.fn
>;
const mockHasBearer = hasBearerToken as unknown as ReturnType<typeof vi.fn>;
const mockRateLimit = checkApiRateLimit as unknown as ReturnType<typeof vi.fn>;
const mockGetAuthDb = getAuthDb as unknown as ReturnType<typeof vi.fn>;
const mockCanEdit = userCanAddEditArea as unknown as ReturnType<typeof vi.fn>;
const db = baseDb as unknown as {
  user: { findUnique: ReturnType<typeof vi.fn> };
  testRuns: { findFirst: ReturnType<typeof vi.fn> };
};

const RUN = {
  id: 42,
  projectId: 3,
  isCompleted: false,
  testRunType: "HYBRID",
  compositionLockedAt: null,
};

/** The policy-enhanced client `getAuthDb` hands back for a non-admin. */
let enhancedFindFirst: ReturnType<typeof vi.fn>;

function request(method = "GET", headers: Record<string, string> = {}) {
  return new NextRequest("https://tpi.example.com/api/test-runs/42/execute", {
    method,
    headers,
  });
}

function user(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    access: "USER",
    role: { rolePermissions: [] },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue(null as never);
  mockAuthenticate.mockResolvedValue({
    authenticated: true,
    user: { userId: "user-1", access: "USER" },
  });
  mockHasBearer.mockReturnValue(false);
  mockRateLimit.mockResolvedValue({
    allowed: true,
    limit: 10000,
    remaining: 9999,
    resetAt: 1_700_003_600,
  });
  db.user.findUnique.mockResolvedValue(user());
  db.testRuns.findFirst.mockResolvedValue(RUN);
  enhancedFindFirst = vi.fn(async () => RUN);
  mockGetAuthDb.mockResolvedValue({
    testRuns: { findFirst: enhancedFindFirst },
  });
  mockCanEdit.mockResolvedValue(true);
});

async function json(res: NextResponse) {
  return (await res.json()) as Record<string, unknown>;
}

describe("authenticateRunRequest — run id", () => {
  it.each([0, -1, 1.5, Number.NaN])(
    "rejects %p with 400 before any auth work",
    async (runId) => {
      const res = await authenticateRunRequest(request(), runId as number);
      expect(isRouteResponse(res)).toBe(true);
      const response = res as NextResponse;
      expect(response.status).toBe(400);
      expect(await json(response)).toEqual({ error: "Invalid test run id" });
      expect(mockAuthenticate).not.toHaveBeenCalled();
    }
  );
});

describe("authenticateRunRequest — authentication", () => {
  it("passes the auth status and error code straight through", async () => {
    mockAuthenticate.mockResolvedValue({
      authenticated: false,
      error: "API token has expired",
      errorCode: "EXPIRED_TOKEN",
      status: 401,
    });
    const res = (await authenticateRunRequest(request(), 42)) as NextResponse;
    expect(res.status).toBe(401);
    expect(await json(res)).toEqual({
      error: "API token has expired",
      code: "EXPIRED_TOKEN",
    });
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it("omits `code` when the auth result carries no error code", async () => {
    mockAuthenticate.mockResolvedValue({
      authenticated: false,
      error: "Unauthorized",
      status: 401,
    });
    const res = (await authenticateRunRequest(request(), 42)) as NextResponse;
    expect(res.status).toBe(401);
    expect(await json(res)).toEqual({ error: "Unauthorized" });
  });

  it("401s when the authenticated principal has no user row", async () => {
    db.user.findUnique.mockResolvedValue(null);
    const res = (await authenticateRunRequest(request(), 42)) as NextResponse;
    expect(res.status).toBe(401);
    expect(await json(res)).toEqual({ error: "User not found" });
  });

  it("hands a browser session through without consulting the limiter", async () => {
    mockSession.mockResolvedValue({
      user: { id: "user-1", access: "USER" },
    } as never);
    const ctx = await authenticateRunRequest(request(), 42);
    expect(isRouteResponse(ctx)).toBe(false);
    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(mockAuthenticate).toHaveBeenCalledWith(expect.anything(), {
      user: { id: "user-1", access: "USER" },
    });
  });
});

describe("authenticateRunRequest — token rate limit", () => {
  it("applies the API rate limit to a bearer-token caller", async () => {
    mockHasBearer.mockReturnValue(true);
    const ctx = await authenticateRunRequest(request(), 42);
    expect(mockRateLimit).toHaveBeenCalledTimes(1);
    expect(isRouteResponse(ctx)).toBe(false);
  });

  it("429s with X-RateLimit-* headers once the window is exhausted", async () => {
    mockHasBearer.mockReturnValue(true);
    mockRateLimit.mockResolvedValue({
      allowed: false,
      limit: 5000,
      remaining: 0,
      resetAt: 1_700_003_600,
    });
    const res = (await authenticateRunRequest(request(), 42)) as NextResponse;
    expect(res.status).toBe(429);
    expect(await json(res)).toEqual({ error: "Rate limit exceeded" });
    expect(res.headers.get("X-RateLimit-Limit")).toBe("5000");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(res.headers.get("X-RateLimit-Reset")).toBe("1700003600");
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });
});

describe("authenticateRunRequest — run visibility", () => {
  it("reads through the policy client for a non-admin", async () => {
    const ctx = await authenticateRunRequest(request(), 42);
    expect(mockGetAuthDb).toHaveBeenCalledWith(
      expect.objectContaining({ id: "user-1" })
    );
    expect(enhancedFindFirst).toHaveBeenCalledWith({
      where: { id: 42, isDeleted: false },
      select: {
        id: true,
        projectId: true,
        isCompleted: true,
        testRunType: true,
        compositionLockedAt: true,
      },
    });
    expect(db.testRuns.findFirst).not.toHaveBeenCalled();
    expect(ctx).toEqual({ userId: "user-1", access: "USER", run: RUN });
  });

  it("reads through baseDb for an ADMIN, skipping the policy client", async () => {
    db.user.findUnique.mockResolvedValue(user({ access: "ADMIN" }));
    mockAuthenticate.mockResolvedValue({
      authenticated: true,
      user: { userId: "user-1", access: "ADMIN" },
    });
    const ctx = await authenticateRunRequest(request(), 42);
    expect(mockGetAuthDb).not.toHaveBeenCalled();
    expect(db.testRuns.findFirst).toHaveBeenCalledTimes(1);
    expect(ctx).toEqual({ userId: "user-1", access: "ADMIN", run: RUN });
  });

  it("404s — never 403 — when the run is invisible to the caller", async () => {
    enhancedFindFirst.mockResolvedValue(null);
    const res = (await authenticateRunRequest(request(), 42, {
      write: true,
    })) as NextResponse;
    expect(res.status).toBe(404);
    expect(await json(res)).toEqual({ error: "Test run not found" });
    // The permission check must not run — a 403 would confirm the run exists.
    expect(mockCanEdit).not.toHaveBeenCalled();
  });

  it("404s a soft-deleted run through the same not-found path", async () => {
    enhancedFindFirst.mockResolvedValue(null);
    const res = (await authenticateRunRequest(request(), 42)) as NextResponse;
    expect(res.status).toBe(404);
    expect(enhancedFindFirst.mock.calls[0][0].where.isDeleted).toBe(false);
  });
});

describe("authenticateRunRequest — write permission", () => {
  it("403s when the caller cannot add/edit TestRuns in the project", async () => {
    mockCanEdit.mockResolvedValue(false);
    const res = (await authenticateRunRequest(request("POST"), 42, {
      write: true,
    })) as NextResponse;
    expect(res.status).toBe(403);
    expect(await json(res)).toEqual({ error: "Forbidden" });
    expect(mockCanEdit).toHaveBeenCalledWith("user-1", 3, "TestRuns", "USER");
  });

  it("returns the context when the caller can write", async () => {
    const ctx = await authenticateRunRequest(request("POST"), 42, {
      write: true,
    });
    expect(isRouteResponse(ctx)).toBe(false);
    expect(ctx).toEqual({ userId: "user-1", access: "USER", run: RUN });
  });

  it("never checks the write permission on a read request", async () => {
    await authenticateRunRequest(request(), 42);
    expect(mockCanEdit).not.toHaveBeenCalled();
  });
});

describe("parseId / isRouteResponse", () => {
  it("accepts a positive integer and rejects everything else", () => {
    expect(parseId("42")).toBe(42);
    expect(parseId("0")).toBeNaN();
    expect(parseId("-3")).toBeNaN();
    expect(parseId("abc")).toBeNaN();
  });

  it("narrows a NextResponse away from a context object", () => {
    expect(isRouteResponse(NextResponse.json({}, { status: 400 }))).toBe(true);
    expect(
      isRouteResponse({ userId: "u", access: "USER", run: RUN } as never)
    ).toBe(false);
  });
});

/**
 * The `mode:read` gate is enforced in ONE place: `authenticateApiTokenForMethod`
 * (lib/api-token-auth.ts — `WRITE_HTTP_METHODS`). These tests exercise the real
 * function, and then pin the fact that `authenticateRunRequest` reaches auth
 * through `authenticateRequest`, which does NOT consult it.
 */
describe("read-only (mode:read) token gating", () => {
  async function realTokenAuth() {
    return await vi.importActual<typeof import("~/lib/api-token-auth")>(
      "~/lib/api-token-auth"
    );
  }

  async function cacheHit(scopes: string[]) {
    const cache = await import("~/lib/api-token-cache");
    (
      cache.getCachedTokenInfo as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      tokenId: "tok-1",
      userId: "user-1",
      userAccess: "USER",
      userName: "Ada",
      userEmail: "ada@example.com",
      scopes,
      expiresAt: null,
    });
  }

  function tokenRequest(method: string) {
    return request(method, { authorization: "Bearer tpi_readonlytoken" });
  }

  it("accepts a mode:read token on a GET", async () => {
    await cacheHit(["mode:read"]);
    const { authenticateApiTokenForMethod } = await realTokenAuth();
    const result = await authenticateApiTokenForMethod(tokenRequest("GET"));
    expect(result.authenticated).toBe(true);
    expect(result.userId).toBe("user-1");
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "rejects a mode:read token on %s with READ_ONLY_TOKEN",
    async (method) => {
      await cacheHit(["mode:read"]);
      const { authenticateApiTokenForMethod } = await realTokenAuth();
      const result = await authenticateApiTokenForMethod(tokenRequest(method));
      expect(result.authenticated).toBe(false);
      expect(result.errorCode).toBe("READ_ONLY_TOKEN");
      expect(result.error).not.toContain("tpi_readonlytoken");
    }
  );

  it("lets a full-scope token through on a POST", async () => {
    await cacheHit([]);
    const { authenticateApiTokenForMethod } = await realTokenAuth();
    const result = await authenticateApiTokenForMethod(tokenRequest("POST"));
    expect(result.authenticated).toBe(true);
  });

  it("rejects a mode:read bearer on a write method with 403 READ_ONLY_TOKEN", async () => {
    mockHasBearer.mockReturnValue(true);
    mockAuthenticate.mockResolvedValueOnce({
      authenticated: false,
      error: "Token is read-only; write operations are not permitted.",
      errorCode: "READ_ONLY_TOKEN",
      status: 403,
    });
    const ctx = await authenticateRunRequest(tokenRequest("POST"), 42, {
      write: true,
    });
    expect(isRouteResponse(ctx)).toBe(true);
    const res = ctx as NextResponse;
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      code: "READ_ONLY_TOKEN",
    });
  });
});
