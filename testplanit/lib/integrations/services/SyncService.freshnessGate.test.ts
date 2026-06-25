import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Server-side freshness gate + per-issue Valkey lock for performIssueRefresh.
 *
 * The hover-triggered prefetch used to short-circuit on the client at 3h —
 * now `minFreshnessSeconds` lives in SyncService and short-circuits the
 * upstream API call IFF `Issue.lastSyncedAt` is fresher than the caller's
 * tolerance. A per-issue Valkey lock additionally serializes concurrent
 * sync attempts: if a second caller arrives mid-sync it resolves with
 * `locked: true` rather than queueing or duplicating the API call.
 */

// ─── Mocks ────────────────────────────────────────────────────────────────
const mockIssueFindFirst = vi.fn();
const mockIssueFindUnique = vi.fn();
const mockUserFindUnique = vi.fn();
const mockIntegrationFindUnique = vi.fn();

vi.mock("@/lib/rawDb", () => ({
  rawDb: {
    issue: {
      findFirst: (...args: any[]) => mockIssueFindFirst(...args),
      findUnique: (...args: any[]) => mockIssueFindUnique(...args),
      // Used by updateExistingIssue. The freshness-gate tests never reach it
      // (sync is always cached/locked), but the lock test does — stub as no-op.
      update: vi.fn().mockResolvedValue({ id: 1 }),
    },
    user: {
      findUnique: (...args: any[]) => mockUserFindUnique(...args),
    },
    integration: {
      findUnique: (...args: any[]) => mockIntegrationFindUnique(...args),
    },
  },
}));

vi.mock("../cache/IssueCache", () => ({
  issueCache: { set: vi.fn(), setMetadata: vi.fn() },
}));

const mockSyncIssue = vi.fn();
vi.mock("../IntegrationManager", () => ({
  integrationManager: {
    getAdapter: vi.fn().mockResolvedValue({
      getCapabilities: () => ({ syncIssue: true }),
      syncIssue: (...args: any[]) => mockSyncIssue(...args),
    }),
  },
}));

vi.mock("~/services/issueSearch", () => ({
  syncIssueToElasticsearch: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../multiTenantDb", () => ({
  getCurrentTenantId: vi.fn(),
}));

vi.mock("../../queues", () => ({
  getSyncQueue: vi.fn().mockReturnValue(null),
}));

vi.mock("../../auditContextEnqueue", () => ({
  enqueueWithAuditContext: vi.fn(),
}));

