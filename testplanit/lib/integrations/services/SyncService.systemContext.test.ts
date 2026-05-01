import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `performIssueRefreshSystem` — server-context issue sync used by inbound
 * webhook handlers and any other path that has no user session.
 *
 * Differences from the user-context `performIssueRefresh` exercised here:
 *   • No `userId` parameter, no `prisma.user.findUnique` lookup.
 *   • OAUTH2 integrations are rejected (user-tied tokens).
 *   • Auth check collapses to "Integration.credentials present?".
 *
 * Same freshness gate + per-issue Valkey lock as the user path — those are
 * already covered in `SyncService.freshnessGate.test.ts`. This file's
 * focus is the system-context auth + adapter wiring.
 */

// ─── Mocks ────────────────────────────────────────────────────────────────
const mockIssueFindFirst = vi.fn();
const mockIntegrationFindUnique = vi.fn();
const mockUserFindUnique = vi.fn();

vi.mock("@/lib/prismaBase", () => ({
  prisma: {
    issue: {
      findFirst: (...args: any[]) => mockIssueFindFirst(...args),
      update: vi.fn().mockResolvedValue({ id: 1 }),
    },
    user: {
      // `_performIssueRefreshInnerSystem` MUST NOT call this — assertion
      // in tests below verifies it stayed at zero invocations.
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

vi.mock("../../multiTenantPrisma", () => ({
  getCurrentTenantId: vi.fn(),
}));

vi.mock("../../queues", () => ({
  getSyncQueue: vi.fn().mockReturnValue(null),
}));

vi.mock("../../auditContextEnqueue", () => ({
  enqueueWithAuditContext: vi.fn(),
}));

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
  mockSyncIssue.mockResolvedValue(FRESH_ISSUE_DATA);
  mockIssueFindFirst.mockResolvedValue({
    id: 1,
    integrationId: 1,
    externalId: "JIRA-1",
    lastSyncedAt: null,
  });
});

describe("performIssueRefreshSystem — auth + wiring", () => {
  it("PERSONAL_ACCESS_TOKEN integration with credentials succeeds without a userId", async () => {
    mockIntegrationFindUnique.mockResolvedValueOnce({
      id: 1,
      authType: "PERSONAL_ACCESS_TOKEN",
      credentials: { token: "pat-secret" },
      provider: "JIRA",
    });

    const result = await syncService.performIssueRefreshSystem(1, "JIRA-1");

    expect(result.success).toBe(true);
    expect(mockSyncIssue).toHaveBeenCalledTimes(1);
    // Critically — no user table lookup happened.
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });

  it("API_KEY integration with credentials succeeds", async () => {
    mockIntegrationFindUnique.mockResolvedValueOnce({
      id: 1,
      authType: "API_KEY",
      credentials: { key: "api-key" },
      provider: "JIRA",
    });

    const result = await syncService.performIssueRefreshSystem(1, "JIRA-1");
    expect(result.success).toBe(true);
    expect(mockSyncIssue).toHaveBeenCalledTimes(1);
  });

  it("OAUTH2 integration is rejected — system can't refresh user-tied tokens", async () => {
    mockIntegrationFindUnique.mockResolvedValueOnce({
      id: 1,
      authType: "OAUTH2",
      credentials: { accessToken: "x" },
      provider: "JIRA",
    });

    const result = await syncService.performIssueRefreshSystem(1, "JIRA-1");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/OAUTH2|user-bound/i);
    expect(mockSyncIssue).not.toHaveBeenCalled();
  });

  it("PAT integration without credentials fails fast", async () => {
    mockIntegrationFindUnique.mockResolvedValueOnce({
      id: 1,
      authType: "PERSONAL_ACCESS_TOKEN",
      credentials: null,
      provider: "JIRA",
    });

    const result = await syncService.performIssueRefreshSystem(1, "JIRA-1");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/missing credentials/i);
    expect(mockSyncIssue).not.toHaveBeenCalled();
  });

  it("missing integration returns a graceful failure", async () => {
    mockIntegrationFindUnique.mockResolvedValueOnce(null);

    const result = await syncService.performIssueRefreshSystem(99, "JIRA-1");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Integration not found/);
    expect(mockSyncIssue).not.toHaveBeenCalled();
  });

  it("NONE auth type bypasses the credential check (e.g., public-API integrations)", async () => {
    mockIntegrationFindUnique.mockResolvedValueOnce({
      id: 1,
      authType: "NONE",
      credentials: null,
      provider: "JIRA",
    });

    const result = await syncService.performIssueRefreshSystem(1, "JIRA-1");
    expect(result.success).toBe(true);
    expect(mockSyncIssue).toHaveBeenCalledTimes(1);
  });
});

describe("performIssueRefreshSystem — gate + lock parity with user path", () => {
  it("respects the freshness gate when minFreshnessSeconds is non-zero", async () => {
    mockIssueFindFirst.mockResolvedValueOnce({
      id: 1,
      lastSyncedAt: new Date(Date.now() - 5_000), // 5s old
    });
    mockIntegrationFindUnique.mockResolvedValueOnce({
      id: 1,
      authType: "PERSONAL_ACCESS_TOKEN",
      credentials: { token: "x" },
      provider: "JIRA",
    });

    const result = await syncService.performIssueRefreshSystem(1, "JIRA-1", {
      minFreshnessSeconds: 15, // webhook-trigger window
    });

    expect(result).toEqual({ success: true, cached: true });
    expect(mockSyncIssue).not.toHaveBeenCalled();
    // Integration fetch is gated AFTER cache check, so it shouldn't fire.
    expect(mockIntegrationFindUnique).not.toHaveBeenCalled();
  });

  it("acquires the same per-issue Valkey lock as the user path", async () => {
    mockIntegrationFindUnique.mockResolvedValueOnce({
      id: 1,
      authType: "PERSONAL_ACCESS_TOKEN",
      credentials: { token: "x" },
      provider: "JIRA",
    });

    await syncService.performIssueRefreshSystem(1, "JIRA-1");

    expect(mockValkeySet).toHaveBeenCalledWith(
      "sync-lock:issue:1:JIRA-1",
      "1",
      "EX",
      60,
      "NX"
    );
    expect(mockValkeyDel).toHaveBeenCalledWith("sync-lock:issue:1:JIRA-1");
  });

  it("returns locked:true when a user-context sync is already in flight for the same issue", async () => {
    // Simulate a concurrent user-path sync holding the lock.
    mockValkeyStore.set("sync-lock:issue:1:JIRA-1", "1");

    const result = await syncService.performIssueRefreshSystem(1, "JIRA-1");

    expect(result).toEqual({ success: true, locked: true });
    expect(mockSyncIssue).not.toHaveBeenCalled();
    expect(mockIntegrationFindUnique).not.toHaveBeenCalled();
  });
});
