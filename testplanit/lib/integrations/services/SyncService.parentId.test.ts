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
const mockProjectIntegrationFindFirst = vi.fn();
// Added for 22-05's performProjectImport re-resolution-pass cases (todos
// 10-12): the mapping/integration lookups performProjectImport itself
// makes, plus the raw parameterized write the end-of-run pass issues.
const mockIpFindUnique = vi.fn();
const mockIpUpdate = vi.fn();
const mockIntegrationFindUnique = vi.fn();
const mockExecuteRaw = vi.fn();

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
    projectIntegration: {
      findFirst: (...args: any[]) => mockProjectIntegrationFindFirst(...args),
    },
    integrationProject: {
      findUnique: (...args: any[]) => mockIpFindUnique(...args),
      update: (...args: any[]) => mockIpUpdate(...args),
    },
    integration: {
      findUnique: (...args: any[]) => mockIntegrationFindUnique(...args),
    },
    $executeRaw: (...args: any[]) => mockExecuteRaw(...args),
  },
}));

// performProjectImport resolves its adapter via IntegrationManager —
// mocked here so the three new cases below never touch a real tracker.
const mockGetAdapter = vi.fn();
vi.mock("../IntegrationManager", () => ({
  integrationManager: {
    getAdapter: (...args: any[]) => mockGetAdapter(...args),
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

  it("updateExistingIssue strips the locally-owned columns for a DETACHED requirement — only the mirrors refresh", async () => {
    const { SyncService } = await import("./SyncService");
    const service = new SyncService();
    const { rawDb } = await import("@/lib/rawDb");
    const db = rawDb as any;

    mockIssueFindFirst.mockResolvedValueOnce({
      id: 44,
      projectId: 7,
      data: {},
      isRequirement: true,
      requirementDetachedAt: new Date("2026-08-01T00:00:00Z"),
    });

    await (service as any).updateExistingIssue(
      db,
      1,
      makeIssueData({ id: "ext-detached", priority: "High", status: "closed" })
    );

    expect(mockIssueUpdate).toHaveBeenCalledTimes(1);
    const data = mockIssueUpdate.mock.calls[0][0].data;
    for (const field of [
      "title",
      "description",
      "status",
      "priority",
      "parentId",
    ]) {
      expect(data).not.toHaveProperty(field);
    }
    expect(data.externalStatus).toBe("closed");
    expect(data.externalPriority).toBe("High");
    expect(data.lastSyncedAt).toBeInstanceOf(Date);
  });

  it("sets isRequirement from the project's configured requirement issue types", async () => {
    const { SyncService } = await import("./SyncService");
    const service = new SyncService();
    const { rawDb } = await import("@/lib/rawDb");
    const db = rawDb as any;

    mockProjectIntegrationFindFirst.mockResolvedValue({
      config: { requirements: { enabled: true, issueTypeIds: ["10001"] } },
    });

    await (service as any).upsertIssueFromExternal(
      db,
      1,
      7,
      makeIssueData({ id: "ext-req", issueType: { id: "10001" } })
    );

    const call = mockIssueUpsert.mock.calls[0][0];
    expect(call.create.isRequirement).toBe(true);
    expect(call.update.isRequirement).toBe(true);
  });

  it("clears isRequirement when the issue type is not configured", async () => {
    const { SyncService } = await import("./SyncService");
    const service = new SyncService();
    const { rawDb } = await import("@/lib/rawDb");
    const db = rawDb as any;

    mockProjectIntegrationFindFirst.mockResolvedValue({
      config: { requirements: { enabled: true, issueTypeIds: ["10001"] } },
    });

    await (service as any).upsertIssueFromExternal(
      db,
      1,
      7,
      makeIssueData({ id: "ext-non-req", issueType: { id: "10002" } })
    );

    const call = mockIssueUpsert.mock.calls[0][0];
    expect(call.create.isRequirement).toBe(false);
    expect(call.update.isRequirement).toBe(false);

    // The enable switch is part of the effective set — a disabled config
    // classifies false even for a configured type id, so sync and the
    // recompute route can never disagree.
    vi.clearAllMocks();
    mockProjectsFindUnique.mockResolvedValue({ createdBy: "creator-1" });
    mockIssueUpsert.mockResolvedValue({ id: 555 });
    mockIssueFindUnique.mockResolvedValue(null);
    mockProjectIntegrationFindFirst.mockResolvedValue({
      config: { requirements: { enabled: false, issueTypeIds: ["10001"] } },
    });

    await (service as any).upsertIssueFromExternal(
      db,
      1,
      7,
      makeIssueData({ id: "ext-disabled", issueType: { id: "10001" } })
    );

    const disabledCall = mockIssueUpsert.mock.calls[0][0];
    expect(disabledCall.create.isRequirement).toBe(false);
    expect(disabledCall.update.isRequirement).toBe(false);
  });

  it("sets isRequirement from labels for a typeless tracker's issue", async () => {
    const { SyncService } = await import("./SyncService");
    const service = new SyncService();
    const { rawDb } = await import("@/lib/rawDb");
    const db = rawDb as any;

    // A GitHub-style config: the designation entries are LABEL names
    // (GitHub's getIssueTypes serves labels), and the mapped issue
    // carries no issueType at all.
    mockProjectIntegrationFindFirst.mockResolvedValue({
      config: { requirements: { enabled: true, issueTypeIds: ["epic"] } },
    });

    await (service as any).upsertIssueFromExternal(
      db,
      1,
      7,
      makeIssueData({ id: "ext-labeled", labels: ["bug", "epic"] })
    );

    const call = mockIssueUpsert.mock.calls[0][0];
    expect(call.create.isRequirement).toBe(true);
    expect(call.update.isRequirement).toBe(true);
  });

  it("never lets a label collide with a configured type id on a typed issue", async () => {
    const { SyncService } = await import("./SyncService");
    const service = new SyncService();
    const { rawDb } = await import("@/lib/rawDb");
    const db = rawDb as any;

    mockProjectIntegrationFindFirst.mockResolvedValue({
      config: { requirements: { enabled: true, issueTypeIds: ["10001"] } },
    });

    // The issue HAS a type (not configured) and a label whose name equals
    // the configured type id — the precedence contract says the type
    // governs, so this must classify false.
    await (service as any).upsertIssueFromExternal(
      db,
      1,
      7,
      makeIssueData({
        id: "ext-collision",
        issueType: { id: "10002" },
        labels: ["10001"],
      })
    );

    const call = mockIssueUpsert.mock.calls[0][0];
    expect(call.create.isRequirement).toBe(false);
    expect(call.update.isRequirement).toBe(false);
  });

  // The per-issue tri-state override outranks the config at BOTH sync
  // write sites — a pinned row must survive every poll in the pinned
  // state, or promotion/exclusion would silently revert on the next sync.
  it("keeps a FORCE_OFF row unclassified on upsert even when its type is configured", async () => {
    const { SyncService } = await import("./SyncService");
    const service = new SyncService();
    const { rawDb } = await import("@/lib/rawDb");
    const db = rawDb as any;

    mockProjectIntegrationFindFirst.mockResolvedValue({
      config: { requirements: { enabled: true, issueTypeIds: ["10001"] } },
    });
    // Existing row carries the override (the existence pre-check select).
    mockIssueFindUnique.mockResolvedValue({
      id: 555,
      projectId: 7,
      isRequirement: false,
      requirementDetachedAt: null,
      requirementOverride: "FORCE_OFF",
      _count: { children: 0, caseIssues: 0, milestoneIssues: 0 },
    });

    await (service as any).upsertIssueFromExternal(
      db,
      1,
      7,
      makeIssueData({ id: "ext-pinned-off", issueType: { id: "10001" } })
    );

    const call = mockIssueUpsert.mock.calls[0][0];
    expect(call.update.isRequirement).toBe(false);
  });

  it("keeps a FORCE_ON row classified on upsert even when its type is not configured", async () => {
    const { SyncService } = await import("./SyncService");
    const service = new SyncService();
    const { rawDb } = await import("@/lib/rawDb");
    const db = rawDb as any;

    mockProjectIntegrationFindFirst.mockResolvedValue({
      config: { requirements: { enabled: true, issueTypeIds: ["10001"] } },
    });
    mockIssueFindUnique.mockResolvedValue({
      id: 556,
      projectId: 7,
      isRequirement: true,
      requirementDetachedAt: null,
      requirementOverride: "FORCE_ON",
      _count: { children: 0, caseIssues: 0, milestoneIssues: 0 },
    });

    await (service as any).upsertIssueFromExternal(
      db,
      1,
      7,
      makeIssueData({ id: "ext-pinned-on", issueType: { id: "10002" } })
    );

    const call = mockIssueUpsert.mock.calls[0][0];
    expect(call.update.isRequirement).toBe(true);
  });

  it("honors the override in updateExistingIssue's payload too", async () => {
    const { SyncService } = await import("./SyncService");
    const service = new SyncService();
    const { rawDb } = await import("@/lib/rawDb");
    const db = rawDb as any;

    mockProjectIntegrationFindFirst.mockResolvedValue({
      config: { requirements: { enabled: true, issueTypeIds: ["10001"] } },
    });
    // updateExistingIssue loads the full row via findFirst.
    mockIssueFindFirst.mockResolvedValueOnce({
      id: 557,
      projectId: 7,
      externalId: "ext-pinned-on-2",
      integrationId: 1,
      isRequirement: true,
      requirementDetachedAt: null,
      requirementOverride: "FORCE_ON",
      data: {},
    });

    await (service as any).updateExistingIssue(
      db,
      1,
      makeIssueData({ id: "ext-pinned-on-2", issueType: { id: "10002" } })
    );

    expect(mockIssueUpdate).toHaveBeenCalledTimes(1);
    expect(mockIssueUpdate.mock.calls[0][0].data.isRequirement).toBe(true);
  });

  it("leaves isRequirement untouched when the db client does not expose projectIntegration", async () => {
    const { SyncService } = await import("./SyncService");
    const service = new SyncService();
    const { rawDb } = await import("@/lib/rawDb");
    const db = rawDb as any;
    delete db.projectIntegration;

    await expect(
      (service as any).upsertIssueFromExternal(
        db,
        1,
        7,
        makeIssueData({ id: "ext-no-pi-model", issueType: { id: "10001" } })
      )
    ).resolves.not.toThrow();

    const call = mockIssueUpsert.mock.calls[0][0];
    expect(call.create.isRequirement).toBeUndefined();
    expect(call.update.isRequirement).toBeUndefined();
  });

  it("reports an unresolved tracker parent through upsertIssueFromExternal's result", async () => {
    const { SyncService } = await import("./SyncService");
    const service = new SyncService();
    const { rawDb } = await import("@/lib/rawDb");
    const db = rawDb as any;

    // Parent ref present, but no local row matches yet — a forward
    // reference (child paged in before its parent).
    mockIssueFindFirst.mockResolvedValueOnce(null);
    const deferred = await (service as any).upsertIssueFromExternal(
      db,
      1,
      7,
      makeIssueData({
        id: "ext-child-deferred",
        parent: { id: "not-yet-imported", key: "DEMO-9" },
      })
    );
    expect(deferred.parentUnresolved).toBe(true);

    // Parent ref present and resolves — never reported as unresolved.
    vi.clearAllMocks();
    mockProjectsFindUnique.mockResolvedValue({ createdBy: "creator-1" });
    mockIssueUpsert.mockResolvedValue({ id: 555 });
    mockIssueFindUnique.mockResolvedValue(null);
    mockIssueFindFirst.mockResolvedValueOnce({ id: 900, projectId: 7 });
    const resolved = await (service as any).upsertIssueFromExternal(
      db,
      1,
      7,
      makeIssueData({
        id: "ext-child-resolved",
        parent: { id: "10050", key: "DEMO-1" },
      })
    );
    expect(resolved.parentUnresolved).toBeFalsy();

    // No parent ref at all — never reported as unresolved.
    vi.clearAllMocks();
    mockProjectsFindUnique.mockResolvedValue({ createdBy: "creator-1" });
    mockIssueUpsert.mockResolvedValue({ id: 555 });
    mockIssueFindUnique.mockResolvedValue(null);
    const noParent = await (service as any).upsertIssueFromExternal(
      db,
      1,
      7,
      makeIssueData({ id: "ext-no-parent-at-all" })
    );
    expect(noParent.parentUnresolved).toBeFalsy();
  });

  it("re-resolves deferred parents after the import loop and links the child", async () => {
    const { SyncService } = await import("./SyncService");
    const service = new SyncService();

    mockIpFindUnique.mockResolvedValue({
      id: "ip-1",
      externalProjectId: "TPI",
      externalProjectKey: "TPI",
      externalProjectName: "Test Project",
      projectIntegration: { projectId: 7, integrationId: 1 },
    });
    mockIpUpdate.mockResolvedValue({});
    mockIntegrationFindUnique.mockResolvedValue({ provider: "JIRA" });

    // Child-first, then parent, in ONE page — the whole point of P3f.
    const searchIssues = vi.fn().mockResolvedValueOnce({
      issues: [
        makeIssueData({
          id: "ext-child",
          key: "TPI-2",
          parent: { id: "ext-parent", key: "TPI-1" },
        }),
        makeIssueData({ id: "ext-parent", key: "TPI-1" }),
      ],
      total: 2,
      hasMore: false,
    });
    mockGetAdapter.mockResolvedValue({
      searchIssues,
      getCapabilities: vi.fn().mockReturnValue({ searchIssues: true }),
    });

    // Child's inline resolution attempt during the loop: parent row
    // doesn't exist yet.
    mockIssueFindFirst.mockResolvedValueOnce(null);
    mockIssueUpsert
      .mockResolvedValueOnce({ id: 701 }) // child
      .mockResolvedValueOnce({ id: 601 }); // parent
    // End-of-run re-resolution attempt: the parent row now exists.
    mockIssueFindFirst.mockResolvedValueOnce({ id: 601, projectId: 7 });

    const result = await service.performProjectImport(1, "ip-1", {
      updatedWithinDays: 90,
      cap: 200,
    });

    expect(result.imported).toBe(2);
    expect(result.errors).toHaveLength(0);
    expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
    // Assert on the values the tagged template received (strings array is
    // call argument 0) rather than an exact SQL string, so whitespace
    // changes don't make this brittle.
    const rawValues = mockExecuteRaw.mock.calls[0].slice(1);
    expect(rawValues).toEqual([601, 701, 7]); // resolved parent, child id, projectId
  });

  it("leaves a still-unresolvable deferred parent for a later sync pass", async () => {
    const { SyncService } = await import("./SyncService");
    const service = new SyncService();

    mockIpFindUnique.mockResolvedValue({
      id: "ip-1",
      externalProjectId: "TPI",
      externalProjectKey: "TPI",
      externalProjectName: "Test Project",
      projectIntegration: { projectId: 7, integrationId: 1 },
    });
    mockIpUpdate.mockResolvedValue({});
    mockIntegrationFindUnique.mockResolvedValue({ provider: "JIRA" });

    const searchIssues = vi.fn().mockResolvedValueOnce({
      issues: [
        makeIssueData({
          id: "ext-orphan-child",
          key: "TPI-9",
          parent: { id: "ext-parent-never-arrives", key: "TPI-8" },
        }),
      ],
      total: 1,
      hasMore: false,
    });
    mockGetAdapter.mockResolvedValue({
      searchIssues,
      getCapabilities: vi.fn().mockReturnValue({ searchIssues: true }),
    });

    mockIssueUpsert.mockResolvedValueOnce({ id: 801 });
    // Every findFirst call — the inline attempt and the end-of-run
    // re-attempt — reports no match: the parent genuinely never showed up
    // in this run.
    mockIssueFindFirst.mockResolvedValue(null);

    const result = await service.performProjectImport(1, "ip-1", {
      updatedWithinDays: 90,
      cap: 200,
    });

    expect(result.imported).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(mockExecuteRaw).not.toHaveBeenCalled();
  });

  // Not one of the three named todos, but directly proves the behavior
  // CONTEXT P3c requires of the second write path: a per-entry failure
  // (the live cycle-guard trigger's RAISE, simulated here as a rejected
  // $executeRaw call) fails only that one link and leaves the rest of the
  // run — including the other deferred entry's successful link — alone.
  it("isolates a re-resolution write failure to its own deferred entry", async () => {
    const { SyncService } = await import("./SyncService");
    const service = new SyncService();

    mockIpFindUnique.mockResolvedValue({
      id: "ip-1",
      externalProjectId: "TPI",
      externalProjectKey: "TPI",
      externalProjectName: "Test Project",
      projectIntegration: { projectId: 7, integrationId: 1 },
    });
    mockIpUpdate.mockResolvedValue({});
    mockIntegrationFindUnique.mockResolvedValue({ provider: "JIRA" });

    const searchIssues = vi.fn().mockResolvedValueOnce({
      issues: [
        makeIssueData({
          id: "ext-child-a",
          key: "TPI-11",
          parent: { id: "ext-parent-a", key: "TPI-10" },
        }),
        makeIssueData({
          id: "ext-child-b",
          key: "TPI-13",
          parent: { id: "ext-parent-b", key: "TPI-12" },
        }),
        makeIssueData({ id: "ext-parent-a", key: "TPI-10" }),
        makeIssueData({ id: "ext-parent-b", key: "TPI-12" }),
      ],
      total: 4,
      hasMore: false,
    });
    mockGetAdapter.mockResolvedValue({
      searchIssues,
      getCapabilities: vi.fn().mockReturnValue({ searchIssues: true }),
    });

    // Inline attempts for both children: neither parent exists yet.
    mockIssueFindFirst
      .mockResolvedValueOnce(null) // childA inline
      .mockResolvedValueOnce(null); // childB inline
    mockIssueUpsert
      .mockResolvedValueOnce({ id: 711 }) // childA
      .mockResolvedValueOnce({ id: 712 }) // childB
      .mockResolvedValueOnce({ id: 611 }) // parentA
      .mockResolvedValueOnce({ id: 612 }); // parentB
    // End-of-run re-resolution: both parents now resolve.
    mockIssueFindFirst
      .mockResolvedValueOnce({ id: 611, projectId: 7 }) // childA entry
      .mockResolvedValueOnce({ id: 612, projectId: 7 }); // childB entry

    mockExecuteRaw
      .mockResolvedValueOnce(undefined) // childA's write succeeds
      .mockRejectedValueOnce(new Error("cycle guard rejected reparent")); // childB's write fails

    const result = await service.performProjectImport(1, "ip-1", {
      updatedWithinDays: 90,
      cap: 200,
    });

    expect(result.imported).toBe(4);
    expect(mockExecuteRaw).toHaveBeenCalledTimes(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("712");
    expect(result.errors[0]).toContain("cycle guard rejected reparent");
  });
});
