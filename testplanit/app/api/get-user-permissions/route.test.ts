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

vi.mock("~/lib/prisma", () => {
  const prismaStub = {
    user: {
      findUnique: vi.fn(),
    },
    projects: {
      findUnique: vi.fn(),
    },
    userProjectPermission: {
      findUnique: vi.fn(),
    },
    groupProjectPermission: {
      findMany: vi.fn(),
    },
  };
  return { prisma: prismaStub };
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
    const { prisma } = await import("~/lib/prisma");
    // Default Prisma responses so the route reaches the "compute permissions"
    // branch when the caller is authorized. Tests that should short-circuit
    // before any Prisma read use the unauthorized / forbidden branches.
    (prisma as any).user.findUnique.mockResolvedValue({
      id: "target-user",
      access: "NONE",
      role: { id: 1, rolePermissions: [] },
      groups: [],
    });
    (prisma as any).projects.findUnique.mockResolvedValue({
      id: 42,
      defaultAccessType: "NO_ACCESS",
      defaultRole: null,
    });
    (prisma as any).userProjectPermission.findUnique.mockResolvedValue(null);
    (prisma as any).groupProjectPermission.findMany.mockResolvedValue([]);
  });

  it("returns 401 when no session is present (anonymous caller)", async () => {
    const { getServerAuthSession } = await import("~/server/auth");
    (getServerAuthSession as any).mockResolvedValue(null);

    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({ userId: "target-user", projectId: 42 }),
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");

    const { prisma } = await import("~/lib/prisma");
    expect((prisma as any).user.findUnique).not.toHaveBeenCalled();
  });

  it("returns 401 when the session has no user id", async () => {
    const { getServerAuthSession } = await import("~/server/auth");
    (getServerAuthSession as any).mockResolvedValue({
      user: { id: undefined, access: "NONE" },
    });

    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({ userId: "target-user", projectId: 42 }),
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
      makeRequest({ userId: "target-user", projectId: 42 }),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("Forbidden");

    // No Prisma reads should fire — the IDOR check short-circuits before
    // any role-resolution query touches the database.
    const { prisma } = await import("~/lib/prisma");
    expect((prisma as any).user.findUnique).not.toHaveBeenCalled();
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
      makeRequest({ userId: "target-user", projectId: 42 }),
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
      makeRequest({ userId: "caller-user", projectId: 42 }),
    );

    expect(response.status).toBe(200);
    const { prisma } = await import("~/lib/prisma");
    expect((prisma as any).user.findUnique).toHaveBeenCalled();
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
      makeRequest({ userId: "target-user", projectId: 42 }),
    );

    expect(response.status).toBe(200);
    const { prisma } = await import("~/lib/prisma");
    expect((prisma as any).user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "target-user" } }),
    );
  });

  it("returns 400 for invalid body shape after passing auth", async () => {
    const { getServerAuthSession } = await import("~/server/auth");
    (getServerAuthSession as any).mockResolvedValue({
      user: { id: "caller-user", access: "NONE" },
    });

    const { POST } = await import("./route");
    // Missing projectId — Zod should reject.
    const response = await POST(
      makeRequest({ userId: "caller-user" }),
    );

    expect(response.status).toBe(400);
  });
});
