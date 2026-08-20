import { beforeEach, describe, expect, it, vi } from "vitest";

// PROV-04 unit suite — the synced parentId resolution and isRequirement
// classification SyncService.upsertIssueFromExternal/updateExistingIssue
// gain in this phase.
//
// Two plans convert these titles, in order:
//   - 22-02 converts todos 1-9 (the inline best-effort resolve-on-sync
//     write, plus the isRequirement classification write).
//   - 22-05 converts todos 10-12 (the end-of-import re-resolution pass for
//     a tracker parent that had no local row yet at first sync).
//
// Titles are byte-stable — both converting plans depend on the exact
// wording landed here.

// ---------------------------------------------------------------------------
// Mock rawDb — SyncService imports `rawDb` from "@/lib/rawDb". Mirrors the
// mock/assert shape of SyncService.upsertIssueFromExternal.crossProject.test.ts
// (the PROV-05 guard precedent), extended with `issue.findFirst` (needed by
// both the parent-resolution lookup and updateExistingIssue's own existing-
// row lookup) and `projectIntegration.findFirst` (task 2's classification
// lookup, guarded so it never breaks a test that doesn't mock it).
// ---------------------------------------------------------------------------
const mockProjectsFindUnique = vi.fn();
const mockIssueUpsert = vi.fn();
const mockIssueUpdate = vi.fn();
const mockIssueFindFirst = vi.fn();
const mockIssueFindUnique = vi.fn();

vi.mock("@/lib/rawDb", () => ({
  rawDb: {
    projects: {
      findUnique: (...args: any[]) => mockProjectsFindUnique(...args),
    },
    issue: {
      upsert: (...args: any[]) => mockIssueUpsert(...args),
      update: (...args: any[]) => mockIssueUpdate(...args),
      findFirst: (...args: any[]) => mockIssueFindFirst(...args),
      findUnique: (...args: any[]) => mockIssueFindUnique(...args),
    },
  },
}));

// ---------------------------------------------------------------------------
// Mock side-effect deps of the write paths (same set as the crossProject
// guard test — issueSearch, multiTenantDb, queues, IssueCache, valkey).
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

