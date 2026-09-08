import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Auto-track discovery + import pass (D1 / MSYNC-01) — `performProjectMilestoneSync`.
 *
 *   - enabled=false -> no-op
 *   - autoTrack=true -> newly-appeared filter-matching artifacts (diffed
 *     against already-linked externalIds AND the persisted first-pass
 *     baseline) are auto-imported, attributed to `autoTrackAdminId` (NOT
 *     the triggering user)
 *   - first pass (no baseline) -> imports NOTHING; persists the currently
 *     matching unlinked ids as `autoTrackBaseline` so auto-track only ever
 *     imports artifacts created after it was enabled
 *   - autoTrack=false -> the same new artifact is skipped; only already-
 *     linked milestones refresh
 *   - kinds gating -> a newly-appeared artifact of a non-configured kind is
 *     ignored
 */

// ─── Mocks ────────────────────────────────────────────────────────────────
const mockProjectIntegrationFindUnique = vi.fn();
const mockProjectIntegrationUpdate = vi.fn();
const mockMilestonesFindMany = vi.fn();
const mockMilestonesFindFirst = vi.fn();
const mockMilestonesFindUnique = vi.fn();
const mockMilestonesUpsert = vi.fn();
const mockMilestoneTypesUpsert = vi.fn();
const mockMilestoneTypesAssignmentUpsert = vi.fn();
const mockIntegrationProjectFindMany = vi.fn();

vi.mock("@/lib/rawDb", () => ({
  rawDb: {
    projectIntegration: {
      findUnique: (...args: any[]) => mockProjectIntegrationFindUnique(...args),
      update: (...args: any[]) => mockProjectIntegrationUpdate(...args),
    },
    milestones: {
      findMany: (...args: any[]) => mockMilestonesFindMany(...args),
      findFirst: (...args: any[]) => mockMilestonesFindFirst(...args),
      findUnique: (...args: any[]) => mockMilestonesFindUnique(...args),
      upsert: (...args: any[]) => mockMilestonesUpsert(...args),
    },
    milestoneTypes: {
      upsert: (...args: any[]) => mockMilestoneTypesUpsert(...args),
    },
    milestoneTypesAssignment: {
      upsert: (...args: any[]) => mockMilestoneTypesAssignmentUpsert(...args),
    },
    integrationProject: {
      findMany: (...args: any[]) => mockIntegrationProjectFindMany(...args),
    },
  },
}));

const mockGetExternalMilestones = vi.fn();
vi.mock("../IntegrationManager", () => ({
  integrationManager: {
    getAdapter: vi.fn().mockResolvedValue({
      getCapabilities: () => ({
        milestones: { kinds: ["RELEASE", "ITERATION"], webhooks: false },
      }),
      getExternalMilestones: (...args: any[]) =>
        mockGetExternalMilestones(...args),
    }),
  },
}));

vi.mock("../../valkey", () => ({ default: null }));

import { milestoneSyncService } from "./MilestoneSyncService";

const V1 = {
  id: "v1",
  kind: "RELEASE" as const,
  name: "v1.0",
  state: "ACTIVE" as const,
  rawState: "unreleased",
};
const V2_NEW = {
  id: "v2-new",
  kind: "RELEASE" as const,
  name: "v2.0",
  state: "FUTURE" as const,
  rawState: "unreleased",
};
const SPRINT_NEW = {
  id: "sprint-new",
  kind: "ITERATION" as const,
  name: "Sprint 9",
  state: "ACTIVE" as const,
  rawState: "active",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockIntegrationProjectFindMany.mockResolvedValue([
    { externalProjectKey: "TEST" },
  ]);
  mockMilestoneTypesUpsert.mockImplementation(
    async ({ where }: { where: { name: string } }) => ({
      id: where.name === "Release" ? 1001 : 1002,
    })
  );
  mockMilestoneTypesAssignmentUpsert.mockResolvedValue({});
  mockProjectIntegrationUpdate.mockResolvedValue({});
  mockMilestonesFindUnique.mockResolvedValue(null);
  mockMilestonesUpsert.mockImplementation(async ({ create }: any) => ({
    id: 5000,
    ...create,
  }));
  // Default: v1 is already linked, v2-new / sprint-new are not.
  mockMilestonesFindMany.mockResolvedValue([
    { externalId: "v1", isDeleted: false },
  ]);
  mockMilestonesFindFirst.mockResolvedValue({
    id: 1,
    projectId: 100,
    milestoneTypesId: 5,
    externalKind: "RELEASE",
    lastSyncedAt: null,
    isDeleted: false,
  });
  mockGetExternalMilestones.mockImplementation(
    async ({ kind }: { kind: "RELEASE" | "ITERATION" }) => ({
      items: kind === "RELEASE" ? [V1, V2_NEW] : [SPRINT_NEW],
      hasMore: false,
    })
  );
});

