import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `MilestoneSyncService.convertMilestoneToLocal` (HOOK-02, 19-03).
 *
 * Converts a synced milestone to a fully local one: detach + THREE-WAY
 * externalState + bulk SYNCED->MANUAL MilestoneIssue flip, all in ONE
 * transaction, followed post-commit by a reason-tagged audit event and a
 * membership-aware wake-up publish. See 19-RESEARCH.md Pattern 3, Pitfall 3
 * (detachedAt marker — why integrationId must stay non-null), Pitfall 5
 * (MilestoneIssue.source flip propagation), 19-PATTERNS.md (raw-db-bypass
 * idiom mirroring `_upsertMilestoneShell`).
 */

// ─── Mocks ────────────────────────────────────────────────────────────────
const mockMilestonesFindUnique = vi.fn((..._args: any[]): Promise<any> =>
  Promise.resolve(undefined)
);
const mockTxMilestonesUpdate = vi.fn();
const mockTxMilestoneIssueUpdateMany = vi.fn();
const mockTransaction = vi.fn((..._args: any[]) =>
  (_args[0] as (tx: any) => Promise<any>)({
    milestones: { update: mockTxMilestonesUpdate },
    milestoneIssue: { updateMany: mockTxMilestoneIssueUpdateMany },
  })
);

vi.mock("@/lib/rawDb", () => ({
  rawDb: {
    milestones: {
      findUnique: (...args: any[]) => mockMilestonesFindUnique(...args),
    },
    $transaction: (...args: any[]) => mockTransaction(...args),
  },
}));

const mockCaptureAuditEvent = vi.fn((..._args: any[]) =>
  Promise.resolve(undefined)
);
vi.mock("~/lib/services/auditLog", () => ({
  captureAuditEvent: (...args: any[]) => mockCaptureAuditEvent(...args),
}));

const mockPublishMilestoneWakeUp = vi.fn();
vi.mock("~/lib/live/publish", () => ({
  publishMilestoneWakeUp: (...args: any[]) =>
    mockPublishMilestoneWakeUp(...args),
}));

vi.mock("../../valkey", () => ({ default: null }));

vi.mock("./SyncService", () => ({
  syncService: { upsertIssueFromExternal: vi.fn() },
  IMPORT_MAX_CAP: 1000,
}));

import { milestoneSyncService } from "./MilestoneSyncService";

beforeEach(() => {
  vi.clearAllMocks();
  mockTransaction.mockImplementation(async (fn: any) =>
    fn({
      milestones: { update: mockTxMilestonesUpdate },
      milestoneIssue: { updateMany: mockTxMilestoneIssueUpdateMany },
    })
  );
  mockMilestonesFindUnique.mockResolvedValue({
    id: 42,
    projectId: 100,
    detachedAt: null,
  });
  mockCaptureAuditEvent.mockResolvedValue(undefined);
});

