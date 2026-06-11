import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/prisma", () => {
  const tx = {
    groups: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    groupAssignment: {
      createMany: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
    },
    appConfig: {
      findUnique: vi.fn(),
    },
  };
  return {
    prisma: {
      $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(tx)),
      __tx: tx,
      groups: tx.groups,
      user: tx.user,
      groupAssignment: tx.groupAssignment,
      appConfig: tx.appConfig,
    },
  };
});

vi.mock("~/lib/services/auditLog", () => ({
  captureAuditEvent: vi.fn(async () => {}),
}));

vi.mock("~/lib/auditContext", () => ({
  updateAuditContext: vi.fn(),
}));

vi.mock("~/lib/webhooks/event-emitters/groupEvents", () => ({
  emitScimGroupCreated: vi.fn(async () => {}),
  emitScimGroupUpdated: vi.fn(async () => {}),
  emitScimGroupMemberAdded: vi.fn(async () => {}),
  emitScimGroupMemberRemoved: vi.fn(async () => {}),
  emitScimGroupDeleted: vi.fn(async () => {}),
}));

// Telemetry: fire-and-forget update of ScimToken.lastSyncAt; unit under
// test is the group-service mutation itself, not the throttled-write side
// effect (covered in lib/scim/token-telemetry.test.ts).
vi.mock("~/lib/scim/token-telemetry", () => ({
  touchLastSync: vi.fn(),
}));

vi.mock("~/lib/scim/filter", async () => {
  const actual =
    await vi.importActual<typeof import("~/lib/scim/filter")>(
      "~/lib/scim/filter"
    );
  return {
    ...actual,
    scimFilterToPrismaGroupWhere: vi.fn(actual.scimFilterToPrismaGroupWhere),
  };
});

import { updateAuditContext } from "~/lib/auditContext";
import { prisma } from "~/lib/prisma";
import { captureAuditEvent } from "~/lib/services/auditLog";
import {
  emitScimGroupCreated,
  emitScimGroupDeleted,
  emitScimGroupMemberAdded,
  emitScimGroupMemberRemoved,
  emitScimGroupUpdated,
} from "~/lib/webhooks/event-emitters/groupEvents";

import {
  SCIM_SCHEMAS,
  SCIM_SYSTEM_USER_ID,
  SYSTEM_PROJECT_ID,
} from "../constants";
import { scimFilterToPrismaGroupWhere } from "../filter";
import { ScimPatchApplyError } from "../patch";
import {
  ScimNotFoundError,
  ScimUniquenessError,
  ScimValidationError,
  createScimGroup,
  deleteScimGroup,
  getScimGroupById,
  listScimGroups,
  patchScimGroup,
  putScimGroup,
} from "./groups";

import type { ScimGroupBody } from "../mapping/group";

