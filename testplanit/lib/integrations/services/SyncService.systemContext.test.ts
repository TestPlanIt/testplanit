import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `performIssueRefreshSystem` — server-context issue sync used by inbound
 * webhook handlers and any other path that has no user session.
 *
 * Differences from the user-context `performIssueRefresh` exercised here:
 *   • No `userId` parameter, no `rawDb.user.findUnique` lookup.
 *   • OAUTH2 integrations are rejected (user-tied tokens).
 *   • Auth check collapses to "Integration.credentials present?".
 *
 * Same freshness gate + per-issue Valkey lock as the user path — those are
 * already covered in `SyncService.freshnessGate.test.ts`. This file's
 * focus is the system-context auth + adapter wiring.
 */

// ─── Mocks ────────────────────────────────────────────────────────────────
const mockIssueFindFirst = vi.fn();
const mockIssueUpdate = vi.fn();
const mockIssueCreate = vi.fn();
const mockIssueUpsert = vi.fn();
const mockIssueFindUnique = vi.fn();
const mockIntegrationFindUnique = vi.fn();
const mockUserFindUnique = vi.fn();
const mockProjectsFindUnique = vi.fn();

vi.mock("@/lib/rawDb", () => ({
  rawDb: {
    issue: {
      findFirst: (...args: any[]) => mockIssueFindFirst(...args),
      findUnique: (...args: any[]) => mockIssueFindUnique(...args),
      update: (...args: any[]) => mockIssueUpdate(...args),
      create: (...args: any[]) => mockIssueCreate(...args),
      upsert: (...args: any[]) => mockIssueUpsert(...args),
    },
    user: {
      // `_performIssueRefreshInnerSystem` MUST NOT call this — assertion
      // in tests below verifies it stayed at zero invocations.
      findUnique: (...args: any[]) => mockUserFindUnique(...args),
    },
    integration: {
      findUnique: (...args: any[]) => mockIntegrationFindUnique(...args),
    },
    projects: {
      // Auto-create looks up the project's creator to populate
      // Issue.createdById (required FK; webhooks have no user session).
      findUnique: (...args: any[]) => mockProjectsFindUnique(...args),
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

const { mockValkeyStore, mockValkeySet, mockValkeyDel, mockValkeyPublish } =
  vi.hoisted(() => {
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
      mockValkeyPublish: vi.fn(async (_channel: string, _payload: string) => 1),
    };
  });

vi.mock("../../valkey", () => ({
  default: {
    set: (key: string, val: string, ...opts: unknown[]) =>
      mockValkeySet(key, val, ...opts),
    del: (key: string) => mockValkeyDel(key),
    publish: (channel: string, payload: string) =>
      mockValkeyPublish(channel, payload),
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
  // `vi.clearAllMocks()` calls `mockClear` (clears call history) but
  // does NOT drain the `mockResolvedValueOnce` queue. Tests upstream
  // that set one-shot rejections / nulls would otherwise leak through
  // to subsequent tests. Reset every shared mock fully here, then
  // re-establish the default implementations below.
  mockIssueFindFirst.mockReset();
  mockIntegrationFindUnique.mockReset();
  mockUserFindUnique.mockReset();
  mockProjectsFindUnique.mockReset();
  mockIssueCreate.mockReset();
  mockIssueUpsert.mockReset();
  mockIssueFindUnique.mockReset();
  mockIssueUpdate.mockReset();
  mockSyncIssue.mockReset();
  mockValkeyPublish.mockReset();
  mockValkeyPublish.mockImplementation(async () => 1);
  mockSyncIssue.mockResolvedValue(FRESH_ISSUE_DATA);
  mockIssueFindFirst.mockResolvedValue({
    id: 1,
    integrationId: 1,
    externalId: "JIRA-1",
    lastSyncedAt: null,
  });
  mockIssueUpdate.mockResolvedValue({ id: 1 });
  mockIssueCreate.mockResolvedValue({ id: 1 });
  // Auto-create now goes through upsert(externalId_integrationId) so a
  // soft-deleted Issue with the same external id gets resurrected
  // instead of 23505ing. Default to a fresh row id; tests with a
  // specific assertion override.
  mockIssueUpsert.mockResolvedValue({ id: 1 });
  // updateExistingIssue() re-reads the row after update to publish the
  // webhook payload; the default mirrors the post-update state.
  mockIssueFindUnique.mockResolvedValue({ id: 1 });
  // Default: project's creator is "user-creator-1" — used by auto-create
  // to populate Issue.createdById. Tests override per-case.
  mockProjectsFindUnique.mockResolvedValue({ createdBy: "user-creator-1" });
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

  it("OAUTH2 with at least one active UserIntegrationAuth succeeds — Atlassian-preferred path for Jira", async () => {
    // Atlassian pushes OAuth 2.0 (3LO) for Jira integrations. The system
    // sync path treats the most-recently-active UserIntegrationAuth as
    // the effective service-account credential.
    mockIntegrationFindUnique.mockResolvedValueOnce({
      id: 1,
      authType: "OAUTH2",
      credentials: null,
      provider: "JIRA",
      userIntegrationAuths: [
        {
          id: "uia_1",
          isActive: true,
          accessToken: "encrypted-token",
          refreshToken: "encrypted-refresh",
          tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000), // +1h
        },
      ],
    });

    const result = await syncService.performIssueRefreshSystem(1, "JIRA-1");

    expect(result.success).toBe(true);
    expect(mockSyncIssue).toHaveBeenCalledTimes(1);
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });

  it("OAUTH2 with NO active UserIntegrationAuth fails fast with a re-auth message", async () => {
    mockIntegrationFindUnique.mockResolvedValueOnce({
      id: 1,
      authType: "OAUTH2",
      credentials: null,
      provider: "JIRA",
      userIntegrationAuths: [],
    });

    const result = await syncService.performIssueRefreshSystem(1, "JIRA-1");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(
      /no active user authentication|re.authenticate/i
    );
    expect(mockSyncIssue).not.toHaveBeenCalled();
  });

  it("OAUTH2 with expired token AND no refresh token fails with a re-auth message (admin recovery loud)", async () => {
    mockIntegrationFindUnique.mockResolvedValueOnce({
      id: 1,
      authType: "OAUTH2",
      credentials: null,
      provider: "JIRA",
      userIntegrationAuths: [
        {
          id: "uia_1",
          isActive: true,
          accessToken: "encrypted-token",
          refreshToken: null,
          tokenExpiresAt: new Date(Date.now() - 60 * 60 * 1000), // -1h
        },
      ],
    });

    const result = await syncService.performIssueRefreshSystem(1, "JIRA-1");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/expired|re.authenticate/i);
    expect(mockSyncIssue).not.toHaveBeenCalled();
  });

  it("OAUTH2 with expired token but valid refresh token proceeds (adapter handles refresh)", async () => {
    // The adapter is responsible for refreshing — JiraAdapter has a
    // refreshTokens() method. The service layer just gates entry; if the
    // refresh fails downstream, the API call returns an error and is
    // handled by the standard sync-failure path.
    mockIntegrationFindUnique.mockResolvedValueOnce({
      id: 1,
      authType: "OAUTH2",
      credentials: null,
      provider: "JIRA",
      userIntegrationAuths: [
        {
          id: "uia_1",
          isActive: true,
          accessToken: "encrypted-token",
          refreshToken: "encrypted-refresh",
          tokenExpiresAt: new Date(Date.now() - 60 * 60 * 1000), // -1h
        },
      ],
    });

    const result = await syncService.performIssueRefreshSystem(1, "JIRA-1");

    expect(result.success).toBe(true);
    expect(mockSyncIssue).toHaveBeenCalledTimes(1);
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

describe("performIssueRefreshSystem — createIfMissing (auto-create)", () => {
  it("creates a new Issue row when no local match exists and createIfMissing is set", async () => {
    mockIntegrationFindUnique.mockResolvedValueOnce({
      id: 1,
      authType: "PERSONAL_ACCESS_TOKEN",
      credentials: { token: "x" },
      provider: "JIRA",
    });
    // Local lookup misses — no Issue row matches.
    mockIssueFindFirst.mockResolvedValue(null);

    const result = await syncService.performIssueRefreshSystem(1, "JIRA-1", {
      createIfMissing: { projectId: 7 },
    });

    expect(result.success).toBe(true);
    // Auto-create now upserts on the (externalId, integrationId) unique
    // tuple so a soft-deleted Issue with the same external id (e.g. user
    // deleted, external system re-syncs) resurrects instead of 23505ing.
    expect(mockIssueUpsert).toHaveBeenCalledTimes(1);
    expect(mockIssueUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          externalId_integrationId: { externalId: "JIRA-1", integrationId: 1 },
        },
        create: expect.objectContaining({
          externalId: "JIRA-1",
          externalKey: undefined, // FRESH_ISSUE_DATA has no .key
          title: "Test issue",
          externalStatus: "Open",
          integrationId: 1,
          projectId: 7,
          createdById: "user-creator-1", // Project creator surrogate.
        }),
        update: expect.objectContaining({
          isDeleted: false,
          title: "Test issue",
          externalStatus: "Open",
        }),
      })
    );
    expect(mockIssueCreate).not.toHaveBeenCalled();
    expect(mockIssueUpdate).not.toHaveBeenCalled();
  });

  it("auto-create fails gracefully when project has no creator on record (required for Issue.createdById)", async () => {
    mockIntegrationFindUnique.mockResolvedValueOnce({
      id: 1,
      authType: "PERSONAL_ACCESS_TOKEN",
      credentials: { token: "x" },
      provider: "JIRA",
    });
    mockIssueFindFirst.mockResolvedValue(null);
    mockProjectsFindUnique.mockResolvedValueOnce(null); // project missing

    const result = await syncService.performIssueRefreshSystem(1, "JIRA-1", {
      createIfMissing: { projectId: 7 },
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no creator on record/i);
    expect(mockIssueCreate).not.toHaveBeenCalled();
    expect(mockIssueUpsert).not.toHaveBeenCalled();
  });

  it("falls back to update path when an existing Issue row matches, even with createIfMissing set", async () => {
    mockIntegrationFindUnique.mockResolvedValueOnce({
      id: 1,
      authType: "PERSONAL_ACCESS_TOKEN",
      credentials: { token: "x" },
      provider: "JIRA",
    });
    // Existing Issue row found — update path takes over.
    mockIssueFindFirst.mockResolvedValue({
      id: 99,
      integrationId: 1,
      externalId: "JIRA-1",
      lastSyncedAt: null,
    });

    const result = await syncService.performIssueRefreshSystem(1, "JIRA-1", {
      createIfMissing: { projectId: 7 },
    });

    expect(result.success).toBe(true);
    expect(mockIssueCreate).not.toHaveBeenCalled();
    expect(mockIssueUpdate).toHaveBeenCalledTimes(1);
  });

  it("throws when missing AND createIfMissing is NOT set (legacy manual-sync contract preserved)", async () => {
    mockIntegrationFindUnique.mockResolvedValueOnce({
      id: 1,
      authType: "PERSONAL_ACCESS_TOKEN",
      credentials: { token: "x" },
      provider: "JIRA",
    });
    mockIssueFindFirst.mockResolvedValue(null);

    const result = await syncService.performIssueRefreshSystem(1, "JIRA-1");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found in local database/i);
    expect(mockIssueCreate).not.toHaveBeenCalled();
    expect(mockIssueUpdate).not.toHaveBeenCalled();
  });
});

describe("performIssueRefreshSystem — GitHub repo context", () => {
  it("short-circuits the GitHub owner/repo lookup when externalIssueId is already in compound form", async () => {
    mockIntegrationFindUnique.mockResolvedValueOnce({
      id: 1,
      authType: "PERSONAL_ACCESS_TOKEN",
      credentials: { token: "x" },
      provider: "GITHUB",
    });
    // Found via direct lookup — no need to look up a stored Issue for
    // owner/repo since the externalIssueId is already compound.
    mockIssueFindFirst.mockResolvedValue({
      id: 50,
      integrationId: 1,
      externalKey: "octocat/Hello-World#42",
      lastSyncedAt: null,
    });

    const result = await syncService.performIssueRefreshSystem(
      1,
      "octocat/Hello-World#42"
    );

    expect(result.success).toBe(true);
    // Adapter receives the compound id verbatim — no double-encoding.
    expect(mockSyncIssue).toHaveBeenCalledWith("octocat/Hello-World#42");
    // findFirst is called exactly twice: once by `_executeSyncWithAdapter`
    // for the existing-vs-create branch decision, then once inside
    // `updateExistingIssue` for its own lookup. The legacy
    // "stored-issue-to-derive-owner/repo" lookup is BYPASSED — that's
    // the contract this test guards.
    expect(mockIssueFindFirst).toHaveBeenCalledTimes(2);
  });

  it("auto-creates a GitHub Issue when given a compound id with no local match", async () => {
    mockIntegrationFindUnique.mockResolvedValueOnce({
      id: 1,
      authType: "PERSONAL_ACCESS_TOKEN",
      credentials: { token: "x" },
      provider: "GITHUB",
    });
    mockIssueFindFirst.mockResolvedValue(null);
    mockSyncIssue.mockResolvedValueOnce({
      ...FRESH_ISSUE_DATA,
      id: "octocat/Hello-World#42",
      key: "#42",
      title: "Auto-created from GitHub",
    });

    const result = await syncService.performIssueRefreshSystem(
      1,
      "octocat/Hello-World#42",
      { createIfMissing: { projectId: 11 } }
    );

    expect(result.success).toBe(true);
    expect(mockSyncIssue).toHaveBeenCalledWith("octocat/Hello-World#42");
    expect(mockIssueUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          externalId_integrationId: {
            externalId: "octocat/Hello-World#42",
            integrationId: 1,
          },
        },
        create: expect.objectContaining({
          externalId: "octocat/Hello-World#42",
          externalKey: "#42",
          title: "Auto-created from GitHub",
          integrationId: 1,
          projectId: 11,
          createdById: "user-creator-1",
        }),
        update: expect.objectContaining({
          isDeleted: false,
          externalKey: "#42",
          title: "Auto-created from GitHub",
        }),
      })
    );
  });
});

describe("performIssueRefreshSystem — SSE wake-up publish", () => {
  it("auto-create publishes 'issue-created' on the project-scoped channel", async () => {
    mockIntegrationFindUnique.mockResolvedValueOnce({
      id: 1,
      authType: "PERSONAL_ACCESS_TOKEN",
      credentials: { token: "x" },
      provider: "JIRA",
    });
    mockIssueFindFirst.mockResolvedValue(null);
    // Auto-create now goes through upsert; surface the resurrected/new
    // row's id so the SSE payload assertion gets the right value.
    mockIssueUpsert.mockResolvedValueOnce({ id: 99 });

    await syncService.performIssueRefreshSystem(1, "JIRA-1", {
      createIfMissing: { projectId: 7 },
    });

    expect(mockValkeyPublish).toHaveBeenCalledWith(
      "issue-updates:tenant:default:project:7",
      expect.stringContaining('"event":"issue-created"')
    );
    const payload = JSON.parse(mockValkeyPublish.mock.calls[0]![1] as string);
    expect(payload).toMatchObject({
      event: "issue-created",
      issueId: 99,
      projectId: 7,
    });
  });

  it("update path publishes 'issue-updated' with the existing issue's projectId", async () => {
    mockIntegrationFindUnique.mockResolvedValueOnce({
      id: 1,
      authType: "PERSONAL_ACCESS_TOKEN",
      credentials: { token: "x" },
      provider: "JIRA",
    });
    // Both findFirst calls return an existing Issue: first is the
    // existence-check inside `_executeSyncWithAdapter`, second is the
    // lookup inside `updateExistingIssue` itself.
    mockIssueFindFirst.mockResolvedValue({
      id: 55,
      projectId: 13,
      integrationId: 1,
      externalId: "JIRA-1",
      lastSyncedAt: null,
    });

    await syncService.performIssueRefreshSystem(1, "JIRA-1");

    expect(mockValkeyPublish).toHaveBeenCalledWith(
      "issue-updates:tenant:default:project:13",
      expect.stringContaining('"event":"issue-updated"')
    );
    const payload = JSON.parse(mockValkeyPublish.mock.calls[0]![1] as string);
    expect(payload).toMatchObject({
      event: "issue-updated",
      issueId: 55,
      projectId: 13,
    });
  });

  it("does NOT publish when sync is short-circuited by freshness gate (cached)", async () => {
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
      minFreshnessSeconds: 15,
    });

    expect(result).toEqual({ success: true, cached: true });
    expect(mockValkeyPublish).not.toHaveBeenCalled();
  });

  it("update path swallows publish errors — sync still resolves successfully", async () => {
    mockIntegrationFindUnique.mockResolvedValueOnce({
      id: 1,
      authType: "PERSONAL_ACCESS_TOKEN",
      credentials: { token: "x" },
      provider: "JIRA",
    });
    mockIssueFindFirst.mockResolvedValue({
      id: 55,
      projectId: 13,
      integrationId: 1,
      externalId: "JIRA-1",
      lastSyncedAt: null,
    });
    mockValkeyPublish.mockRejectedValueOnce(new Error("valkey unreachable"));

    const result = await syncService.performIssueRefreshSystem(1, "JIRA-1");

    // SSE is opportunistic; the DB row is the source of truth.
    expect(result.success).toBe(true);
  });
});
