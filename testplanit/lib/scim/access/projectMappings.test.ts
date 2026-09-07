import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/services/auditLog", () => ({
  captureAuditEvent: vi.fn(async () => {}),
}));

import { captureAuditEvent } from "~/lib/services/auditLog";

import {
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
}

function makeTx(opts: {
  mappings?: Array<{ projectId: number; mappedAccess: string }>;
  existing?: Array<{
    projectId: number;
    accessType: string;
    roleId: number | null;
    derivedFromMapping: boolean;
  }>;
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
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("tierToProjectGrant", () => {
  it("P1: grants GLOBAL_ROLE so members carry their own global role onto the project", () => {
    expect(tierToProjectGrant("USER")).toEqual({
      accessType: "GLOBAL_ROLE",
      roleId: null,
    });
  });

  it("P2: never emits DEFAULT — the engine filters DEFAULT group rows out, so it would grant nothing", () => {
    for (const tier of ["USER", "PROJECTADMIN", "ADMIN"] as const) {
      expect(tierToProjectGrant(tier).accessType).not.toBe("DEFAULT");
    }
  });

  it("P3: never binds a role id — a group mapping does not pick roles on the operator's behalf", () => {
    for (const tier of ["USER", "PROJECTADMIN", "ADMIN"] as const) {
      expect(tierToProjectGrant(tier).roleId).toBeNull();
      expect(tierToProjectGrant(tier).accessType).not.toBe("SPECIFIC_ROLE");
    }
  });

  it("P4: every mappable tier resolves identically — PROJECTADMIN is a system access level, not a per-project grant", () => {
    expect(tierToProjectGrant("PROJECTADMIN")).toEqual(
      tierToProjectGrant("USER")
    );
    expect(tierToProjectGrant("ADMIN")).toEqual(tierToProjectGrant("USER"));
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
      accessType: "GLOBAL_ROLE",
      roleId: null,
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

  it("P12: re-tiering an already-derived row is a no-op — every tier grants the same thing", async () => {
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

    expect(tx.groupProjectPermission.upsert).not.toHaveBeenCalled();
  });

  it("P12b: converts a stale SPECIFIC_ROLE derived row from the old role-bridge behaviour", async () => {
    // Rows written before the role bridge was removed carry a roleId; the
    // materializer must bring them back to the current shape.
    const tx = makeTx({
      mappings: [{ projectId: 5, mappedAccess: "ADMIN" }],
      existing: [
        {
          projectId: 5,
          accessType: "SPECIFIC_ROLE",
          roleId: 9,
          derivedFromMapping: true,
        },
      ],
    });

    await materializeGroupProjectMappings(tx as never, 1);

    const args = tx.groupProjectPermission.upsert.mock.calls[0][0] as {
      update: Record<string, unknown>;
    };
    expect(args.update).toMatchObject({
      accessType: "GLOBAL_ROLE",
      roleId: null,
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
