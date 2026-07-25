import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for POST /api/get-user-permissions.
 *
 * CR-02 regression suite: the endpoint must require an authenticated caller
 * and refuse to disclose another user's effective role unless the caller is
 * a system ADMIN. Prior to this gate, anyone reachable to the route could
 * iterate (userId, projectId) pairs to enumerate the org's role assignments
 * — the role + access type was returned in the response body without any
 * caller authentication.
 *
 * The two in-tree callers (`useProjectPermissions`, `useEffectiveRoleOnProject`)
 * always pass `session.user.id` for `userId`, so the same-user branch is the
 * canonical path and remains supported. Admins retain full read access for
 * the admin-UI surfaces that need to inspect other users' permissions.
 */

vi.mock("~/server/auth", () => ({
  getServerAuthSession: vi.fn(),
}));

vi.mock("~/lib/db", () => {
  const dbStub = {
    user: {
      findUnique: vi.fn(),
    },
    projects: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    userProjectPermission: {
      findUnique: vi.fn(),
    },
    groupProjectPermission: {
      findMany: vi.fn(),
    },
  };
  return { baseDb: dbStub };
});

function makeRequest(body: unknown): Request {
  return {
    async json() {
      return body;
    },
  } as unknown as Request;
}

describe("POST /api/get-user-permissions — caller authentication (CR-02)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { baseDb } = await import("~/lib/db");
    // Default Prisma responses so the route reaches the "compute permissions"
    // branch when the caller is authorized. Tests that should short-circuit
    // before any Prisma read use the unauthorized / forbidden branches.
    (baseDb as any).user.findUnique.mockResolvedValue({
      id: "target-user",
      access: "NONE",
      role: { id: 1, rolePermissions: [] },
      groups: [],
    });
    (baseDb as any).projects.findUnique.mockResolvedValue({
      id: 42,
      defaultAccessType: "NO_ACCESS",
      defaultRole: null,
    });
    // Backs authorizeProjectAdminForProject's isProjectAdmin computation —
    // default to "not a project admin" so existing assertions on hasAccess/
    // effectiveRole/permissions are unaffected.
    (baseDb as any).projects.findFirst.mockResolvedValue(null);
    (baseDb as any).userProjectPermission.findUnique.mockResolvedValue(null);
    (baseDb as any).groupProjectPermission.findMany.mockResolvedValue([]);
  });

  it("returns 401 when no session is present (anonymous caller)", async () => {
    const { getServerAuthSession } = await import("~/server/auth");
    (getServerAuthSession as any).mockResolvedValue(null);

    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({ userId: "target-user", projectId: 42 })
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");

    const { baseDb } = await import("~/lib/db");
    expect((baseDb as any).user.findUnique).not.toHaveBeenCalled();
  });

  it("returns 401 when the session has no user id", async () => {
    const { getServerAuthSession } = await import("~/server/auth");
    (getServerAuthSession as any).mockResolvedValue({
      user: { id: undefined, access: "NONE" },
    });

    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({ userId: "target-user", projectId: 42 })
    );

    expect(response.status).toBe(401);
  });

  it("returns 403 when a non-admin caller asks about a different user", async () => {
    const { getServerAuthSession } = await import("~/server/auth");
    (getServerAuthSession as any).mockResolvedValue({
      user: { id: "caller-user", access: "NONE" },
    });

    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({ userId: "target-user", projectId: 42 })
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("Forbidden");

    // No Prisma reads should fire — the IDOR check short-circuits before
    // any role-resolution query touches the database.
    const { baseDb } = await import("~/lib/db");
    expect((baseDb as any).user.findUnique).not.toHaveBeenCalled();
  });

  it("returns 403 when a non-admin caller asks about their PROJECTADMIN peer", async () => {
    // PROJECTADMINs are NOT admins for this gate's purposes — only ADMIN
    // gets to read other users' roles. PROJECTADMINs querying another user
    // get the 403 the same as a NONE caller would.
    const { getServerAuthSession } = await import("~/server/auth");
    (getServerAuthSession as any).mockResolvedValue({
      user: { id: "caller-user", access: "PROJECTADMIN" },
    });

    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({ userId: "target-user", projectId: 42 })
    );

    expect(response.status).toBe(403);
  });

  it("allows the caller to query their own permissions (canonical hook usage)", async () => {
    // Both useProjectPermissions and useEffectiveRoleOnProject pass
    // session.user.id for userId — the most common path. This test pins
    // that the same-user branch resolves and reaches the permission
    // computation rather than getting blocked at the IDOR gate.
    const { getServerAuthSession } = await import("~/server/auth");
    (getServerAuthSession as any).mockResolvedValue({
      user: { id: "caller-user", access: "NONE" },
    });

    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({ userId: "caller-user", projectId: 42 })
    );

    expect(response.status).toBe(200);
    const { baseDb } = await import("~/lib/db");
    expect((baseDb as any).user.findUnique).toHaveBeenCalled();
  });

  it("allows an ADMIN caller to query another user's permissions", async () => {
    // System ADMINs retain the cross-user read so admin-UI surfaces
    // (e.g. user-management dashboards) can keep functioning.
    const { getServerAuthSession } = await import("~/server/auth");
    (getServerAuthSession as any).mockResolvedValue({
      user: { id: "admin-user", access: "ADMIN" },
    });

    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({ userId: "target-user", projectId: 42 })
    );

    expect(response.status).toBe(200);
    const { baseDb } = await import("~/lib/db");
    expect((baseDb as any).user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "target-user" } })
    );
  });

  it("includes isProjectAdmin: true in the response for a system ADMIN caller", async () => {
    const { getServerAuthSession } = await import("~/server/auth");
    (getServerAuthSession as any).mockResolvedValue({
      user: { id: "admin-user", access: "ADMIN" },
    });

    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({ userId: "admin-user", projectId: 42 })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.isProjectAdmin).toBe(true);
  });

  it("includes isProjectAdmin: false for a caller who is not a project admin", async () => {
    const { getServerAuthSession } = await import("~/server/auth");
    (getServerAuthSession as any).mockResolvedValue({
      user: { id: "caller-user", access: "NONE" },
    });
    const { baseDb } = await import("~/lib/db");
    (baseDb as any).projects.findFirst.mockResolvedValue(null);

    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({ userId: "caller-user", projectId: 42 })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.isProjectAdmin).toBe(false);
  });

  it("includes isProjectAdmin: true for a caller who is the project's Project Admin", async () => {
    const { getServerAuthSession } = await import("~/server/auth");
    (getServerAuthSession as any).mockResolvedValue({
      user: { id: "caller-user", access: "NONE" },
    });
    const { baseDb } = await import("~/lib/db");
    (baseDb as any).projects.findFirst.mockResolvedValue({ id: 42 });

    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({ userId: "caller-user", projectId: 42 })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.isProjectAdmin).toBe(true);
  });

  it("returns 400 for invalid body shape after passing auth", async () => {
    const { getServerAuthSession } = await import("~/server/auth");
    (getServerAuthSession as any).mockResolvedValue({
      user: { id: "caller-user", access: "NONE" },
    });

    const { POST } = await import("./route");
    // Missing projectId — Zod should reject.
    const response = await POST(makeRequest({ userId: "caller-user" }));

    expect(response.status).toBe(400);
  });
});

