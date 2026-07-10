import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Idempotent upsert on `[externalId, integrationId]` (MSYNC-03) — a second
 * upsert against the same key must UPDATE the existing row, never create a
 * duplicate, and must reflect the latest ExternalMilestone fields.
 */

// ─── Mocks ────────────────────────────────────────────────────────────────
// In-memory "table" keyed by `${externalId}:${integrationId}` so upsert
// calls behave like a real unique-constrained upsert across calls within a
// single test.
const milestonesTable = new Map<string, any>();
let nextId = 1;

const mockMilestonesFindFirst = vi.fn();
const mockMilestonesFindUnique = vi.fn((...args: any[]) => {
  const { where } = args[0] as {
    where: {
      externalId_integrationId: { externalId: string; integrationId: number };
    };
  };
  const key = `${where.externalId_integrationId.externalId}:${where.externalId_integrationId.integrationId}`;
  return Promise.resolve(milestonesTable.get(key) ?? null);
});
const mockMilestonesUpsert = vi.fn((...args: any[]) => {
  const { where, create, update } = args[0] as {
    where: {
      externalId_integrationId: { externalId: string; integrationId: number };
    };
    create: any;
    update: any;
  };
  const key = `${where.externalId_integrationId.externalId}:${where.externalId_integrationId.integrationId}`;
  const existing = milestonesTable.get(key);
  if (existing) {
    const updated = { ...existing, ...update };
    milestonesTable.set(key, updated);
    return Promise.resolve(updated);
  }
  const created = { id: nextId++, ...create };
  milestonesTable.set(key, created);
  return Promise.resolve(created);
});
const mockIntegrationProjectFindMany = vi.fn();

vi.mock("@/lib/rawDb", () => ({
  rawDb: {
    milestones: {
      findFirst: (...args: any[]) => mockMilestonesFindFirst(...args),
      findUnique: (...args: any[]) => mockMilestonesFindUnique(...args),
      upsert: (...args: any[]) => mockMilestonesUpsert(...args),
    },
    integrationProject: {
      findMany: (...args: any[]) => mockIntegrationProjectFindMany(...args),
    },
  },
}));

const mockGetExternalMilestones = vi.fn();
vi.mock("../IntegrationManager", () => ({
  integrationManager: {
    getAdapter: vi.fn().mockResolvedValue({
      getCapabilities: () => ({
        milestones: { kinds: ["RELEASE"], webhooks: false },
      }),
      getExternalMilestones: (...args: any[]) =>
        mockGetExternalMilestones(...args),
    }),
  },
}));

vi.mock("../../valkey", () => ({ default: null }));

import { milestoneSyncService } from "./MilestoneSyncService";

beforeEach(() => {
  vi.clearAllMocks();
  milestonesTable.clear();
  nextId = 1;
  mockMilestonesFindFirst.mockResolvedValue({
    id: 1,
    projectId: 100,
    milestoneTypesId: 5,
    lastSyncedAt: null,
    isDeleted: false,
  });
  mockIntegrationProjectFindMany.mockResolvedValue([
    { externalProjectKey: "TEST" },
  ]);
});

describe("Milestone upsert idempotency (MSYNC-03)", () => {
  it("creates one row on first sync, updates in place on second sync (no duplicate)", async () => {
    mockGetExternalMilestones.mockResolvedValueOnce({
      items: [
        {
          id: "5000",
          kind: "RELEASE",
          name: "v1.0",
          state: "ACTIVE",
          rawState: "unreleased",
        },
      ],
      hasMore: false,
    });

    const first = await milestoneSyncService.performMilestoneRefresh(
      "user-1",
      42,
      "5000",
      { minFreshnessSeconds: 0 }
    );
    expect(first.success).toBe(true);
    expect(milestonesTable.size).toBe(1);
    const afterFirst = milestonesTable.get("5000:42");
    expect(afterFirst.name).toBe("v1.0");
    expect(afterFirst.isCompleted).toBe(false);

    // Re-run with an updated upstream state (now released).
    mockGetExternalMilestones.mockResolvedValueOnce({
      items: [
        {
          id: "5000",
          kind: "RELEASE",
          name: "v1.0",
          state: "CLOSED",
          rawState: "released",
        },
      ],
      hasMore: false,
    });

    const second = await milestoneSyncService.performMilestoneRefresh(
      "user-1",
      42,
      "5000",
      { minFreshnessSeconds: 0 }
    );
    expect(second.success).toBe(true);

    // Still exactly one row — the second call updated in place.
    expect(milestonesTable.size).toBe(1);
    const afterSecond = milestonesTable.get("5000:42");
    expect(afterSecond.id).toBe(afterFirst.id);
    expect(afterSecond.isCompleted).toBe(true);
    expect(afterSecond.externalState).toBe("released");
  });

  it("upsert call uses externalId_integrationId as the where clause (idempotent key)", async () => {
    mockGetExternalMilestones.mockResolvedValue({
      items: [
        {
          id: "6000",
          kind: "RELEASE",
          name: "v2.0",
          state: "FUTURE",
          rawState: "unreleased",
        },
      ],
      hasMore: false,
    });

    await milestoneSyncService.performMilestoneRefresh("user-1", 7, "6000", {
      minFreshnessSeconds: 0,
    });

    expect(mockMilestonesUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          externalId_integrationId: { externalId: "6000", integrationId: 7 },
        },
      })
    );
  });

  it("does not overwrite projectId/milestoneTypesId/createdBy on update (create-only fields)", async () => {
    mockGetExternalMilestones.mockResolvedValueOnce({
      items: [
        {
          id: "7000",
          kind: "RELEASE",
          name: "v3.0",
          state: "ACTIVE",
          rawState: "unreleased",
        },
      ],
      hasMore: false,
    });
    await milestoneSyncService.performMilestoneRefresh("user-1", 9, "7000", {
      minFreshnessSeconds: 0,
    });

    const firstCall = mockMilestonesUpsert.mock.calls[0][0];
    expect(firstCall.create.projectId).toBe(100);
    expect(firstCall.create.milestoneTypesId).toBe(5);
    expect(firstCall.create.createdBy).toBe("user-1");

    mockGetExternalMilestones.mockResolvedValueOnce({
      items: [
        {
          id: "7000",
          kind: "RELEASE",
          name: "v3.0 renamed",
          state: "ACTIVE",
          rawState: "unreleased",
        },
      ],
      hasMore: false,
    });
    await milestoneSyncService.performMilestoneRefresh("user-1", 9, "7000", {
      minFreshnessSeconds: 0,
    });

    const secondCall = mockMilestonesUpsert.mock.calls[1][0];
    expect(secondCall.update.projectId).toBeUndefined();
    expect(secondCall.update.milestoneTypesId).toBeUndefined();
    expect(secondCall.update.createdBy).toBeUndefined();
    expect(secondCall.update.name).toBe("v3.0 renamed");
  });

  it("update payload includes isDeleted: false — an explicit re-import (refresh path exercises the same upsert) resurrects a tombstoned row", async () => {
    mockGetExternalMilestones.mockResolvedValueOnce({
      items: [
        {
          id: "8000",
          kind: "RELEASE",
          name: "v4.0",
          state: "ACTIVE",
          rawState: "unreleased",
        },
      ],
      hasMore: false,
    });

    await milestoneSyncService.performMilestoneRefresh("user-1", 11, "8000", {
      minFreshnessSeconds: 0,
    });

    const call = mockMilestonesUpsert.mock.calls[0][0];
    expect(call.update.isDeleted).toBe(false);
  });
});