describe("MilestoneSyncService.convertMilestoneToLocal", () => {
  it("sets detachedAt to the current time and keeps integrationId non-null (Pitfall 3 — never nulls integrationId)", async () => {
    const before = Date.now();
    const result = await milestoneSyncService.convertMilestoneToLocal(
      {
        milestones: { findUnique: mockMilestonesFindUnique },
        $transaction: mockTransaction,
      } as any,
      42,
      "deleted"
    );
    const after = Date.now();

    expect(result.success).toBe(true);
    expect(mockTxMilestonesUpdate).toHaveBeenCalledTimes(1);
    const call = mockTxMilestonesUpdate.mock.calls[0][0];
    expect(call.where).toEqual({ id: 42 });
    expect(call.data.detachedAt).toBeInstanceOf(Date);
    expect(call.data.detachedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(call.data.detachedAt.getTime()).toBeLessThanOrEqual(after);
    // integrationId is DELIBERATELY never mutated by this method.
    expect(call.data).not.toHaveProperty("integrationId");
  });

  it("does NOT touch @@unique([externalId, integrationId]) — externalId stays set for re-link detection (D-07)", async () => {
    await milestoneSyncService.convertMilestoneToLocal(
      {
        milestones: { findUnique: mockMilestonesFindUnique },
        $transaction: mockTransaction,
      } as any,
      42,
      "deleted"
    );

    const call = mockTxMilestonesUpdate.mock.calls[0][0];
    expect(call.data).not.toHaveProperty("externalId");
    expect(call.data).not.toHaveProperty("integrationId");
  });

  it("flips all SYNCED MilestoneIssue links for the milestone to MANUAL in one transaction with the detachedAt write", async () => {
    await milestoneSyncService.convertMilestoneToLocal(
      {
        milestones: { findUnique: mockMilestonesFindUnique },
        $transaction: mockTransaction,
      } as any,
      42,
      "deleted"
    );

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockTxMilestoneIssueUpdateMany).toHaveBeenCalledWith({
      where: { milestoneId: 42, source: "SYNCED" },
      data: { source: "MANUAL" },
    });
    // Both writes happened inside the SAME $transaction callback invocation.
    expect(mockTxMilestonesUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      mockTxMilestoneIssueUpdateMany.mock.invocationCallOrder[0]
    );
  });

  it("is idempotent — calling convertMilestoneToLocal on an already-detached milestone is a no-op success", async () => {
    mockMilestonesFindUnique.mockResolvedValue({
      id: 42,
      projectId: 100,
      detachedAt: new Date("2026-07-01T00:00:00.000Z"),
    });

    const result = await milestoneSyncService.convertMilestoneToLocal(
      {
        milestones: { findUnique: mockMilestonesFindUnique },
        $transaction: mockTransaction,
      } as any,
      42,
      "deleted"
    );

    expect(result).toEqual({ success: true, alreadyDetached: true });
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockCaptureAuditEvent).not.toHaveBeenCalled();
    expect(mockPublishMilestoneWakeUp).not.toHaveBeenCalled();
  });

  it("writes externalState='deleted' for the upstream-delete conversion reason", async () => {
    await milestoneSyncService.convertMilestoneToLocal(
      {
        milestones: { findUnique: mockMilestonesFindUnique },
        $transaction: mockTransaction,
      } as any,
      42,
      "deleted"
    );

    const call = mockTxMilestonesUpdate.mock.calls[0][0];
    expect(call.data.externalState).toBe("deleted");
    expect(call.data).not.toHaveProperty("mergedToExternalId");
  });

  it("writes externalState='merged' for the upstream-merge conversion reason and records mergedToExternalId", async () => {
    await milestoneSyncService.convertMilestoneToLocal(
      {
        milestones: { findUnique: mockMilestonesFindUnique },
        $transaction: mockTransaction,
      } as any,
      42,
      "merged",
      "ext-9999"
    );

    const call = mockTxMilestonesUpdate.mock.calls[0][0];
    expect(call.data.externalState).toBe("merged");
    expect(call.data.mergedToExternalId).toBe("ext-9999");
  });

  it("writes externalState='manual_unlink' for the admin-initiated unlink conversion reason (HOOK-03 caller)", async () => {
    await milestoneSyncService.convertMilestoneToLocal(
      {
        milestones: { findUnique: mockMilestonesFindUnique },
        $transaction: mockTransaction,
      } as any,
      42,
      "manual_unlink"
    );

    const call = mockTxMilestonesUpdate.mock.calls[0][0];
    // manual_unlink must NEVER collapse into "deleted" — Plan 05's badge
    // guard depends on this exact three-way distinction (D-11).
    expect(call.data.externalState).toBe("manual_unlink");
    expect(call.data.externalState).not.toBe("deleted");
  });

  it("emits a post-commit audit event with metadata.reason after the transaction commits", async () => {
    const callOrder: string[] = [];
    mockTransaction.mockImplementationOnce(async (fn: any) => {
      const result = await fn({
        milestones: { update: mockTxMilestonesUpdate },
        milestoneIssue: { updateMany: mockTxMilestoneIssueUpdateMany },
      });
      callOrder.push("transaction-committed");
      return result;
    });
    mockCaptureAuditEvent.mockImplementationOnce(async () => {
      callOrder.push("audit-emitted");
    });

    await milestoneSyncService.convertMilestoneToLocal(
      {
        milestones: { findUnique: mockMilestonesFindUnique },
        $transaction: mockTransaction,
      } as any,
      42,
      "merged",
      "ext-777"
    );

    expect(callOrder).toEqual(["transaction-committed", "audit-emitted"]);
    expect(mockCaptureAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "UPDATE",
        entityType: "Milestones",
        entityId: "42",
        projectId: 100,
        metadata: expect.objectContaining({
          reason: "merged",
          mergedToExternalId: "ext-777",
        }),
      })
    );
  });

  it("writes via the raw db client (rawDb/defaultDb), never the enhanced/policy-governed client — mirrors _upsertMilestoneShell's documented bypass contract", async () => {
    // The service method takes `db` as an explicit parameter (same contract
    // as every other raw-db write path in this file, e.g.
    // `_upsertMilestoneShell`) — callers (webhook apply service, unlink
    // route) pass the raw client, never the enhanced/policy client, because
    // the enhanced client's `@deny('update', integrationId != null &&
    // detachedAt == null)` would reject this exact write.
    const rawDbLike = {
      milestones: { findUnique: mockMilestonesFindUnique },
      $transaction: mockTransaction,
    };

    const result = await milestoneSyncService.convertMilestoneToLocal(
      rawDbLike as any,
      42,
      "deleted"
    );

    expect(result.success).toBe(true);
    expect(mockMilestonesFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 42 } })
    );
  });

  it("a converted (detached) milestone is eligible for the completion worker to process again — integrationId != null alone no longer means 'skip'", async () => {
    // This behavior lives in workers/forecastWorker.ts's auto-complete
    // query (Task 3), not in convertMilestoneToLocal itself. Assert the
    // documented contract here: convertMilestoneToLocal never touches
    // isCompleted/automaticCompletion, leaving the worker free to pick the
    // row up once detachedAt is set.
    await milestoneSyncService.convertMilestoneToLocal(
      {
        milestones: { findUnique: mockMilestonesFindUnique },
        $transaction: mockTransaction,
      } as any,
      42,
      "deleted"
    );

    const call = mockTxMilestonesUpdate.mock.calls[0][0];
    expect(call.data).not.toHaveProperty("isCompleted");
    expect(call.data).not.toHaveProperty("automaticCompletion");
  });

  it("publishes a milestone wake-up event (thin payload, deferred via setImmediate, post-commit) so live subscribers refetch", async () => {
    await milestoneSyncService.convertMilestoneToLocal(
      {
        milestones: { findUnique: mockMilestonesFindUnique },
        $transaction: mockTransaction,
      } as any,
      42,
      "deleted"
    );

    expect(mockPublishMilestoneWakeUp).toHaveBeenCalledWith({
      event: "milestone.converted",
      milestoneId: 42,
      projectId: 100,
    });
    // Pitfall 5: the bulk SYNCED->MANUAL flip must also invalidate the
    // member table via a membership-aware wake-up.
    expect(mockPublishMilestoneWakeUp).toHaveBeenCalledWith({
      event: "milestone.membership_changed",
      milestoneId: 42,
      projectId: 100,
    });
  });

  it("re-importing a detached milestone through the picker clears detachedAt and re-establishes tracker-owned field locks", async () => {
    // This behavior lives in `_upsertMilestoneShell`'s update branch (Task
    // 2), exercised here via `performMilestoneImport` (the picker's entry
    // point) against a previously-converted (detached) row — the paired
    // contract to convertMilestoneToLocal: only an explicit re-import
    // clears detachedAt, never an automatic refresh pass.
    const mockUpsert = vi.fn(async (args: any) => ({
      id: 42,
      detachedAt: null,
      ...args.update,
    }));
    const mockFindUniqueForShell = vi.fn().mockResolvedValue({ id: 42 });
    const mockAssignmentUpsert = vi.fn().mockResolvedValue({});
    const mockIntegrationProjectFindMany = vi
      .fn()
      .mockResolvedValue([{ externalProjectKey: "TEST" }]);
    const mockGetExternalMilestones = vi.fn().mockResolvedValue({
      items: [
        {
          id: "5000",
          kind: "RELEASE",
          name: "v1.0 (re-imported)",
          state: "ACTIVE",
          rawState: "unreleased",
        },
      ],
      hasMore: false,
    });

    vi.doMock("../IntegrationManager", () => ({
      integrationManager: {
        getAdapter: vi.fn().mockResolvedValue({
          getCapabilities: () => ({
            milestones: { kinds: ["RELEASE"], webhooks: false },
          }),
          getExternalMilestones: mockGetExternalMilestones,
        }),
      },
    }));

    vi.resetModules();
    const { milestoneSyncService: freshService } =
      await import("./MilestoneSyncService");

    const dbLike = {
      milestones: {
        findUnique: mockFindUniqueForShell,
        upsert: mockUpsert,
      },
      milestoneTypes: {
        upsert: vi
          .fn()
          .mockResolvedValueOnce({ id: 1 })
          .mockResolvedValueOnce({ id: 2 }),
      },
      milestoneTypesAssignment: { upsert: mockAssignmentUpsert },
      integrationProject: { findMany: mockIntegrationProjectFindMany },
    };

    await freshService.performMilestoneImport(
      "user-1",
      42,
      100,
      { externalIds: ["5000"], kinds: ["RELEASE"] },
      "user-1",
      { dbClient: dbLike as any }
    );

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          isDeleted: false,
          detachedAt: null,
        }),
      })
    );
  });
});