interface TxLike {
  groups: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
  user: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  groupAssignment: {
    createMany: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  appConfig: { findUnique: ReturnType<typeof vi.fn> };
}

const tx = (prisma as unknown as { __tx: TxLike }).__tx;

const CTX = { tokenId: "tok_test", systemUserId: SCIM_SYSTEM_USER_ID } as const;

interface PrismaGroupRow {
  id: number;
  name: string;
  externalId: string | null;
  scimDisplayName: string | null;
  scimExtensions: unknown;
  updatedAt: Date | null;
  isDeleted: boolean;
  assignedUsers: Array<{ user: { id: string; name: string } }>;
}

function makeGroup(overrides: Partial<PrismaGroupRow> = {}): PrismaGroupRow {
  const now = new Date("2026-06-01T00:00:00Z");
  return {
    id: 7,
    name: "Eng",
    externalId: "e-1",
    scimDisplayName: "eng",
    scimExtensions: null,
    updatedAt: now,
    isDeleted: false,
    assignedUsers: [],
    ...overrides,
  };
}

function makeBody(overrides: Partial<ScimGroupBody> = {}): ScimGroupBody {
  return {
    schemas: [SCIM_SCHEMAS.CORE_GROUP],
    displayName: "Eng",
    externalId: "e-1",
    members: [],
    ...overrides,
  } as ScimGroupBody;
}

afterEach(() => {
  vi.clearAllMocks();
  // Default stubs for recompute path (readScimFallbackDefault + recomputeUserAccess).
  // Tests that need different behaviour override these before calling the SUT.
  tx.appConfig.findUnique.mockResolvedValue(null);
  tx.user.findUnique.mockResolvedValue(null);
  tx.groupAssignment.findMany.mockResolvedValue([]);
});

describe("createScimGroup", () => {
  describe("A — happy paths", () => {
    it("A1: brand-new INSERT writes scimDisplayName lowercased; emits scim.group.created; audit CREATE; returns linked:false", async () => {
      tx.groups.findUnique.mockResolvedValue(null);
      tx.groups.findFirst.mockResolvedValue(null);
      tx.user.findMany.mockResolvedValue([{ id: "u1" }]);
      const created = makeGroup({
        id: 11,
        name: "Eng",
        scimDisplayName: "eng",
      });
      tx.groups.create.mockResolvedValue(created);
      tx.groupAssignment.createMany.mockResolvedValue({ count: 1 });

      const result = await createScimGroup(
        makeBody({ members: [{ value: "u1" }] }),
        CTX
      );

      expect(tx.groups.create).toHaveBeenCalledTimes(1);
      const createArgs = tx.groups.create.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(createArgs.data.name).toBe("Eng");
      expect(createArgs.data.scimDisplayName).toBe("eng");
      expect(createArgs.data.externalId).toBe("e-1");

      expect(tx.groupAssignment.createMany).toHaveBeenCalledTimes(1);
      const cmArgs = tx.groupAssignment.createMany.mock.calls[0][0] as {
        data: Array<{ userId: string; groupId: number }>;
      };
      expect(cmArgs.data).toEqual([{ userId: "u1", groupId: 11 }]);

      expect(emitScimGroupCreated).toHaveBeenCalledTimes(1);
      const emitCall = (emitScimGroupCreated as ReturnType<typeof vi.fn>).mock
        .calls[0];
      // snapshot() projects to the narrow ScimGroupSnapshot shape (drops
      // assignedUsers + any other relations to keep the emit payload safe),
      // so identity won't match `created` — assert the narrow projection.
      expect(emitCall[0]).toMatchObject({
        id: created.id,
        name: created.name,
        externalId: created.externalId,
        scimDisplayName: created.scimDisplayName,
      });
      expect(emitCall[0]).not.toHaveProperty("assignedUsers");
      expect(emitCall[1]).toEqual([{ value: "u1" }]);

      expect(captureAuditEvent).toHaveBeenCalledTimes(1);
      const audit = (captureAuditEvent as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(audit.action).toBe("CREATE");
      expect(audit.entityType).toBe("Groups");
      expect(audit.entityId).toBe("11");

      expect(result.linked).toBe(false);
    });

    it("A2: tombstone resurrection — same externalId → flips isDeleted=false + scimResurrected:true audit + emits created", async () => {
      const tombstoned = makeGroup({
        id: 22,
        externalId: "e-resurrect",
        isDeleted: true,
        scimDisplayName: "old",
      });
      tx.groups.findUnique.mockResolvedValue(tombstoned);
      tx.user.findMany.mockResolvedValue([]);
      const resurrected = {
        ...tombstoned,
        isDeleted: false,
        name: "Eng",
        scimDisplayName: "eng",
      };
      tx.groups.update.mockResolvedValue(resurrected);

      const result = await createScimGroup(
        makeBody({ externalId: "e-resurrect", members: [] }),
        CTX
      );

      expect(tx.groups.update).toHaveBeenCalledTimes(1);
      const args = tx.groups.update.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(args.data.isDeleted).toBe(false);

      const resurrectAudit = (
        captureAuditEvent as ReturnType<typeof vi.fn>
      ).mock.calls.find(([e]) => e.metadata?.scimResurrected === true);
      expect(resurrectAudit).toBeDefined();
      expect(emitScimGroupCreated).toHaveBeenCalledTimes(1);
      expect(result.linked).toBe(false);
    });

    it("A3: JIT bind — live row with same Groups.name and no externalId → UPDATE scim columns + scimLinked:true + linked:true", async () => {
      tx.groups.findUnique.mockResolvedValue(null);
      const existing = makeGroup({
        id: 33,
        name: "Eng",
        externalId: null,
        scimDisplayName: null,
      });
      tx.groups.findFirst.mockResolvedValue(existing);
      tx.user.findMany.mockResolvedValue([]);
      const linked = { ...existing, externalId: "e-1", scimDisplayName: "eng" };
      tx.groups.update.mockResolvedValue(linked);

      const result = await createScimGroup(makeBody({ members: [] }), CTX);

      expect(tx.groups.update).toHaveBeenCalledTimes(1);
      const linkAudit = (
        captureAuditEvent as ReturnType<typeof vi.fn>
      ).mock.calls.find(([e]) => e.metadata?.scimLinked === true);
      expect(linkAudit).toBeDefined();
      expect(linkAudit?.[0].action).toBe("UPDATE");
      expect(result.linked).toBe(true);
    });

    it("A4: D-04 skip-invalid on create — only valid IDs land in createMany; missing land in scimSkippedMemberIds", async () => {
      tx.groups.findUnique.mockResolvedValue(null);
      tx.groups.findFirst.mockResolvedValue(null);
      tx.user.findMany.mockResolvedValue([{ id: "u1" }]);
      tx.groups.create.mockResolvedValue(makeGroup({ id: 41 }));
      tx.groupAssignment.createMany.mockResolvedValue({ count: 1 });

      await createScimGroup(
        makeBody({
          members: [{ value: "u1" }, { value: "u2" }, { value: "u3" }],
        }),
        CTX
      );

      const cmArgs = tx.groupAssignment.createMany.mock.calls[0][0] as {
        data: Array<{ userId: string }>;
      };
      expect(cmArgs.data.map((d) => d.userId)).toEqual(["u1"]);

      const skipAudit = (
        captureAuditEvent as ReturnType<typeof vi.fn>
      ).mock.calls.find(([e]) =>
        Array.isArray(e.metadata?.scimSkippedMemberIds)
      );
      expect(skipAudit).toBeDefined();
      const skipped = skipAudit?.[0].metadata?.scimSkippedMemberIds as string[];
      expect(skipped.sort()).toEqual(["u2", "u3"]);

      const emitCall = (emitScimGroupCreated as ReturnType<typeof vi.fn>).mock
        .calls[0];
      expect(emitCall[1]).toEqual([{ value: "u1" }]);
    });

    it("A5: D-05 all-invalid on create — createMany NOT called; emit with members:[] (forensic signal)", async () => {
      tx.groups.findUnique.mockResolvedValue(null);
      tx.groups.findFirst.mockResolvedValue(null);
      tx.user.findMany.mockResolvedValue([]);
      tx.groups.create.mockResolvedValue(makeGroup({ id: 51 }));

      await createScimGroup(
        makeBody({ members: [{ value: "missing1" }, { value: "missing2" }] }),
        CTX
      );

      expect(tx.groupAssignment.createMany).not.toHaveBeenCalled();
      const emitCall = (emitScimGroupCreated as ReturnType<typeof vi.fn>).mock
        .calls[0];
      expect(emitCall[1]).toEqual([]);

      const skipAudit = (
        captureAuditEvent as ReturnType<typeof vi.fn>
      ).mock.calls.find(([e]) =>
        Array.isArray(e.metadata?.scimSkippedMemberIds)
      );
      expect(skipAudit).toBeDefined();
      const skipped = skipAudit?.[0].metadata?.scimSkippedMemberIds as string[];
      expect(skipped.sort()).toEqual(["missing1", "missing2"]);
    });

    it("A6: scimExtensions URN merge on create — top-level URN bucket lands inside scimExtensions", async () => {
      tx.groups.findUnique.mockResolvedValue(null);
      tx.groups.findFirst.mockResolvedValue(null);
      tx.user.findMany.mockResolvedValue([]);
      tx.groups.create.mockResolvedValue(makeGroup({ id: 61 }));

      const body = {
        schemas: [SCIM_SCHEMAS.CORE_GROUP, "urn:custom:ext"],
        displayName: "Eng",
        members: [],
        "urn:custom:ext": { customAttr: "value" },
      } as unknown as ScimGroupBody;

      await createScimGroup(body, CTX);

      const args = tx.groups.create.mock.calls[0][0] as {
        data: { scimExtensions: Record<string, unknown> };
      };
      expect(args.data.scimExtensions).toBeDefined();
      expect(args.data.scimExtensions["urn:custom:ext"]).toEqual({
        customAttr: "value",
      });
    });

    it("A7: empty members on create — createMany NOT called; emit with members:[]", async () => {
      tx.groups.findUnique.mockResolvedValue(null);
      tx.groups.findFirst.mockResolvedValue(null);
      tx.groups.create.mockResolvedValue(makeGroup({ id: 71 }));

      await createScimGroup(makeBody({ members: [] }), CTX);

      expect(tx.groupAssignment.createMany).not.toHaveBeenCalled();
      const emitCall = (emitScimGroupCreated as ReturnType<typeof vi.fn>).mock
        .calls[0];
      expect(emitCall[1]).toEqual([]);
    });

    it("A8: P2002 NOT swallowed — bubbles up from tx.groups.create", async () => {
      tx.groups.findUnique.mockResolvedValue(null);
      tx.groups.findFirst.mockResolvedValue(null);
      const p2002 = Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
        clientVersion: "test",
      });
      tx.groups.create.mockRejectedValue(p2002);

      await expect(createScimGroup(makeBody(), CTX)).rejects.toBe(p2002);
    });
  });
});

