import { beforeEach, describe, expect, it, vi } from "vitest";

// listScimConflictsAction issues its filtered query via Kysely
// `sql`...`.execute(baseDb.$qb). Mock $qb as a capturing executor: transform/
// compile pass the raw node through (so tests can inspect its SQL fragments and
// bound parameters) and executeQuery returns the { rows } shape the action reads.
const { qbCompileQuery, qbExecuteQuery } = vi.hoisted(() => ({
  qbCompileQuery: vi.fn((node: unknown) => node),
  qbExecuteQuery: vi.fn(),
}));

vi.mock("~/lib/db", () => ({
  baseDb: {
    $qb: {
      getExecutor: () => ({
        transformQuery: (n: unknown) => n,
        compileQuery: qbCompileQuery,
        executeQuery: qbExecuteQuery,
      }),
    },
    auditLog: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    groups: {
      findUnique: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("~/lib/services/auditLog", () => ({
  captureAuditEvent: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  getServerAuthSession: vi.fn(),
}));

vi.mock("~/lib/webhooks/event-emitters/groupEvents", () => ({
  emitScimGroupMemberAdded: vi.fn(),
}));

import { baseDb } from "~/lib/db";
import { emitScimGroupMemberAdded } from "~/lib/webhooks/event-emitters/groupEvents";
import { SYSTEM_PROJECT_ID } from "~/lib/scim/constants";
import { getServerAuthSession } from "~/server/auth";
import {
  listScimConflictsAction,
  reEmitScimMemberEventAction,
} from "./scimConflictLogActions";

function mockAdminSession(id = "admin1") {
  vi.mocked(getServerAuthSession).mockResolvedValue({
    user: { id, access: "ADMIN", name: "Admin User" },
  } as any);
}

function mockNonAdminSession(id = "user1") {
  vi.mocked(getServerAuthSession).mockResolvedValue({
    user: { id, access: "USER" },
  } as any);
}

function mockNoSession() {
  vi.mocked(getServerAuthSession).mockResolvedValue(null as any);
}

function makeAuditRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "audit-1",
    userId: null,
    userEmail: null,
    userName: null,
    action: "UPDATE",
    entityType: "Groups",
    entityId: "42",
    entityName: null,
    changes: null,
    metadata: { source: "scim" },
    timestamp: new Date("2026-06-01T12:00:00Z"),
    projectId: null,
    ...overrides,
  };
}

describe("scimConflictLogActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    qbCompileQuery.mockImplementation((node: unknown) => node);
    qbExecuteQuery.mockResolvedValue({ rows: [] });
    // Default tx behavior: invoke the callback with a fake tx client.
    vi.mocked(baseDb.$transaction).mockImplementation(async (cb: any) => {
      const txStub = {
        auditLog: {
          create: vi.fn(async ({ data }: any) => ({
            id: "new-audit-1",
            ...data,
            timestamp: new Date(),
          })),
        },
      };
      return cb(txStub);
    });
  });

  describe("listScimConflictsAction", () => {
    it("L1: rejects non-admin caller and does not issue the query", async () => {
      mockNonAdminSession();

      const result = await listScimConflictsAction({});

      expect(result).toEqual({ success: false, error: "Unauthorized" });
      expect(qbExecuteQuery).not.toHaveBeenCalled();
    });

    it("L2: rejects missing session and does not issue the query", async () => {
      mockNoSession();

      const result = await listScimConflictsAction({});

      expect(result).toEqual({ success: false, error: "Unauthorized" });
      expect(qbExecuteQuery).not.toHaveBeenCalled();
    });

    it("L3: admin session issues the query with the SCIM filter literal", async () => {
      mockAdminSession();
      qbExecuteQuery.mockResolvedValueOnce({ rows: [] } as any);

      await listScimConflictsAction({ startIndex: 0, count: 50 });

      expect(qbExecuteQuery).toHaveBeenCalledTimes(1);
      // The Prisma.sql template fragments are stored on the first arg.
      const call = qbCompileQuery.mock.calls[0][0] as any;
      // Prisma.sql arg is a Sql object: stringify by walking its values+strings.
      const rendered = JSON.stringify(call);
      expect(rendered).toContain("metadata->>'source' = 'scim'");
      expect(rendered).toContain("scimLinked");
      expect(rendered).toContain("scimResurrected");
      expect(rendered).toContain("scimSkippedMemberIds");
      expect(rendered).toContain("scimDisplayNameOverwrote");
      expect(rendered).toContain("scimConflict");
      expect(rendered).toContain("scimReEmittedBy");
      expect(rendered).toContain("ORDER BY");
      expect(rendered.toLowerCase()).toContain("timestamp");
    });

    it("L4: hasMore=true when 51 rows returned; items sliced to 50", async () => {
      mockAdminSession();
      const rows = Array.from({ length: 51 }, (_, i) =>
        makeAuditRow({ id: `audit-${i}` })
      );
      qbExecuteQuery.mockResolvedValueOnce({ rows } as any);

      const result = await listScimConflictsAction({ count: 50 });

      expect(result.success).toBe(true);
      expect(result.items).toHaveLength(50);
      expect(result.hasMore).toBe(true);
    });

    it("L5: default startIndex=0, count=50 when input is empty", async () => {
      mockAdminSession();
      qbExecuteQuery.mockResolvedValueOnce({ rows: [] } as any);

      const result = await listScimConflictsAction({});

      expect(result.success).toBe(true);
      expect(result.items).toEqual([]);
      expect(result.hasMore).toBe(false);
    });

    it("L6: respects cursor input — passes cursor.timestamp and cursor.id to query", async () => {
      mockAdminSession();
      qbExecuteQuery.mockResolvedValueOnce({ rows: [] } as any);

      await listScimConflictsAction({
        cursor: {
          timestamp: "2026-06-01T00:00:00Z",
          id: "audit-cursor-id",
        },
      });

      const call = qbCompileQuery.mock.calls[0][0] as any;
      const rendered = JSON.stringify(call);
      // The cursor must appear as a bound value, not interpolated text.
      expect(rendered).toContain("audit-cursor-id");
    });

    it("L7: query failure returns generic error and does NOT leak err.message", async () => {
      mockAdminSession();
      qbExecuteQuery.mockRejectedValueOnce(
        new Error('column "foo" does not exist')
      );

      const result = await listScimConflictsAction({});

      expect(result.success).toBe(false);
      expect(result.error).toBe("Failed to load conflict log");
      expect(result.error).not.toContain("column");
    });

    it("L8: list action does NOT write any audit row (read-only)", async () => {
      mockAdminSession();
      qbExecuteQuery.mockResolvedValueOnce({ rows: [] } as any);

      await listScimConflictsAction({});

      expect(baseDb.auditLog.create).not.toHaveBeenCalled();
    });
  });

  describe("reEmitScimMemberEventAction", () => {
    it("R1: rejects non-admin caller with no DB ops", async () => {
      mockNonAdminSession();

      const result = await reEmitScimMemberEventAction("audit-1");

      expect(result).toEqual({ success: false, error: "Unauthorized" });
      expect(baseDb.auditLog.findUnique).not.toHaveBeenCalled();
      expect(emitScimGroupMemberAdded).not.toHaveBeenCalled();
    });

    it("R2: returns 'Audit row not found' when findUnique returns null", async () => {
      mockAdminSession();
      vi.mocked(baseDb.auditLog.findUnique).mockResolvedValueOnce(null as any);

      const result = await reEmitScimMemberEventAction("missing-id");

      expect(result).toEqual({
        success: false,
        error: "Audit row not found",
      });
      expect(emitScimGroupMemberAdded).not.toHaveBeenCalled();
    });

    it("R3: returns 'No skipped members to re-emit' when metadata lacks scimSkippedMemberIds", async () => {
      mockAdminSession();
      vi.mocked(baseDb.auditLog.findUnique).mockResolvedValueOnce(
        makeAuditRow({
          metadata: { source: "scim", scimLinked: true },
        }) as any
      );

      const result = await reEmitScimMemberEventAction("audit-1");

      expect(result).toEqual({
        success: false,
        error: "No skipped members to re-emit",
      });
      expect(emitScimGroupMemberAdded).not.toHaveBeenCalled();
    });

    it("R4: emits only the now-valid subset and audits remaining skipped members", async () => {
      mockAdminSession("admin42");
      vi.mocked(baseDb.auditLog.findUnique).mockResolvedValueOnce(
        makeAuditRow({
          id: "audit-orig",
          entityType: "Groups",
          entityId: "42",
          metadata: {
            source: "scim",
            scimSkippedMemberIds: ["u1", "u2"],
          },
        }) as any
      );
      vi.mocked(baseDb.groups.findUnique).mockResolvedValueOnce({
        id: 42,
        name: "Engineering",
        externalId: "ext-1",
        scimDisplayName: "Engineering",
        isDeleted: false,
      } as any);
      vi.mocked(baseDb.user.findMany).mockResolvedValueOnce([
        { id: "u1" },
      ] as any);

      const result = await reEmitScimMemberEventAction("audit-orig");

      expect(result.success).toBe(true);
      expect(result.emittedMembers).toEqual(["u1"]);

      expect(emitScimGroupMemberAdded).toHaveBeenCalledTimes(1);
      const emitArgs = vi.mocked(emitScimGroupMemberAdded).mock.calls[0];
      expect(emitArgs[1]).toEqual(["u1"]);
      expect(emitArgs[3]).toMatchObject({
        projectId: SYSTEM_PROJECT_ID,
        actorUserId: "admin42",
      });
    });

    it("R5: emits all skipped members when all are now valid", async () => {
      mockAdminSession();
      vi.mocked(baseDb.auditLog.findUnique).mockResolvedValueOnce(
        makeAuditRow({
          metadata: {
            source: "scim",
            scimSkippedMemberIds: ["u1", "u2"],
          },
        }) as any
      );
      vi.mocked(baseDb.groups.findUnique).mockResolvedValueOnce({
        id: 42,
        name: "Engineering",
        externalId: "ext-1",
        scimDisplayName: "Engineering",
        isDeleted: false,
      } as any);
      vi.mocked(baseDb.user.findMany).mockResolvedValueOnce([
        { id: "u1" },
        { id: "u2" },
      ] as any);

      const result = await reEmitScimMemberEventAction("audit-orig");

      expect(result.success).toBe(true);
      expect(result.emittedMembers).toEqual(["u1", "u2"]);
      expect(emitScimGroupMemberAdded).toHaveBeenCalledTimes(1);
    });

    it("R6: emit failure inside tx rolls back the transaction", async () => {
      mockAdminSession();
      vi.mocked(baseDb.auditLog.findUnique).mockResolvedValueOnce(
        makeAuditRow({
          metadata: {
            source: "scim",
            scimSkippedMemberIds: ["u1"],
          },
        }) as any
      );
      vi.mocked(baseDb.groups.findUnique).mockResolvedValueOnce({
        id: 42,
        name: "Engineering",
        externalId: "ext-1",
        scimDisplayName: "Engineering",
        isDeleted: false,
      } as any);
      vi.mocked(baseDb.user.findMany).mockResolvedValueOnce([
        { id: "u1" },
      ] as any);
      vi.mocked(emitScimGroupMemberAdded).mockRejectedValueOnce(
        new Error("emit failed")
      );

      const result = await reEmitScimMemberEventAction("audit-orig");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Re-emit failed");
      // The tx callback throwing rolls back; no new audit row in the outer
      // mock (auditLog.create on the outer baseDb is never called).
      expect(baseDb.auditLog.create).not.toHaveBeenCalled();
    });

    it("R7: new audit row carries metadata.source 'scim' and discriminator fields", async () => {
      mockAdminSession("admin99");
      const txAuditCreate = vi.fn(async ({ data }: any) => ({
        id: "new-audit-1",
        ...data,
      }));
      vi.mocked(baseDb.$transaction).mockImplementation(async (cb: any) => {
        return cb({ auditLog: { create: txAuditCreate } });
      });

      vi.mocked(baseDb.auditLog.findUnique).mockResolvedValueOnce(
        makeAuditRow({
          id: "audit-orig",
          metadata: {
            source: "scim",
            scimSkippedMemberIds: ["u1"],
          },
        }) as any
      );
      vi.mocked(baseDb.groups.findUnique).mockResolvedValueOnce({
        id: 42,
        name: "Engineering",
        externalId: "ext-1",
        scimDisplayName: "Engineering",
        isDeleted: false,
      } as any);
      vi.mocked(baseDb.user.findMany).mockResolvedValueOnce([
        { id: "u1" },
      ] as any);

      await reEmitScimMemberEventAction("audit-orig");

      expect(txAuditCreate).toHaveBeenCalledTimes(1);
      const data = txAuditCreate.mock.calls[0][0].data;
      expect(data.metadata).toMatchObject({
        source: "scim",
        scimReEmittedBy: "admin99",
        referencedAuditLogId: "audit-orig",
      });
      expect(data.entityType).toBe("Groups");
      expect(data.entityId).toBe("42");
    });

    it("R8: target Group missing or tombstoned returns 'Group not found'", async () => {
      mockAdminSession();
      vi.mocked(baseDb.auditLog.findUnique).mockResolvedValueOnce(
        makeAuditRow({
          metadata: {
            source: "scim",
            scimSkippedMemberIds: ["u1"],
          },
        }) as any
      );
      vi.mocked(baseDb.groups.findUnique).mockResolvedValueOnce({
        id: 42,
        name: "Engineering",
        externalId: "ext-1",
        scimDisplayName: "Engineering",
        isDeleted: true,
      } as any);

      const result = await reEmitScimMemberEventAction("audit-orig");

      expect(result).toEqual({
        success: false,
        error: "Group not found",
      });
      expect(emitScimGroupMemberAdded).not.toHaveBeenCalled();
    });

    it("R9: rejects audit rows whose entityType is not 'Groups'", async () => {
      mockAdminSession();
      vi.mocked(baseDb.auditLog.findUnique).mockResolvedValueOnce(
        makeAuditRow({
          entityType: "User",
          metadata: {
            source: "scim",
            scimSkippedMemberIds: ["u1"],
          },
        }) as any
      );

      const result = await reEmitScimMemberEventAction("audit-orig");

      expect(result.success).toBe(false);
      expect(result.error).toBe("No skipped members to re-emit");
      expect(emitScimGroupMemberAdded).not.toHaveBeenCalled();
    });

    it("R10: returns newAuditLogId + emittedMembers on success", async () => {
      mockAdminSession("admin1");
      vi.mocked(baseDb.$transaction).mockImplementation(async (cb: any) => {
        return cb({
          auditLog: {
            create: vi.fn(async () => ({ id: "new-audit-42" })),
          },
        });
      });

      vi.mocked(baseDb.auditLog.findUnique).mockResolvedValueOnce(
        makeAuditRow({
          metadata: {
            source: "scim",
            scimSkippedMemberIds: ["u1"],
          },
        }) as any
      );
      vi.mocked(baseDb.groups.findUnique).mockResolvedValueOnce({
        id: 42,
        name: "Engineering",
        externalId: "ext-1",
        scimDisplayName: "Engineering",
        isDeleted: false,
      } as any);
      vi.mocked(baseDb.user.findMany).mockResolvedValueOnce([
        { id: "u1" },
      ] as any);

      const result = await reEmitScimMemberEventAction("audit-orig");

      expect(result).toEqual({
        success: true,
        newAuditLogId: "new-audit-42",
        emittedMembers: ["u1"],
      });
    });
  });
});
