import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * RED scaffold (18-01) for the not-yet-exported `upsertIssueFromExternal`
 * on SyncService — the D-12 refactor target of the current private
 * `_createIssueFromExternal` (SyncService.ts:1506-1586).
 *
 * Target signature (locked in 18-01-PLAN.md <interfaces>):
 *   upsertIssueFromExternal(db, integrationId: number, projectId: number, issueData: IssueData)
 *     => Promise<{ id: number; created: boolean }>
 *
 * This is a signature/visibility change only — membership import (Phase 18
 * Plan 03+) MUST delegate issue-row writes here rather than growing a
 * milestone-private issue writer (D-12). These tests MUST fail at authoring
 * time: `upsertIssueFromExternal` does not exist as a public export yet.
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

describe("SyncService.upsertIssueFromExternal (D-12 canonical upsert)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProjectsFindUnique.mockResolvedValue({ createdBy: "creator-1" });
  });

  it("is exported as a public method callable without reaching into a private", async () => {
    const syncServiceModule = await import("./SyncService");
    const service = new syncServiceModule.SyncService();

    // This assertion is the RED pin: today only `_createIssueFromExternal`
    // (private) exists. `upsertIssueFromExternal` must be a real, callable,
    // exported method on the class instance.
    expect(typeof (service as any).upsertIssueFromExternal).toBe("function");
  });

  it("returns { id, created: true } for a brand-new externalId_integrationId pair", async () => {
    mockIssueUpsert.mockResolvedValue({ id: 555 });

    const syncServiceModule = await import("./SyncService");
    const service = new syncServiceModule.SyncService();
    const rawDbModule = await import("@/lib/rawDb");

    const result = await (service as any).upsertIssueFromExternal(
      (rawDbModule as any).rawDb,
      1,
      42,
      makeIssueData({ id: "ext-new" })
    );

    expect(result).toEqual({ id: 555, created: true });
  });

  it("returns { id, created: false } when the row already existed and was updated in place", async () => {
    // Simulate an existing row: findUnique-style pre-check the implementation
    // is expected to perform before the upsert to derive `created`.
    mockIssueUpsert.mockResolvedValue({ id: 555 });

    const syncServiceModule = await import("./SyncService");
    const service = new syncServiceModule.SyncService();
    const rawDbModule = await import("@/lib/rawDb");
    const db = (rawDbModule as any).rawDb;
    // A pre-existing-row lookup path (findUnique) would resolve truthy in a
    // real implementation — RED pin only asserts the contract's `created`
    // field distinguishes create vs update; the mock above simulates the
    // "already existed" branch via a second call with the same external id.
    (db.issue as any).findUnique = vi.fn().mockResolvedValue({ id: 555 });

    const result = await (service as any).upsertIssueFromExternal(
      db,
      1,
      42,
      makeIssueData({ id: "ext-existing" })
    );

    expect(result.created).toBe(false);
    expect(result.id).toBe(555);
  });

  it("writes via db.issue.upsert keyed on externalId_integrationId", async () => {
    mockIssueUpsert.mockResolvedValue({ id: 555 });

    const syncServiceModule = await import("./SyncService");
    const service = new syncServiceModule.SyncService();
    const rawDbModule = await import("@/lib/rawDb");

    await (service as any).upsertIssueFromExternal(
      (rawDbModule as any).rawDb,
      7,
      42,
      makeIssueData({ id: "ext-1" })
    );

    expect(mockIssueUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          externalId_integrationId: {
            externalId: "ext-1",
            integrationId: 7,
          },
        },
      })
    );
  });

  it("threads issueData.parent through buildSyncedIssueData into Issue.data when present", async () => {
    mockIssueUpsert.mockResolvedValue({ id: 555 });

    const syncServiceModule = await import("./SyncService");
    const service = new syncServiceModule.SyncService();
    const rawDbModule = await import("@/lib/rawDb");

    await (service as any).upsertIssueFromExternal(
      (rawDbModule as any).rawDb,
      1,
      42,
      makeIssueData({
        id: "ext-child",
        parent: { id: "999", key: "TPI-999" },
      })
    );

    const call = mockIssueUpsert.mock.calls[0][0];
    // buildSyncedIssueData must have captured the parent ref into the JSON
    // payload written to Issue.data — the D-14 hierarchy seam.
    expect(call.create.data).toMatchObject({
      parent: { id: "999", key: "TPI-999" },
    });
    expect(call.update.data).toMatchObject({
      parent: { id: "999", key: "TPI-999" },
    });
  });
});