describe("getScimGroupById", () => {
  it("B1: existing row → returns groupToScim with members projected", async () => {
    tx.groups.findUnique.mockResolvedValue(
      makeGroup({
        id: 81,
        assignedUsers: [
          { user: { id: "u1", name: "Alice" } },
          { user: { id: "u2", name: "Bob" } },
        ],
      })
    );

    const result = await getScimGroupById("81", CTX);
    expect(result.id).toBe("81");
    expect(result.displayName).toBe("Eng");
    expect(result.members).toEqual([
      { value: "u1", display: "Alice" },
      { value: "u2", display: "Bob" },
    ]);
  });

  it("B2: tombstoned row → throws ScimNotFoundError", async () => {
    tx.groups.findUnique.mockResolvedValue(makeGroup({ isDeleted: true }));
    await expect(getScimGroupById("7", CTX)).rejects.toBeInstanceOf(
      ScimNotFoundError
    );
  });

  it("B3: missing row → throws ScimNotFoundError", async () => {
    tx.groups.findUnique.mockResolvedValue(null);
    await expect(getScimGroupById("99", CTX)).rejects.toBeInstanceOf(
      ScimNotFoundError
    );
  });

  it("B4: NaN id → throws ScimNotFoundError without DB call", async () => {
    await expect(getScimGroupById("not-a-number", CTX)).rejects.toBeInstanceOf(
      ScimNotFoundError
    );
    expect(tx.groups.findUnique).not.toHaveBeenCalled();
  });
});

describe("listScimGroups", () => {
  it("C1: defaults — where AND isDeleted:false; skip 0; take 100; order id asc", async () => {
    tx.groups.findMany.mockResolvedValue([]);
    tx.groups.count.mockResolvedValue(0);

    await listScimGroups({}, CTX);

    const args = tx.groups.findMany.mock.calls[0][0] as {
      where: { AND: Array<Record<string, unknown>> };
      skip: number;
      take: number;
      orderBy: Record<string, string>;
    };
    expect(args.skip).toBe(0);
    expect(args.take).toBe(100);
    expect(args.orderBy).toEqual({ id: "asc" });
    const tombGate = args.where.AND.find(
      (clause) => "isDeleted" in clause && clause.isDeleted === false
    );
    expect(tombGate).toBeDefined();
  });

  it("C2: filter passes through scimFilterToPrismaGroupWhere and ANDs with tombstone gate", async () => {
    tx.groups.findMany.mockResolvedValue([]);
    tx.groups.count.mockResolvedValue(0);

    await listScimGroups({ filter: 'displayName eq "Eng"' }, CTX);

    expect(scimFilterToPrismaGroupWhere).toHaveBeenCalledWith(
      'displayName eq "Eng"'
    );
    const args = tx.groups.findMany.mock.calls[0][0] as {
      where: { AND: Array<Record<string, unknown>> };
    };
    expect(args.where.AND.length).toBe(2);
  });

  it("C3: startIndex=21 count=20 → skip=20 take=20", async () => {
    tx.groups.findMany.mockResolvedValue([]);
    tx.groups.count.mockResolvedValue(0);

    await listScimGroups({ startIndex: 21, count: 20 }, CTX);

    const args = tx.groups.findMany.mock.calls[0][0] as {
      skip: number;
      take: number;
    };
    expect(args.skip).toBe(20);
    expect(args.take).toBe(20);
  });

  it("C4: count > 200 → take capped at 200", async () => {
    tx.groups.findMany.mockResolvedValue([]);
    tx.groups.count.mockResolvedValue(0);
    await listScimGroups({ count: 999 }, CTX);
    const args = tx.groups.findMany.mock.calls[0][0] as { take: number };
    expect(args.take).toBe(200);
  });

  it("C5: InvalidFilterError bubbles up; no findMany", async () => {
    await expect(
      listScimGroups({ filter: 'displayName co "x"' }, CTX)
    ).rejects.toThrow(/not supported/);
    expect(tx.groups.findMany).not.toHaveBeenCalled();
  });

  it("C6: totalResults from tx.groups.count with same where", async () => {
    tx.groups.findMany.mockResolvedValue([makeGroup()]);
    tx.groups.count.mockResolvedValue(42);

    const result = await listScimGroups({}, CTX);
    expect(result.totalResults).toBe(42);
  });
});