describe("performProjectMilestoneSync — enabled gate", () => {
  it("is a no-op when config.milestoneSync.enabled is false", async () => {
    mockProjectIntegrationFindUnique.mockResolvedValue({
      config: { milestoneSync: { enabled: false } },
    });

    const result = await milestoneSyncService.performProjectMilestoneSync(
      "user-1",
      1,
      100
    );

    expect(result).toEqual({
      success: true,
      autoImported: 0,
      refreshed: 0,
      errors: [],
    });
    expect(mockGetExternalMilestones).not.toHaveBeenCalled();
    expect(mockMilestonesUpsert).not.toHaveBeenCalled();
  });
});

describe("performProjectMilestoneSync — autoTrack=true", () => {
  it("auto-imports a newly-appeared version, attributed to autoTrackAdminId (not the triggering user)", async () => {
    mockProjectIntegrationFindUnique.mockResolvedValue({
      config: {
        milestoneSync: {
          enabled: true,
          kinds: ["RELEASE"],
          autoTrack: true,
          autoTrackAdminId: "admin-who-enabled-sync",
          autoTrackBaseline: [],
        },
      },
    });

    const result = await milestoneSyncService.performProjectMilestoneSync(
      "triggering-user",
      1,
      100
    );

    expect(result.success).toBe(true);
    expect(result.autoImported).toBe(1);

    // Only the NEW id (v2-new) is imported — v1 is already linked.
    const importUpsertCall = mockMilestonesUpsert.mock.calls.find(
      (c) => c[0].create.externalId === "v2-new"
    );
    expect(importUpsertCall).toBeTruthy();
    expect(importUpsertCall![0].create.createdBy).toBe(
      "admin-who-enabled-sync"
    );
    // The triggering user must NOT be the attributed creator.
    expect(importUpsertCall![0].create.createdBy).not.toBe("triggering-user");
  });

  it("kinds gating: a newly-appeared sprint is ignored when kinds=['RELEASE'] only", async () => {
    mockProjectIntegrationFindUnique.mockResolvedValue({
      config: {
        milestoneSync: {
          enabled: true,
          kinds: ["RELEASE"],
          autoTrack: true,
          autoTrackAdminId: "admin-1",
          autoTrackBaseline: [],
        },
      },
    });

    await milestoneSyncService.performProjectMilestoneSync(
      "triggering-user",
      1,
      100
    );

    // The "current filter-matching artifacts" discovery fetch (includeClosed:
    // false — distinguishes it from the per-milestone refresh calls below,
    // which pass includeClosed: true) should only have been called for the
    // configured kind (RELEASE) — ITERATION is never fetched, so the newly-
    // appeared sprint is never even seen, let alone imported.
    const discoveryKinds = mockGetExternalMilestones.mock.calls
      .filter((c) => c[0].includeClosed === false)
      .map((c) => c[0].kind);
    expect(discoveryKinds).toEqual(["RELEASE"]);
    const sprintUpsertCall = mockMilestonesUpsert.mock.calls.find(
      (c) => c[0].create.externalId === "sprint-new"
    );
    expect(sprintUpsertCall).toBeUndefined();
  });

  it("uses includeClosed:false when fetching current matches (default filter)", async () => {
    mockProjectIntegrationFindUnique.mockResolvedValue({
      config: {
        milestoneSync: {
          enabled: true,
          kinds: ["RELEASE"],
          autoTrack: true,
          autoTrackAdminId: "admin-1",
          autoTrackBaseline: [],
        },
      },
    });

    await milestoneSyncService.performProjectMilestoneSync(
      "triggering-user",
      1,
      100
    );

    expect(mockGetExternalMilestones).toHaveBeenCalledWith(
      expect.objectContaining({ includeClosed: false })
    );
  });
});

