import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies BEFORE importing the route handler.
vi.mock("~/lib/api-token-auth", () => ({
  authenticateApiToken: vi.fn(),
}));

vi.mock("~/lib/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}));

const findManyMock = vi.fn();
vi.mock("~/lib/auth/utils", () => ({
  getEnhancedDb: vi.fn(async () => ({
    milestones: { findMany: findManyMock },
  })),
}));

// Module-load invocation tracker for `withAuditContext`. We still pass
// the inner handler back so existing tests can exercise the route logic
// directly, but tracking that the wrapper actually ran at import time
// guards against a regression where the wrapper is dropped from the
// export chain (WR-03). Stored on globalThis because `vi.mock` factories
// are hoisted above top-level `let`/`const` declarations.
declare global {
  var __auditContextTracker: { calls: number; handler: unknown } | undefined;
}
vi.mock("~/lib/auditContextWrappers", () => {
  const tracker = (globalThis.__auditContextTracker ??= {
    calls: 0,
    handler: null,
  });
  return {
    withAuditContext: <T extends (...args: any[]) => any>(handler: T): T => {
      tracker.calls += 1;
      tracker.handler = handler;
      return handler;
    },
  };
});

import { authenticateApiToken } from "~/lib/api-token-auth";
import { prisma } from "~/lib/prisma";

import { GET } from "./route";

const createMockRequest = (
  q: string | null,
  authHeader = "Bearer tpi_validtoken"
): NextRequest => {
  const headers = new Headers();
  if (authHeader) headers.set("authorization", authHeader);
  const params = new URLSearchParams();
  if (q !== null) params.set("q", q);
  return {
    method: "GET",
    headers,
    nextUrl: { searchParams: params },
    url: `http://localhost:3000/api/mcp/milestones-descendants${q !== null ? `?q=${encodeURIComponent(q)}` : ""}`,
  } as unknown as NextRequest;
};

describe("GET /api/mcp/milestones-descendants — batched recursive CTE", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: every id passed in is accessible. Individual tests override
    // findManyMock to simulate cross-tenant filtering.
    findManyMock.mockImplementation(async (args: any) => {
      const ids = args?.where?.id?.in ?? [];
      return ids.map((id: number) => ({ id }));
    });
  });

  it("returns data:{<id>:N} for the requested ids; missing rows default to 0", async () => {
    (authenticateApiToken as any).mockResolvedValue({
      authenticated: true,
      userId: "u1",
      scopes: [],
    });
    (prisma.$queryRaw as any).mockResolvedValue([
      { root_milestone_id: 1, descendant_count: 5 },
      { root_milestone_id: 2, descendant_count: 0 },
      // id 3 absent → defaults to 0 in the response
    ]);

    const response = await GET(
      createMockRequest(JSON.stringify({ milestoneIds: [1, 2, 3] }))
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({
      "1": 5,
      "2": 0,
      "3": 0,
    });
  });

  it("returns 401 when authenticateApiToken reports unauthenticated and never queries the database", async () => {
    (authenticateApiToken as any).mockResolvedValue({
      authenticated: false,
      error: "Invalid token",
      errorCode: "INVALID_TOKEN",
    });

    const response = await GET(
      createMockRequest(JSON.stringify({ milestoneIds: [1] }))
    );
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe("INVALID_TOKEN");
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("empty milestoneIds returns {data:{}} without querying the database", async () => {
    (authenticateApiToken as any).mockResolvedValue({
      authenticated: true,
      userId: "u1",
      scopes: [],
    });

    const response = await GET(
      createMockRequest(JSON.stringify({ milestoneIds: [] }))
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({});
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("missing q query param returns {data:{}} without querying the database", async () => {
    (authenticateApiToken as any).mockResolvedValue({
      authenticated: true,
      userId: "u1",
      scopes: [],
    });

    const response = await GET(createMockRequest(null));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({});
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("$queryRaw is called with a Prisma.sql tagged template containing WITH RECURSIVE / ANY / isDeleted=false / GROUP BY", async () => {
    (authenticateApiToken as any).mockResolvedValue({
      authenticated: true,
      userId: "u1",
      scopes: [],
    });
    (prisma.$queryRaw as any).mockResolvedValue([]);

    await GET(createMockRequest(JSON.stringify({ milestoneIds: [10, 20] })));
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    // Tagged-template invocation form: first arg is the "strings" array
    // (TemplateStringsArray-like), subsequent args are the bound values.
    const callArgs = (prisma.$queryRaw as any).mock.calls[0];
    const strings = callArgs[0] as unknown as ArrayLike<string>;
    const staticParts = Array.from(
      { length: strings.length },
      (_, i) => strings[i]
    ).join("");
    expect(staticParts).toContain("WITH RECURSIVE descendants");
    expect(staticParts).toContain('"parentId" = ANY(');
    expect(staticParts).toContain('"isDeleted" = false');
    expect(staticParts).toContain("GROUP BY root_milestone_id");
    // The bound value is the ids array — not interpolated into the SQL
    // string, but passed as a bound parameter.
    expect(callArgs[1]).toEqual([10, 20]);
  });

  it("filters out ids the caller cannot access (cross-tenant boundary); inaccessible ids default to 0", async () => {
    (authenticateApiToken as any).mockResolvedValue({
      authenticated: true,
      userId: "u1",
      scopes: [],
    });
    // Caller asks for ids [1,2,3] but ZenStack policies only let them read 1.
    findManyMock.mockResolvedValueOnce([{ id: 1 }]);
    (prisma.$queryRaw as any).mockResolvedValue([
      { root_milestone_id: 1, descendant_count: 4 },
    ]);

    const response = await GET(
      createMockRequest(JSON.stringify({ milestoneIds: [1, 2, 3] }))
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    // 2 and 3 default to 0 — the endpoint never confirms or denies whether
    // those ids exist in another tenant.
    expect(body.data).toEqual({ "1": 4, "2": 0, "3": 0 });
    // The CTE was only invoked with the accessible subset.
    const callArgs = (prisma.$queryRaw as any).mock.calls[0];
    expect(callArgs[1]).toEqual([1]);
  });

  it("returns all-zero data without invoking the CTE when every requested id is inaccessible", async () => {
    (authenticateApiToken as any).mockResolvedValue({
      authenticated: true,
      userId: "u1",
      scopes: [],
    });
    findManyMock.mockResolvedValueOnce([]);

    const response = await GET(
      createMockRequest(JSON.stringify({ milestoneIds: [1, 2, 3] }))
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({ "1": 0, "2": 0, "3": 0 });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("rejects milestoneIds arrays exceeding the per-request cap with 400", async () => {
    (authenticateApiToken as any).mockResolvedValue({
      authenticated: true,
      userId: "u1",
      scopes: [],
    });
    const tooMany = Array.from({ length: 251 }, (_, i) => i + 1);

    const response = await GET(
      createMockRequest(JSON.stringify({ milestoneIds: tooMany }))
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("milestoneIds exceeds maximum");
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it("rejects oversized q strings with 400 before parsing", async () => {
    (authenticateApiToken as any).mockResolvedValue({
      authenticated: true,
      userId: "u1",
      scopes: [],
    });
    const huge = "x".repeat(20_000);

    const response = await GET(createMockRequest(huge));
    expect(response.status).toBe(400);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it("wraps the GET export in withAuditContext (audit trail wired at module load)", () => {
    // The wrapper is invoked once when the route module is evaluated. If
    // the export chain were ever changed to bypass `withAuditContext`,
    // this assertion would fail before any request flows through.
    const tracker = globalThis.__auditContextTracker!;
    expect(tracker.calls).toBeGreaterThanOrEqual(1);
    expect(typeof tracker.handler).toBe("function");
  });

  it("filters non-positive integers from milestoneIds before querying", async () => {
    (authenticateApiToken as any).mockResolvedValue({
      authenticated: true,
      userId: "u1",
      scopes: [],
    });
    (prisma.$queryRaw as any).mockResolvedValue([]);

    const response = await GET(
      createMockRequest(
        JSON.stringify({ milestoneIds: [1, 0, -5, 7, "x" as never, 9.5] })
      )
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    // Only 1 and 7 survive; 0, -5, "x", 9.5 are filtered out.
    expect(body.data).toEqual({ "1": 0, "7": 0 });
    const callArgs = (prisma.$queryRaw as any).mock.calls[0];
    expect(callArgs[1]).toEqual([1, 7]);
  });
});