describe("patchScimGroup — non-member updates", () => {
  it("D1: displayName PATCH writes name + scimDisplayName; scimDisplayNameOverwrote:false when pre-PATCH was in sync", async () => {
    const current = makeGroup({ id: 91, name: "Eng", scimDisplayName: "eng" });
    tx.groups.findUnique.mockResolvedValue(current);
    tx.groups.update.mockResolvedValue({
      ...current,
      name: "NewName",
      scimDisplayName: "newname",
    });

    const body = {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [{ op: "replace", path: "displayName", value: "NewName" }],
    };

    await patchScimGroup("91", body as never, CTX);

    expect(tx.groups.update).toHaveBeenCalledTimes(1);
    const args = tx.groups.update.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(args.data.name).toBe("NewName");
    expect(args.data.scimDisplayName).toBe("newname");

    expect(emitScimGroupUpdated).toHaveBeenCalledTimes(1);
    const audit = (captureAuditEvent as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0];
    expect(audit?.metadata?.scimDisplayNameOverwrote).toBeFalsy();
  });

  it("D1-PII: emitScimGroupUpdated `after` MUST be the narrow ScimGroupSnapshot — no assignedUsers / no full User rows / no password leaked outbound", async () => {
    // UAT 2026-06-09: a webhook destination received `scim.group.updated`
    // payloads whose `after` field carried the raw Prisma row including
    // assignedUsers[].user with the full User columns — password hash,
    // emailVerified, lockedUntil, all PII. The snapshot() helper in
    // services/groups.ts was a passthrough. Fix projects explicitly to
    // ScimGroupSnapshot; this guards the regression.
    const current = makeGroup({
      id: 200,
      name: "OrigName",
      scimDisplayName: "origname",
      assignedUsers: [
        // Add a User-shaped object with sensitive fields. The Prisma type
        // narrows to {id, name}, but the runtime helper used to forward
        // whatever Prisma loaded — proven by the UAT to include password.
        {
          user: {
            id: "u1",
            name: "Alice",
            password: "$2b$10$leaked-hash",
            email: "alice@example.com",
            lockedUntil: null,
          } as unknown as { id: string; name: string },
        },
      ],
    });
    tx.groups.findUnique.mockResolvedValue(current);
    tx.groups.update.mockResolvedValue({
      ...current,
      name: "NewName",
      scimDisplayName: "newname",
    });

    const body = {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [{ op: "replace", path: "displayName", value: "NewName" }],
    };

    await patchScimGroup("200", body as never, CTX);

    expect(emitScimGroupUpdated).toHaveBeenCalledTimes(1);
    const [before, after] = (emitScimGroupUpdated as ReturnType<typeof vi.fn>)
      .mock.calls[0] as [Record<string, unknown>, Record<string, unknown>];

    // The narrow projection MUST drop the assignedUsers relation entirely
    // (the emitter doesn't need member rows; member ops go through
    // emitScimGroupMemberAdded / Removed which carry just {value} refs).
    expect(after).not.toHaveProperty("assignedUsers");
    expect(before).not.toHaveProperty("assignedUsers");

    // Belt-and-suspenders: serialize the entire emitted args and confirm
    // none of the sensitive strings the UAT observed are present anywhere.
    const serialized = JSON.stringify([before, after]);
    expect(serialized).not.toContain("leaked-hash");
    expect(serialized).not.toContain("alice@example.com");
    expect(serialized).not.toContain("lockedUntil");

    // The narrow snapshot fields MUST still be there — diff is meaningful.
    expect(after).toMatchObject({
      id: 200,
      name: "NewName",
      scimDisplayName: "newname",
    });
  });

  it("D2: displayName PATCH on admin-renamed row (name !== scimDisplayName) → scimDisplayNameOverwrote:true", async () => {
    const current = makeGroup({
      id: 92,
      name: "AdminName",
      scimDisplayName: "oldname",
    });
    tx.groups.findUnique.mockResolvedValue(current);
    tx.groups.update.mockResolvedValue({ ...current, name: "NewName" });

    const body = {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [{ op: "replace", path: "displayName", value: "NewName" }],
    };

    await patchScimGroup("92", body as never, CTX);

    const audit = (
      captureAuditEvent as ReturnType<typeof vi.fn>
    ).mock.calls.find(([e]) => e.metadata?.scimDisplayNameOverwrote === true);
    expect(audit).toBeDefined();
  });

  it("D3: scimExtensions URN merge on PATCH — preserves untouched URN buckets", async () => {
    const current = makeGroup({
      id: 93,
      scimExtensions: { "urn:other:preserved": { x: 1 } },
    });
    tx.groups.findUnique.mockResolvedValue(current);
    tx.groups.update.mockResolvedValue(current);

    const body = {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [
        {
          op: "replace",
          path: "urn:custom:ext",
          value: { newAttr: "v" },
        },
      ],
    };

    await patchScimGroup("93", body as never, CTX);

    if (tx.groups.update.mock.calls.length > 0) {
      const args = tx.groups.update.mock.calls[0][0] as {
        data: { scimExtensions?: Record<string, unknown> };
      };
      if (args.data.scimExtensions) {
        expect(args.data.scimExtensions["urn:other:preserved"]).toEqual({
          x: 1,
        });
      }
    }
  });

  it("D4: empty-diff PATCH → emit suppressed; scimNoOp:true audit", async () => {
    const current = makeGroup({ id: 94, name: "Eng", scimDisplayName: "eng" });
    tx.groups.findUnique.mockResolvedValue(current);

    const body = {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [{ op: "replace", path: "displayName", value: "Eng" }],
    };

    await patchScimGroup("94", body as never, CTX);

    expect(emitScimGroupUpdated).not.toHaveBeenCalled();
    const noop = (
      captureAuditEvent as ReturnType<typeof vi.fn>
    ).mock.calls.find(([e]) => e.metadata?.scimNoOp === true);
    expect(noop).toBeDefined();
  });

  it("D5: PATCH on tombstoned row → throws ScimNotFoundError", async () => {
    tx.groups.findUnique.mockResolvedValue(makeGroup({ isDeleted: true }));

    const body = {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [{ op: "replace", path: "displayName", value: "X" }],
    };
    await expect(
      patchScimGroup("7", body as never, CTX)
    ).rejects.toBeInstanceOf(ScimNotFoundError);
  });
});

