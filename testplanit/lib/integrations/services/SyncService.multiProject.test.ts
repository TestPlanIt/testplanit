import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock prismaBase — SyncService imports `prisma` from "@/lib/prismaBase"
// ---------------------------------------------------------------------------
const mockIntegrationProjectFindMany = vi.fn();
const mockIntegrationProjectUpdate = vi.fn();
const mockIssueFindMany = vi.fn();
const mockIssueCount = vi.fn();

vi.mock("@/lib/prismaBase", () => ({
  prisma: {
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: "user-1",
        role: { rolePermissions: [] },
      }),
    },
    integration: {
      findUnique: vi.fn().mockResolvedValue({
        id: 1,
        authType: "NONE",
        credentials: {},
        userIntegrationAuths: [],
      }),
    },
    integrationProject: {
      findMany: (...args: any[]) => mockIntegrationProjectFindMany(...args),
      update: (...args: any[]) => mockIntegrationProjectUpdate(...args),
    },
    issue: {
      count: (...args: any[]) => mockIssueCount(...args),
      findMany: (...args: any[]) => mockIssueFindMany(...args),
    },
  },
}));

// ---------------------------------------------------------------------------
// Mock IssueCache
// ---------------------------------------------------------------------------
const mockIssueCacheSet = vi.fn();
const mockIssueCacheSetMetadata = vi.fn();

vi.mock("../cache/IssueCache", () => ({
  issueCache: {
    set: (...args: any[]) => mockIssueCacheSet(...args),
    setMetadata: (...args: any[]) => mockIssueCacheSetMetadata(...args),
  },
}));

// ---------------------------------------------------------------------------
// Mock IntegrationManager — adapter returned per test
// ---------------------------------------------------------------------------
const mockSyncIssue = vi.fn();
const mockGetAdapter = vi.fn();

vi.mock("../IntegrationManager", () => ({
  integrationManager: {
    getAdapter: (...args: any[]) => mockGetAdapter(...args),
  },
}));

