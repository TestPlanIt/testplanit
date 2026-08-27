import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock rawDb — SyncService imports `rawDb` from "@/lib/rawDb"
// Mirrors SyncService.projectImport.test.ts's mocked-adapter/db idiom.
// ---------------------------------------------------------------------------
const mockIpFindUnique = vi.fn();
const mockIpUpdate = vi.fn();
const mockIntegrationFindUnique = vi.fn();
const mockProjectsFindUnique = vi.fn();
const mockIssueUpsert = vi.fn();

vi.mock("@/lib/rawDb", () => ({
  rawDb: {
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
vi.mock("../../multiTenantDb", () => ({
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

// The production IMPORT_PAGE_SIZE is 50 and is not exported (private
// implementation detail) — literal 50 here matches it so "a full page"
// behaves as the loop expects (page < IMPORT_PAGE_SIZE would otherwise
// force hasMore false early).
const PAGE_SIZE = 50;

function makeFullPages(pageCount: number) {
  return Array.from({ length: pageCount }, (_, p) => ({
    issues: Array.from({ length: PAGE_SIZE }, (_, i) =>
      makeExtIssue({ id: `p${p}-${i}` })
    ),
    total: undefined,
    hasMore: p < pageCount - 1,
  }));
}

// ---------------------------------------------------------------------------
// Task 1 — the typed, windowless, paged-to-completion import mode
// ---------------------------------------------------------------------------
describe("SyncService — performProjectImport pagedToCompletion mode (#501/28-04)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIpFindUnique.mockResolvedValue(makeMapping());
    mockIpUpdate.mockResolvedValue({});
    mockIntegrationFindUnique.mockResolvedValue({ provider: "JIRA" });
    mockProjectsFindUnique.mockResolvedValue({ createdBy: "creator-1" });
    mockIssueUpsert.mockResolvedValue({ id: 101 });
  });

  it("pages past IMPORT_MAX_PAGES (40) when the tracker keeps yielding full pages", async () => {
    const { SyncService } = await import("./SyncService");
    const service = new SyncService();

    const adapter = makeSearchAdapter(makeFullPages(45));
    mockGetAdapter.mockResolvedValue(adapter);

    const result = await service.performProjectImport(1, "ip-1", {
      pagedToCompletion: true,
    });

    expect(adapter.searchIssues).toHaveBeenCalledTimes(45);
    expect(result.imported).toBe(45 * PAGE_SIZE);
  });

  it("imports past 200 rows without a cap being reached", async () => {
    const { SyncService } = await import("./SyncService");
    const service = new SyncService();

    const adapter = makeSearchAdapter(makeFullPages(6)); // 300 issues
    mockGetAdapter.mockResolvedValue(adapter);

    const result = await service.performProjectImport(1, "ip-1", {
      pagedToCompletion: true,
    });

    expect(result.imported).toBe(6 * PAGE_SIZE);
    expect(result.reachedCap).toBe(false);
  });

  it("passes issueTypeIds on every searchIssues call", async () => {
    const { SyncService } = await import("./SyncService");
    const service = new SyncService();

    const adapter = makeSearchAdapter(makeFullPages(3));
    mockGetAdapter.mockResolvedValue(adapter);

    await service.performProjectImport(1, "ip-1", {
      pagedToCompletion: true,
      issueTypeIds: ["10001", "10002"],
    });

    expect(adapter.searchIssues).toHaveBeenCalledTimes(3);
    adapter.searchIssues.mock.calls.forEach((call: any[]) => {
      expect(call[0]).toEqual(
        expect.objectContaining({ issueTypeIds: ["10001", "10002"] })
      );
    });
  });

  it("skips an issue whose issueType is outside the selected set and counts it in skipped", async () => {
    const { SyncService } = await import("./SyncService");
    const service = new SyncService();

    const adapter = makeSearchAdapter([
      {
        issues: [
          makeExtIssue({
            id: "story-1",
            issueType: { id: "10001", name: "Story" },
          }),
          makeExtIssue({
            id: "bug-1",
            issueType: { id: "10002", name: "Bug" },
          }),
        ],
        total: 2,
        hasMore: false,
      },
    ]);
    mockGetAdapter.mockResolvedValue(adapter);

    const result = await service.performProjectImport(1, "ip-1", {
      pagedToCompletion: true,
      issueTypeIds: ["10001"],
    });

    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
    expect(mockIssueUpsert).toHaveBeenCalledTimes(1);
    expect(mockIssueUpsert.mock.calls[0][0].where).toEqual({
      externalId_integrationId: { externalId: "story-1", integrationId: 1 },
    });
  });

  it("skips an issue with no issueType at all when a type filter is active (the pre-28-02 ADO/GitLab shape)", async () => {
    const { SyncService } = await import("./SyncService");
    const service = new SyncService();

    const adapter = makeSearchAdapter([
      {
        issues: [makeExtIssue({ id: "untyped-1", issueType: undefined })],
        total: 1,
        hasMore: false,
      },
    ]);
    mockGetAdapter.mockResolvedValue(adapter);

    const result = await service.performProjectImport(1, "ip-1", {
      pagedToCompletion: true,
      issueTypeIds: ["10001"],
    });

    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);
    expect(mockIssueUpsert).not.toHaveBeenCalled();
  });

  it("does not end the import when a page's issues are all filtered out by the type predicate", async () => {
    const { SyncService } = await import("./SyncService");
    const service = new SyncService();

    const adapter = makeSearchAdapter([
      {
        // A FULL page (PAGE_SIZE) so the "hasMore but short page => last
        // page" heuristic guard doesn't override the tracker's own hasMore.
        issues: Array.from({ length: PAGE_SIZE }, (_, i) =>
          makeExtIssue({
            id: `bug-${i}`,
            issueType: { id: "10002", name: "Bug" },
          })
        ),
        total: PAGE_SIZE,
        hasMore: true,
      },
      {
        issues: [
          makeExtIssue({
            id: "story-1",
            issueType: { id: "10001", name: "Story" },
          }),
        ],
        total: 1,
        hasMore: false,
      },
    ]);
    mockGetAdapter.mockResolvedValue(adapter);

    const result = await service.performProjectImport(1, "ip-1", {
      pagedToCompletion: true,
      issueTypeIds: ["10001"],
    });

    expect(adapter.searchIssues).toHaveBeenCalledTimes(2);
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(PAGE_SIZE);
  });

  it("applies no recency cutoff when pagedToCompletion is set, even if updatedWithinDays is present", async () => {
    const { SyncService } = await import("./SyncService");
    const service = new SyncService();

    const adapter = makeSearchAdapter([
      {
        issues: [
          makeExtIssue({ id: "recent", updatedAt: new Date() }),
          makeExtIssue({
            id: "stale",
            updatedAt: new Date(Date.now() - 400 * 86_400_000),
          }),
        ],
        total: 2,
        hasMore: false,
      },
    ]);
    mockGetAdapter.mockResolvedValue(adapter);

    const result = await service.performProjectImport(1, "ip-1", {
      pagedToCompletion: true,
      updatedWithinDays: 30,
    });

    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(0);
  });

  it("reports progress with a running count and no percentage or fabricated total", async () => {
    const { SyncService } = await import("./SyncService");
    const service = new SyncService();

    const adapter = makeSearchAdapter([
      {
        issues: [makeExtIssue({ id: "a" }), makeExtIssue({ id: "b" })],
        total: 2,
        hasMore: false,
      },
    ]);
    mockGetAdapter.mockResolvedValue(adapter);

    const updateProgress = vi.fn().mockResolvedValue(undefined);
    const job = { updateProgress } as any;

    await service.performProjectImport(
      1,
      "ip-1",
      { pagedToCompletion: true },
      job
    );

    expect(updateProgress).toHaveBeenCalled();
    updateProgress.mock.calls.forEach((call: any[]) => {
      const payload = call[0];
      expect(payload.percentage).toBeUndefined();
      expect(payload.total === null || payload.total === undefined).toBe(true);
      expect(typeof payload.current).toBe("number");
    });
  });

  it("reports reachedCap false and an honest (non-fabricated) cappedAt", async () => {
    const { SyncService } = await import("./SyncService");
    const service = new SyncService();

    const adapter = makeSearchAdapter(makeFullPages(2)); // 100 issues
    mockGetAdapter.mockResolvedValue(adapter);

    const result = await service.performProjectImport(1, "ip-1", {
      pagedToCompletion: true,
    });

    expect(result.reachedCap).toBe(false);
    expect(result.cappedAt).not.toBe(Number.MAX_SAFE_INTEGER);
    expect(result.cappedAt).toBe(result.imported);
  });
});
