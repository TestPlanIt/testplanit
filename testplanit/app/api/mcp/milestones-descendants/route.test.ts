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

vi.mock("~/lib/auditContextWrappers", () => ({
  // Pass-through HOF so tests invoke the inner handler logic directly.
  withAuditContext: <T extends (...args: any[]) => any>(handler: T): T =>
    handler,
}));

import { authenticateApiToken } from "~/lib/api-token-auth";
import { prisma } from "~/lib/prisma";

import { GET } from "./route";

const createMockRequest = (
  q: string | null,
  authHeader = "Bearer tpi_validtoken",
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
      createMockRequest(JSON.stringify({ milestoneIds: [1, 2, 3] })),
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
      createMockRequest(JSON.stringify({ milestoneIds: [1] })),
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
      createMockRequest(JSON.stringify({ milestoneIds: [] })),
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
    const staticParts = Array.from({ length: strings.length }, (_, i) => strings[i]).join("");
    expect(staticParts).toContain("WITH RECURSIVE descendants");
    expect(staticParts).toContain('"parentId" = ANY(');
    expect(staticParts).toContain('"isDeleted" = false');
    expect(staticParts).toContain("GROUP BY root_milestone_id");
    // The bound value is the ids array — not interpolated into the SQL
    // string, but passed as a bound parameter.
    expect(callArgs[1]).toEqual([10, 20]);
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
        JSON.stringify({ milestoneIds: [1, 0, -5, 7, "x" as never, 9.5] }),
      ),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    // Only 1 and 7 survive; 0, -5, "x", 9.5 are filtered out.
    expect(body.data).toEqual({ "1": 0, "7": 0 });
    const callArgs = (prisma.$queryRaw as any).mock.calls[0];
    expect(callArgs[1]).toEqual([1, 7]);
  });
});
