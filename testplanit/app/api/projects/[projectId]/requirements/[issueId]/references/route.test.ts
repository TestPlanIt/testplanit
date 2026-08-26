// Converted from the it.todo scaffold (27-01) by 27-07. POST attaches a
// manual traceability reference (LINK-03, D-09/D-10/D-11): an internal pick
// creates the join row directly; an external pick upserts an Issue shell
// through the existing guarded upsertLinkedIssueShell path first.
// Load-bearing: the shell payload never sends isRequirement or parentId
// (D-09) -- a reference-created shell must never enter the requirements
// tree.
//
// Mirrors the co-located route unit-test convention this directory already
// uses (see ../covering-cases/route.test.ts): vi.mock of next-auth,
// ~/server/auth, ~/lib/authContext, ~/lib/db, then a makeRequest helper.

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
    projectIntegration: { findFirst: vi.fn() },
    projects: { findUnique: vi.fn() },
  },
}));

vi.mock("~/lib/auth/utils", () => ({
  getEnhancedDb: vi.fn(),
}));

vi.mock("~/lib/services/linkedIssueUpsert", () => ({
  upsertLinkedIssueShell: vi.fn(),
}));

vi.mock("~/lib/services/areaPermission", () => ({
  userHasAreaPermission: vi.fn(),
}));

vi.mock("~/lib/utils/errors", () => ({
  isUniqueConstraintError: vi.fn(),
}));

import { getServerSession } from "next-auth";
import { resolveViewerProjectScope } from "~/lib/authContext";
import { getEnhancedDb } from "~/lib/auth/utils";
import { baseDb } from "~/lib/db";
import { userHasAreaPermission } from "~/lib/services/areaPermission";
import { upsertLinkedIssueShell } from "~/lib/services/linkedIssueUpsert";
import { isUniqueConstraintError } from "~/lib/utils/errors";

import { POST } from "./route";

const mockedSession = getServerSession as unknown as ReturnType<typeof vi.fn>;
const mockedResolveScope = resolveViewerProjectScope as unknown as ReturnType<
  typeof vi.fn
>;
const mockedFindFirst = baseDb.issue.findFirst as unknown as ReturnType<
  typeof vi.fn
>;
const mockedProjectIntegrationFindFirst = baseDb.projectIntegration
  .findFirst as unknown as ReturnType<typeof vi.fn>;
const mockedProjectsFindUnique = baseDb.projects
  .findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedGetEnhancedDb = getEnhancedDb as unknown as ReturnType<
  typeof vi.fn
>;
const mockedUpsertShell = upsertLinkedIssueShell as unknown as ReturnType<
  typeof vi.fn
>;
const mockedUserHasAreaPermission =
  userHasAreaPermission as unknown as ReturnType<typeof vi.fn>;
const mockedIsUniqueConstraintError =
  isUniqueConstraintError as unknown as ReturnType<typeof vi.fn>;

