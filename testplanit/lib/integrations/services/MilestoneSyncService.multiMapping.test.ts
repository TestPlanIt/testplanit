import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Multi-mapping project bugfix (UAT): a project can have MORE THAN ONE
 * active `IntegrationProject` mapping on the same integration (e.g. TPI
 * mapped to both ABT and ADM in Jira). `_resolveProjectKeys` +
 * `_fetchKindAcrossKeys` union the fetch across every mapped key instead of
 * arbitrarily picking one via `findFirst` — pins the live bug where an
 * ABT-only sprint selection was silently dropped because the service only
 * ever consulted ADM.
 */

// ─── Mocks ────────────────────────────────────────────────────────────────
const mockMilestonesFindFirst = vi.fn();
const mockMilestonesFindUnique = vi.fn();
const mockMilestonesUpsert = vi.fn();
const mockMilestonesFindMany = vi.fn();
const mockIntegrationProjectFindMany = vi.fn();
const mockProjectIntegrationFindUnique = vi.fn();
const mockMilestoneTypesUpsert = vi.fn();
const mockMilestoneTypesAssignmentUpsert = vi.fn();

vi.mock("@/lib/rawDb", () => ({
  rawDb: {
    milestones: {
      findFirst: (...args: any[]) => mockMilestonesFindFirst(...args),
      findUnique: (...args: any[]) => mockMilestonesFindUnique(...args),
      upsert: (...args: any[]) => mockMilestonesUpsert(...args),
      findMany: (...args: any[]) => mockMilestonesFindMany(...args),
    },
    integrationProject: {
      findMany: (...args: any[]) => mockIntegrationProjectFindMany(...args),
    },
    projectIntegration: {
      findUnique: (...args: any[]) => mockProjectIntegrationFindUnique(...args),
    },
    milestoneTypes: {
      upsert: (...args: any[]) => mockMilestoneTypesUpsert(...args),
    },
    milestoneTypesAssignment: {
      upsert: (...args: any[]) => mockMilestoneTypesAssignmentUpsert(...args),
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

const ABT_ONLY_SPRINT = {
  id: "abt-sprint-1",
  kind: "ITERATION" as const,
  name: "ABT Sprint 1",
  state: "ACTIVE" as const,
  rawState: "active",
};
const ADM_ONLY_SPRINT = {
  id: "adm-sprint-1",
  kind: "ITERATION" as const,
  name: "ADM Sprint 1",
  state: "ACTIVE" as const,
  rawState: "active",
};
const SHARED_SPRINT = {
  id: "shared-sprint",
  kind: "ITERATION" as const,
  name: "Shared Board Sprint",
  state: "ACTIVE" as const,
  rawState: "active",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockMilestonesFindUnique.mockResolvedValue(null);
  mockMilestonesUpsert.mockImplementation(async ({ create }: any) => ({
    id: 5000,
    ...create,
  }));
  mockMilestoneTypesUpsert.mockImplementation(
    async ({ where }: { where: { name: string } }) => ({
      id: where.name === "Release" ? 1001 : 1002,
    })
  );
  mockMilestoneTypesAssignmentUpsert.mockResolvedValue({});
  // Two active mappings on the same integration/project — the live-bug
  // scenario (TPI project 370 mapped to both ABT and ADM on integration 9).
  mockIntegrationProjectFindMany.mockResolvedValue([
    { externalProjectKey: "ABT" },
    { externalProjectKey: "ADM" },
  ]);
});

describe("performMilestoneImport — union across multiple project mappings", () => {
  it("imports an externalId that is only present under the SECOND mapped key (the live ABT/ADM bug)", async () => {
    mockGetExternalMilestones.mockImplementation(
      async ({ projectKey }: { projectKey: string }) => ({
        items: projectKey === "ABT" ? [ABT_ONLY_SPRINT] : [],
        hasMore: false,
      })
    );

    const result = await milestoneSyncService.performMilestoneImport(
      "admin-1",
      9,
      370,
      { externalIds: ["abt-sprint-1"], kinds: ["ITERATION"] }
    );

    expect(result.success).toBe(true);
    expect(result.imported).toBe(1);
    expect(result.errors).toEqual([]);
    const upsertCall = mockMilestonesUpsert.mock.calls.find(
      (c) => c[0].create.externalId === "abt-sprint-1"
    );
    expect(upsertCall).toBeTruthy();
  });

  it("fetches once per key per kind", async () => {
    mockGetExternalMilestones.mockResolvedValue({ items: [], hasMore: false });

    await milestoneSyncService.performMilestoneImport("admin-1", 9, 370, {
      externalIds: [],
      kinds: ["RELEASE", "ITERATION"],
    });

    // 2 keys x 2 kinds = 4 calls.
    expect(mockGetExternalMilestones).toHaveBeenCalledTimes(4);
    const keysCalled = mockGetExternalMilestones.mock.calls.map(
      (c) => c[0].projectKey
    );
    expect(keysCalled.filter((k) => k === "ABT")).toHaveLength(2);
    expect(keysCalled.filter((k) => k === "ADM")).toHaveLength(2);
  });

  it("dedupes a sprint id returned under BOTH keys — imported once, not twice", async () => {
    mockGetExternalMilestones.mockImplementation(
      async ({ projectKey }: { projectKey: string }) => ({
        items:
          projectKey === "ABT" || projectKey === "ADM" ? [SHARED_SPRINT] : [],
        hasMore: false,
      })
    );

    const result = await milestoneSyncService.performMilestoneImport(
      "admin-1",
      9,
      370,
      { externalIds: ["shared-sprint"], kinds: ["ITERATION"] }
    );

    expect(result.imported).toBe(1);
    const upsertCallsForShared = mockMilestonesUpsert.mock.calls.filter(
      (c) => c[0].create.externalId === "shared-sprint"
    );
    expect(upsertCallsForShared).toHaveLength(1);
  });

  it("imports artifacts visible under either key when no explicit selection is given (both ABT-only and ADM-only present)", async () => {
    mockGetExternalMilestones.mockImplementation(
      async ({ projectKey }: { projectKey: string }) => ({
        items: projectKey === "ABT" ? [ABT_ONLY_SPRINT] : [ADM_ONLY_SPRINT],
        hasMore: false,
      })
    );

    const result = await milestoneSyncService.performMilestoneImport(
      "admin-1",
      9,
      370,
      { kinds: ["ITERATION"] }
    );

    expect(result.imported).toBe(2);
    const importedIds = mockMilestonesUpsert.mock.calls.map(
      (c) => c[0].create.externalId
    );
    expect(importedIds).toContain("abt-sprint-1");
    expect(importedIds).toContain("adm-sprint-1");
  });
});

describe("performMilestoneImport — per-key fetch failure handling", () => {
  it("continues with the other key's results when one key's fetch fails (partial failure)", async () => {
    mockGetExternalMilestones.mockImplementation(
      async ({ projectKey }: { projectKey: string }) => {
        if (projectKey === "ABT") {
          throw new Error("ABT: permission denied");
        }
        return { items: [ADM_ONLY_SPRINT], hasMore: false };
      }
    );

    const result = await milestoneSyncService.performMilestoneImport(
      "admin-1",
      9,
      370,
      { kinds: ["ITERATION"] }
    );

    expect(result.success).toBe(true);
    expect(result.imported).toBe(1);
    const importedIds = mockMilestonesUpsert.mock.calls.map(
      (c) => c[0].create.externalId
    );
    expect(importedIds).toContain("adm-sprint-1");
  });

  it("surfaces an error when EVERY key's fetch fails for a kind", async () => {
    mockGetExternalMilestones.mockRejectedValue(new Error("upstream 500"));

    const result = await milestoneSyncService.performMilestoneImport(
      "admin-1",
      9,
      370,
      { kinds: ["ITERATION"] }
    );

    expect(result.imported).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("ITERATION");
  });
});

describe("performProjectMilestoneSync — union across multiple project mappings", () => {
  it("auto-tracks an artifact only visible under the second mapped key", async () => {
    mockProjectIntegrationFindUnique.mockResolvedValue({
      config: {
        milestoneSync: {
          enabled: true,
          kinds: ["ITERATION"],
          autoTrack: true,
          autoTrackAdminId: "admin-1",
        },
      },
    });
    mockMilestonesFindMany.mockResolvedValue([]); // nothing linked yet
    mockGetExternalMilestones.mockImplementation(
      async ({ projectKey }: { projectKey: string }) => ({
        items: projectKey === "ABT" ? [ABT_ONLY_SPRINT] : [],
        hasMore: false,
      })
    );

    const result = await milestoneSyncService.performProjectMilestoneSync(
      "triggering-user",
      9,
      370
    );

    expect(result.success).toBe(true);
    expect(result.autoImported).toBe(1);
    const importedIds = mockMilestonesUpsert.mock.calls.map(
      (c) => c[0].create.externalId
    );
    expect(importedIds).toContain("abt-sprint-1");
  });
});

describe("performMilestoneRefresh — resolves an artifact via a non-first mapping", () => {
  it("finds the artifact via the SECOND mapping when the first key's fetch lacks it, without throwing", async () => {
    mockMilestonesFindFirst.mockResolvedValue({
      id: 1,
      projectId: 370,
      milestoneTypesId: 1002,
      externalKind: "ITERATION",
      isDeleted: false,
    });
    mockGetExternalMilestones.mockImplementation(
      async ({ projectKey }: { projectKey: string }) => ({
        items: projectKey === "ADM" ? [ABT_ONLY_SPRINT] : [],
        hasMore: false,
      })
    );

    const result = await milestoneSyncService.performMilestoneRefresh(
      "user-1",
      9,
      "abt-sprint-1",
      { minFreshnessSeconds: 0 }
    );

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(mockMilestonesUpsert).toHaveBeenCalledTimes(1);
    // Both keys must have been consulted (first key alone doesn't have it).
    const keysCalled = mockGetExternalMilestones.mock.calls.map(
      (c) => c[0].projectKey
    );
    expect(keysCalled).toContain("ABT");
    expect(keysCalled).toContain("ADM");
  });

  it("throws 'no longer present upstream' only after ALL keys were tried and none matched", async () => {
    mockMilestonesFindFirst.mockResolvedValue({
      id: 1,
      projectId: 370,
      milestoneTypesId: 1002,
      externalKind: "ITERATION",
      isDeleted: false,
    });
    mockGetExternalMilestones.mockResolvedValue({ items: [], hasMore: false });

    const result = await milestoneSyncService.performMilestoneRefresh(
      "user-1",
      9,
      "gone-sprint",
      { minFreshnessSeconds: 0 }
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("no longer present upstream");
    const keysCalled = mockGetExternalMilestones.mock.calls.map(
      (c) => c[0].projectKey
    );
    expect(keysCalled).toEqual(["ABT", "ADM"]);
  });

  it("propagates the fetch error (not 'no longer present upstream') when EVERY key's fetch throws", async () => {
    mockMilestonesFindFirst.mockResolvedValue({
      id: 1,
      projectId: 370,
      milestoneTypesId: 1002,
      externalKind: "ITERATION",
      isDeleted: false,
    });
    mockGetExternalMilestones.mockRejectedValue(
      new Error("credential revoked")
    );

    const result = await milestoneSyncService.performMilestoneRefresh(
      "user-1",
      9,
      "abt-sprint-1",
      { minFreshnessSeconds: 0 }
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("credential revoked");
    expect(result.error).not.toContain("no longer present upstream");
  });

  it("does not throw when a key errors but a LATER key finds the match", async () => {
    mockMilestonesFindFirst.mockResolvedValue({
      id: 1,
      projectId: 370,
      milestoneTypesId: 1002,
      externalKind: "ITERATION",
      isDeleted: false,
    });
    mockGetExternalMilestones.mockImplementation(
      async ({ projectKey }: { projectKey: string }) => {
        if (projectKey === "ABT") {
          throw new Error("ABT: transient error");
        }
        return { items: [ABT_ONLY_SPRINT], hasMore: false };
      }
    );

    const result = await milestoneSyncService.performMilestoneRefresh(
      "user-1",
      9,
      "abt-sprint-1",
      { minFreshnessSeconds: 0 }
    );

    expect(result.success).toBe(true);
    expect(mockMilestonesUpsert).toHaveBeenCalledTimes(1);
  });
});
