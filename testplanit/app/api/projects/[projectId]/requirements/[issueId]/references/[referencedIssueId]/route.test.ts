// Converted from the it.todo scaffold (27-01) by 27-07. DELETE removes a
// manual traceability reference (LINK-03, D-15): hard-deletes only the
// RequirementIssueReference join row -- the referenced Issue row always
// survives, mirroring the sibling bare-join RepositoryCaseIssue unlink
// semantics.
//
// Mirrors the co-located route unit-test convention this directory already
// uses (see ../route.test.ts / ../covering-cases/route.test.ts): vi.mock of
// next-auth, ~/server/auth, ~/lib/authContext, ~/lib/db, then a makeRequest
// helper.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("~/server/auth", () => ({ authOptions: {} }));

vi.mock("~/lib/authContext", () => ({
  resolveViewerProjectScope: vi.fn(),
}));

vi.mock("~/lib/db", () => ({
  baseDb: {
    issue: { findFirst: vi.fn() },
    requirementIssueReference: { findFirst: vi.fn() },
  },
}));

vi.mock("~/lib/auth/utils", () => ({
  getEnhancedDb: vi.fn(),
}));

import { getServerSession } from "next-auth";
import { resolveViewerProjectScope } from "~/lib/authContext";
import { getEnhancedDb } from "~/lib/auth/utils";
import { baseDb } from "~/lib/db";

import { DELETE } from "./route";

const mockedSession = getServerSession as unknown as ReturnType<typeof vi.fn>;
const mockedResolveScope = resolveViewerProjectScope as unknown as ReturnType<
  typeof vi.fn
>;
const mockedFindFirst = baseDb.issue.findFirst as unknown as ReturnType<
  typeof vi.fn
>;
const mockedReferenceFindFirst = baseDb.requirementIssueReference
  .findFirst as unknown as ReturnType<typeof vi.fn>;
const mockedGetEnhancedDb = getEnhancedDb as unknown as ReturnType<
  typeof vi.fn
>;

function makeRequest(
  projectId = "5",
  issueId = "10",
  referencedIssueId = "20"
): NextRequest {
  return new NextRequest(
    `http://localhost/api/projects/${projectId}/requirements/${issueId}/references/${referencedIssueId}`,
    { method: "DELETE" }
  );
}

const params = (projectId = "5", issueId = "10", referencedIssueId = "20") => ({
  params: Promise.resolve({ projectId, issueId, referencedIssueId }),
});

describe("DELETE /api/projects/[projectId]/requirements/[issueId]/references/[referencedIssueId]", () => {
  let mockDeleteMany: ReturnType<typeof vi.fn>;
  let mockIssueMethods: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedSession.mockResolvedValue({
      user: { id: "user-1", access: "USER" },
    });
    mockedResolveScope.mockResolvedValue([5]);
    mockedFindFirst.mockResolvedValue({ id: 10 });
    // Default: the post-delete existence probe finds no surviving row, so
    // the existing count-0 no-op test keeps its current meaning.
    mockedReferenceFindFirst.mockResolvedValue(null);
    mockDeleteMany = vi.fn().mockResolvedValue({ count: 1 });
    mockIssueMethods = {
      findFirst: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
    mockedGetEnhancedDb.mockResolvedValue({
      requirementIssueReference: { deleteMany: mockDeleteMany },
      issue: mockIssueMethods,
    });
  });

  it("returns 401 without a session", async () => {
    mockedSession.mockResolvedValue(null);

    const res = await DELETE(makeRequest(), params());

    expect(res.status).toBe(401);
    expect(mockedFindFirst).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-integer id in the path", async () => {
    const res = await DELETE(
      makeRequest("5", "10", "abc"),
      params("5", "10", "abc")
    );

    expect(res.status).toBe(400);
    expect(mockedFindFirst).not.toHaveBeenCalled();
  });

  it("returns 403 when the viewer's project scope excludes the requirement's project", async () => {
    mockedResolveScope.mockResolvedValue([6, 7]);

    const res = await DELETE(makeRequest(), params());

    expect(res.status).toBe(403);
    expect(mockedFindFirst).not.toHaveBeenCalled();
    expect(mockDeleteMany).not.toHaveBeenCalled();
  });

  it("returns 404 when the addressed id is not a live requirement in the project", async () => {
    mockedFindFirst.mockResolvedValue(null);

    const res = await DELETE(makeRequest(), params());

    expect(res.status).toBe(404);
    expect(mockDeleteMany).not.toHaveBeenCalled();
  });

  it("deletes only the join row and never touches the referenced Issue", async () => {
    const res = await DELETE(makeRequest(), params());

    expect(res.status).toBe(200);
    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: { requirementId: 10, referencedIssueId: 20 },
    });
    expect(mockIssueMethods.findFirst).not.toHaveBeenCalled();
    expect(mockIssueMethods.update).not.toHaveBeenCalled();
    expect(mockIssueMethods.delete).not.toHaveBeenCalled();
  });

  it("still returns a 200 no-op when the pair genuinely does not exist", async () => {
    mockDeleteMany.mockResolvedValue({ count: 0 });
    mockedReferenceFindFirst.mockResolvedValue(null);

    const res = await DELETE(makeRequest(), params());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ deletedCount: 0 });
  });

  it("returns 403 when the join row survives a policy-filtered delete", async () => {
    mockDeleteMany.mockResolvedValue({ count: 0 });
    mockedReferenceFindFirst.mockResolvedValue({
      requirementId: 10,
      referencedIssueId: 20,
    });

    const res = await DELETE(makeRequest(), params());

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: "Forbidden" });
    expect(mockIssueMethods.update).not.toHaveBeenCalled();
    expect(mockIssueMethods.delete).not.toHaveBeenCalled();
  });
});