function makeRequest(
  projectId = "5",
  issueId = "10",
  body?: unknown
): NextRequest {
  return new NextRequest(
    `http://localhost/api/projects/${projectId}/requirements/${issueId}/references`,
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

describe("POST /api/projects/[projectId]/requirements/[issueId]/references", () => {
  let mockCreate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedSession.mockResolvedValue({
      user: { id: "user-1", access: "USER" },
    });
    mockedResolveScope.mockResolvedValue([5]);
    // where.id === 10 is the requirement's own identity pre-check; 20 is
    // the referenced internal issue's own identity lookup -- distinct call
    // sites in the same test run distinguished by the id the route asks
    // for, mirroring the real distinct queries the route issues.
    mockedFindFirst.mockImplementation(async ({ where }: any) => {
      if (where.id === 10) return { id: 10 };
      if (where.id === 20) return { id: 20, projectId: 5 };
      return null;
    });
    mockedProjectIntegrationFindFirst.mockResolvedValue({ integrationId: 42 });
    mockedProjectsFindUnique.mockResolvedValue({ createdBy: "someone-else" });
    mockedUserHasAreaPermission.mockResolvedValue(true);
    mockedUpsertShell.mockResolvedValue({ id: 99 });
    mockCreate = vi.fn().mockResolvedValue({
      requirementId: 10,
      referencedIssueId: 20,
      createdById: "user-1",
    });
    mockedGetEnhancedDb.mockResolvedValue({
      requirementIssueReference: { create: mockCreate },
    });
    mockedIsUniqueConstraintError.mockReturnValue(false);
  });

  it("returns 401 without a session", async () => {
    mockedSession.mockResolvedValue(null);

    const res = await POST(makeRequest(), params());

    expect(res.status).toBe(401);
    expect(mockedFindFirst).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-integer project or issue id", async () => {
    const res = await POST(
      makeRequest("abc", "10", { internalIssueId: 20 }),
      params("abc", "10")
    );

    expect(res.status).toBe(400);
    expect(mockedFindFirst).not.toHaveBeenCalled();
  });

  it("returns 400 when the body names neither an internal issue nor an external issue", async () => {
    const res = await POST(makeRequest("5", "10", {}), params());

    expect(res.status).toBe(400);
    expect(mockedFindFirst).not.toHaveBeenCalled();
  });

  it("returns 400 when the referenced issue id equals the requirement id", async () => {
    const res = await POST(
      makeRequest("5", "10", { internalIssueId: 10 }),
      params()
    );

    expect(res.status).toBe(400);
    // Self-reference is rejected before any DB write.
    expect(mockedResolveScope).not.toHaveBeenCalled();
    expect(mockedFindFirst).not.toHaveBeenCalled();
  });

  it("returns 403 when the viewer's project scope excludes the requirement's project", async () => {
    mockedResolveScope.mockResolvedValue([6, 7]);

    const res = await POST(
      makeRequest("5", "10", { internalIssueId: 20 }),
      params()
    );

    expect(res.status).toBe(403);
    expect(mockedFindFirst).not.toHaveBeenCalled();
  });

  it("returns 403 when the viewer's project scope excludes the referenced internal issue's project", async () => {
    mockedResolveScope.mockResolvedValue([5]);
    mockedFindFirst.mockImplementation(async ({ where }: any) => {
      if (where.id === 10) return { id: 10 };
      // Referenced issue lives in a different project (99), outside scope.
      if (where.id === 20) return { id: 20, projectId: 99 };
      return null;
    });

    const res = await POST(
      makeRequest("5", "10", { internalIssueId: 20 }),
      params()
    );

    expect(res.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns 404 when the addressed id is not a live requirement in the project", async () => {
    mockedFindFirst.mockImplementation(async () => null);

    const res = await POST(
      makeRequest("5", "10", { internalIssueId: 20 }),
      params()
    );

    expect(res.status).toBe(404);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("writes nothing and returns 403 when the caller lacks canAddEdit on an external pick", async () => {
    mockedUserHasAreaPermission.mockResolvedValue(false);

    const res = await POST(
      makeRequest("5", "10", {
        external: { externalId: "EXT-1", key: "EXT-1", title: "Title" },
      }),
      params()
    );

    expect(res.status).toBe(403);
    expect(mockedUpsertShell).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockedProjectIntegrationFindFirst).not.toHaveBeenCalled();
  });

  it("writes nothing and returns 403 when the caller lacks canAddEdit on an internal pick", async () => {
    mockedUserHasAreaPermission.mockResolvedValue(false);

    const res = await POST(
      makeRequest("5", "10", { internalIssueId: 20 }),
      params()
    );

    expect(res.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("allows a project creator who has no explicit canAddEdit grant", async () => {
    mockedUserHasAreaPermission.mockResolvedValue(false);
    mockedProjectsFindUnique.mockResolvedValue({ createdBy: "user-1" });

    const res = await POST(
      makeRequest("5", "10", { internalIssueId: 20 }),
      params()
    );

    expect(res.status).toBe(200);
    expect(mockCreate).toHaveBeenCalled();
  });

  it("returns 400 for a self-external-pick before the shell upsert runs", async () => {
    mockedFindFirst.mockImplementation(async ({ where }: any) => {
      if (where.id === 10) return { id: 10 };
      if (where.externalId === "SELF-1") return { id: 10 };
      return null;
    });

    const res = await POST(
      makeRequest("5", "10", {
        external: { externalId: "SELF-1", key: "SELF-1", title: "Self" },
      }),
      params()
    );

    expect(res.status).toBe(400);
    expect(mockedUpsertShell).not.toHaveBeenCalled();
  });

  it("creates the join row through the enhanced client for an internal pick", async () => {
    const res = await POST(
      makeRequest("5", "10", { internalIssueId: 20 }),
      params()
    );

    expect(res.status).toBe(200);
    expect(mockedGetEnhancedDb).toHaveBeenCalledWith(
      expect.objectContaining({
        user: expect.objectContaining({ id: "user-1" }),
      })
    );
    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        requirementId: 10,
        referencedIssueId: 20,
        createdById: "user-1",
      },
    });
    expect(mockedUpsertShell).not.toHaveBeenCalled();
  });

  it("upserts the shell through upsertLinkedIssueShell for an external pick", async () => {
    const res = await POST(
      makeRequest("5", "10", {
        external: {
          externalId: "EXT-1",
          key: "EXT-1",
          title: "External Title",
        },
      }),
      params()
    );

    expect(res.status).toBe(200);
    expect(mockedUpsertShell).toHaveBeenCalledWith(
      baseDb,
      expect.objectContaining({
        externalId: "EXT-1",
        integrationId: 42,
      })
    );
    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        requirementId: 10,
        referencedIssueId: 99,
        createdById: "user-1",
      },
    });
  });

  it("never sends isRequirement or parentId in the shell payload", async () => {
    await POST(
      makeRequest("5", "10", {
        external: {
          externalId: "EXT-2",
          key: "EXT-2",
          title: "Another External",
        },
      }),
      params()
    );

    expect(mockedUpsertShell).toHaveBeenCalledTimes(1);
    const shellArgs = mockedUpsertShell.mock.calls[0][1];
    expect(shellArgs.create).not.toHaveProperty("isRequirement");
    expect(shellArgs.create).not.toHaveProperty("parentId");
    expect(shellArgs.update).not.toHaveProperty("isRequirement");
    expect(shellArgs.update).not.toHaveProperty("parentId");
  });

  it("returns 200 without creating a duplicate when the pair already exists", async () => {
    mockCreate.mockRejectedValue(new Error("duplicate key value"));
    mockedIsUniqueConstraintError.mockReturnValue(true);

    const res = await POST(
      makeRequest("5", "10", { internalIssueId: 20 }),
      params()
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ created: false });
  });
});
