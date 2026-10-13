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

/**
 * A tiny stand-in for the Issue table so the parent-scoping assertions can
 * read the SURVIVING state of the row rather than inspecting which client
 * method the route reached for. `findFirst` answers from these rows and the
 * enhanced-client `update` writes back into them, so a refusal that still
 * let the write through shows up as a changed `parentId` here.
 */
interface StoredIssue {
  id: number;
  projectId: number | null;
  isDeleted: boolean;
  isRequirement: boolean;
  parentId: number | null;
}

let rows: StoredIssue[] = [];

/** Child under test. */
const CHILD_ID = 10;
/** A live requirement in project 5 — the only legitimate new parent below. */
const LIVE_REQUIREMENT_PARENT_ID = 3;
/** A defect: same table, same project, wrong role. */
const DEFECT_ID = 77;
/** A requirement that has already been soft-deleted. */
const DELETED_REQUIREMENT_ID = 88;
/** A live requirement, but in another project. */
const OTHER_PROJECT_REQUIREMENT_ID = 99;
/** No row carries this id. */
const MISSING_ID = 12345;

function matchesWhere(row: StoredIssue, where: any): boolean {
  if (where.id !== undefined && row.id !== where.id) return false;
  if (where.projectId !== undefined && row.projectId !== where.projectId) {
    return false;
  }
  if (where.isDeleted !== undefined && row.isDeleted !== where.isDeleted) {
    return false;
  }
  if (
    where.isRequirement !== undefined &&
    row.isRequirement !== where.isRequirement
  ) {
    return false;
  }
  return true;
}

const storedChild = () => rows.find((row) => row.id === CHILD_ID)!;

describe("POST /api/projects/[projectId]/requirements/[issueId]/reparent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSession.mockResolvedValue({
      user: { id: "user-1", access: "USER" },
    });
    mockedAuth.mockResolvedValue({ ok: true, status: 200, projectId: 5 });
    rows = [
      {
        id: CHILD_ID,
        projectId: 5,
        isDeleted: false,
        isRequirement: true,
        parentId: null,
      },
      {
        id: LIVE_REQUIREMENT_PARENT_ID,
        projectId: 5,
        isDeleted: false,
        isRequirement: true,
        parentId: null,
      },
      {
        id: DEFECT_ID,
        projectId: 5,
        isDeleted: false,
        isRequirement: false,
        parentId: null,
      },
      {
        id: DELETED_REQUIREMENT_ID,
        projectId: 5,
        isDeleted: true,
        isRequirement: true,
        parentId: null,
      },
      {
        id: OTHER_PROJECT_REQUIREMENT_ID,
        projectId: 6,
        isDeleted: false,
        isRequirement: true,
        parentId: null,
      },
    ];
    mockedFindFirst.mockImplementation(
      async ({ where }: any) =>
        rows.find((row) => matchesWhere(row, where)) ?? null
    );
    mockedAssertValidReparent.mockResolvedValue(undefined);
    mockIssueUpdate.mockImplementation(async ({ where, data }: any) => {
      const row = rows.find((candidate) => candidate.id === where.id);
      if (!row) throw new Error("record not found");
      Object.assign(row, data);
      return { ...row };
    });
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

  // The new parent gets the same REQUIREMENT_SCOPE_WHERE treatment the child
  // already got. `assertValidReparent` is mocked to succeed throughout this
  // block on purpose: it checks project membership and cycles only, so these
  // cases prove the ROUTE refuses them, not the hierarchy service.
  describe("new-parent scoping", () => {
    it.each([
      ["a defect", DEFECT_ID],
      ["a soft-deleted requirement", DELETED_REQUIREMENT_ID],
      ["a requirement in another project", OTHER_PROJECT_REQUIREMENT_ID],
      ["an id with no row behind it", MISSING_ID],
    ])(
      "returns 400 and leaves the requirement where it was when the new parent is %s",
      async (_label, parentId) => {
        const res = await POST(makeRequest({ parentId }), params());

        // The assertion that matters: the row was not moved.
        expect(storedChild().parentId).toBeNull();
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toBe(
          "New parent must be a live requirement in the same project"
        );
      }
    );

    it("moves the requirement when the new parent is a live requirement in the same project", async () => {
      const res = await POST(
        makeRequest({ parentId: LIVE_REQUIREMENT_PARENT_ID }),
        params()
      );

      expect(res.status).toBe(200);
      expect(storedChild().parentId).toBe(LIVE_REQUIREMENT_PARENT_ID);
    });

    it("still detaches to the root when parentId is null", async () => {
      storedChild().parentId = LIVE_REQUIREMENT_PARENT_ID;

      const res = await POST(makeRequest({ parentId: null }), params());

      expect(res.status).toBe(200);
      expect(storedChild().parentId).toBeNull();
    });
  });
});
