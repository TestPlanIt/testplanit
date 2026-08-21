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

vi.mock("~/lib/services/requirementHierarchy", () => ({
  assertValidReparent: vi.fn(),
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
import { assertValidReparent } from "~/lib/services/requirementHierarchy";

import { POST } from "./route";

const mockedSession = getServerSession as unknown as ReturnType<typeof vi.fn>;
const mockedFindFirst = baseDb.issue.findFirst as unknown as ReturnType<
  typeof vi.fn
>;
const mockedAuth = authorizeProjectAdminForProject as unknown as ReturnType<
  typeof vi.fn
>;
const mockedAssertValidReparent = assertValidReparent as unknown as ReturnType<
  typeof vi.fn
>;
const mockedGetEnhancedDb = getEnhancedDb as unknown as ReturnType<
  typeof vi.fn
>;

function makeRequest(body: unknown): NextRequest {
  return new NextRequest(
    "http://localhost/api/projects/5/requirements/10/reparent",
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }
  );
}

const params = (projectId = "5", issueId = "10") => ({
  params: Promise.resolve({ projectId, issueId }),
});

describe("POST /api/projects/[projectId]/requirements/[issueId]/reparent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSession.mockResolvedValue({
      user: { id: "user-1", access: "USER" },
    });
    mockedAuth.mockResolvedValue({ ok: true, status: 200, projectId: 5 });
    mockedFindFirst.mockResolvedValue({ id: 10 });
    mockedAssertValidReparent.mockResolvedValue(undefined);
    mockIssueUpdate.mockResolvedValue({ id: 10, parentId: 3 });
  });

  it("returns 401 when there is no session", async () => {
    mockedSession.mockResolvedValue(null);

    const res = await POST(makeRequest({ parentId: 3 }), params());

    expect(res.status).toBe(401);
    expect(mockedAuth).not.toHaveBeenCalled();
    expect(mockedFindFirst).not.toHaveBeenCalled();
    expect(mockedAssertValidReparent).not.toHaveBeenCalled();
    expect(mockIssueUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 when projectId or issueId is not a number", async () => {
    const res = await POST(makeRequest({ parentId: 3 }), params("abc", "10"));

    expect(res.status).toBe(400);
    expect(mockedAuth).not.toHaveBeenCalled();
    expect(mockedAssertValidReparent).not.toHaveBeenCalled();
  });

  it("returns 400 when the request body fails schema validation", async () => {
    const res = await POST(makeRequest({ parentId: "not-a-number" }), params());

    expect(res.status).toBe(400);
    expect(mockedAuth).not.toHaveBeenCalled();
    expect(mockedFindFirst).not.toHaveBeenCalled();
    expect(mockedAssertValidReparent).not.toHaveBeenCalled();
  });

  it("returns 403 when the caller is not a project admin for the addressed project", async () => {
    mockedAuth.mockResolvedValue({
      ok: false,
      status: 403,
      error: "Forbidden",
    });

    const res = await POST(makeRequest({ parentId: 3 }), params());

    expect(res.status).toBe(403);
    expect(mockedFindFirst).not.toHaveBeenCalled();
    expect(mockedAssertValidReparent).not.toHaveBeenCalled();
    expect(mockIssueUpdate).not.toHaveBeenCalled();
  });

  it("returns 404 when the addressed issue is not a live requirement in the addressed project", async () => {
    mockedFindFirst.mockResolvedValue(null);

    const res = await POST(makeRequest({ parentId: 3 }), params());

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
    expect(mockedAssertValidReparent).not.toHaveBeenCalled();
    expect(mockIssueUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 with the service error message when assertValidReparent throws", async () => {
    mockedAssertValidReparent.mockRejectedValue(
      new Error("Reparenting Issue 10 under 3 would create a cycle")
    );

    const res = await POST(makeRequest({ parentId: 3 }), params());

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe(
      "Reparenting Issue 10 under 3 would create a cycle"
    );
    expect(mockIssueUpdate).not.toHaveBeenCalled();
  });

  it("successfully reparents a live requirement, calling assertValidReparent before the write", async () => {
    const callOrder: string[] = [];
    mockedAssertValidReparent.mockImplementation(async () => {
      callOrder.push("assertValidReparent");
    });
    mockIssueUpdate.mockImplementation(async () => {
      callOrder.push("update");
      return { id: 10, parentId: 3 };
    });

    const res = await POST(makeRequest({ parentId: 3 }), params());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ id: 10, parentId: 3 });
    expect(mockedGetEnhancedDb).toHaveBeenCalledTimes(1);
    expect(mockIssueUpdate).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { parentId: 3 },
    });
    expect(callOrder).toEqual(["assertValidReparent", "update"]);
  });
});