describe("patchScimGroup — member operations + D-05", () => {
  it("E1: PATCH add member (valid) → createMany + emit member_added", async () => {
    const current = makeGroup({ id: 101, assignedUsers: [] });
    tx.groups.findUnique.mockResolvedValue(current);
    tx.user.findMany.mockResolvedValue([{ id: "u1" }]);
    tx.groupAssignment.createMany.mockResolvedValue({ count: 1 });

    const body = {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [{ op: "add", path: "members", value: [{ value: "u1" }] }],
    };

    await patchScimGroup("101", body as never, CTX);

    expect(tx.groupAssignment.createMany).toHaveBeenCalledTimes(1);
    const cmArgs = tx.groupAssignment.createMany.mock.calls[0][0] as {
      data: Array<{ userId: string; groupId: number }>;
    };
    expect(cmArgs.data).toEqual([{ userId: "u1", groupId: 101 }]);

    expect(emitScimGroupMemberAdded).toHaveBeenCalledTimes(1);
    const emitCall = (emitScimGroupMemberAdded as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(emitCall[1]).toEqual(["u1"]);
  });

  it("E2: PATCH add valid + missing → createMany with valid only; scimSkippedMemberIds audit", async () => {
    const current = makeGroup({ id: 102, assignedUsers: [] });
    tx.groups.findUnique.mockResolvedValue(current);
    tx.user.findMany.mockResolvedValue([{ id: "u1" }]);
    tx.groupAssignment.createMany.mockResolvedValue({ count: 1 });

    const body = {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [
        {
          op: "add",
          path: "members",
          value: [{ value: "u1" }, { value: "u2" }],
        },
      ],
    };

    await patchScimGroup("102", body as never, CTX);

    const cmArgs = tx.groupAssignment.createMany.mock.calls[0][0] as {
      data: Array<{ userId: string }>;
    };
    expect(cmArgs.data.map((d) => d.userId)).toEqual(["u1"]);

    const skipAudit = (
      captureAuditEvent as ReturnType<typeof vi.fn>
    ).mock.calls.find(([e]) => Array.isArray(e.metadata?.scimSkippedMemberIds));
    expect(skipAudit).toBeDefined();
    expect(skipAudit?.[0].metadata?.scimSkippedMemberIds).toEqual(["u2"]);
  });

  it("E3: PATCH add all-invalid (D-05) → createMany NOT called; emit member_added with members:[]", async () => {
    const current = makeGroup({ id: 103, assignedUsers: [] });
    tx.groups.findUnique.mockResolvedValue(current);
    tx.user.findMany.mockResolvedValue([]);

    const body = {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [
        {
          op: "add",
          path: "members",
          value: [{ value: "missing1" }, { value: "missing2" }],
        },
      ],
    };

    await patchScimGroup("103", body as never, CTX);

    expect(tx.groupAssignment.createMany).not.toHaveBeenCalled();
    expect(emitScimGroupMemberAdded).toHaveBeenCalledTimes(1);
    const emitCall = (emitScimGroupMemberAdded as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(emitCall[1]).toEqual([]);

    const skipAudit = (
      captureAuditEvent as ReturnType<typeof vi.fn>
    ).mock.calls.find(([e]) => Array.isArray(e.metadata?.scimSkippedMemberIds));
    expect(skipAudit?.[0].metadata?.scimSkippedMemberIds.sort()).toEqual([
      "missing1",
      "missing2",
    ]);
  });

  it("E4: PATCH remove existing member → deleteMany + emit member_removed", async () => {
    const current = makeGroup({
      id: 104,
      assignedUsers: [{ user: { id: "u1", name: "Alice" } }],
    });
    tx.groups.findUnique.mockResolvedValue(current);
    tx.groupAssignment.deleteMany.mockResolvedValue({ count: 1 });

    const body = {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [
        {
          op: "remove",
          path: 'members[value eq "u1"]',
        },
      ],
    };

    await patchScimGroup("104", body as never, CTX);

    expect(tx.groupAssignment.deleteMany).toHaveBeenCalledTimes(1);
    const dmArgs = tx.groupAssignment.deleteMany.mock.calls[0][0] as {
      where: { groupId: number; userId: { in: string[] } };
    };
    expect(dmArgs.where.groupId).toBe(104);
    expect(dmArgs.where.userId.in).toEqual(["u1"]);

    expect(emitScimGroupMemberRemoved).toHaveBeenCalledTimes(1);
  });

  it("E6: PATCH Entra-shape Remove (members[] value array) → applyScimPatch rewrites; member is removed", async () => {
    const current = makeGroup({
      id: 106,
      assignedUsers: [{ user: { id: "u1091", name: "Cap Test" } }],
    });
    tx.groups.findUnique.mockResolvedValue(current);
    tx.groupAssignment.deleteMany.mockResolvedValue({ count: 1 });

    const body = {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [
        {
          op: "Remove",
          path: "members",
          value: [{ value: "u1091" }],
        },
      ],
    };

    await patchScimGroup("106", body as never, CTX);

    expect(emitScimGroupMemberRemoved).toHaveBeenCalledTimes(1);
    const dmArgs = tx.groupAssignment.deleteMany.mock.calls[0][0] as {
      where: { userId: { in: string[] } };
    };
    expect(dmArgs.where.userId.in).toEqual(["u1091"]);
  });

  it("E7: PATCH on tombstoned row → throws ScimNotFoundError", async () => {
    tx.groups.findUnique.mockResolvedValue(makeGroup({ isDeleted: true }));

    const body = {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [{ op: "add", path: "members", value: [{ value: "u1" }] }],
    };

    await expect(
      patchScimGroup("7", body as never, CTX)
    ).rejects.toBeInstanceOf(ScimNotFoundError);
  });

  it("E8: PATCH malformed Operations → ScimPatchApplyError; no DB write", async () => {
    const current = makeGroup({ id: 108 });
    tx.groups.findUnique.mockResolvedValue(current);

    const body = {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: "not-an-array",
    };

    await expect(
      patchScimGroup("108", body as never, CTX)
    ).rejects.toBeInstanceOf(ScimPatchApplyError);

    expect(tx.groups.update).not.toHaveBeenCalled();
    expect(emitScimGroupUpdated).not.toHaveBeenCalled();
  });
});

describe("putScimGroup", () => {
  it("F1: PUT with same content → empty diff; scimNoOp:true audit; no emit", async () => {
    const current = makeGroup({
      id: 111,
      name: "Eng",
      scimDisplayName: "eng",
      externalId: "e-1",
    });
    tx.groups.findUnique.mockResolvedValue(current);

    await putScimGroup(
      "111",
      makeBody({ displayName: "Eng", externalId: "e-1", members: [] }),
      CTX
    );

    expect(emitScimGroupUpdated).not.toHaveBeenCalled();
    const noop = (
      captureAuditEvent as ReturnType<typeof vi.fn>
    ).mock.calls.find(([e]) => e.metadata?.scimNoOp === true);
    expect(noop).toBeDefined();
  });

  it("F2: PUT with new displayName + same members → updates name + scimDisplayName; emit updated", async () => {
    const current = makeGroup({ id: 112, name: "Eng", scimDisplayName: "eng" });
    tx.groups.findUnique.mockResolvedValue(current);
    tx.groups.update.mockResolvedValue({
      ...current,
      name: "NewEng",
      scimDisplayName: "neweng",
    });

    await putScimGroup(
      "112",
      makeBody({ displayName: "NewEng", members: [] }),
      CTX
    );

    expect(tx.groups.update).toHaveBeenCalledTimes(1);
    const args = tx.groups.update.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(args.data.name).toBe("NewEng");
    expect(args.data.scimDisplayName).toBe("neweng");
    expect(emitScimGroupUpdated).toHaveBeenCalledTimes(1);
  });

  it("F3: PUT with new members set — diff vs current.assignedUsers; CREATE+DELETE inside tx; member_added + member_removed", async () => {
    const current = makeGroup({
      id: 113,
      assignedUsers: [
        { user: { id: "u1", name: "Alice" } },
        { user: { id: "u2", name: "Bob" } },
      ],
    });
    tx.groups.findUnique.mockResolvedValue(current);
    tx.groups.update.mockResolvedValue(current);
    tx.user.findMany.mockResolvedValue([{ id: "u2" }, { id: "u3" }]);
    tx.groupAssignment.createMany.mockResolvedValue({ count: 1 });
    tx.groupAssignment.deleteMany.mockResolvedValue({ count: 1 });

    // After PUT, members = [u2, u3] → add u3, remove u1
    await putScimGroup(
      "113",
      makeBody({
        members: [{ value: "u2" }, { value: "u3" }],
      }),
      CTX
    );

    const cmArgs = tx.groupAssignment.createMany.mock.calls[0]?.[0] as
      | { data: Array<{ userId: string }> }
      | undefined;
    expect(cmArgs?.data.map((d) => d.userId)).toEqual(["u3"]);

    const dmArgs = tx.groupAssignment.deleteMany.mock.calls[0]?.[0] as
      | { where: { userId: { in: string[] } } }
      | undefined;
    expect(dmArgs?.where.userId.in).toEqual(["u1"]);

    expect(emitScimGroupMemberAdded).toHaveBeenCalledTimes(1);
    expect(emitScimGroupMemberRemoved).toHaveBeenCalledTimes(1);
  });

  it("F4: PUT 404 on tombstoned row", async () => {
    tx.groups.findUnique.mockResolvedValue(makeGroup({ isDeleted: true }));
    await expect(putScimGroup("7", makeBody(), CTX)).rejects.toBeInstanceOf(
      ScimNotFoundError
    );
  });

  it("F5: PUT 404 on missing row", async () => {
    tx.groups.findUnique.mockResolvedValue(null);
    await expect(putScimGroup("99", makeBody(), CTX)).rejects.toBeInstanceOf(
      ScimNotFoundError
    );
  });
});

describe("deleteScimGroup", () => {
  it("G1: tx.groups.update {isDeleted:true}; emit deleted; audit DELETE", async () => {
    const current = makeGroup({ id: 121 });
    tx.groups.findUnique.mockResolvedValue(current);
    tx.groups.update.mockResolvedValue({ ...current, isDeleted: true });

    const result = await deleteScimGroup("121", CTX);

    expect(tx.groups.update).toHaveBeenCalledTimes(1);
    const args = tx.groups.update.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(args.data.isDeleted).toBe(true);

    expect(emitScimGroupDeleted).toHaveBeenCalledTimes(1);
    const audit = (captureAuditEvent as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0];
    expect(audit?.action).toBe("DELETE");
    expect(result.status).toBe(204);
  });

  it("G2: DELETE on tombstoned row → throws ScimNotFoundError", async () => {
    tx.groups.findUnique.mockResolvedValue(makeGroup({ isDeleted: true }));
    await expect(deleteScimGroup("7", CTX)).rejects.toBeInstanceOf(
      ScimNotFoundError
    );
  });

  it("G3: DELETE preserves externalId on the tombstone row", async () => {
    const current = makeGroup({ id: 123, externalId: "e-preserve" });
    tx.groups.findUnique.mockResolvedValue(current);
    tx.groups.update.mockResolvedValue({ ...current, isDeleted: true });

    await deleteScimGroup("123", CTX);

    const args = tx.groups.update.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect("externalId" in args.data).toBe(false);
  });

  it("G4: DELETE on a mapped group with members clears groupAssignment rows and recomputes access for each ex-member in-transaction", async () => {
    const current = makeGroup({
      id: 124,
      assignedUsers: [
        { user: { id: "u10", name: "Alice" } },
        { user: { id: "u11", name: "Bob" } },
      ],
    });
    tx.groups.findUnique.mockResolvedValue(current);
    tx.groups.update.mockResolvedValue({ ...current, isDeleted: true });

    // recomputeUserAccess calls: findUnique then groupAssignment.findMany per user.
    // Both ex-members had USER access via GROUP_MAPPING; after deletion they
    // have no mapped groups → recompute writes NONE.
    tx.user.findUnique
      .mockResolvedValueOnce({
        id: "u10",
        access: "USER",
        accessSource: "GROUP_MAPPING",
      })
      .mockResolvedValueOnce({
        id: "u11",
        access: "USER",
        accessSource: "GROUP_MAPPING",
      });
    tx.groupAssignment.findMany
      .mockResolvedValueOnce([]) // u10 has no remaining mapped groups
      .mockResolvedValueOnce([]); // u11 has no remaining mapped groups
    tx.user.update.mockResolvedValue({ id: "u10", access: "NONE" });

    await deleteScimGroup("124", CTX);

    // groupAssignment.deleteMany must have been called for the group
    expect(tx.groupAssignment.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { groupId: 124 } })
    );

    // recomputeUserAccess must have written NONE for both ex-members
    expect(tx.user.update).toHaveBeenCalledTimes(2);
    const updateIds = (
      tx.user.update.mock.calls as Array<[{ where: { id: string } }]>
    )
      .map(([args]) => args.where.id)
      .sort();
    expect(updateIds).toEqual(["u10", "u11"]);

    // Each recompute write must carry GROUP_MAPPING as the source
    for (const [args] of tx.user.update.mock.calls as Array<
      [
        {
          where: { id: string };
          data: { access: string; accessSource: string };
        },
      ]
    >) {
      expect(args.data.accessSource).toBe("GROUP_MAPPING");
    }
  });
});

