/**
 * The effective-permission ladder. This module is what /api/get-user-permissions
 * answers with — i.e. what the UI uses to decide whether to show a gated
 * action — so every server-side gate that claims to "match the UI" is only as
 * correct as these rungs.
 *
 * The group GLOBAL_ROLE rung is called out specially: it is the one a previous
 * copy of this ladder omitted, which made the server stricter than the UI for
 * SCIM/SAML deployments that grant access at the group level.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db", () => ({ baseDb: {} }));

const {
  ALL_AREA_PERMISSIONS,
  NO_AREA_PERMISSIONS,
  areaPermissionsFrom,
  hasProjectAccess,
  permissionsForArea,
  resolveEffectiveProjectAccess,
  resolveEligibleRoleIds,
  userHasAreaPermission,
} = await import("./areaPermission");

const closerRole = (id = 1) => ({
  id,
  name: "Tester",
  rolePermissions: [
    { area: "TestRuns", canAddEdit: true, canDelete: false, canClose: true },
    { area: "Sessions", canAddEdit: true, canDelete: false, canClose: false },
  ],
});

const editorRole = (id = 2) => ({
  id,
  name: "Contributor",
  rolePermissions: [
    { area: "TestRuns", canAddEdit: true, canDelete: true, canClose: false },
  ],
});

interface Fixture {
  access?: string;
  globalRole?: ReturnType<typeof closerRole> | null;
  groupIds?: number[];
  userPerm?: { accessType: string; role?: unknown } | null;
  groupPerms?: Array<{ accessType: string; role?: unknown }>;
  projectDefaultAccessType?: string;
  projectDefaultRole?: unknown;
  missingUser?: boolean;
  missingProject?: boolean;
}

const makeDb = (f: Fixture) => ({
  user: {
    findUnique: vi.fn().mockResolvedValue(
      f.missingUser
        ? null
        : {
            id: "u1",
            access: f.access ?? "USER",
            role: f.globalRole ?? null,
            groups: (f.groupIds ?? []).map((groupId) => ({ groupId })),
          }
    ),
  },
  projects: {
    findUnique: vi.fn().mockResolvedValue(
      f.missingProject
        ? null
        : {
            id: 1,
            defaultAccessType: f.projectDefaultAccessType ?? "DEFAULT",
            defaultRole: f.projectDefaultRole ?? null,
          }
    ),
  },
  userProjectPermission: {
    findUnique: vi.fn().mockResolvedValue(f.userPerm ?? null),
  },
  groupProjectPermission: {
    findMany: vi.fn().mockResolvedValue(f.groupPerms ?? []),
  },
});

const canClose = (f: Fixture) =>
  userHasAreaPermission(
    "u1",
    1,
    "TestRuns" as never,
    "canClose",
    makeDb(f) as never
  );

beforeEach(() => vi.clearAllMocks());

describe("permissionsForArea", () => {
  it("grants nothing when the role has no row for the area", () => {
    expect(
      permissionsForArea(closerRole() as never, "Milestones" as never)
    ).toEqual(NO_AREA_PERMISSIONS);
  });

  it("grants nothing for a null role", () => {
    expect(permissionsForArea(null, "TestRuns" as never)).toEqual(
      NO_AREA_PERMISSIONS
    );
  });

  it("returns the role's bits for the area", () => {
    expect(
      permissionsForArea(closerRole() as never, "TestRuns" as never)
    ).toEqual({
      canAddEdit: true,
      canDelete: false,
      canClose: true,
    });
  });
});

describe("system access", () => {
  it("grants a system ADMIN everything, even with an explicit NO_ACCESS row", async () => {
    await expect(
      canClose({ access: "ADMIN", userPerm: { accessType: "NO_ACCESS" } })
    ).resolves.toBe(true);
  });

  it("grants a system PROJECTADMIN everything on a project that allows them", async () => {
    await expect(canClose({ access: "PROJECTADMIN" })).resolves.toBe(true);
  });

  // Unlike ADMIN, a PROJECTADMIN is subject to an explicit denial.
  it("denies a PROJECTADMIN who is explicitly denied the project", async () => {
    await expect(
      canClose({
        access: "PROJECTADMIN",
        userPerm: { accessType: "NO_ACCESS" },
      })
    ).resolves.toBe(false);
  });

  it("denies a PROJECTADMIN when the project itself denies by default", async () => {
    await expect(
      canClose({
        access: "PROJECTADMIN",
        projectDefaultAccessType: "NO_ACCESS",
      })
    ).resolves.toBe(false);
  });
});

describe("user-specific rung", () => {
  it("NO_ACCESS denies outright", async () => {
    await expect(
      canClose({
        userPerm: { accessType: "NO_ACCESS" },
        projectDefaultAccessType: "SPECIFIC_ROLE",
        projectDefaultRole: closerRole(),
      })
    ).resolves.toBe(false);
  });

  it("SPECIFIC_ROLE uses the row's role", async () => {
    await expect(
      canClose({
        userPerm: { accessType: "SPECIFIC_ROLE", role: closerRole() },
      })
    ).resolves.toBe(true);
    await expect(
      canClose({
        userPerm: { accessType: "SPECIFIC_ROLE", role: editorRole() },
      })
    ).resolves.toBe(false);
  });

  it("GLOBAL_ROLE uses the user's own global role", async () => {
    await expect(
      canClose({
        userPerm: { accessType: "GLOBAL_ROLE" },
        globalRole: closerRole(),
      })
    ).resolves.toBe(true);
  });

  it("DEFAULT defers to the lower rungs", async () => {
    await expect(
      canClose({
        userPerm: { accessType: "DEFAULT" },
        projectDefaultAccessType: "SPECIFIC_ROLE",
        projectDefaultRole: closerRole(),
      })
    ).resolves.toBe(true);
  });
});

describe("group rung", () => {
  it("a group SPECIFIC_ROLE grant carries that role", async () => {
    await expect(
      canClose({
        groupIds: [7],
        groupPerms: [{ accessType: "SPECIFIC_ROLE", role: closerRole() }],
      })
    ).resolves.toBe(true);
  });

  // The rung a previous copy of this ladder was missing: the server denied
  // users the UI was happily offering the action to.
  it("a group GLOBAL_ROLE grant carries the member's own global role", async () => {
    await expect(
      canClose({
        groupIds: [7],
        groupPerms: [{ accessType: "GLOBAL_ROLE" }],
        globalRole: closerRole(),
      })
    ).resolves.toBe(true);
  });

  it("a group SPECIFIC_ROLE grant wins over a group GLOBAL_ROLE grant", async () => {
    await expect(
      canClose({
        groupIds: [7, 8],
        groupPerms: [
          { accessType: "GLOBAL_ROLE" },
          { accessType: "SPECIFIC_ROLE", role: editorRole() },
        ],
        globalRole: closerRole(),
      })
    ).resolves.toBe(false);
  });

  it("the user's own row outranks any group grant", async () => {
    await expect(
      canClose({
        userPerm: { accessType: "SPECIFIC_ROLE", role: editorRole() },
        groupIds: [7],
        groupPerms: [{ accessType: "SPECIFIC_ROLE", role: closerRole() }],
      })
    ).resolves.toBe(false);
  });
});

describe("project-default rung", () => {
  it("GLOBAL_ROLE uses the user's global role", async () => {
    await expect(
      canClose({
        projectDefaultAccessType: "GLOBAL_ROLE",
        globalRole: closerRole(),
      })
    ).resolves.toBe(true);
  });

  it("SPECIFIC_ROLE uses the project's default role", async () => {
    await expect(
      canClose({
        projectDefaultAccessType: "SPECIFIC_ROLE",
        projectDefaultRole: closerRole(),
      })
    ).resolves.toBe(true);
  });

  it("NO_ACCESS denies", async () => {
    await expect(
      canClose({ projectDefaultAccessType: "NO_ACCESS" })
    ).resolves.toBe(false);
  });

  it("DEFAULT with no role resolves to nothing", async () => {
    await expect(canClose({})).resolves.toBe(false);
  });
});

describe("resolveEffectiveProjectAccess", () => {
  it("reports unresolved for a missing user or project", async () => {
    const missingUser = await resolveEffectiveProjectAccess(
      "u1",
      1,
      makeDb({ missingUser: true }) as never
    );
    expect(missingUser.resolved).toBe(false);
    expect(hasProjectAccess(missingUser)).toBe(false);
    expect(areaPermissionsFrom(missingUser, "TestRuns" as never)).toEqual(
      NO_AREA_PERMISSIONS
    );

    const missingProject = await resolveEffectiveProjectAccess(
      "u1",
      1,
      makeDb({ missingProject: true }) as never
    );
    expect(missingProject.resolved).toBe(false);
  });

  it("names the deciding path in the reported access types", async () => {
    const viaGroup = await resolveEffectiveProjectAccess(
      "u1",
      1,
      makeDb({
        groupIds: [7],
        groupPerms: [{ accessType: "SPECIFIC_ROLE", role: closerRole() }],
      }) as never
    );
    expect(viaGroup.groupAccessType).toBe("SPECIFIC_ROLE");
    expect(viaGroup.userAccessType).toBeNull();
    expect(hasProjectAccess(viaGroup)).toBe(true);
  });

  it("gives an admin the full grid on every area", async () => {
    const admin = await resolveEffectiveProjectAccess(
      "u1",
      1,
      makeDb({ access: "ADMIN" }) as never
    );
    expect(areaPermissionsFrom(admin, "Milestones" as never)).toEqual(
      ALL_AREA_PERMISSIONS
    );
  });

  // Group lookups are skipped entirely when a higher rung already decided,
  // which is what keeps the common path to three reads.
  it("does not query group grants when the user's own row decides", async () => {
    const db = makeDb({
      userPerm: { accessType: "SPECIFIC_ROLE", role: closerRole() },
      groupIds: [7],
    });
    await resolveEffectiveProjectAccess("u1", 1, db as never);
    expect(db.groupProjectPermission.findMany).not.toHaveBeenCalled();
  });
});

describe("resolveEligibleRoleIds", () => {
  it("returns the roles carrying the permission on the area", async () => {
    const db = {
      rolePermission: {
        findMany: vi.fn().mockResolvedValue([{ roleId: 1 }, { roleId: 4 }]),
      },
    };
    await expect(
      resolveEligibleRoleIds("TestRuns" as never, "canClose", db as never)
    ).resolves.toEqual(new Set([1, 4]));
    expect(db.rolePermission.findMany).toHaveBeenCalledWith({
      where: { area: "TestRuns", canClose: true },
      select: { roleId: true },
    });
  });
});
