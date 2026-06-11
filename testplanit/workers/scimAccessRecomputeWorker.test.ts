import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Hooked prisma client mock ────────────────────────────────────────────────
// The worker MUST import from "../lib/prisma" (the $extends-hooked singleton),
// not from getPrismaClientForJob. Tests assert the hooked client is the one used.

const mockTx = {
  appConfig: { findUnique: vi.fn() },
  user: { findMany: vi.fn() },
  groupAssignment: { findMany: vi.fn() },
};

const mockPrisma = {
  $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(mockTx)),
};

vi.mock("../lib/prisma", () => ({
  prisma: mockPrisma,
}));

// ── recomputeUserAccess spy ──────────────────────────────────────────────────
const recomputeUserAccessMock = vi.fn().mockResolvedValue(undefined);
const readScimFallbackDefaultMock = vi.fn().mockResolvedValue("NONE");

vi.mock("../lib/scim/services/recompute", () => ({
  recomputeUserAccess: recomputeUserAccessMock,
  readScimFallbackDefault: readScimFallbackDefaultMock,
}));

// ── Audit context mock ───────────────────────────────────────────────────────
const runWithAuditContextMock = vi.fn((ctx: unknown, fn: () => unknown) => fn());
const updateAuditContextMock = vi.fn();

vi.mock("../lib/auditContext", () => ({
  runWithAuditContext: runWithAuditContextMock,
  updateAuditContext: updateAuditContextMock,
}));

// ── Multi-tenant mock ────────────────────────────────────────────────────────
const validateMultiTenantJobDataMock = vi.fn();

vi.mock("../lib/multiTenantPrisma", () => ({
  validateMultiTenantJobData: validateMultiTenantJobDataMock,
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

import { processor } from "./scimAccessRecomputeWorker";
import { prisma } from "../lib/prisma";
import { runWithAuditContext } from "../lib/auditContext";
import { validateMultiTenantJobData } from "../lib/multiTenantPrisma";

afterEach(() => {
  vi.clearAllMocks();
});

function makeJob(overrides: Partial<{ groupId: number; adminUserId: string; tenantId?: string }> = {}) {
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
    mockTx.groupAssignment.findMany.mockResolvedValue([]);
    await processor(makeJob({ groupId: 42 }));
    expect(validateMultiTenantJobDataMock).toHaveBeenCalledTimes(1);
    expect(validateMultiTenantJobDataMock).toHaveBeenCalledWith(
      expect.objectContaining({ adminUserId: "admin-user-1" })
    );
  });

  it("W2: job with groupId — recomputes each member of that group", async () => {
    const members = [{ userId: "user-a" }, { userId: "user-b" }];
    mockTx.groupAssignment.findMany.mockResolvedValue(members);

    await processor(makeJob({ groupId: 10 }));

    expect(mockTx.groupAssignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ groupId: 10 }) })
    );
    expect(recomputeUserAccessMock).toHaveBeenCalledTimes(2);
    expect(recomputeUserAccessMock).toHaveBeenCalledWith(mockTx, "user-a", "NONE");
    expect(recomputeUserAccessMock).toHaveBeenCalledWith(mockTx, "user-b", "NONE");
  });

  it("W3: job WITHOUT groupId — selects all accessSource=GROUP_MAPPING users and recomputes each", async () => {
    const users = [{ id: "user-x" }, { id: "user-y" }, { id: "user-z" }];
    mockTx.user.findMany.mockResolvedValue(users);

    await processor(makeJob({ adminUserId: "admin-1" }));

    expect(mockTx.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ accessSource: "GROUP_MAPPING", isDeleted: false }),
      })
    );
    expect(recomputeUserAccessMock).toHaveBeenCalledTimes(3);
    expect(recomputeUserAccessMock).toHaveBeenCalledWith(mockTx, "user-x", "NONE");
    expect(recomputeUserAccessMock).toHaveBeenCalledWith(mockTx, "user-y", "NONE");
    expect(recomputeUserAccessMock).toHaveBeenCalledWith(mockTx, "user-z", "NONE");
  });

  it("W4: audit frame carries adminUserId and scimGroupId when groupId is present", async () => {
    mockTx.groupAssignment.findMany.mockResolvedValue([{ userId: "user-a" }]);

    await processor(makeJob({ groupId: 99, adminUserId: "admin-42" }));

    expect(runWithAuditContextMock).toHaveBeenCalledTimes(1);
    const ctxArg = runWithAuditContextMock.mock.calls[0][0] as Record<string, unknown>;
    expect(ctxArg.userId).toBe("admin-42");
    expect(ctxArg.scimGroupId).toBe("99");
  });

  it("W5: uses the hooked lib/prisma client, NOT getPrismaClientForJob", async () => {
    mockTx.groupAssignment.findMany.mockResolvedValue([]);

    await processor(makeJob({ groupId: 5 }));

    // The hooked prisma.$transaction was called (not getPrismaClientForJob)
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    // prisma is the hooked singleton — it's the same object imported
    expect(prisma).toBe(mockPrisma);
  });
});
