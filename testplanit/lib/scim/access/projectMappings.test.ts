import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/services/auditLog", () => ({
  captureAuditEvent: vi.fn(async () => {}),
}));

import { captureAuditEvent } from "~/lib/services/auditLog";

import {
  PROJECT_ADMIN_ROLE_NAME,
  isProjectMappableAccess,
  materializeGroupProjectMappings,
  tierToProjectGrant,
} from "./projectMappings";

interface TxLike {
  groupProjectAccessMapping: { findMany: ReturnType<typeof vi.fn> };
  groupProjectPermission: {
    findMany: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
  roles: { findFirst: ReturnType<typeof vi.fn> };
}

function makeTx(opts: {
  mappings?: Array<{ projectId: number; mappedAccess: string }>;
  existing?: Array<{
    projectId: number;
    accessType: string;
    roleId: number | null;
    derivedFromMapping: boolean;
  }>;
  projectAdminRoleId?: number | null;
}): TxLike {
  return {
    groupProjectAccessMapping: {
      findMany: vi.fn(async () => opts.mappings ?? []),
    },
    groupProjectPermission: {
      findMany: vi.fn(async () => opts.existing ?? []),
      upsert: vi.fn(async () => ({})),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    roles: {
      findFirst: vi.fn(async () =>
        opts.projectAdminRoleId === null
          ? null
          : { id: opts.projectAdminRoleId ?? 9 }
      ),
    },
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("tierToProjectGrant", () => {
  it("P1: USER grants GLOBAL_ROLE, not DEFAULT — DEFAULT group rows are filtered out by the engine and would grant nothing", () => {
    expect(tierToProjectGrant("USER", 9)).toEqual({
      grant: { accessType: "GLOBAL_ROLE", roleId: null },
      degraded: false,
    });
  });

  it("P2: PROJECTADMIN grants the Project Admin role", () => {
    expect(tierToProjectGrant("PROJECTADMIN", 9)).toEqual({
      grant: { accessType: "SPECIFIC_ROLE", roleId: 9 },
      degraded: false,
    });
  });

  it("P3: ADMIN is the same as PROJECTADMIN within one project", () => {
    expect(tierToProjectGrant("ADMIN", 9)).toEqual(
      tierToProjectGrant("PROJECTADMIN", 9)
    );
  });

  it("P4: degrades to GLOBAL_ROLE and reports it when no Project Admin role exists", () => {
    expect(tierToProjectGrant("PROJECTADMIN", null)).toEqual({
      grant: { accessType: "GLOBAL_ROLE", roleId: null },
      degraded: true,
    });
  });
});

describe("isProjectMappableAccess", () => {
  it("P5: rejects NONE — a group row cannot deny project access", () => {
    expect(isProjectMappableAccess("NONE")).toBe(false);
    expect(isProjectMappableAccess("USER")).toBe(true);
    expect(isProjectMappableAccess("PROJECTADMIN")).toBe(true);
    expect(isProjectMappableAccess("ADMIN")).toBe(true);
  });
});

describe("materializeGroupProjectMappings", () => {
  it("P6: creates a derived permission row for a new mapping", async () => {
    const tx = makeTx({
      mappings: [{ projectId: 5, mappedAccess: "PROJECTADMIN" }],
    });

    await materializeGroupProjectMappings(tx as never, 1);

    expect(tx.groupProjectPermission.upsert).toHaveBeenCalledTimes(1);
    const args = tx.groupProjectPermission.upsert.mock.calls[0][0] as {
      create: Record<string, unknown>;
    };
    expect(args.create).toMatchObject({
      groupId: 1,
      projectId: 5,
      accessType: "SPECIFIC_ROLE",
      roleId: 9,
      derivedFromMapping: true,
    });
  });

  it("P7: is a no-op when the derived row already has the desired shape", async () => {
    const tx = makeTx({
      mappings: [{ projectId: 5, mappedAccess: "USER" }],
      existing: [
        {
          projectId: 5,
          accessType: "GLOBAL_ROLE",
          roleId: null,
          derivedFromMapping: true,
        },
      ],
    });

    await materializeGroupProjectMappings(tx as never, 1);

    expect(tx.groupProjectPermission.upsert).not.toHaveBeenCalled();
    expect(tx.groupProjectPermission.deleteMany).not.toHaveBeenCalled();
  });

  it("P8: withdraws a derived row whose mapping is gone", async () => {
    const tx = makeTx({
      mappings: [],
      existing: [
        {
          projectId: 5,
          accessType: "GLOBAL_ROLE",
          roleId: null,
          derivedFromMapping: true,
        },
      ],
    });

    await materializeGroupProjectMappings(tx as never, 1);

    expect(tx.groupProjectPermission.deleteMany).toHaveBeenCalledWith({
      where: { groupId: 1, projectId: { in: [5] } },
    });
  });

  it("P9: NEVER deletes a permission an admin assigned by hand", async () => {
    const tx = makeTx({
      mappings: [],
      existing: [
        {
          projectId: 7,
          accessType: "SPECIFIC_ROLE",
          roleId: 3,
          derivedFromMapping: false,
        },
      ],
    });

    await materializeGroupProjectMappings(tx as never, 1);

    expect(tx.groupProjectPermission.deleteMany).not.toHaveBeenCalled();
  });

  it("P10: audits taking over a manual row when a mapping collides with it", async () => {
    const tx = makeTx({
      mappings: [{ projectId: 7, mappedAccess: "PROJECTADMIN" }],
      existing: [
        {
          projectId: 7,
          accessType: "GLOBAL_ROLE",
          roleId: null,
          derivedFromMapping: false,
        },
      ],
    });

    await materializeGroupProjectMappings(tx as never, 1);

    expect(captureAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "GroupProjectPermission",
        entityId: "1:7",
        metadata: expect.objectContaining({
          scimProjectMappingSupersededManual: true,
        }),
      })
    );
    expect(tx.groupProjectPermission.upsert).toHaveBeenCalledTimes(1);
  });

  it("P11: audits the degraded grant when the Project Admin role is missing", async () => {
    const tx = makeTx({
      mappings: [{ projectId: 5, mappedAccess: "ADMIN" }],
      projectAdminRoleId: null,
    });

    await materializeGroupProjectMappings(tx as never, 1);

    expect(captureAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          scimProjectRoleMissing: true,
          missingRoleName: PROJECT_ADMIN_ROLE_NAME,
        }),
      })
    );
    const args = tx.groupProjectPermission.upsert.mock.calls[0][0] as {
      create: Record<string, unknown>;
    };
    expect(args.create.accessType).toBe("GLOBAL_ROLE");
  });

  it("P12: retiers an existing derived row in place", async () => {
    const tx = makeTx({
      mappings: [{ projectId: 5, mappedAccess: "PROJECTADMIN" }],
      existing: [
        {
          projectId: 5,
          accessType: "GLOBAL_ROLE",
          roleId: null,
          derivedFromMapping: true,
        },
      ],
    });

    await materializeGroupProjectMappings(tx as never, 1);

    const args = tx.groupProjectPermission.upsert.mock.calls[0][0] as {
      update: Record<string, unknown>;
    };
    expect(args.update).toMatchObject({
      accessType: "SPECIFIC_ROLE",
      roleId: 9,
      derivedFromMapping: true,
    });
  });

  it("P13: handles several mapped projects in one pass, adding and withdrawing together", async () => {
    const tx = makeTx({
      mappings: [
        { projectId: 5, mappedAccess: "USER" },
        { projectId: 6, mappedAccess: "ADMIN" },
      ],
      existing: [
        {
          projectId: 8,
          accessType: "GLOBAL_ROLE",
          roleId: null,
          derivedFromMapping: true,
        },
      ],
    });

    await materializeGroupProjectMappings(tx as never, 1);

    expect(tx.groupProjectPermission.upsert).toHaveBeenCalledTimes(2);
    expect(tx.groupProjectPermission.deleteMany).toHaveBeenCalledWith({
      where: { groupId: 1, projectId: { in: [8] } },
    });
  });
});
