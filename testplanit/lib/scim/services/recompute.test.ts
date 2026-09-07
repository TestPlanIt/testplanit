import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db", () => {
  const tx = {
    appConfig: {
      findUnique: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    groupAssignment: {
      findMany: vi.fn(),
    },
    scimRoleMapping: {
      findMany: vi.fn(async () => []),
    },
  };
  return {
    baseDb: {
      $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(tx)),
      __tx: tx,
    },
  };
});

vi.mock("~/lib/services/auditLog", () => ({
  captureAuditEvent: vi.fn(async () => {}),
}));

vi.mock("~/lib/auditContext", () => ({
  getAuditContext: vi.fn(() => ({})),
  updateAuditContext: vi.fn(),
}));

import { baseDb } from "~/lib/db";
import { captureAuditEvent } from "~/lib/services/auditLog";
import { updateAuditContext } from "~/lib/auditContext";

import { recomputeUserAccess } from "./recompute";

import type { Access } from "~/zenstack/models";

interface TxLike {
  appConfig: { findUnique: ReturnType<typeof vi.fn> };
  user: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  groupAssignment: { findMany: ReturnType<typeof vi.fn> };
  scimRoleMapping: { findMany: ReturnType<typeof vi.fn> };
}

const tx = (baseDb as unknown as { __tx: TxLike }).__tx;

afterEach(() => {
  vi.clearAllMocks();
});

function makeUser(
  overrides: {
    id?: string;
    access?: Access;
    accessSource?: "MANUAL" | "GROUP_MAPPING";
    email?: string;
    scimRoles?: string[];
  } = {}
) {
  return {
    id: overrides.id ?? "user-1",
    access: overrides.access ?? ("NONE" as Access),
    accessSource: overrides.accessSource ?? "MANUAL",
    email: overrides.email ?? "user@example.com",
    scimRoles: overrides.scimRoles ?? [],
  };
}

function makeGroupAssignment(mappedAccess: Access | null) {
  return {
    group: { mappedAccess },
  };
}