describe("performProjectMilestoneSync — auto-track baseline (first pass)", () => {
  it("FIRST pass (no baseline): imports NOTHING and persists the current unlinked ids as the baseline", async () => {
    mockProjectIntegrationFindUnique.mockResolvedValue({
      config: {
        milestoneSync: {
          enabled: true,
          kinds: ["RELEASE"],
          autoTrack: true,
          autoTrackAdminId: "admin-1",
        },
      },
    });

    const result = await milestoneSyncService.performProjectMilestoneSync(
      "triggering-user",
      1,
      100
    );

    expect(result.success).toBe(true);
    // v2-new is unlinked but PRE-EXISTING — the first pass must not
    // backfill it (the reported bug: enabling auto-track imported every
    // existing artifact, swamping a deliberate selective import).
    expect(result.autoImported).toBe(0);
    const importUpsertCall = mockMilestonesUpsert.mock.calls.find(
      (c) => c[0].create.externalId === "v2-new"
    );
    expect(importUpsertCall).toBeUndefined();

    // The baseline persists the unlinked current matches (v2-new; v1 is
    // linked so it is tracked via the linked set, not the baseline).
    expect(mockProjectIntegrationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId_integrationId: { projectId: 100, integrationId: 1 },
        },
        data: {
          config: expect.objectContaining({
            milestoneSync: expect.objectContaining({
              autoTrackBaseline: ["v2-new"],
            }),
          }),
        },
      })
    );
  });

  it("later pass: a baselined (pre-existing) artifact is never imported, while a genuinely new one is", async () => {
    mockProjectIntegrationFindUnique.mockResolvedValue({
      config: {
        milestoneSync: {
          enabled: true,
          kinds: ["RELEASE"],
          autoTrack: true,
          autoTrackAdminId: "admin-1",
          autoTrackBaseline: ["v2-new"],
        },
      },
    });
    const V3_GENUINELY_NEW = {
      id: "v3-post-enable",
      kind: "RELEASE" as const,
      name: "v3.0",
      state: "FUTURE" as const,
      rawState: "unreleased",
    };
    mockGetExternalMilestones.mockImplementation(
      async ({ kind }: { kind: "RELEASE" | "ITERATION" }) => ({
        items: kind === "RELEASE" ? [V1, V2_NEW, V3_GENUINELY_NEW] : [],
        hasMore: false,
      })
    );

    const result = await milestoneSyncService.performProjectMilestoneSync(
      "triggering-user",
      1,
      100
    );

    expect(result.success).toBe(true);
    expect(result.autoImported).toBe(1);
    const v2UpsertCall = mockMilestonesUpsert.mock.calls.find(
      (c) => c[0].create.externalId === "v2-new"
    );
    expect(v2UpsertCall).toBeUndefined();
    const v3UpsertCall = mockMilestonesUpsert.mock.calls.find(
      (c) => c[0].create.externalId === "v3-post-enable"
    );
    expect(v3UpsertCall).toBeTruthy();
    // No re-baselining once a baseline exists.
    expect(mockProjectIntegrationUpdate).not.toHaveBeenCalled();
  });
});

describe("performProjectMilestoneSync — per-project scan opt-out", () => {
  it("skips excluded tracker projects in discovery: their keys are never fetched and their artifacts never import", async () => {
    mockProjectIntegrationFindUnique.mockResolvedValue({
      config: {
        milestoneSync: {
          enabled: true,
          kinds: ["RELEASE"],
          autoTrack: true,
          autoTrackAdminId: "admin-1",
          autoTrackBaseline: [],
          autoTrackExcludedExternalProjectIds: ["20060"],
        },
      },
    });
    mockIntegrationProjectFindMany.mockResolvedValue([
      { externalProjectKey: "TEST", externalProjectId: "10050" },
      { externalProjectKey: "ADM", externalProjectId: "20060" },
    ]);
    const ADM_ONLY = {
      id: "adm-v1",
      kind: "RELEASE" as const,
      name: "ADM 1.0",
      state: "FUTURE" as const,
      rawState: "unreleased",
    };
    mockGetExternalMilestones.mockImplementation(
      async ({ projectKey }: { projectKey: string }) => ({
        items: projectKey === "ADM" ? [ADM_ONLY] : [V1, V2_NEW],
        hasMore: false,
      })
    );

    const result = await milestoneSyncService.performProjectMilestoneSync(
      "triggering-user",
      1,
      100
    );

    expect(result.success).toBe(true);
    // Discovery (includeClosed:false) never touches the excluded key…
    const discoveryKeys = mockGetExternalMilestones.mock.calls
      .filter((c) => c[0].includeClosed === false)
      .map((c) => c[0].projectKey);
    expect(discoveryKeys).toEqual(["TEST"]);
    // …so the excluded project's artifact never imports, while the
    // included project's new artifact still does.
    const importedIds = mockMilestonesUpsert.mock.calls.map(
      (c) => c[0].create.externalId
    );
    expect(importedIds).not.toContain("adm-v1");
    expect(importedIds).toContain("v2-new");
  });
});

