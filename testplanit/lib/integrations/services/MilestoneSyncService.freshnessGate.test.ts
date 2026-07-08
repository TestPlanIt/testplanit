import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Server-side freshness gate + per-entity Valkey lock for
 * `performMilestoneRefresh`. Mirrors `SyncService.freshnessGate.test.ts`'s
 * mocking conventions but targets the milestone-namespaced lock key
 * (`sync-lock:milestone:...`, distinct from `sync-lock:issue:...`).
 */

// ─── Mocks ────────────────────────────────────────────────────────────────
const mockMilestonesFindFirst = vi.fn();
const mockMilestonesFindUnique = vi.fn();
const mockMilestonesUpsert = vi.fn();
const mockIntegrationProjectFindFirst = vi.fn();

vi.mock("@/lib/rawDb", () => ({
  rawDb: {
    milestones: {
      findFirst: (...args: any[]) => mockMilestonesFindFirst(...args),
      findUnique: (...args: any[]) => mockMilestonesFindUnique(...args),
      upsert: (...args: any[]) => mockMilestonesUpsert(...args),
    },
    integrationProject: {
      findFirst: (...args: any[]) => mockIntegrationProjectFindFirst(...args),
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

// Valkey mock — simulates a real lock: the first SET NX wins, subsequent
// callers see the existing key and SET NX returns null (lock held).
const { mockValkeyStore, mockValkeySet, mockValkeyDel } = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    mockValkeyStore: store,
    mockValkeySet: vi.fn(
      async (key: string, _val: string, ..._opts: unknown[]) => {
        if (store.has(key)) return null;
        store.set(key, "1");
        return "OK";
      }
    ),
    mockValkeyDel: vi.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
  };
});

vi.mock("../../valkey", () => ({
  default: {
    set: (key: string, val: string, ...opts: unknown[]) =>
      mockValkeySet(key, val, ...opts),
    del: (key: string) => mockValkeyDel(key),
  },
}));

// ─── Imports under test ──────────────────────────────────────────────────
import { milestoneSyncService } from "./MilestoneSyncService";

const EXTERNAL_MILESTONE = {
  id: "10001",
  kind: "RELEASE" as const,
  name: "v1.0",
  description: "",
  startDate: undefined,
  endDate: undefined,
  state: "ACTIVE" as const,
  rawState: "unreleased",
  url: "https://example.atlassian.net/projects/TEST/versions/10001",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockValkeyStore.clear();
  mockMilestonesFindFirst.mockResolvedValue({
    id: 1,
    projectId: 100,
    milestoneTypesId: 5,
    lastSyncedAt: null,
  });
  mockMilestonesFindUnique.mockResolvedValue(null);
  mockMilestonesUpsert.mockResolvedValue({ id: 1 });
  mockIntegrationProjectFindFirst.mockResolvedValue({
    externalProjectKey: "TEST",
  });
  mockGetExternalMilestones.mockResolvedValue({
    items: [EXTERNAL_MILESTONE],
    hasMore: false,
  });
});

describe("performMilestoneRefresh — freshness gate", () => {
  it("manual trigger (minFreshnessSeconds=0) always fetches even if recently synced", async () => {
    mockMilestonesFindFirst.mockResolvedValueOnce({
      id: 1,
      projectId: 100,
      milestoneTypesId: 5,
      lastSyncedAt: new Date(Date.now() - 1000),
    });

    const result = await milestoneSyncService.performMilestoneRefresh(
      "user-1",
      1,
      "10001",
      { minFreshnessSeconds: 0 }
    );

    expect(result.success).toBe(true);
    expect(result.cached).toBeFalsy();
    expect(mockMilestonesUpsert).toHaveBeenCalledTimes(1);
  });

  it("page-load trigger (minFreshnessSeconds=300) skips upstream fetch when milestone is fresher than 5 min", async () => {
    mockMilestonesFindFirst.mockResolvedValueOnce({
      id: 1,
      lastSyncedAt: new Date(Date.now() - 60_000),
    });

    const result = await milestoneSyncService.performMilestoneRefresh(
      "user-1",
      1,
      "10001",
      { minFreshnessSeconds: 300 }
    );

    expect(result).toEqual({ success: true, cached: true });
    expect(mockMilestonesUpsert).not.toHaveBeenCalled();
    // Lock should NOT have been touched — the gate fires before the lock.
    expect(mockValkeySet).not.toHaveBeenCalled();
  });

  it("page-load trigger fetches when lastSyncedAt is older than the gate window", async () => {
    mockMilestonesFindFirst.mockResolvedValueOnce({
      id: 1,
      projectId: 100,
      milestoneTypesId: 5,
      lastSyncedAt: new Date(Date.now() - 10 * 60_000),
    });

    const result = await milestoneSyncService.performMilestoneRefresh(
      "user-1",
      1,
      "10001",
      { minFreshnessSeconds: 300 }
    );

    expect(result.success).toBe(true);
    expect(result.cached).toBeFalsy();
    expect(mockMilestonesUpsert).toHaveBeenCalledTimes(1);
  });

  it("never-synced milestone (lastSyncedAt=null) bypasses the gate even with a non-zero window", async () => {
    mockMilestonesFindFirst.mockResolvedValueOnce({
      id: 1,
      projectId: 100,
      milestoneTypesId: 5,
      lastSyncedAt: null,
    });
    const result = await milestoneSyncService.performMilestoneRefresh(
      "user-1",
      1,
      "10001",
      { minFreshnessSeconds: 300 }
    );
    expect(result.success).toBe(true);
    expect(result.cached).toBeFalsy();
    expect(mockMilestonesUpsert).toHaveBeenCalledTimes(1);
  });
});

describe("performMilestoneRefresh — project scoping", () => {
  it("scopes the milestone lookup by projectId when provided", async () => {
    const result = await milestoneSyncService.performMilestoneRefresh(
      "user-1",
      1,
      "10001",
      { minFreshnessSeconds: 0, projectId: 100 }
    );

    expect(result.success).toBe(true);
    expect(mockMilestonesFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          integrationId: 1,
          externalId: "10001",
          projectId: 100,
        }),
      })
    );
  });

  it("also scopes the freshness-gate lookup by projectId", async () => {
    mockMilestonesFindFirst.mockResolvedValueOnce({
      id: 1,
      lastSyncedAt: new Date(Date.now() - 60_000),
    });

    const result = await milestoneSyncService.performMilestoneRefresh(
      "user-1",
      1,
      "10001",
      { minFreshnessSeconds: 300, projectId: 100 }
    );

    expect(result).toEqual({ success: true, cached: true });
    expect(mockMilestonesFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ projectId: 100 }),
      })
    );
  });

  it("returns notFound (no upstream fetch, no write) when the externalId belongs to another project", async () => {
    // Simulates a project-admin of project A passing project B's externalId:
    // the projectId-scoped lookup finds no row.
    mockMilestonesFindFirst.mockResolvedValue(null);

    const result = await milestoneSyncService.performMilestoneRefresh(
      "user-1",
      1,
      "10001",
      { minFreshnessSeconds: 0, projectId: 999 }
    );

    expect(result.success).toBe(false);
    expect(result.notFound).toBe(true);
    expect(mockGetExternalMilestones).not.toHaveBeenCalled();
    expect(mockMilestonesUpsert).not.toHaveBeenCalled();
  });

  it("does not constrain the lookup when projectId is omitted (worker refresh path)", async () => {
    const result = await milestoneSyncService.performMilestoneRefresh(
      "user-1",
      1,
      "10001",
      { minFreshnessSeconds: 0 }
    );

    expect(result.success).toBe(true);
    const where = mockMilestonesFindFirst.mock.calls[0][0].where;
    expect(where).not.toHaveProperty("projectId");
  });
});

