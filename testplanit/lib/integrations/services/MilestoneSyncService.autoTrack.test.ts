import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Auto-track discovery + import pass (D1 / MSYNC-01) — `performProjectMilestoneSync`.
 *
 *   - enabled=false -> no-op
 *   - autoTrack=true -> newly-appeared filter-matching artifacts (diffed
 *     against already-linked externalIds) are auto-imported, attributed to
 *     `autoTrackAdminId` (NOT the triggering user)
 *   - autoTrack=false -> the same new artifact is skipped; only already-
 *     linked milestones refresh
 *   - kinds gating -> a newly-appeared artifact of a non-configured kind is
 *     ignored
 */

// ─── Mocks ────────────────────────────────────────────────────────────────
const mockProjectIntegrationFindUnique = vi.fn();
const mockMilestonesFindMany = vi.fn();
const mockMilestonesFindFirst = vi.fn();
const mockMilestonesFindUnique = vi.fn();
const mockMilestonesUpsert = vi.fn();
const mockMilestoneTypesUpsert = vi.fn();
const mockMilestoneTypesAssignmentUpsert = vi.fn();
const mockIntegrationProjectFindFirst = vi.fn();

vi.mock("@/lib/rawDb", () => ({
  rawDb: {
    projectIntegration: {
      findUnique: (...args: any[]) => mockProjectIntegrationFindUnique(...args),
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
      findFirst: (...args: any[]) => mockIntegrationProjectFindFirst(...args),
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
  mockIntegrationProjectFindFirst.mockResolvedValue({
    externalProjectKey: "TEST",
  });
  mockMilestoneTypesUpsert.mockImplementation(
    async ({ where }: { where: { name: string } }) => ({
      id: where.name === "Release" ? 1001 : 1002,
    })
  );
  mockMilestoneTypesAssignmentUpsert.mockResolvedValue({});
  mockMilestonesFindUnique.mockResolvedValue(null);
  mockMilestonesUpsert.mockImplementation(async ({ create }: any) => ({
    id: 5000,
    ...create,
  }));
  // Default: v1 is already linked, v2-new / sprint-new are not.
  mockMilestonesFindMany.mockResolvedValue([{ externalId: "v1" }]);
  mockMilestonesFindFirst.mockResolvedValue({
    id: 1,
    projectId: 100,
    milestoneTypesId: 5,
    externalKind: "RELEASE",
    lastSyncedAt: null,
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