describe("performProjectMilestoneSync — autoTrack=false", () => {
  it("does NOT import the same newly-appeared version when autoTrack is false", async () => {
    mockProjectIntegrationFindUnique.mockResolvedValue({
      config: {
        milestoneSync: {
          enabled: true,
          kinds: ["RELEASE"],
          autoTrack: false,
        },
      },
    });

    const result = await milestoneSyncService.performProjectMilestoneSync(
      "triggering-user",
      1,
      100
    );

    expect(result.autoImported).toBe(0);
    const importUpsertCall = mockMilestonesUpsert.mock.calls.find(
      (c) => c[0].create.externalId === "v2-new"
    );
    expect(importUpsertCall).toBeUndefined();
  });

  it("still refreshes already-linked milestones even when autoTrack is false", async () => {
    mockProjectIntegrationFindUnique.mockResolvedValue({
      config: {
        milestoneSync: {
          enabled: true,
          kinds: ["RELEASE"],
          autoTrack: false,
        },
      },
    });

    const result = await milestoneSyncService.performProjectMilestoneSync(
      "triggering-user",
      1,
      100
    );

    expect(result.refreshed).toBe(1); // v1 (already linked) refreshed
    const refreshUpsertCall = mockMilestonesUpsert.mock.calls.find(
      (c) => c[0].update !== undefined && c[0].create.externalId === "v1"
    );
    expect(refreshUpsertCall).toBeTruthy();
  });
});

describe("performProjectMilestoneSync — tombstone semantics (soft-deleted synced milestone)", () => {
  it("a tombstoned (isDeleted) row still counts as 'linked' in the auto-track diff — it is NOT re-imported", async () => {
    mockProjectIntegrationFindUnique.mockResolvedValue({
      config: {
        milestoneSync: {
          enabled: true,
          kinds: ["RELEASE"],
          autoTrack: true,
          autoTrackAdminId: "admin-1",
          autoTrackBaseline: [],
        },
      },
    });
    // v1 is linked but soft-deleted; v2-new is genuinely new.
    mockMilestonesFindMany.mockResolvedValue([
      { externalId: "v1", isDeleted: true },
    ]);

    const result = await milestoneSyncService.performProjectMilestoneSync(
      "triggering-user",
      1,
      100
    );

    expect(result.success).toBe(true);
    // v1 must NOT be re-imported despite currentMatches including it.
    const v1UpsertCall = mockMilestonesUpsert.mock.calls.find(
      (c) => c[0].create.externalId === "v1"
    );
    expect(v1UpsertCall).toBeUndefined();
    // v2-new is genuinely unseen and still gets auto-imported.
    expect(result.autoImported).toBe(1);
    const v2UpsertCall = mockMilestonesUpsert.mock.calls.find(
      (c) => c[0].create.externalId === "v2-new"
    );
    expect(v2UpsertCall).toBeTruthy();
  });

  it("a tombstoned (isDeleted) row is skipped by the refresh loop — no adapter fetch/write for it", async () => {
    mockProjectIntegrationFindUnique.mockResolvedValue({
      config: {
        milestoneSync: {
          enabled: true,
          kinds: ["RELEASE"],
          autoTrack: false,
        },
      },
    });
    mockMilestonesFindMany.mockResolvedValue([
      { externalId: "v1", isDeleted: true },
    ]);

    const result = await milestoneSyncService.performProjectMilestoneSync(
      "triggering-user",
      1,
      100
    );

    expect(result.success).toBe(true);
    expect(result.refreshed).toBe(0);
    const v1UpsertCall = mockMilestonesUpsert.mock.calls.find(
      (c) => c[0].update !== undefined && c[0].create.externalId === "v1"
    );
    expect(v1UpsertCall).toBeUndefined();
  });

  it("mixed linked set: a non-deleted row IS refreshed while a tombstoned row is skipped, in the same pass", async () => {
    mockProjectIntegrationFindUnique.mockResolvedValue({
      config: {
        milestoneSync: {
          enabled: true,
          kinds: ["RELEASE"],
          autoTrack: false,
        },
      },
    });
    mockMilestonesFindMany.mockResolvedValue([
      { externalId: "v1", isDeleted: false },
      { externalId: "v1-deleted", isDeleted: true },
    ]);

    const result = await milestoneSyncService.performProjectMilestoneSync(
      "triggering-user",
      1,
      100
    );

    expect(result.refreshed).toBe(1);
    const refreshedIds = mockMilestonesUpsert.mock.calls
      .filter((c) => c[0].update !== undefined)
      .map((c) => c[0].create.externalId);
    expect(refreshedIds).toContain("v1");
    expect(refreshedIds).not.toContain("v1-deleted");
  });
});
