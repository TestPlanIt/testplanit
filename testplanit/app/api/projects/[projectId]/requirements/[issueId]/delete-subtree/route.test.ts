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
  deleteRequirementSubtree: vi.fn(),
}));

import { getServerSession } from "next-auth";
import { baseDb } from "~/lib/db";
import { authorizeProjectAdminForProject } from "~/lib/integrations/importAuthorization";
import { deleteRequirementSubtree } from "~/lib/services/requirementHierarchy";

import { POST } from "./route";

const mockedSession = getServerSession as unknown as ReturnType<typeof vi.fn>;
const mockedFindFirst = baseDb.issue.findFirst as unknown as ReturnType<
  typeof vi.fn
>;
const mockedAuth = authorizeProjectAdminForProject as unknown as ReturnType<
  typeof vi.fn
>;
const mockedDeleteRequirementSubtree =
  deleteRequirementSubtree as unknown as ReturnType<typeof vi.fn>;

function makeRequest(body?: unknown): NextRequest {
  return new NextRequest(
    "http://localhost/api/projects/5/requirements/10/delete-subtree",
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

describe("POST /api/projects/[projectId]/requirements/[issueId]/delete-subtree", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSession.mockResolvedValue({
      user: { id: "user-1", access: "USER" },
    });
    mockedAuth.mockResolvedValue({ ok: true, status: 200, projectId: 5 });
    mockedFindFirst.mockResolvedValue({ id: 10 });
    mockedDeleteRequirementSubtree.mockResolvedValue({
      deletedIds: [7, 11, 13],
      deletedAt: new Date("2026-08-21T00:00:00Z"),
    });
  });

  it("returns 401 when there is no session", async () => {
    mockedSession.mockResolvedValue(null);

    const res = await POST(makeRequest(), params());

    expect(res.status).toBe(401);
    expect(mockedAuth).not.toHaveBeenCalled();
    expect(mockedFindFirst).not.toHaveBeenCalled();
    expect(mockedDeleteRequirementSubtree).not.toHaveBeenCalled();
  });

  it("returns 400 when projectId or issueId is not a number", async () => {
    const res = await POST(makeRequest(), params("abc", "10"));

    expect(res.status).toBe(400);
    expect(mockedAuth).not.toHaveBeenCalled();
    expect(mockedDeleteRequirementSubtree).not.toHaveBeenCalled();
  });

  it("returns 400 when the request body fails schema validation", async () => {
    const res = await POST(makeRequest({ unexpectedField: "test" }), params());

    expect(res.status).toBe(400);
    expect(mockedAuth).not.toHaveBeenCalled();
    expect(mockedFindFirst).not.toHaveBeenCalled();
    expect(mockedDeleteRequirementSubtree).not.toHaveBeenCalled();
  });

  it("tolerates an absent body and does not fail schema validation", async () => {
    const res = await POST(makeRequest(), params());

    expect(res.status).toBe(200);
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
    expect(mockedDeleteRequirementSubtree).not.toHaveBeenCalled();
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
    expect(mockedDeleteRequirementSubtree).not.toHaveBeenCalled();
  });

  it("returns the deletedIds array produced by deleteRequirementSubtree", async () => {
    const res = await POST(makeRequest(), params());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deletedIds).toEqual([7, 11, 13]);
    expect(mockedDeleteRequirementSubtree).toHaveBeenCalledWith(10, 5);
  });
});
