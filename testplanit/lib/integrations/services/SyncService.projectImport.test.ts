import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock the raw Prisma client — SyncService imports `prisma` from
// "@/lib/prismaBase" (aliased to `defaultPrisma`).
// ---------------------------------------------------------------------------
const mockIpFindUnique = vi.fn();
const mockIpUpdate = vi.fn();
const mockIntegrationFindUnique = vi.fn();
const mockProjectsFindUnique = vi.fn();
const mockIssueUpsert = vi.fn();

vi.mock("@/lib/prismaBase", () => ({
  prisma: {
    integrationProject: {
      findUnique: (...args: any[]) => mockIpFindUnique(...args),
      update: (...args: any[]) => mockIpUpdate(...args),
    },
    integration: {
      findUnique: (...args: any[]) => mockIntegrationFindUnique(...args),
    },
    projects: {
      findUnique: (...args: any[]) => mockProjectsFindUnique(...args),
    },
    issue: {
      upsert: (...args: any[]) => mockIssueUpsert(...args),
    },
  },
}));

// ---------------------------------------------------------------------------
// Mock IntegrationManager — adapter returned per test
// ---------------------------------------------------------------------------
const mockGetAdapter = vi.fn();

vi.mock("../IntegrationManager", () => ({
  integrationManager: {
    getAdapter: (...args: any[]) => mockGetAdapter(...args),
  },
}));

