import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Idempotent upsert on `[externalId, integrationId, projectId]` (MSYNC-03) —
 * a second upsert against the same key must UPDATE the existing row, never
 * create a duplicate, and must reflect the latest ExternalMilestone fields.
 * The identity is PER PROJECT: the same external artifact imported into a
 * different project creates an independent row.
 */

// ─── Mocks ────────────────────────────────────────────────────────────────
// In-memory "table" keyed by `${externalId}:${integrationId}:${projectId}`
// so upsert calls behave like a real unique-constrained upsert across calls
// within a single test.
const milestonesTable = new Map<string, any>();
let nextId = 1;

type MilestoneWhereKey = {
  externalId_integrationId_projectId: {
    externalId: string;
    integrationId: number;
    projectId: number;
  };
};

function tableKey(where: MilestoneWhereKey): string {
  const key = where.externalId_integrationId_projectId;
  return `${key.externalId}:${key.integrationId}:${key.projectId}`;
}

const mockMilestonesFindFirst = vi.fn();
const mockMilestonesFindUnique = vi.fn((...args: any[]) => {
  const { where } = args[0] as { where: MilestoneWhereKey };
  return Promise.resolve(milestonesTable.get(tableKey(where)) ?? null);
});
const mockMilestonesUpsert = vi.fn((...args: any[]) => {
  const { where, create, update } = args[0] as {
    where: MilestoneWhereKey;
    create: any;
    update: any;
  };
  const key = tableKey(where);
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
    const afterFirst = milestonesTable.get("5000:42:100");
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
    const afterSecond = milestonesTable.get("5000:42:100");
    expect(afterSecond.id).toBe(afterFirst.id);
    expect(afterSecond.isCompleted).toBe(true);
    expect(afterSecond.externalState).toBe("released");
  });

  it("upsert call uses externalId_integrationId_projectId as the where clause (per-project idempotent key)", async () => {
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
          externalId_integrationId_projectId: {
            externalId: "6000",
            integrationId: 7,
            projectId: 100,
          },
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

  it("REGRESSION: importing the same artifact into a SECOND project creates an independent row, leaving the first project's (deleted) row untouched", async () => {
    // Project A (100) already tracks artifact 9000 — but the user deleted
    // it (tombstone). The reported bug: importing 9000 into project B (200)
    // matched A's row via the old global [externalId, integrationId] key
    // and REVIVED it in project A instead of creating B's own row.
    milestonesTable.set("9000:13:100", {
      id: 77,
      projectId: 100,
      isDeleted: true,
      name: "Sprint 9",
    });
    nextId = 78;

    const ext = {
      id: "9000",
      kind: "RELEASE" as const,
      name: "Sprint 9",
      state: "ACTIVE" as const,
      rawState: "active",
    };
    mockGetExternalMilestones.mockResolvedValue({
      items: [ext],
      hasMore: false,
    });
    // performMilestoneImport provisions types via rawDb models the mock
    // doesn't implement — call the shell upsert directly, which is the
    // exact write the import path funnels through.
    const result = await (milestoneSyncService as any)._upsertMilestoneShell(
      (await import("@/lib/rawDb")).rawDb,
      13,
      200,
      5,
      "user-1",
      ext
    );

    // A NEW row for project B…
    expect(result.created).toBe(true);
    const projectBRow = milestonesTable.get("9000:13:200");
    expect(projectBRow).toBeTruthy();
    expect(projectBRow.projectId).toBe(200);
    expect(projectBRow.isDeleted).toBeUndefined(); // fresh create, no tombstone
    // …and project A's tombstoned row is completely untouched.
    const projectARow = milestonesTable.get("9000:13:100");
    expect(projectARow.id).toBe(77);
    expect(projectARow.isDeleted).toBe(true);
  });
});