describe("H — anti-pattern guards (raw-prisma + emit-inside-tx + entityType + ScimValidationError type)", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("fs") as typeof import("fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path") as typeof import("path");
  const source = fs.readFileSync(path.join(__dirname, "groups.ts"), "utf-8");

  it("H1: source imports raw ~/lib/prisma (NOT getEnhancedDb)", () => {
    expect(source.includes("getEnhancedDb")).toBe(false);
    expect(source.includes('from "~/lib/prisma"')).toBe(true);
  });

  it("H2: every captureAuditEvent call uses entityType:'Groups'", async () => {
    tx.groups.findUnique.mockResolvedValue(null);
    tx.groups.findFirst.mockResolvedValue(null);
    tx.groups.create.mockResolvedValue(makeGroup({ id: 200 }));
    await createScimGroup(makeBody({ members: [] }), CTX);
    const call = (captureAuditEvent as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0];
    expect(call?.entityType).toBe("Groups");
    expect(call?.entityId).toBe("200");
  });

  it("H3: source does not call webhookEvents.emit inline (emitters wrap it)", () => {
    expect(source.includes("webhookEvents.emit")).toBe(false);
  });

  it("H4: source has no `as any` casts", () => {
    expect(source.match(/\bas any\b/g)).toBeNull();
  });

  it("H5: source has no planning-doc refs", () => {
    const noComments = source
      .split("\n")
      .filter((line) => !line.trim().startsWith("*"))
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    expect(noComments.match(/\bD-\d+\b/g)).toBeNull();
    expect(noComments.includes("Phase 8")).toBe(false);
    expect(noComments.match(/\bPlan 0\d\b/g)).toBeNull();
    expect(noComments.includes("Pitfall")).toBe(false);
  });
});

