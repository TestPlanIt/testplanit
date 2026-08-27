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

// ---------------------------------------------------------------------------
// Task 1 (28-05) — cooperative cancellation of a running paged-to-completion
// import. `mockIpFindUnique` is called once up front by every run (the
// mapping resolution) — these tests queue additional resolved values for the
// per-page cancel re-read that follows.
// ---------------------------------------------------------------------------
describe("SyncService — performProjectImport cooperative cancellation (#501/28-05)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIpFindUnique.mockResolvedValue(makeMapping());
    mockIpUpdate.mockResolvedValue({});
    mockIntegrationFindUnique.mockResolvedValue({ provider: "JIRA" });
    mockProjectsFindUnique.mockResolvedValue({ createdBy: "creator-1" });
    mockIssueUpsert.mockResolvedValue({ id: 101 });
  });

  it("stops between pages when a cancel is requested", async () => {
    const { SyncService } = await import("./SyncService");
    const service = new SyncService();

    const adapter = makeSearchAdapter(makeFullPages(5));
    mockGetAdapter.mockResolvedValue(adapter);

    mockIpFindUnique
      .mockResolvedValueOnce(makeMapping()) // initial mapping resolution
      .mockResolvedValueOnce({ syncStatus: "syncing" }) // cancel check after page 1
      .mockResolvedValueOnce({ syncStatus: "cancel-requested" }); // cancel check after page 2

    const result = await service.performProjectImport(1, "ip-1", {
      pagedToCompletion: true,
    });

    expect(adapter.searchIssues).toHaveBeenCalledTimes(2);
    expect(result.cancelled).toBe(true);
  });

  it("keeps the rows it already imported when cancelled", async () => {
    const { SyncService } = await import("./SyncService");
    const service = new SyncService();

    const adapter = makeSearchAdapter(makeFullPages(5));
    mockGetAdapter.mockResolvedValue(adapter);

    mockIpFindUnique
      .mockResolvedValueOnce(makeMapping())
      .mockResolvedValueOnce({ syncStatus: "syncing" })
      .mockResolvedValueOnce({ syncStatus: "cancel-requested" });

    const result = await service.performProjectImport(1, "ip-1", {
      pagedToCompletion: true,
    });

    expect(result.imported).toBe(2 * PAGE_SIZE);
    // Every imported row went through upsert (never a compensating delete —
    // this mocked client exposes no delete method at all, so a rollback
    // attempt would have thrown rather than silently no-opped).
    expect(mockIssueUpsert).toHaveBeenCalledTimes(2 * PAGE_SIZE);
  });

  it("ends a cancelled run in a terminal cancelled state", async () => {
    const { SyncService } = await import("./SyncService");
    const service = new SyncService();

    const adapter = makeSearchAdapter(makeFullPages(5));
    mockGetAdapter.mockResolvedValue(adapter);

    mockIpFindUnique
      .mockResolvedValueOnce(makeMapping())
      .mockResolvedValueOnce({ syncStatus: "syncing" })
      .mockResolvedValueOnce({ syncStatus: "cancel-requested" });

    await service.performProjectImport(1, "ip-1", { pagedToCompletion: true });

    const lastCall =
      mockIpUpdate.mock.calls[mockIpUpdate.mock.calls.length - 1];
    expect(lastCall[0].data.syncStatus).toBe("cancelled");
    expect(lastCall[0].data.syncStatus).not.toBe("error");
  });

  it("stops when the mapping row disappears mid-run", async () => {
    const { SyncService } = await import("./SyncService");
    const service = new SyncService();

    const adapter = makeSearchAdapter(makeFullPages(5));
    mockGetAdapter.mockResolvedValue(adapter);

    mockIpFindUnique
      .mockResolvedValueOnce(makeMapping()) // initial mapping resolution
      .mockResolvedValueOnce(null); // mapping gone by the first per-page check

    const result = await service.performProjectImport(1, "ip-1", {
      pagedToCompletion: true,
    });

    expect(adapter.searchIssues).toHaveBeenCalledTimes(1);
    expect(result.cancelled).toBe(true);
  });

  it("does not re-read the mapping per page in recency mode", async () => {
    const { SyncService } = await import("./SyncService");
    const service = new SyncService();

    const adapter = makeSearchAdapter(makeFullPages(3));
    mockGetAdapter.mockResolvedValue(adapter);

    await service.performProjectImport(1, "ip-1", {});

    // Only the initial mapping resolution — the recency-window mode must
    // gain no per-page cancel re-read (T-28-05-02).
    expect(mockIpFindUnique).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Task 2 — the windowless, type-scoped count probe
// ---------------------------------------------------------------------------
describe("SyncService — previewProjectImport type-scoped windowless probe (#501/28-04)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIpFindUnique.mockResolvedValue(makeMapping());
    mockIpUpdate.mockResolvedValue({});
    mockIntegrationFindUnique.mockResolvedValue({ provider: "JIRA" });
    mockProjectsFindUnique.mockResolvedValue({ createdBy: "creator-1" });
    mockIssueUpsert.mockResolvedValue({ id: 101 });
  });

  it("passes issueTypeIds to searchIssues and reports the type-scoped count", async () => {
    const { SyncService } = await import("./SyncService");
    const service = new SyncService();

    const adapter = makeSearchAdapter([
      {
        issues: [makeExtIssue({ id: "a" }), makeExtIssue({ id: "b" })],
        total: 7,
        hasMore: true,
      },
    ]);
    mockGetAdapter.mockResolvedValue(adapter);

    const result = await service.previewProjectImport(1, "ip-1", {
      issueTypeIds: ["10001", "10002"],
    });

    expect(adapter.searchIssues).toHaveBeenCalledWith(
      expect.objectContaining({ issueTypeIds: ["10001", "10002"] })
    );
    expect(result.matched).toBe(7);
    expect(result.hasMore).toBe(true);
  });

  it("passes no recency window to searchIssues when updatedWithinDays is omitted", async () => {
    const { SyncService } = await import("./SyncService");
    const service = new SyncService();

    const adapter = makeSearchAdapter([
      { issues: [makeExtIssue({ id: "a" })], total: 1, hasMore: false },
    ]);
    mockGetAdapter.mockResolvedValue(adapter);

    await service.previewProjectImport(1, "ip-1", {
      issueTypeIds: ["10001"],
    });

    expect(adapter.searchIssues).toHaveBeenCalledWith(
      expect.objectContaining({ updatedWithinDays: undefined })
    );
  });

  it("yields an honest at-least-N with hasMore true for a provider that can only report its page length", async () => {
    const { SyncService } = await import("./SyncService");
    const service = new SyncService();

    const adapter = makeSearchAdapter([
      {
        issues: Array.from({ length: PAGE_SIZE }, (_, i) =>
          makeExtIssue({ id: `t${i}` })
        ),
        total: undefined,
        hasMore: false,
      },
    ]);
    mockGetAdapter.mockResolvedValue(adapter);

    const result = await service.previewProjectImport(1, "ip-1", {
      issueTypeIds: ["10001"],
    });

    expect(result.matched).toBe(PAGE_SIZE);
    expect(result.hasMore).toBe(true);
  });

  it("leaves the recency preview's searchIssues call arguments unchanged when issueTypeIds is omitted", async () => {
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

    expect(adapter.searchIssues).toHaveBeenCalledWith({
      projectId: "TPI",
      updatedWithinDays: 90,
      fullSync: true,
      limit: PAGE_SIZE,
      offset: 0,
      issueTypeIds: undefined,
    });
    expect(result.matched).toBe(42);
    expect(result.hasMore).toBe(true);
    expect(result.cap).toBe(200);
  });
});