describe("performMilestoneRefresh — per-entity Valkey lock", () => {
  it("manual trigger acquires + releases the lock around a successful sync", async () => {
    await milestoneSyncService.performMilestoneRefresh("user-1", 1, "10001", {
      minFreshnessSeconds: 0,
    });
    expect(mockValkeySet).toHaveBeenCalledTimes(1);
    expect(mockValkeyDel).toHaveBeenCalledTimes(1);
    expect(mockValkeyStore.size).toBe(0);
  });

  it("returns locked:true when another sync is in flight for the same milestone", async () => {
    mockValkeyStore.set("sync-lock:milestone:1:10001", "1");

    const result = await milestoneSyncService.performMilestoneRefresh(
      "user-1",
      1,
      "10001",
      { minFreshnessSeconds: 0 }
    );

    expect(result).toEqual({ success: true, locked: true });
    expect(mockMilestonesUpsert).not.toHaveBeenCalled();
    expect(mockValkeyStore.has("sync-lock:milestone:1:10001")).toBe(true);
    expect(mockValkeyDel).not.toHaveBeenCalled();
  });

  it("uses a key scoped to integrationId + externalId in the milestone namespace (never sync-lock:issue:)", async () => {
    await milestoneSyncService.performMilestoneRefresh("user-1", 1, "10001", {
      minFreshnessSeconds: 0,
    });

    const lockKeys = mockValkeySet.mock.calls.map((c) => c[0]);
    expect(lockKeys).toEqual(["sync-lock:milestone:1:10001"]);
    expect(lockKeys.every((k) => !k.startsWith("sync-lock:issue:"))).toBe(true);
  });

  it("releases the lock even when the upstream sync throws", async () => {
    mockGetExternalMilestones.mockRejectedValueOnce(new Error("upstream 500"));
    const result = await milestoneSyncService.performMilestoneRefresh(
      "user-1",
      1,
      "10001",
      { minFreshnessSeconds: 0 }
    );
    expect(result.success).toBe(false);
    expect(mockValkeyDel).toHaveBeenCalledTimes(1);
    expect(mockValkeyStore.size).toBe(0);
  });
});