describe("SyncService — synced parentId and requirement classification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProjectsFindUnique.mockResolvedValue({ createdBy: "creator-1" });
    mockIssueUpsert.mockResolvedValue({ id: 555 });
    mockIssueUpdate.mockResolvedValue({ id: 555 });
    // No pre-existing row by default (existence pre-check in
    // upsertIssueFromExternal) — created: true branch.
    mockIssueFindUnique.mockResolvedValue(null);
  });

  it("resolves a tracker parent ref to the local parent row id and writes it on upsert", async () => {
    const { SyncService } = await import("./SyncService");
    const service = new SyncService();
    const { rawDb } = await import("@/lib/rawDb");
    const db = rawDb as any;

    // The parent-resolution lookup: a local row with matching externalId,
    // same project (7) as the child being synced.
    mockIssueFindFirst.mockResolvedValueOnce({ id: 900, projectId: 7 });

    await (service as any).upsertIssueFromExternal(
      db,
      1,
      7,
      makeIssueData({
        id: "ext-child",
        parent: { id: "10050", key: "DEMO-1" },
      })
    );

    const call = mockIssueUpsert.mock.calls[0][0];
    expect(call.create.parentId).toBe(900);
    expect(call.update.parentId).toBe(900);
  });

  it("writes parentId: null explicitly when the tracker reports no parent", async () => {
    const { SyncService } = await import("./SyncService");
    const service = new SyncService();
    const { rawDb } = await import("@/lib/rawDb");
    const db = rawDb as any;

    await (service as any).upsertIssueFromExternal(
      db,
      1,
      7,
      makeIssueData({ id: "ext-no-parent" })
    );

    // Regression pin for the anti-pattern: the key must be PRESENT, not
    // merely falsy — a conditional-spread omission would fail this.
    const call = mockIssueUpsert.mock.calls[0][0];
    expect("parentId" in call.create).toBe(true);
    expect("parentId" in call.update).toBe(true);
    expect(call.create.parentId).toBeNull();
    expect(call.update.parentId).toBeNull();
    // No parent ref means the parent-resolution lookup is never reached.
    expect(mockIssueFindFirst).not.toHaveBeenCalled();
  });

  it("leaves parentId untouched when the tracker parent has no local row yet", async () => {
    const { SyncService } = await import("./SyncService");
    const service = new SyncService();
    const { rawDb } = await import("@/lib/rawDb");
    const db = rawDb as any;

    // No matching row found for the parent ref.
    mockIssueFindFirst.mockResolvedValueOnce(null);

    await expect(
      (service as any).upsertIssueFromExternal(
        db,
        1,
        7,
        makeIssueData({
          id: "ext-forward-ref",
          parent: { id: "not-yet-imported", key: "DEMO-2" },
        })
      )
    ).resolves.not.toThrow();

    const call = mockIssueUpsert.mock.calls[0][0];
    expect(call.create.parentId).toBeUndefined();
    expect(call.update.parentId).toBeUndefined();
  });

  it("leaves parentId untouched when the resolved parent belongs to a different project", async () => {
    const { SyncService } = await import("./SyncService");
    const service = new SyncService();
    const { rawDb } = await import("@/lib/rawDb");
    const db = rawDb as any;

    // Matching row found, but it belongs to project 4, not the owning
    // project (7) of the issue being synced — T-22-02-01.
    mockIssueFindFirst.mockResolvedValueOnce({ id: 900, projectId: 4 });

    await expect(
      (service as any).upsertIssueFromExternal(
        db,
        1,
        7,
        makeIssueData({
          id: "ext-cross-project",
          parent: { id: "10050", key: "DEMO-1" },
        })
      )
    ).resolves.not.toThrow();

    const call = mockIssueUpsert.mock.calls[0][0];
    expect(call.create.parentId).toBeUndefined();
    expect(call.update.parentId).toBeUndefined();
  });

  it("builds the parent lookup with only the identifier clauses the tracker actually supplied", async () => {
    const { resolveSyncedParentId } = await import("./SyncService");
    const { rawDb } = await import("@/lib/rawDb");
    const db = rawDb as any;

    mockIssueFindFirst.mockResolvedValueOnce(null);

    await resolveSyncedParentId(db, 1, 7, { id: "10050" });

    expect(mockIssueFindFirst).toHaveBeenCalledTimes(1);
    const { where } = mockIssueFindFirst.mock.calls[0][0];
    // A `{ externalKey: undefined }` clause would be an ignored predicate
    // that degrades the OR into match-anything — exactly one clause here
    // proves that trap did not land.
    expect(where.OR).toHaveLength(1);
    expect(where.OR).toEqual([{ externalId: "10050" }]);
  });

  it("updateExistingIssue writes parentId against the existing row's own project", async () => {
    const { SyncService } = await import("./SyncService");
    const service = new SyncService();
    const { rawDb } = await import("@/lib/rawDb");
    const db = rawDb as any;

    // First findFirst call = updateExistingIssue's own existing-row lookup;
    // second = the parent-resolution lookup inside resolveSyncedParentId.
    mockIssueFindFirst
      .mockResolvedValueOnce({ id: 42, projectId: 7, data: {} })
      .mockResolvedValueOnce({ id: 900, projectId: 7 });

    await (service as any).updateExistingIssue(
      db,
      1,
      makeIssueData({
        id: "ext-1",
        parent: { id: "10050", key: "DEMO-1" },
      })
    );

    expect(mockIssueUpdate).toHaveBeenCalledTimes(1);
    expect(mockIssueUpdate.mock.calls[0][0].data.parentId).toBe(900);

    // Second call: the existing row's own project is null — resolution
    // must not fall back to any other source and leaves parentId untouched.
    vi.clearAllMocks();
    mockIssueFindFirst
      .mockResolvedValueOnce({ id: 43, projectId: null, data: {} })
      .mockResolvedValueOnce({ id: 901, projectId: 7 });

    await (service as any).updateExistingIssue(
      db,
      1,
      makeIssueData({
        id: "ext-2",
        parent: { id: "10051", key: "DEMO-3" },
      })
    );

    expect(mockIssueUpdate.mock.calls[0][0].data.parentId).toBeUndefined();
  });

  it.todo(
    "sets isRequirement from the project's configured requirement issue types"
  );
  it.todo("clears isRequirement when the issue type is not configured");
  it.todo(
    "leaves isRequirement untouched when the db client does not expose projectIntegration"
  );
  it.todo(
    "reports an unresolved tracker parent through upsertIssueFromExternal's result"
  );
  it.todo(
    "re-resolves deferred parents after the import loop and links the child"
  );
  it.todo(
    "leaves a still-unresolvable deferred parent for a later sync pass"
  );
});