// Valkey mock — simulates a real lock: the first SET NX wins, subsequent
// callers see the existing key and SET NX returns null (lock held).
// `vi.hoisted` so the refs survive vi.mock factory hoisting.
const { mockValkeyStore, mockValkeySet, mockValkeyDel } = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    mockValkeyStore: store,
    mockValkeySet: vi.fn(
      async (key: string, _val: string, ..._opts: unknown[]) => {
        if (store.has(key)) return null; // NX semantics
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
import { syncService } from "./SyncService";

// ─── Fixtures ────────────────────────────────────────────────────────────

const FRESH_ISSUE_DATA = {
  id: "JIRA-1",
  title: "Test issue",
  description: "",
  status: "Open",
  priority: "Medium",
  type: "Story",
  assignee: null,
  reporter: null,
  externalUrl: "https://example.atlassian.net/browse/JIRA-1",
  labels: [],
  customFields: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockValkeyStore.clear();
  mockUserFindUnique.mockResolvedValue({
    id: "user-1",
    role: { rolePermissions: [] },
  });
  mockIntegrationFindUnique.mockResolvedValue({
    id: 1,
    authType: "PERSONAL_ACCESS_TOKEN",
    credentials: { token: "x" },
    provider: "JIRA",
    userIntegrationAuths: [],
  });
  mockSyncIssue.mockResolvedValue(FRESH_ISSUE_DATA);
  // Default: stored issue exists for the gate query.
  mockIssueFindFirst.mockResolvedValue({
    id: 1,
    integrationId: 1,
    externalId: "JIRA-1",
    lastSyncedAt: null,
  });
  mockIssueFindUnique.mockResolvedValue({
    id: 1,
    integrationId: 1,
    externalId: "JIRA-1",
  });
});

describe("performIssueRefresh — freshness gate", () => {
  it("manual trigger (minFreshnessSeconds=0) always fetches even if recently synced", async () => {
    // Stored issue was synced 1s ago — well within any tolerance.
    mockIssueFindFirst.mockResolvedValueOnce({
      id: 1,
      lastSyncedAt: new Date(Date.now() - 1000),
    });

    const result = await syncService.performIssueRefresh(
      "user-1",
      1,
      "JIRA-1",
      { minFreshnessSeconds: 0 }
    );

    expect(result.success).toBe(true);
    expect(result.cached).toBeFalsy();
    expect(mockSyncIssue).toHaveBeenCalledTimes(1);
  });

  it("hover trigger (minFreshnessSeconds=300) skips upstream fetch when issue is fresher than 5 min", async () => {
    // Stored issue was synced 60 seconds ago.
    mockIssueFindFirst.mockResolvedValueOnce({
      id: 1,
      lastSyncedAt: new Date(Date.now() - 60_000),
    });

    const result = await syncService.performIssueRefresh(
      "user-1",
      1,
      "JIRA-1",
      { minFreshnessSeconds: 300 }
    );

    expect(result).toEqual({ success: true, cached: true });
    expect(mockSyncIssue).not.toHaveBeenCalled();
    // Lock should NOT have been touched — the gate fires before the lock.
    expect(mockValkeySet).not.toHaveBeenCalled();
  });

  it("hover trigger fetches when lastSyncedAt is older than the gate window", async () => {
    // Synced 10 minutes ago — outside the 5-minute window.
    mockIssueFindFirst.mockResolvedValueOnce({
      id: 1,
      lastSyncedAt: new Date(Date.now() - 10 * 60_000),
    });

    const result = await syncService.performIssueRefresh(
      "user-1",
      1,
      "JIRA-1",
      { minFreshnessSeconds: 300 }
    );

    expect(result.success).toBe(true);
    expect(result.cached).toBeFalsy();
    expect(mockSyncIssue).toHaveBeenCalledTimes(1);
  });

  it("webhook trigger (minFreshnessSeconds=15) coalesces a burst — second call within 15s is cached", async () => {
    // First call: never synced before, fetches normally.
    mockIssueFindFirst.mockResolvedValueOnce({
      id: 1,
      lastSyncedAt: null,
    });
    const first = await syncService.performIssueRefresh("user-1", 1, "JIRA-1", {
      minFreshnessSeconds: 15,
    });
    expect(first.success).toBe(true);
    expect(first.cached).toBeFalsy();
    expect(mockSyncIssue).toHaveBeenCalledTimes(1);

    // Second call ~1s later: lastSyncedAt is now ~now → cached.
    mockIssueFindFirst.mockResolvedValueOnce({
      id: 1,
      lastSyncedAt: new Date(Date.now() - 1000),
    });
    const second = await syncService.performIssueRefresh(
      "user-1",
      1,
      "JIRA-1",
      { minFreshnessSeconds: 15 }
    );
    expect(second).toEqual({ success: true, cached: true });
    // Still only ONE upstream API call total.
    expect(mockSyncIssue).toHaveBeenCalledTimes(1);
  });

  it("never-synced issue (lastSyncedAt=null) bypasses the gate even with a non-zero window", async () => {
    mockIssueFindFirst.mockResolvedValueOnce({ id: 1, lastSyncedAt: null });
    const result = await syncService.performIssueRefresh(
      "user-1",
      1,
      "JIRA-1",
      { minFreshnessSeconds: 300 }
    );
    expect(result.success).toBe(true);
    expect(result.cached).toBeFalsy();
    expect(mockSyncIssue).toHaveBeenCalledTimes(1);
  });
});

describe("performIssueRefresh — per-issue Valkey lock", () => {
  it("manual trigger acquires + releases the lock around a successful sync", async () => {
    mockIssueFindFirst.mockResolvedValueOnce({ id: 1, lastSyncedAt: null });
    await syncService.performIssueRefresh("user-1", 1, "JIRA-1", {
      minFreshnessSeconds: 0,
    });
    expect(mockValkeySet).toHaveBeenCalledTimes(1);
    expect(mockValkeyDel).toHaveBeenCalledTimes(1);
    expect(mockValkeyStore.size).toBe(0);
  });

  it("returns locked:true when another sync is in flight for the same issue", async () => {
    // Pre-acquire the lock to simulate an in-flight sync.
    mockValkeyStore.set("sync-lock:issue:1:JIRA-1", "1");

    const result = await syncService.performIssueRefresh(
      "user-1",
      1,
      "JIRA-1",
      { minFreshnessSeconds: 0 }
    );

    expect(result).toEqual({ success: true, locked: true });
    expect(mockSyncIssue).not.toHaveBeenCalled();
    // The pre-existing lock must still be held — releasing someone else's
    // lock would defeat the whole point.
    expect(mockValkeyStore.has("sync-lock:issue:1:JIRA-1")).toBe(true);
    expect(mockValkeyDel).not.toHaveBeenCalled();
  });

  it("releases the lock even when the upstream sync throws", async () => {
    mockSyncIssue.mockRejectedValueOnce(new Error("upstream 500"));
    const result = await syncService.performIssueRefresh(
      "user-1",
      1,
      "JIRA-1",
      { minFreshnessSeconds: 0 }
    );
    expect(result.success).toBe(false);
    // Lock released so the next call can proceed.
    expect(mockValkeyDel).toHaveBeenCalledTimes(1);
    expect(mockValkeyStore.size).toBe(0);
  });

  it("uses a key scoped to integrationId + externalId so two issues never block each other", async () => {
    mockIssueFindFirst.mockResolvedValue({ id: 1, lastSyncedAt: null });

    await syncService.performIssueRefresh("user-1", 1, "JIRA-1", {
      minFreshnessSeconds: 0,
    });
    await syncService.performIssueRefresh("user-1", 1, "JIRA-2", {
      minFreshnessSeconds: 0,
    });

    const lockKeys = mockValkeySet.mock.calls.map((c) => c[0]);
    expect(lockKeys).toEqual([
      "sync-lock:issue:1:JIRA-1",
      "sync-lock:issue:1:JIRA-2",
    ]);
  });
});