describe("recomputeUserAccess", () => {
  it("B1: governed user in mapped group — sets highest tier and GROUP_MAPPING source, calls tx.user.update once", async () => {
    const user = makeUser({ access: "NONE", accessSource: "MANUAL" });
    tx.user.findUnique.mockResolvedValue(user);
    tx.groupAssignment.findMany.mockResolvedValue([
      makeGroupAssignment("USER"),
      makeGroupAssignment("ADMIN"),
    ]);
    tx.user.update.mockResolvedValue({
      ...user,
      access: "ADMIN",
      accessSource: "GROUP_MAPPING",
    });

    await recomputeUserAccess(tx as never, user.id, "NONE");

    expect(tx.user.update).toHaveBeenCalledTimes(1);
    const updateCall = tx.user.update.mock.calls[0][0] as {
      where: { id: string };
      data: { access: Access; accessSource: string };
    };
    expect(updateCall.data.access).toBe("ADMIN");
    expect(updateCall.data.accessSource).toBe("GROUP_MAPPING");
  });

  it("B2: governed GROUP_MAPPING user who left all mapped groups — sets fallbackDefault, keeps GROUP_MAPPING source", async () => {
    const user = makeUser({ access: "ADMIN", accessSource: "GROUP_MAPPING" });
    tx.user.findUnique.mockResolvedValue(user);
    tx.groupAssignment.findMany.mockResolvedValue([]);
    tx.user.update.mockResolvedValue({
      ...user,
      access: "NONE",
      accessSource: "GROUP_MAPPING",
    });

    await recomputeUserAccess(tx as never, user.id, "NONE");

    expect(tx.user.update).toHaveBeenCalledTimes(1);
    const updateCall = tx.user.update.mock.calls[0][0] as {
      where: { id: string };
      data: { access: Access; accessSource: string };
    };
    expect(updateCall.data.access).toBe("NONE");
    expect(updateCall.data.accessSource).toBe("GROUP_MAPPING");
  });

  it("B3: MANUAL user in no mapped group — no tx.user.update, no audit (D-01/D-02 invariant)", async () => {
    const user = makeUser({ access: "ADMIN", accessSource: "MANUAL" });
    tx.user.findUnique.mockResolvedValue(user);
    tx.groupAssignment.findMany.mockResolvedValue([]);

    await recomputeUserAccess(tx as never, user.id, "NONE");

    expect(tx.user.update).not.toHaveBeenCalled();
    expect(captureAuditEvent).not.toHaveBeenCalled();
  });

  it("B4: no-op — computed access equals current access and accessSource unchanged — no write, no audit", async () => {
    const user = makeUser({ access: "USER", accessSource: "GROUP_MAPPING" });
    tx.user.findUnique.mockResolvedValue(user);
    tx.groupAssignment.findMany.mockResolvedValue([
      makeGroupAssignment("USER"),
    ]);

    await recomputeUserAccess(tx as never, user.id, "NONE");

    expect(tx.user.update).not.toHaveBeenCalled();
    expect(captureAuditEvent).not.toHaveBeenCalled();
  });

  it("B5: actual flip — recomputeUserAccess does not call updateAuditContext (caller's responsibility)", async () => {
    const user = makeUser({ access: "NONE", accessSource: "MANUAL" });
    tx.user.findUnique.mockResolvedValue(user);
    tx.groupAssignment.findMany.mockResolvedValue([
      makeGroupAssignment("USER"),
    ]);
    tx.user.update.mockResolvedValue({
      ...user,
      access: "USER",
      accessSource: "GROUP_MAPPING",
    });

    // Clear mocks so we can distinguish recomputeUserAccess's own calls
    // from any caller-side stamping.
    vi.clearAllMocks();
    // Re-apply mock return values wiped by clearAllMocks.
    tx.user.findUnique.mockResolvedValue(user);
    tx.groupAssignment.findMany.mockResolvedValue([
      makeGroupAssignment("USER"),
    ]);
    tx.user.update.mockResolvedValue({
      ...user,
      access: "USER",
      accessSource: "GROUP_MAPPING",
    });

    await recomputeUserAccess(tx as never, user.id, "NONE");

    // recomputeUserAccess must NOT call updateAuditContext — that is the caller's job
    expect(updateAuditContext).not.toHaveBeenCalled();

    // But it must call tx.user.update (the flip happened)
    expect(tx.user.update).toHaveBeenCalledTimes(1);

    // recomputeUserAccess must NOT itself call captureAuditEvent for the access flip
    // (the generic role-change hook in lib/baseDb.ts is the single emitter)
    expect(captureAuditEvent).not.toHaveBeenCalled();
  });

  it("B6: USER→ADMIN flip writes GROUP_MAPPING even when accessSource was already GROUP_MAPPING (idempotent on source)", async () => {
    const user = makeUser({ access: "USER", accessSource: "GROUP_MAPPING" });
    tx.user.findUnique.mockResolvedValue(user);
    tx.groupAssignment.findMany.mockResolvedValue([
      makeGroupAssignment("USER"),
      makeGroupAssignment("ADMIN"),
    ]);
    tx.user.update.mockResolvedValue({
      ...user,
      access: "ADMIN",
      accessSource: "GROUP_MAPPING",
    });

    await recomputeUserAccess(tx as never, user.id, "NONE");

    expect(tx.user.update).toHaveBeenCalledTimes(1);
    const updateCall = tx.user.update.mock.calls[0][0] as {
      data: { access: Access; accessSource: string };
    };
    expect(updateCall.data.access).toBe("ADMIN");
    expect(updateCall.data.accessSource).toBe("GROUP_MAPPING");
  });
});

