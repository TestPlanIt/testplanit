import { afterEach, describe, expect, it, vi } from "vitest";

// ── Hooked baseDb client mock ────────────────────────────────────────────────
vi.mock("../lib/db", () => {
  // The transaction callback receives an opaque tx handle; the recompute
  // helpers that consume it (recomputeUserAccess / readScimFallbackDefault)
  // are themselves mocked below, so it needs no real shape.
  const tx = {};
  return {
    baseDb: {
      $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(tx)),
      // Both sweep paths fetch their id set at the top level (outside the
      // transaction) and then batch the recompute into BATCH_SIZE/tx chunks.
      groupAssignment: { findMany: vi.fn() },
      user: { findMany: vi.fn() },
    },
  };
});

// ── recomputeUserAccess + readScimFallbackDefault spies ──────────────────────
vi.mock("../lib/scim/services/recompute", () => ({
  recomputeUserAccess: vi.fn().mockResolvedValue(undefined),
  readScimFallbackDefault: vi.fn().mockResolvedValue("NONE"),
}));

// ── Audit context mock ───────────────────────────────────────────────────────
vi.mock("../lib/auditContext", () => ({
  runWithAuditContext: vi.fn((ctx: unknown, fn: () => unknown) => fn()),
  updateAuditContext: vi.fn(),
}));

// ── Multi-tenant mock ────────────────────────────────────────────────────────
vi.mock("../lib/multiTenantDb", () => ({
  validateMultiTenantJobData: vi.fn(),
  isMultiTenantMode: vi.fn(() => false),
  disconnectAllTenantClients: vi.fn(),
}));

// ── Tenant context mock ──────────────────────────────────────────────────────
vi.mock("../lib/tenantContext", () => ({
  withTenantContext: vi.fn((fn: unknown) => fn),
}));

// ── Valkey mock ──────────────────────────────────────────────────────────────
vi.mock("../lib/valkey", () => ({ default: null }));

// ── Queue names mock ─────────────────────────────────────────────────────────
vi.mock("../lib/queueNames", () => ({
  SCIM_ACCESS_RECOMPUTE_QUEUE_NAME: "scim-access-recompute",
}));

// ── BullMQ mock ──────────────────────────────────────────────────────────────
vi.mock("bullmq", () => ({
  Worker: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    close: vi.fn(),
  })),
  Queue: vi.fn(),
}));

// ── bullPrefix mock ──────────────────────────────────────────────────────────
vi.mock("../lib/bullPrefix", () => ({
  BULLMQ_PREFIX: "bull",
}));

import { processor } from "./scimAccessRecomputeWorker";
import { baseDb } from "../lib/db";
import { runWithAuditContext } from "../lib/auditContext";
import { validateMultiTenantJobData } from "../lib/multiTenantDb";
import { recomputeUserAccess } from "../lib/scim/services/recompute";

// Top-level baseDb.groupAssignment.findMany / baseDb.user.findMany are called
// outside the transaction — the groupId path fetches members, the sweep path
// fetches all group-mapped users — before either batches the recompute.
const dbGroupAssignment = (
  baseDb as unknown as {
    groupAssignment: { findMany: ReturnType<typeof vi.fn> };
  }
).groupAssignment;
const dbUser = (
  baseDb as unknown as {
    user: { findMany: ReturnType<typeof vi.fn> };
  }
).user;

afterEach(() => {
  vi.clearAllMocks();
});

function makeJob(
  overrides: Partial<{
    groupId: number;
    adminUserId: string;
    tenantId?: string;
  }> = {}
) {
  return {
    id: "job-1",
    data: {
      adminUserId: "admin-user-1",
      ...overrides,
    },
  } as any;
}

describe("scimAccessRecomputeWorker processor", () => {
  it("W1: calls validateMultiTenantJobData on entry", async () => {
    dbGroupAssignment.findMany.mockResolvedValue([]);

    await processor(makeJob({ groupId: 42 }));

    expect(validateMultiTenantJobData).toHaveBeenCalledTimes(1);
    expect(validateMultiTenantJobData).toHaveBeenCalledWith(
      expect.objectContaining({ adminUserId: "admin-user-1" })
    );
  });

  it("W2: job with groupId — recomputes each member of that group", async () => {
    const members = [{ userId: "user-a" }, { userId: "user-b" }];
    dbGroupAssignment.findMany.mockResolvedValue(members);

    await processor(makeJob({ groupId: 10 }));

    expect(dbGroupAssignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ groupId: 10 }),
      })
    );
    expect(recomputeUserAccess).toHaveBeenCalledTimes(2);
    expect(recomputeUserAccess).toHaveBeenCalledWith(
      expect.anything(),
      "user-a",
      "NONE"
    );
    expect(recomputeUserAccess).toHaveBeenCalledWith(
      expect.anything(),
      "user-b",
      "NONE"
    );
  });

  it("W3: job WITHOUT groupId — selects all accessSource=GROUP_MAPPING users and recomputes each", async () => {
    const users = [{ id: "user-x" }, { id: "user-y" }, { id: "user-z" }];
    dbUser.findMany.mockResolvedValue(users);

    await processor(makeJob({ adminUserId: "admin-1" }));

    expect(dbUser.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          accessSource: "GROUP_MAPPING",
          isDeleted: false,
        }),
      })
    );
    expect(recomputeUserAccess).toHaveBeenCalledTimes(3);
    expect(recomputeUserAccess).toHaveBeenCalledWith(
      expect.anything(),
      "user-x",
      "NONE"
    );
    expect(recomputeUserAccess).toHaveBeenCalledWith(
      expect.anything(),
      "user-y",
      "NONE"
    );
    expect(recomputeUserAccess).toHaveBeenCalledWith(
      expect.anything(),
      "user-z",
      "NONE"
    );
  });

  it("W6: fallback sweep batches a large directory into BATCH_SIZE-sized transactions instead of one unbounded tx", async () => {
    const users = Array.from({ length: 250 }, (_, i) => ({ id: `user-${i}` }));
    dbUser.findMany.mockResolvedValue(users);

    await processor(makeJob({ adminUserId: "admin-1" }));

    // 250 users / 100-per-batch = 3 transactions — not one sweep-wide tx.
    expect((baseDb as any).$transaction).toHaveBeenCalledTimes(3);
    expect(recomputeUserAccess).toHaveBeenCalledTimes(250);
  });

  it("W4: audit frame carries adminUserId, scimGroupId, and scimTokenId when groupId is present", async () => {
    dbGroupAssignment.findMany.mockResolvedValue([{ userId: "user-a" }]);

    await processor(makeJob({ groupId: 99, adminUserId: "admin-42" }));

    expect(runWithAuditContext).toHaveBeenCalledTimes(1);
    const ctxArg = (runWithAuditContext as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Record<string, unknown>;
    expect(ctxArg.userId).toBe("admin-42");
    expect(ctxArg.scimGroupId).toBe("99");
    expect(ctxArg.scimTokenId).toBe("worker:scim-access-recompute");
  });

  it("W5: uses the hooked lib/baseDb client, NOT getDbClientForJob", async () => {
    dbGroupAssignment.findMany.mockResolvedValue([{ userId: "user-b" }]);

    await processor(makeJob({ groupId: 5 }));

    // The mocked baseDb.$transaction was called — this proves the processor
    // used the module we mocked (../lib/baseDb), not an unmocked raw client.
    expect((baseDb as any).$transaction).toHaveBeenCalledTimes(1);
  });
});