// ---------------------------------------------------------------------------
// Mock side-effect deps of _createIssueFromExternal
// ---------------------------------------------------------------------------
vi.mock("~/services/issueSearch", () => ({
  syncIssueToElasticsearch: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../multiTenantPrisma", () => ({
  getCurrentTenantId: vi.fn().mockReturnValue(undefined),
}));
vi.mock("../../queues", () => ({
  getSyncQueue: vi.fn().mockReturnValue(null),
}));
vi.mock("../cache/IssueCache", () => ({
  issueCache: {
    set: vi.fn().mockResolvedValue(undefined),
    setMetadata: vi.fn().mockResolvedValue(undefined),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeMapping(overrides: Record<string, any> = {}) {
  return {
    id: "ip-1",
    externalProjectId: "TPI",
    externalProjectKey: "TPI",
    externalProjectName: "Test Project",
    projectIntegration: { projectId: 7, integrationId: 1 },
    ...overrides,
  };
}

function makeExtIssue(overrides: Record<string, any> = {}) {
  return {
    id: "ext-1",
    key: "TPI-1",
    title: "Issue 1",
    status: "open",
    priority: "medium",
    createdAt: new Date(),
    updatedAt: new Date(),
    customFields: {},
    labels: [],
    components: [],
    ...overrides,
  };
}

function makeSearchAdapter(pages: any[]) {
  const searchIssues = vi.fn();
  pages.forEach((p) => searchIssues.mockResolvedValueOnce(p));
  return {
    searchIssues,
    getCapabilities: vi.fn().mockReturnValue({ searchIssues: true }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("SyncService — performProjectImport (bulk import #452)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIpFindUnique.mockResolvedValue(makeMapping());
    mockIpUpdate.mockResolvedValue({});
    mockIntegrationFindUnique.mockResolvedValue({ provider: "JIRA" });
    mockProjectsFindUnique.mockResolvedValue({ createdBy: "creator-1" });
    mockIssueUpsert.mockResolvedValue({ id: 101 });
  });

  it("imports issues via upsert and marks the mapping syncing → completed", async () => {
    const { SyncService } = await import("./SyncService");
    const service = new SyncService();

    const adapter = makeSearchAdapter([
      {
        issues: [
          makeExtIssue({ id: "ext-1", key: "TPI-1" }),
          makeExtIssue({ id: "ext-2", key: "TPI-2" }),
        ],
        total: 2,
        hasMore: false,
      },
    ]);
    mockGetAdapter.mockResolvedValue(adapter);

    const result = await service.performProjectImport(1, "ip-1", {
      updatedWithinDays: 90,
      cap: 200,
    });

    expect(result.imported).toBe(2);
    expect(result.errors).toHaveLength(0);

    // Recency window + external project key were pushed into the search.
    expect(adapter.searchIssues).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "TPI",
        updatedWithinDays: 90,
        fullSync: true,
      })
    );

    // De-dup is the upsert on (externalId, integrationId).
    expect(mockIssueUpsert).toHaveBeenCalledTimes(2);
    expect(mockIssueUpsert.mock.calls[0][0].where).toEqual({
      externalId_integrationId: { externalId: "ext-1", integrationId: 1 },
    });

    // Status badge: syncing first, completed last.
    const statuses = mockIpUpdate.mock.calls.map((c) => c[0].data.syncStatus);
    expect(statuses[0]).toBe("syncing");
    expect(statuses[statuses.length - 1]).toBe("completed");
  });

  it("enforces the cap", async () => {
    const { SyncService } = await import("./SyncService");
    const service = new SyncService();

    const adapter = makeSearchAdapter([
      {
        issues: [
          makeExtIssue({ id: "ext-1" }),
          makeExtIssue({ id: "ext-2" }),
          makeExtIssue({ id: "ext-3" }),
        ],
        total: 3,
        hasMore: false,
      },
    ]);
    mockGetAdapter.mockResolvedValue(adapter);

    const result = await service.performProjectImport(1, "ip-1", {
      updatedWithinDays: 90,
      cap: 1,
    });

    expect(result.imported).toBe(1);
    expect(result.reachedCap).toBe(true);
    expect(mockIssueUpsert).toHaveBeenCalledTimes(1);
  });

  it("skips issues outside the recency window (client-side fallback)", async () => {
    const { SyncService } = await import("./SyncService");
    const service = new SyncService();

    const adapter = makeSearchAdapter([
      {
        issues: [
          makeExtIssue({ id: "recent", updatedAt: new Date() }),
          makeExtIssue({
            id: "stale",
            updatedAt: new Date(Date.now() - 60 * 86_400_000),
          }),
        ],
        total: 2,
        hasMore: false,
      },
    ]);
    mockGetAdapter.mockResolvedValue(adapter);

    const result = await service.performProjectImport(1, "ip-1", {
      updatedWithinDays: 30,
      cap: 200,
    });

    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
    expect(mockIssueUpsert).toHaveBeenCalledTimes(1);
    expect(mockIssueUpsert.mock.calls[0][0].where).toEqual({
      externalId_integrationId: { externalId: "recent", integrationId: 1 },
    });
  });

  it("marks the mapping in error when the tracker search fails", async () => {
    const { SyncService } = await import("./SyncService");
    const service = new SyncService();

    const adapter = {
      searchIssues: vi.fn().mockRejectedValue(new Error("tracker unreachable")),
      getCapabilities: vi.fn().mockReturnValue({ searchIssues: true }),
    };
    mockGetAdapter.mockResolvedValue(adapter);

    const result = await service.performProjectImport(1, "ip-1", {
      updatedWithinDays: 90,
      cap: 200,
    });

    expect(result.imported).toBe(0);
    expect(result.errors.some((e) => e.includes("tracker unreachable"))).toBe(
      true
    );
    const errorCall = mockIpUpdate.mock.calls.find(
      (c) => c[0].data.syncStatus === "error"
    );
    expect(errorCall).toBeDefined();
    expect(errorCall![0].data.syncError).toContain("tracker unreachable");
  });

  it("resolves the Azure project reference by name", async () => {
    const { SyncService } = await import("./SyncService");
    const service = new SyncService();

    mockIntegrationFindUnique.mockResolvedValue({ provider: "AZURE_DEVOPS" });
    mockIpFindUnique.mockResolvedValue(
      makeMapping({
        externalProjectId: "guid-123",
        externalProjectKey: "guid-123",
        externalProjectName: "My ADO Project",
      })
    );

    const adapter = makeSearchAdapter([
      { issues: [], total: 0, hasMore: false },
    ]);
    mockGetAdapter.mockResolvedValue(adapter);

    await service.performProjectImport(1, "ip-1", { updatedWithinDays: 90 });

    expect(adapter.searchIssues).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "My ADO Project" })
    );
  });

  it("follows nextPageToken across pages (Jira cursor pagination)", async () => {
    const { SyncService } = await import("./SyncService");
    const service = new SyncService();

    const searchIssues = vi
      .fn()
      .mockResolvedValueOnce({
        issues: [makeExtIssue({ id: "p1a" }), makeExtIssue({ id: "p1b" })],
        total: 2,
        hasMore: true,
        nextPageToken: "CURSOR-2",
      })
      .mockResolvedValueOnce({
        issues: [makeExtIssue({ id: "p2a" })],
        total: 1,
        hasMore: false,
        nextPageToken: undefined,
      });
    mockGetAdapter.mockResolvedValue({
      searchIssues,
      getCapabilities: vi.fn().mockReturnValue({ searchIssues: true }),
    });

    const result = await service.performProjectImport(1, "ip-1", {
      updatedWithinDays: 365,
      cap: 200,
    });

    expect(result.imported).toBe(3);
    expect(searchIssues).toHaveBeenCalledTimes(2);
    // The second page request must carry the cursor returned by the first.
    expect(searchIssues.mock.calls[1][0]).toEqual(
      expect.objectContaining({ pageToken: "CURSOR-2" })
    );
  });

  it("previewProjectImport uses the tracker-reported total when present", async () => {
    const { SyncService } = await import("./SyncService");
    const service = new SyncService();

    const adapter = makeSearchAdapter([
      {
        issues: [makeExtIssue({ id: "a" }), makeExtIssue({ id: "b" })],
        total: 42,
        hasMore: true,
      },
    ]);
    mockGetAdapter.mockResolvedValue(adapter);

    const result = await service.previewProjectImport(1, "ip-1", {
      updatedWithinDays: 90,
      cap: 200,
    });

    expect(result.matched).toBe(42);
    expect(result.hasMore).toBe(true);
    expect(result.cap).toBe(200);
  });

  it("previewProjectImport falls back to the page count when total is absent (Jira /search/jql)", async () => {
    const { SyncService } = await import("./SyncService");
    const service = new SyncService();

    // A partial page (< page size) with no `total` → exact count, no more.
    const partial = makeSearchAdapter([
      {
        issues: Array.from({ length: 12 }, (_, i) =>
          makeExtIssue({ id: `p${i}` })
        ),
        total: undefined,
        hasMore: false,
      },
    ]);
    mockGetAdapter.mockResolvedValue(partial);

    const r1 = await service.previewProjectImport(1, "ip-1", {
      updatedWithinDays: 365,
    });
    expect(r1.matched).toBe(12);
    expect(r1.hasMore).toBe(false);

    // A full page with no `total` → count of the page, and hasMore inferred.
    const full = makeSearchAdapter([
      {
        issues: Array.from({ length: 50 }, (_, i) =>
          makeExtIssue({ id: `f${i}` })
        ),
        total: undefined,
        hasMore: false,
      },
    ]);
    mockGetAdapter.mockResolvedValue(full);

    const r2 = await service.previewProjectImport(1, "ip-1", {
      updatedWithinDays: 365,
    });
    expect(r2.matched).toBe(50);
    expect(r2.hasMore).toBe(true);
  });
});