describe("recomputeUserAccess — roles hybrid (HYBRID-01)", () => {
  it("C1: a mapped role tier overrides a higher group tier", async () => {
    const user = makeUser({
      access: "ADMIN",
      accessSource: "GROUP_MAPPING",
      scimRoles: ["contractor"],
    });
    tx.user.findUnique.mockResolvedValue(user);
    tx.groupAssignment.findMany.mockResolvedValue([
      makeGroupAssignment("ADMIN"),
    ]);
    tx.scimRoleMapping.findMany.mockResolvedValue([{ mappedAccess: "USER" }]);
    tx.user.update.mockResolvedValue({ ...user, access: "USER" });

    await recomputeUserAccess(tx as never, user.id, "NONE");

    expect(tx.scimRoleMapping.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { roleValue: { in: ["contractor"] } } })
    );
    const updateCall = tx.user.update.mock.calls[0][0] as {
      data: { access: Access };
    };
    expect(updateCall.data.access).toBe("USER");
  });

  it("C2: role values with no mapping row are ignored — group mapping still governs", async () => {
    const user = makeUser({
      access: "NONE",
      accessSource: "GROUP_MAPPING",
      scimRoles: ["engineering"],
    });
    tx.user.findUnique.mockResolvedValue(user);
    tx.groupAssignment.findMany.mockResolvedValue([
      makeGroupAssignment("PROJECTADMIN"),
    ]);
    tx.scimRoleMapping.findMany.mockResolvedValue([]);
    tx.user.update.mockResolvedValue({ ...user, access: "PROJECTADMIN" });

    await recomputeUserAccess(tx as never, user.id, "NONE");

    const updateCall = tx.user.update.mock.calls[0][0] as {
      data: { access: Access };
    };
    expect(updateCall.data.access).toBe("PROJECTADMIN");
  });

  it("C3: a mapped role alone makes an otherwise MANUAL user directory-governed", async () => {
    const user = makeUser({
      access: "NONE",
      accessSource: "MANUAL",
      scimRoles: ["qa-lead"],
    });
    tx.user.findUnique.mockResolvedValue(user);
    tx.groupAssignment.findMany.mockResolvedValue([]);
    tx.scimRoleMapping.findMany.mockResolvedValue([
      { mappedAccess: "PROJECTADMIN" },
    ]);
    tx.user.update.mockResolvedValue({ ...user, access: "PROJECTADMIN" });

    await recomputeUserAccess(tx as never, user.id, "NONE");

    expect(tx.user.update).toHaveBeenCalledTimes(1);
    const updateCall = tx.user.update.mock.calls[0][0] as {
      data: { access: Access; accessSource: string };
    };
    expect(updateCall.data.access).toBe("PROJECTADMIN");
    expect(updateCall.data.accessSource).toBe("GROUP_MAPPING");
  });

  it("C4: highest-wins applies within multiple mapped roles", async () => {
    const user = makeUser({
      access: "NONE",
      accessSource: "GROUP_MAPPING",
      scimRoles: ["qa-lead", "admin"],
    });
    tx.user.findUnique.mockResolvedValue(user);
    tx.groupAssignment.findMany.mockResolvedValue([]);
    tx.scimRoleMapping.findMany.mockResolvedValue([
      { mappedAccess: "PROJECTADMIN" },
      { mappedAccess: "ADMIN" },
    ]);
    tx.user.update.mockResolvedValue({ ...user, access: "ADMIN" });

    await recomputeUserAccess(tx as never, user.id, "NONE");

    const updateCall = tx.user.update.mock.calls[0][0] as {
      data: { access: Access };
    };
    expect(updateCall.data.access).toBe("ADMIN");
  });

  it("C5: a user with no asserted roles never queries the mapping table", async () => {
    const user = makeUser({ access: "NONE", accessSource: "GROUP_MAPPING" });
    tx.user.findUnique.mockResolvedValue(user);
    tx.groupAssignment.findMany.mockResolvedValue([]);

    await recomputeUserAccess(tx as never, user.id, "NONE");

    expect(tx.scimRoleMapping.findMany).not.toHaveBeenCalled();
  });

  it("C6: a role mapped to NONE denies access a group would otherwise grant", async () => {
    const user = makeUser({
      access: "ADMIN",
      accessSource: "GROUP_MAPPING",
      scimRoles: ["suspended"],
    });
    tx.user.findUnique.mockResolvedValue(user);
    tx.groupAssignment.findMany.mockResolvedValue([
      makeGroupAssignment("ADMIN"),
    ]);
    tx.scimRoleMapping.findMany.mockResolvedValue([{ mappedAccess: "NONE" }]);
    tx.user.update.mockResolvedValue({ ...user, access: "NONE" });

    await recomputeUserAccess(tx as never, user.id, "ADMIN");

    const updateCall = tx.user.update.mock.calls[0][0] as {
      data: { access: Access };
    };
    expect(updateCall.data.access).toBe("NONE");
  });
});
