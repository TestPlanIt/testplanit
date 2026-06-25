import { afterEach, describe, expect, it, vi } from "vitest";

// ── Hooked baseDb client mock ────────────────────────────────────────────────
vi.mock("../lib/db", () => {
  const tx = {
    appConfig: { findUnique: vi.fn() },
    user: { findMany: vi.fn() },
    groupAssignment: { findMany: vi.fn() },
  };
  return {
    baseDb: {
      $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(tx)),
      groupAssignment: { findMany: vi.fn() },
      __tx: tx,
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

interface TxLike {
  appConfig: { findUnique: ReturnType<typeof vi.fn> };
  user: { findMany: ReturnType<typeof vi.fn> };
  groupAssignment: { findMany: ReturnType<typeof vi.fn> };
}

const tx = (baseDb as unknown as { __tx: TxLike }).__tx;
// Top-level baseDb.groupAssignment.findMany is called outside the transaction
// for the groupId batch path.
const prismaGroupAssignment = (
  baseDb as unknown as {
    groupAssignment: { findMany: ReturnType<typeof vi.fn> };
  }
).groupAssignment;

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
    prismaGroupAssignment.findMany.mockResolvedValue([]);

    await processor(makeJob({ groupId: 42 }));

    expect(validateMultiTenantJobData).toHaveBeenCalledTimes(1);
    expect(validateMultiTenantJobData).toHaveBeenCalledWith(
      expect.objectContaining({ adminUserId: "admin-user-1" })
    );
  });

  it("W2: job with groupId — recomputes each member of that group", async () => {
    const members = [{ userId: "user-a" }, { userId: "user-b" }];
    prismaGroupAssignment.findMany.mockResolvedValue(members);

    await processor(makeJob({ groupId: 10 }));

    expect(prismaGroupAssignment.findMany).toHaveBeenCalledWith(
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
    tx.user.findMany.mockResolvedValue(users);

    await processor(makeJob({ adminUserId: "admin-1" }));

    expect(tx.user.findMany).toHaveBeenCalledWith(
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

  it("W4: audit frame carries adminUserId, scimGroupId, and scimTokenId when groupId is present", async () => {
    prismaGroupAssignment.findMany.mockResolvedValue([{ userId: "user-a" }]);

    await processor(makeJob({ groupId: 99, adminUserId: "admin-42" }));

    expect(runWithAuditContext).toHaveBeenCalledTimes(1);
    const ctxArg = (runWithAuditContext as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Record<string, unknown>;
    expect(ctxArg.userId).toBe("admin-42");
    expect(ctxArg.scimGroupId).toBe("99");
    expect(ctxArg.scimTokenId).toBe("worker:scim-access-recompute");
  });

  it("W5: uses the hooked lib/baseDb client, NOT getDbClientForJob", async () => {
    prismaGroupAssignment.findMany.mockResolvedValue([{ userId: "user-b" }]);

    await processor(makeJob({ groupId: 5 }));

    // The mocked baseDb.$transaction was called — this proves the processor
    // used the module we mocked (../lib/baseDb), not an unmocked raw client.
    expect((baseDb as any).$transaction).toHaveBeenCalledTimes(1);
  });
});
