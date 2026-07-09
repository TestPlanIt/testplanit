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
const mockMilestonesFindMany = vi.fn();
const mockMilestonesUpsert = vi.fn();
const mockIntegrationProjectFindMany = vi.fn();
const mockProjectIntegrationFindUnique = vi.fn();

vi.mock("@/lib/rawDb", () => ({
  rawDb: {
    milestones: {
      findFirst: (...args: any[]) => mockMilestonesFindFirst(...args),
      findUnique: (...args: any[]) => mockMilestonesFindUnique(...args),
      findMany: (...args: any[]) => mockMilestonesFindMany(...args),
      upsert: (...args: any[]) => mockMilestonesUpsert(...args),
    },
    integrationProject: {
      findMany: (...args: any[]) => mockIntegrationProjectFindMany(...args),
    },
    projectIntegration: {
      findUnique: (...args: any[]) => mockProjectIntegrationFindUnique(...args),
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
    exists: async (key: string) => (mockValkeyStore.has(key) ? 1 : 0),
  },
}));

// `MilestoneSyncService.ts` (18-04) statically imports `IMPORT_MAX_CAP` +
// `syncService` from `./SyncService` for membership reconciliation delegation
// (D-12) — mocked here purely to avoid pulling in `SyncService.ts`'s full
// import chain (notably `IssueCache`, which needs a real Valkey connection
// this suite's minimal `set`/`del`-only mock above doesn't provide). This
// suite's adapter mock never declares `getMilestoneIssues`, so
// `_reconcileMembership` is never invoked — these are clean-skip stubs.
vi.mock("./SyncService", () => ({
  syncService: { upsertIssueFromExternal: vi.fn() },
  IMPORT_MAX_CAP: 1000,
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
    isDeleted: false,
  });
  mockMilestonesFindUnique.mockResolvedValue(null);
  mockMilestonesUpsert.mockResolvedValue({ id: 1 });
  mockIntegrationProjectFindMany.mockResolvedValue([
    { externalProjectKey: "TEST" },
  ]);
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

describe("performMilestoneRefresh — tombstone semantics (soft-deleted synced milestone)", () => {
  it("early-returns success with NO adapter fetch and no write when the local row is soft-deleted", async () => {
    mockMilestonesFindFirst.mockResolvedValueOnce({
      id: 1,
      projectId: 100,
      milestoneTypesId: 5,
      lastSyncedAt: null,
      isDeleted: true,
    });

    const result = await milestoneSyncService.performMilestoneRefresh(
      "user-1",
      1,
      "10001",
      { minFreshnessSeconds: 0 }
    );

    expect(result).toEqual({ success: true });
    expect(mockGetExternalMilestones).not.toHaveBeenCalled();
    expect(mockMilestonesUpsert).not.toHaveBeenCalled();
    expect(mockIntegrationProjectFindMany).not.toHaveBeenCalled();
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

describe("performProjectMilestoneSync — project-pass freshness marker", () => {
  beforeEach(() => {
    mockProjectIntegrationFindUnique.mockResolvedValue({
      config: {
        milestoneSync: { enabled: true, kinds: ["RELEASE"], autoTrack: false },
      },
    });
    // No linked milestones — isolates the marker behavior around the
    // auto-track kind fetch, which is the ungated upstream cost.
    mockMilestonesFindMany.mockResolvedValue([]);
  });

  it("a passive pass runs once, then short-circuits inside the window with zero upstream fetches", async () => {
    const first = await milestoneSyncService.performProjectMilestoneSync(
      "user-1",
      4,
      100,
      { minFreshnessSeconds: 300 }
    );
    expect(first.success).toBe(true);
    expect(first.cached).toBeUndefined();
    expect(mockGetExternalMilestones).toHaveBeenCalledTimes(1);

    const second = await milestoneSyncService.performProjectMilestoneSync(
      "user-1",
      4,
      100,
      { minFreshnessSeconds: 300 }
    );
    expect(second).toEqual({
      success: true,
      autoImported: 0,
      refreshed: 0,
      errors: [],
      cached: true,
    });
    // Still exactly one upstream fetch — the marker made the second pass a
    // true no-op.
    expect(mockGetExternalMilestones).toHaveBeenCalledTimes(1);
  });

  it("a manual pass (minFreshnessSeconds=0) bypasses the marker", async () => {
    await milestoneSyncService.performProjectMilestoneSync("user-1", 4, 100, {
      minFreshnessSeconds: 300,
    });
    expect(mockGetExternalMilestones).toHaveBeenCalledTimes(1);

    const manual = await milestoneSyncService.performProjectMilestoneSync(
      "user-1",
      4,
      100,
      { minFreshnessSeconds: 0 }
    );
    expect(manual.success).toBe(true);
    expect(manual.cached).toBeUndefined();
    expect(mockGetExternalMilestones).toHaveBeenCalledTimes(2);
  });

  it("the marker is scoped per integration+project", async () => {
    await milestoneSyncService.performProjectMilestoneSync("user-1", 4, 100, {
      minFreshnessSeconds: 300,
    });
    const otherProject =
      await milestoneSyncService.performProjectMilestoneSync("user-1", 4, 200, {
        minFreshnessSeconds: 300,
      });
    expect(otherProject.cached).toBeUndefined();
    expect(mockGetExternalMilestones).toHaveBeenCalledTimes(2);
  });
});
