import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * SyncService.upsertIssueFromExternal's cross-project contract: one Issue row
 * per tracker ticket per integration is shared by every project that imports
 * it. The dedup key (`Issue @@unique([externalId, integrationId])`) carries
 * no projectId, so a second project's import takes the update branch — it
 * must leave the home project alone and record itself as a member instead.
 *
 * Run: cd testplanit && pnpm exec vitest run lib/integrations/services/SyncService.upsertIssueFromExternal
 */

// ---------------------------------------------------------------------------
// Mock rawDb — SyncService imports `rawDb` from "@/lib/rawDb"
// ---------------------------------------------------------------------------
const mockProjectsFindUnique = vi.fn();
const mockIssueUpsert = vi.fn();
const mockMembershipUpsert = vi.fn();

vi.mock("@/lib/rawDb", () => ({
  rawDb: {
    projects: {
      findUnique: (...args: any[]) => mockProjectsFindUnique(...args),
    },
    issue: {
      upsert: (...args: any[]) => mockIssueUpsert(...args),
    },
    issueProjectMembership: {
      upsert: (...args: any[]) => mockMembershipUpsert(...args),
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

async function setup(existing: Record<string, any> | null) {
  const syncServiceModule = await import("./SyncService");
  const service = new syncServiceModule.SyncService();
  const rawDbModule = await import("@/lib/rawDb");
  const db = (rawDbModule as any).rawDb;
  db.issue.findUnique = vi.fn().mockResolvedValue(existing);
  return { service, db };
}

describe("SyncService.upsertIssueFromExternal shared across projects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProjectsFindUnique.mockResolvedValue({ createdBy: "creator-1" });
    mockIssueUpsert.mockResolvedValue({ id: 42, projectId: 4 });
    mockMembershipUpsert.mockResolvedValue({});
  });

  it("does not move a row another project imported first", async () => {
    const { service, db } = await setup({ id: 42, projectId: 4 });

    const result = await (service as any).upsertIssueFromExternal(
      db,
      1,
      7,
      makeIssueData({ id: "ext-shared" })
    );

    expect(result).toEqual({ id: 42, created: false, isRequirement: false });
    const call = mockIssueUpsert.mock.calls[0][0];
    expect(call.update).not.toHaveProperty("projectId");
    expect(call.create.projectId).toBe(7);
  });

  it("records the importing project as a member of the shared row", async () => {
    const { service, db } = await setup({ id: 42, projectId: 4 });

    await (service as any).upsertIssueFromExternal(
      db,
      1,
      7,
      makeIssueData({ id: "ext-shared" })
    );

    expect(mockMembershipUpsert).toHaveBeenCalledWith({
      where: { issueId_projectId: { issueId: 42, projectId: 7 } },
      create: { issueId: 42, projectId: 7 },
      update: {},
    });
  });

  it("makes the first importer the home project and a member", async () => {
    const { service, db } = await setup(null);
    mockIssueUpsert.mockResolvedValue({ id: 555, projectId: 7 });

    const result = await (service as any).upsertIssueFromExternal(
      db,
      1,
      7,
      makeIssueData({ id: "ext-new" })
    );

    expect(result).toEqual({ id: 555, created: true, isRequirement: false });
    expect(mockIssueUpsert.mock.calls[0][0].create.projectId).toBe(7);
    expect(mockMembershipUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { issueId_projectId: { issueId: 555, projectId: 7 } },
      })
    );
  });

  it("skips the membership write on a client that does not expose the model", async () => {
    const { service, db } = await setup({ id: 42, projectId: 4 });
    const narrowDb = { ...db, issueProjectMembership: undefined };

    await expect(
      (service as any).upsertIssueFromExternal(
        narrowDb,
        1,
        7,
        makeIssueData({ id: "ext-shared" })
      )
    ).resolves.toEqual({ id: 42, created: false, isRequirement: false });
    expect(mockMembershipUpsert).not.toHaveBeenCalled();
  });
});
