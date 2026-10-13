import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Guard scaffold (PROV-05) for SyncService.upsertIssueFromExternal's
 * cross-project protection: a second project's sync of the same external
 * issue must never silently reassign an existing row's projectId. The
 * dedup key (`Issue @@unique([externalId, integrationId])`) carries no
 * projectId, so this guard lives inside the update branch of the upsert
 * itself rather than as a schema constraint.
 *
 * Run: cd testplanit && pnpm exec vitest run lib/integrations/services/SyncService.upsertIssueFromExternal
 */

// ---------------------------------------------------------------------------
// Mock rawDb — SyncService imports `rawDb` from "@/lib/rawDb"
// ---------------------------------------------------------------------------
const mockProjectsFindUnique = vi.fn();
const mockIssueUpsert = vi.fn();

vi.mock("@/lib/rawDb", () => ({
  rawDb: {
    projects: {
      findUnique: (...args: any[]) => mockProjectsFindUnique(...args),
    },
    issue: {
      upsert: (...args: any[]) => mockIssueUpsert(...args),
    },
  },
}));

// ---------------------------------------------------------------------------
// Mock side-effect deps of the upsert path
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
vi.mock("../../valkey", () => ({ default: null }));

function makeIssueData(overrides: Record<string, any> = {}) {
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

describe("SyncService.upsertIssueFromExternal cross-project guard (PROV-05)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProjectsFindUnique.mockResolvedValue({ createdBy: "creator-1" });
  });

  it("throws instead of reassigning projectId when the matched row belongs to another project and has dependents", async () => {
    const syncServiceModule = await import("./SyncService");
    const service = new syncServiceModule.SyncService();
    const rawDbModule = await import("@/lib/rawDb");
    const db = (rawDbModule as any).rawDb;
    db.issue.findUnique = vi.fn().mockResolvedValue({
      id: 42,
      projectId: 4,
      _count: { children: 2, caseIssues: 0, milestoneIssues: 0 },
    });
    mockIssueUpsert.mockResolvedValue({ id: 555 });

    await expect(
      (service as any).upsertIssueFromExternal(
        db,
        1,
        7,
        makeIssueData({ id: "ext-shared" })
      )
    ).rejects.toThrow(/Refusing to reassign Issue 42/);
  });

  it("does not call db.issue.upsert when the guard fires", async () => {
    const syncServiceModule = await import("./SyncService");
    const service = new syncServiceModule.SyncService();
    const rawDbModule = await import("@/lib/rawDb");
    const db = (rawDbModule as any).rawDb;
    db.issue.findUnique = vi.fn().mockResolvedValue({
      id: 42,
      projectId: 4,
      _count: { children: 2, caseIssues: 0, milestoneIssues: 0 },
    });
    mockIssueUpsert.mockResolvedValue({ id: 555 });

    await expect(
      (service as any).upsertIssueFromExternal(
        db,
        1,
        7,
        makeIssueData({ id: "ext-shared" })
      )
    ).rejects.toThrow();

    expect(mockIssueUpsert).not.toHaveBeenCalled();
  });

  it("allows the upsert when the matched row belongs to another project but has no dependents", async () => {
    const syncServiceModule = await import("./SyncService");
    const service = new syncServiceModule.SyncService();
    const rawDbModule = await import("@/lib/rawDb");
    const db = (rawDbModule as any).rawDb;
    db.issue.findUnique = vi.fn().mockResolvedValue({
      id: 42,
      projectId: 4,
      _count: { children: 0, caseIssues: 0, milestoneIssues: 0 },
    });
    mockIssueUpsert.mockResolvedValue({ id: 555 });

    const result = await (service as any).upsertIssueFromExternal(
      db,
      1,
      7,
      makeIssueData({ id: "ext-shared" })
    );

    expect(result).toEqual({ id: 555, created: false });
    expect(mockIssueUpsert).toHaveBeenCalledTimes(1);
  });

  it("allows the upsert when the matched row already belongs to the same project", async () => {
    const syncServiceModule = await import("./SyncService");
    const service = new syncServiceModule.SyncService();
    const rawDbModule = await import("@/lib/rawDb");
    const db = (rawDbModule as any).rawDb;
    db.issue.findUnique = vi.fn().mockResolvedValue({
      id: 42,
      projectId: 7,
      _count: { children: 3, caseIssues: 2, milestoneIssues: 1 },
    });
    mockIssueUpsert.mockResolvedValue({ id: 555 });

    const result = await (service as any).upsertIssueFromExternal(
      db,
      1,
      7,
      makeIssueData({ id: "ext-shared" })
    );

    expect(result).toEqual({ id: 555, created: false });
    expect(mockIssueUpsert).toHaveBeenCalledTimes(1);
  });
});