// ---------------------------------------------------------------------------
// Mock issueSearch (Elasticsearch sync — fire-and-forget in updateExistingIssue)
// ---------------------------------------------------------------------------
vi.mock("~/services/issueSearch", () => ({
  syncIssueToElasticsearch: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Mock multiTenantPrisma (getCurrentTenantId used in queueSync methods only)
// ---------------------------------------------------------------------------
vi.mock("../../multiTenantPrisma", () => ({
  getCurrentTenantId: vi.fn().mockReturnValue(undefined),
}));

// ---------------------------------------------------------------------------
// Mock queues (not needed for performSync but imported at module level)
// ---------------------------------------------------------------------------
vi.mock("../../queues", () => ({
  getSyncQueue: vi.fn().mockReturnValue(null),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIntegrationProject(overrides: Record<string, any> = {}) {
  return {
    id: "ip-1",
    projectIntegrationId: "pi-1",
    externalProjectId: "TPI",
    externalProjectKey: "TPI",
    externalProjectName: "Test Project Integration",
    isActive: true,
    isDefault: true,
    lastSyncAt: null,
    syncStatus: null,
    syncError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeIssue(overrides: Record<string, any> = {}) {
  return {
    id: "issue-local-1",
    externalId: "1",
    externalKey: "TPI-1",
    name: "TPI-1",
    externalData: null,
    ...overrides,
  };
}

function makeAdapter(syncIssueFn = mockSyncIssue) {
  return {
    syncIssue: syncIssueFn,
    getCapabilities: vi.fn().mockReturnValue({ syncIssue: true }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SyncService — multi-project sync (65-03)", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: no IntegrationProject records (legacy mode)
    mockIntegrationProjectFindMany.mockResolvedValue([]);
    mockIntegrationProjectUpdate.mockResolvedValue({});
    mockIssueCount.mockResolvedValue(0);
    mockIssueFindMany.mockResolvedValue([]);
    mockIssueCacheSet.mockResolvedValue(undefined);

    // Default adapter resolves successfully
    mockSyncIssue.mockResolvedValue({
      id: "ext-1",
      key: "TPI-1",
      title: "Test Issue",
      status: "open",
      priority: "medium",
      customFields: {},
    });
    mockGetAdapter.mockResolvedValue(makeAdapter());
  });

  // -------------------------------------------------------------------------
  // Test 1: iterates all active IntegrationProject records
  // -------------------------------------------------------------------------
  it("iterates all active IntegrationProject records", async () => {
    const { SyncService } = await import("./SyncService");
    const service = new SyncService();

    const project1 = makeIntegrationProject({
      id: "ip-1",
      externalProjectKey: "TPI",
      externalProjectId: "TPI",
    });
    const project2 = makeIntegrationProject({
      id: "ip-2",
      externalProjectKey: "CORE",
      externalProjectId: "CORE",
    });

    mockIntegrationProjectFindMany.mockResolvedValue([project1, project2]);

    // Issues for project 1 (TPI prefix) and project 2 (CORE prefix)
    mockIssueFindMany.mockResolvedValue([
      makeIssue({ id: "local-1", externalKey: "TPI-1", externalId: "1" }),
      makeIssue({ id: "local-2", externalKey: "CORE-1", externalId: "2" }),
    ]);

    mockSyncIssue
      .mockResolvedValueOnce({
        id: "1",
        key: "TPI-1",
        title: "TPI Issue",
        status: "open",
        priority: "medium",
        customFields: {},
      })
      .mockResolvedValueOnce({
        id: "2",
        key: "CORE-1",
        title: "CORE Issue",
        status: "open",
        priority: "medium",
        customFields: {},
      });

    // updateExistingIssue needs issue.findFirst for each — mock it
    const mockFindFirst = vi
      .fn()
      .mockResolvedValueOnce({ id: "local-1" })
      .mockResolvedValueOnce({ id: "local-2" });
    const mockIssueUpdate = vi.fn().mockResolvedValue({});
    vi.mocked(mockGetAdapter).mockResolvedValue({
      syncIssue: mockSyncIssue,
      getCapabilities: vi.fn().mockReturnValue({ syncIssue: true }),
    });

    // Patch the prisma mock to include findFirst and update on issue
    const { prisma } = await import("@/lib/prismaBase");
    (prisma.issue as any).findFirst = mockFindFirst;
    (prisma.issue as any).update = mockIssueUpdate;

    const result = await service.performSync("user-1", 1);

    // Both projects should have been marked syncing then completed
    const updateCalls = mockIntegrationProjectUpdate.mock.calls;
    const syncingCalls = updateCalls.filter(
      (c) => c[0]?.data?.syncStatus === "syncing"
    );
    const completedCalls = updateCalls.filter(
      (c) => c[0]?.data?.syncStatus === "completed"
    );

    expect(syncingCalls).toHaveLength(2);
    expect(completedCalls).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Test 2: isolates errors per project (D-07)
  // -------------------------------------------------------------------------
  it("isolates errors per project (D-07) — one project fails, the other completes", async () => {
    const { SyncService } = await import("./SyncService");
    const service = new SyncService();

    const project1 = makeIntegrationProject({
      id: "ip-1",
      externalProjectKey: "FAIL",
      externalProjectId: "FAIL",
    });
    const project2 = makeIntegrationProject({
      id: "ip-2",
      externalProjectKey: "OK",
      externalProjectId: "OK",
    });

    mockIntegrationProjectFindMany.mockResolvedValue([project1, project2]);

    // Issues: one for each project
    mockIssueFindMany.mockResolvedValue([
      makeIssue({ id: "local-1", externalKey: "FAIL-1", externalId: "f1" }),
      makeIssue({ id: "local-2", externalKey: "OK-1", externalId: "ok1" }),
    ]);

    // Patch prisma.issue with findFirst + update
    const { prisma } = await import("@/lib/prismaBase");
    (prisma.issue as any).findFirst = vi
      .fn()
      .mockResolvedValue({ id: "local-2" });
    (prisma.issue as any).update = vi.fn().mockResolvedValue({});

    // project1 (FAIL prefix) — syncIssue throws
    // project2 (OK prefix) — syncIssue succeeds
    // The outer try/catch around each integrationProject catches project-level errors.
    // To simulate a project-level failure (not issue-level), we make the integrationProject.update
    // for the "syncing" status on project1 throw. That triggers the outer catch.
    mockIntegrationProjectUpdate.mockImplementation(async (args: any) => {
      if (args.where?.id === "ip-1" && args.data?.syncStatus === "syncing") {
        throw new Error("External API unavailable for FAIL project");
      }
      return {};
    });

    const result = await service.performSync("user-1", 1);

    // project1 should have syncStatus "error"
    const errorCalls = mockIntegrationProjectUpdate.mock.calls.filter(
      (c) => c[0]?.where?.id === "ip-1" && c[0]?.data?.syncStatus === "error"
    );
    expect(errorCalls).toHaveLength(1);
    expect(errorCalls[0][0].data.syncError).toContain(
      "External API unavailable"
    );

    // project2 should have syncStatus "completed"
    const completedCalls = mockIntegrationProjectUpdate.mock.calls.filter(
      (c) =>
        c[0]?.where?.id === "ip-2" && c[0]?.data?.syncStatus === "completed"
    );
    expect(completedCalls).toHaveLength(1);

    // Errors array should mention the failing project
    expect(result.errors.some((e) => e.includes("FAIL"))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 3: tracks lastSyncAt per project (D-08)
  // -------------------------------------------------------------------------
  it("tracks lastSyncAt per project (D-08) — set on completed, absent on error", async () => {
    const { SyncService } = await import("./SyncService");
    const service = new SyncService();

    const projectOk = makeIntegrationProject({
      id: "ip-ok",
      externalProjectKey: "OK",
      externalProjectId: "OK",
    });
    const projectErr = makeIntegrationProject({
      id: "ip-err",
      externalProjectKey: "ERR",
      externalProjectId: "ERR",
    });

    mockIntegrationProjectFindMany.mockResolvedValue([projectOk, projectErr]);
    mockIssueFindMany.mockResolvedValue([]);

    // project "ERR" fails at the "syncing" status update
    mockIntegrationProjectUpdate.mockImplementation(async (args: any) => {
      if (args.where?.id === "ip-err" && args.data?.syncStatus === "syncing") {
        throw new Error("ERR project connection refused");
      }
      return {};
    });

    await service.performSync("user-1", 1);

    // Completed project should have lastSyncAt as a Date
    const completedCall = mockIntegrationProjectUpdate.mock.calls.find(
      (c) =>
        c[0]?.where?.id === "ip-ok" && c[0]?.data?.syncStatus === "completed"
    );
    expect(completedCall).toBeDefined();
    expect(completedCall![0].data.lastSyncAt).toBeInstanceOf(Date);

    // Error project update should NOT have lastSyncAt
    const errorCall = mockIntegrationProjectUpdate.mock.calls.find(
      (c) => c[0]?.where?.id === "ip-err" && c[0]?.data?.syncStatus === "error"
    );
    expect(errorCall).toBeDefined();
    expect(errorCall![0].data.lastSyncAt).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Test 4: falls back to legacy sync when no IntegrationProject records
  // -------------------------------------------------------------------------
  it("falls back to legacy sync when no IntegrationProject records exist", async () => {
    const { SyncService } = await import("./SyncService");
    const service = new SyncService();

    // No IntegrationProject records
    mockIntegrationProjectFindMany.mockResolvedValue([]);

    // Legacy path: issues are fetched by integrationId
    const legacyIssue = makeIssue({
      id: "legacy-1",
      externalKey: "LEGACY-1",
      externalId: "leg1",
    });
    mockIssueCount.mockResolvedValue(1);
    mockIssueFindMany.mockResolvedValue([legacyIssue]);

    // Patch prisma.issue with findFirst + update for updateExistingIssue
    const { prisma } = await import("@/lib/prismaBase");
    (prisma.issue as any).findFirst = vi
      .fn()
      .mockResolvedValue({ id: "legacy-1" });
    (prisma.issue as any).update = vi.fn().mockResolvedValue({});

    mockSyncIssue.mockResolvedValue({
      id: "leg1",
      key: "LEGACY-1",
      title: "Legacy Issue",
      status: "open",
      priority: "medium",
      customFields: {},
    });

    const result = await service.performSync("user-1", 1);

    // Legacy path ran: issue.findMany was called (not per-project filtered)
    expect(mockIssueFindMany).toHaveBeenCalled();
    // adapter.syncIssue was called for the legacy issue
    expect(mockSyncIssue).toHaveBeenCalledWith("leg1");
    // No IntegrationProject updates were made
    expect(mockIntegrationProjectUpdate).not.toHaveBeenCalled();
    expect(result.synced).toBe(1);
    expect(result.errors).toHaveLength(0);
  });
});