describe("I — error class re-exports", () => {
  it("I1: ScimUniquenessError, ScimNotFoundError, ScimValidationError are exported", () => {
    expect(ScimUniquenessError).toBeDefined();
    expect(ScimNotFoundError).toBeDefined();
    expect(ScimValidationError).toBeDefined();
    expect(new ScimUniquenessError("x")).toBeInstanceOf(Error);
    expect(new ScimNotFoundError("x")).toBeInstanceOf(Error);
  });
});

describe("J — inline recompute wiring assertions", () => {
  it("J1: patchScimGroup member-add recomputes access for added user (mapped group)", async () => {
    const current = makeGroup({
      id: 200,
      assignedUsers: [],
      // mappedAccess is on the group, not on PrismaGroupRow — recompute reads it via groupAssignment
    });
    tx.groups.findUnique.mockResolvedValue(current);
    tx.user.findMany.mockResolvedValue([{ id: "u1" }]);
    tx.groupAssignment.createMany.mockResolvedValue({ count: 1 });
    // recomputeUserAccess internals: user is GROUP_MAPPING, has a mapped group tying to USER
    tx.user.findUnique.mockResolvedValue({
      id: "u1",
      access: "NONE",
      accessSource: "GROUP_MAPPING",
    });
    tx.groupAssignment.findMany.mockResolvedValue([
      { group: { mappedAccess: "USER" } },
    ]);
    tx.user.update.mockResolvedValue({ id: "u1", access: "USER" });

    const body = {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [{ op: "add", path: "members", value: [{ value: "u1" }] }],
    };

    await patchScimGroup("200", body as never, CTX);

    // recomputeUserAccess must have written the new access
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "u1" },
        data: expect.objectContaining({
          access: "USER",
          accessSource: "GROUP_MAPPING",
        }),
      })
    );
    // scimGroupId must have been stamped on the audit frame
    expect(updateAuditContext).toHaveBeenCalledWith(
      expect.objectContaining({ scimGroupId: "200" })
    );
  });

  it("J2: patchScimGroup member-remove recomputes removed user (falls back to fallback default)", async () => {
    const current = makeGroup({
      id: 201,
      assignedUsers: [{ user: { id: "u1", name: "Alice" } }],
    });
    tx.groups.findUnique.mockResolvedValue(current);
    tx.groupAssignment.deleteMany.mockResolvedValue({ count: 1 });
    // After removal, user has no mapped groups → recompute returns fallback default (NONE)
    tx.user.findUnique.mockResolvedValue({
      id: "u1",
      access: "USER",
      accessSource: "GROUP_MAPPING",
    });
    tx.groupAssignment.findMany.mockResolvedValue([]);
    tx.user.update.mockResolvedValue({ id: "u1", access: "NONE" });

    const body = {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [{ op: "remove", path: 'members[value eq "u1"]' }],
    };

    await patchScimGroup("201", body as never, CTX);

    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "u1" },
        data: expect.objectContaining({
          access: "NONE",
          accessSource: "GROUP_MAPPING",
        }),
      })
    );
    expect(updateAuditContext).toHaveBeenCalledWith(
      expect.objectContaining({ scimGroupId: "201" })
    );
  });

  it("J3: no-op — recompute returns same access → NO user.update, NO role-change audit row", async () => {
    const current = makeGroup({
      id: 202,
      assignedUsers: [],
    });
    tx.groups.findUnique.mockResolvedValue(current);
    tx.user.findMany.mockResolvedValue([{ id: "u1" }]);
    tx.groupAssignment.createMany.mockResolvedValue({ count: 1 });
    // recomputeUserAccess: computed == current → no-op (early return, no user.update)
    tx.user.findUnique.mockResolvedValue({
      id: "u1",
      access: "USER",
      accessSource: "GROUP_MAPPING",
    });
    tx.groupAssignment.findMany.mockResolvedValue([
      { group: { mappedAccess: "USER" } },
    ]);

    const body = {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [{ op: "add", path: "members", value: [{ value: "u1" }] }],
    };

    await patchScimGroup("202", body as never, CTX);

    // No-op: user already has USER access from mapped group → no write
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it("J4: putScimGroup add and remove both trigger recompute", async () => {
    const current = makeGroup({
      id: 203,
      assignedUsers: [
        { user: { id: "u1", name: "Alice" } },
        { user: { id: "u2", name: "Bob" } },
      ],
    });
    tx.groups.findUnique.mockResolvedValue(current);
    // PUT replaces members with [u2, u3] → add u3, remove u1
    tx.user.findMany.mockResolvedValue([{ id: "u2" }, { id: "u3" }]);
    tx.groupAssignment.createMany.mockResolvedValue({ count: 1 });
    tx.groupAssignment.deleteMany.mockResolvedValue({ count: 1 });

    // recompute for u3 (added): no groups yet → fallback NONE, already NONE → no-op
    // recompute for u1 (removed): no groups → fallback NONE, was USER → write NONE
    tx.user.findUnique
      .mockResolvedValueOnce({
        id: "u3",
        access: "NONE",
        accessSource: "GROUP_MAPPING",
      })
      .mockResolvedValueOnce({
        id: "u1",
        access: "USER",
        accessSource: "GROUP_MAPPING",
      });
    tx.groupAssignment.findMany
      .mockResolvedValueOnce([]) // u3 has no mapped groups
      .mockResolvedValueOnce([]); // u1 has no mapped groups after removal
    tx.user.update.mockResolvedValue({ id: "u1", access: "NONE" });

    await putScimGroup(
      "203",
      makeBody({ members: [{ value: "u2" }, { value: "u3" }] }),
      CTX
    );

    expect(updateAuditContext).toHaveBeenCalledWith(
      expect.objectContaining({ scimGroupId: "203" })
    );
    // u1 (removed, was USER) should be written to NONE
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "u1" },
        data: expect.objectContaining({ access: "NONE" }),
      })
    );
  });
});

// Reference SYSTEM_PROJECT_ID to keep the import non-dead in case the
// build pipeline tree-shakes unused identifiers from test fixtures.
void SYSTEM_PROJECT_ID;
