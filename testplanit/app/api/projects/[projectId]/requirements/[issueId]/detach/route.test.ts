import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("~/server/auth", () => ({ authOptions: {} }));
vi.mock("~/lib/auditContextWrappers", () => ({
  withAuditContext: (handler: any) => handler,
}));

vi.mock("~/lib/db", () => ({
  baseDb: {
    issue: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("~/lib/integrations/importAuthorization", () => ({
  authorizeProjectAdminForProject: vi.fn(),
}));

const { mockIssueUpdate } = vi.hoisted(() => ({
  mockIssueUpdate: vi.fn(),
}));

vi.mock("~/lib/auth/utils", () => ({
  getEnhancedDb: vi.fn(async () => ({
    issue: { update: mockIssueUpdate },
  })),
}));

import { getServerSession } from "next-auth";
import { getEnhancedDb } from "~/lib/auth/utils";
import { baseDb } from "~/lib/db";
import { authorizeProjectAdminForProject } from "~/lib/integrations/importAuthorization";

import { POST } from "./route";

const mockedSession = getServerSession as unknown as ReturnType<typeof vi.fn>;
const mockedFindFirst = baseDb.issue.findFirst as unknown as ReturnType<
  typeof vi.fn
>;
const mockedAuth = authorizeProjectAdminForProject as unknown as ReturnType<
  typeof vi.fn
>;
const mockedGetEnhancedDb = getEnhancedDb as unknown as ReturnType<
  typeof vi.fn
>;

function makeRequest(body?: unknown): NextRequest {
  return new NextRequest(
    "http://localhost/api/projects/5/requirements/10/detach",
    {
      method: "POST",
      ...(body !== undefined
        ? {
            body: JSON.stringify(body),
            headers: { "Content-Type": "application/json" },
          }
        : {}),
    }
  );
}

const params = (projectId = "5", issueId = "10") => ({
  params: Promise.resolve({ projectId, issueId }),
});

describe("POST /api/projects/[projectId]/requirements/[issueId]/detach", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSession.mockResolvedValue({
      user: { id: "user-1", access: "USER" },
    });
    mockedAuth.mockResolvedValue({ ok: true, status: 200, projectId: 5 });
    mockedFindFirst.mockResolvedValue({
      id: 10,
      integrationId: 99,
      requirementDetachedAt: null,
    });
    mockIssueUpdate.mockResolvedValue({
      requirementDetachedAt: new Date("2026-08-21T00:00:00Z"),
    });
  });

  it("returns 401 when there is no session", async () => {
    mockedSession.mockResolvedValue(null);

    const res = await POST(makeRequest(), params());

    expect(res.status).toBe(401);
    expect(mockedAuth).not.toHaveBeenCalled();
    expect(mockedFindFirst).not.toHaveBeenCalled();
    expect(mockIssueUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 when projectId or issueId is not a number", async () => {
    const res = await POST(makeRequest(), params("abc", "10"));

    expect(res.status).toBe(400);
    expect(mockedAuth).not.toHaveBeenCalled();
    expect(mockIssueUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 when the request body fails schema validation", async () => {
    const res = await POST(
      makeRequest({ unexpectedField: "test" }),
      params()
    );

    expect(res.status).toBe(400);
    expect(mockedAuth).not.toHaveBeenCalled();
    expect(mockedFindFirst).not.toHaveBeenCalled();
    expect(mockIssueUpdate).not.toHaveBeenCalled();
  });

  it("returns 403 when the caller is not a project admin for the addressed project", async () => {
    mockedAuth.mockResolvedValue({
      ok: false,
      status: 403,
      error: "Forbidden",
    });

    const res = await POST(makeRequest(), params());

    expect(res.status).toBe(403);
    expect(mockedFindFirst).not.toHaveBeenCalled();
    expect(mockIssueUpdate).not.toHaveBeenCalled();
  });

  it("returns 404 when the addressed issue is not a live requirement in the addressed project", async () => {
    mockedFindFirst.mockResolvedValue(null);

    const res = await POST(makeRequest(), params());

    expect(res.status).toBe(404);
    expect(mockedFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 10,
          projectId: 5,
          isDeleted: false,
          isRequirement: true,
        }),
      })
    );
    expect(mockIssueUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 when the addressed requirement has no integrationId", async () => {
    mockedFindFirst.mockResolvedValue({
      id: 10,
      integrationId: null,
      requirementDetachedAt: null,
    });

    const res = await POST(makeRequest(), params());

    expect(res.status).toBe(400);
    expect(mockIssueUpdate).not.toHaveBeenCalled();
  });

  it("is idempotent — detaching an already-detached requirement succeeds as a no-op", async () => {
    const detachedAt = new Date("2026-08-01T00:00:00Z");
    mockedFindFirst.mockResolvedValue({
      id: 10,
      integrationId: 99,
      requirementDetachedAt: detachedAt,
    });

    const res = await POST(makeRequest(), params());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      requirementDetachedAt: detachedAt.toISOString(),
    });
    expect(mockedGetEnhancedDb).not.toHaveBeenCalled();
    expect(mockIssueUpdate).not.toHaveBeenCalled();
  });

  it("detaches a synced requirement, setting requirementDetachedAt and never writing integrationId", async () => {
    const res = await POST(makeRequest(), params());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.requirementDetachedAt).toBe("2026-08-21T00:00:00.000Z");
    expect(mockIssueUpdate).toHaveBeenCalledTimes(1);
    const call = mockIssueUpdate.mock.calls[0][0];
    expect(call.where).toEqual({ id: 10 });
    expect(call.data).toEqual({ requirementDetachedAt: expect.any(Date) });
    expect(call.data).not.toHaveProperty("integrationId");
    expect(Object.keys(call.data)).not.toContain("title");
    expect(Object.keys(call.data)).not.toContain("description");
    expect(Object.keys(call.data)).not.toContain("status");
    expect(Object.keys(call.data)).not.toContain("priority");
    expect(Object.keys(call.data)).not.toContain("parentId");
  });
});