describe("POST /api/get-user-permissions — group GLOBAL_ROLE resolution", () => {
  // Regression: a group assigned to the project with GLOBAL_ROLE defers to
  // each member's own global role. The endpoint used to ignore that grant
  // entirely and fall through to the project default, so on a
  // NO_ACCESS-default project a group member — even a system PROJECTADMIN
  // with an all-permissions role — was reported as having no access and the
  // UI rendered read-only, while the schema policies accepted their writes.

  const groupGlobalGrant = [
    { accessType: "GLOBAL_ROLE", roleId: null, role: null },
  ];

  beforeEach(async () => {
    vi.clearAllMocks();
    const { getServerAuthSession } = await import("~/server/auth");
    (getServerAuthSession as any).mockResolvedValue({
      user: { id: "caller-user", access: "USER" },
    });
    const { baseDb } = await import("~/lib/db");
    (baseDb as any).projects.findUnique.mockResolvedValue({
      id: 42,
      defaultAccessType: "NO_ACCESS",
      defaultRole: null,
    });
    (baseDb as any).projects.findFirst.mockResolvedValue(null);
    (baseDb as any).userProjectPermission.findUnique.mockResolvedValue(null);
    (baseDb as any).groupProjectPermission.findMany.mockResolvedValue(
      groupGlobalGrant
    );
    (baseDb as any).user.findUnique.mockResolvedValue({
      id: "caller-user",
      access: "USER",
      role: {
        id: 9,
        name: "All Access",
        rolePermissions: [
          {
            area: "TestCaseRepository",
            canAddEdit: true,
            canDelete: false,
            canClose: false,
          },
        ],
      },
      groups: [{ groupId: 7 }],
    });
  });

  it("grants the member their global role's permissions on a NO_ACCESS-default project", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({
        userId: "caller-user",
        projectId: 42,
        area: "TestCaseRepository",
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.hasAccess).toBe(true);
    expect(body.effectiveRole).toBe("All Access");
    expect(body.permissions.canAddEdit).toBe(true);
  });

  it("gives a system PROJECTADMIN group member full permissions (accessDenied must not fire)", async () => {
    const { getServerAuthSession } = await import("~/server/auth");
    (getServerAuthSession as any).mockResolvedValue({
      user: { id: "caller-user", access: "PROJECTADMIN" },
    });
    const { baseDb } = await import("~/lib/db");
    (baseDb as any).user.findUnique.mockResolvedValue({
      id: "caller-user",
      access: "PROJECTADMIN",
      role: { id: 9, name: "All Access", rolePermissions: [] },
      groups: [{ groupId: 7 }],
    });

    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({
        userId: "caller-user",
        projectId: 42,
        area: "TestCaseRepository",
      })
    );
    const body = await response.json();

    expect(body.hasAccess).toBe(true);
    expect(body.permissions.canAddEdit).toBe(true);
    expect(body.permissions.canDelete).toBe(true);
  });

  it("still denies a group member whose account has no global role", async () => {
    const { baseDb } = await import("~/lib/db");
    (baseDb as any).user.findUnique.mockResolvedValue({
      id: "caller-user",
      access: "USER",
      role: null,
      groups: [{ groupId: 7 }],
    });

    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({
        userId: "caller-user",
        projectId: 42,
        area: "TestCaseRepository",
      })
    );
    const body = await response.json();

    expect(body.hasAccess).toBe(false);
    expect(body.permissions.canAddEdit).toBe(false);
  });

  it("prefers a SPECIFIC_ROLE group grant over a GLOBAL_ROLE one", async () => {
    const { baseDb } = await import("~/lib/db");
    (baseDb as any).groupProjectPermission.findMany.mockResolvedValue([
      ...groupGlobalGrant,
      {
        accessType: "SPECIFIC_ROLE",
        roleId: 3,
        role: {
          id: 3,
          name: "Scoped Viewer",
          rolePermissions: [
            {
              area: "TestCaseRepository",
              canAddEdit: false,
              canDelete: false,
              canClose: false,
            },
          ],
        },
      },
    ]);

    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({
        userId: "caller-user",
        projectId: 42,
        area: "TestCaseRepository",
      })
    );
    const body = await response.json();

    expect(body.effectiveRole).toBe("Scoped Viewer");
    expect(body.permissions.canAddEdit).toBe(false);
  });

  it("reports the group grant as the accessType in checkAccessOnly mode", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({
        userId: "caller-user",
        projectId: 42,
        checkAccessOnly: true,
      })
    );
    const body = await response.json();

    expect(body.hasAccess).toBe(true);
    expect(body.accessType).toBe("GLOBAL_ROLE");
    expect(body.effectiveRole).toBe("All Access");
  });
});
