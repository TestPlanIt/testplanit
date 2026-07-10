import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * RED scaffold (18-01) for member-import delegation — the not-yet-added
 * reconciliation path hooked into `_performMilestoneRefreshInner`
 * (MilestoneSyncService.ts:321-396).
 *
 * Pins (D-12): membership import MUST delegate every fetched member
 * IssueData to `SyncService.upsertIssueFromExternal` — NO milestone-private
 * issue writer. Pins: a `MilestoneIssue` row with `source: "SYNCED"` is
 * created for each imported member via raw-db `milestoneIssue.upsert`.
 * Pins the clean-skip when the adapter does not declare `getMilestoneIssues`.
 *
 * All assertions target behavior that does not exist yet on
 * MilestoneSyncService — this file MUST fail at authoring time.
 */

// ─── Mocks ────────────────────────────────────────────────────────────────
const mockIntegrationProjectFindMany = vi.fn();
const mockMilestonesFindFirst = vi.fn();
const mockMilestonesUpsert = vi.fn();
const mockMilestoneIssueUpsert = vi.fn();
const mockMilestoneIssueDeleteMany = vi.fn();
const mockUpsertIssueFromExternal = vi.fn();

vi.mock("@/lib/rawDb", () => ({
  rawDb: {
    milestones: {
      findFirst: (...args: any[]) => mockMilestonesFindFirst(...args),
      upsert: (...args: any[]) => mockMilestonesUpsert(...args),
    },
    integrationProject: {
      findMany: (...args: any[]) => mockIntegrationProjectFindMany(...args),
    },
    milestoneIssue: {
      upsert: (...args: any[]) => mockMilestoneIssueUpsert(...args),
      deleteMany: (...args: any[]) => mockMilestoneIssueDeleteMany(...args),
    },
  },
}));

const mockGetExternalMilestones = vi.fn();
const mockGetMilestoneIssues = vi.fn();
let mockAdapterCapabilities: any = {
  milestones: { kinds: ["RELEASE", "ITERATION"], webhooks: false },
};

vi.mock("../IntegrationManager", () => ({
  integrationManager: {
    getAdapter: vi.fn().mockImplementation(async () => ({
      getCapabilities: () => mockAdapterCapabilities,
      getExternalMilestones: (...args: any[]) =>
        mockGetExternalMilestones(...args),
      // Present only when the mock capability declares it — tests toggle
      // this per-case to simulate adapters that omit getMilestoneIssues.
      ...(mockAdapterCapabilities.milestones
        ? {
            getMilestoneIssues: (...args: any[]) =>
              mockGetMilestoneIssues(...args),
          }
        : {}),
    })),
  },
}));

vi.mock("./SyncService", () => ({
  syncService: {
    upsertIssueFromExternal: (...args: any[]) =>
      mockUpsertIssueFromExternal(...args),
  },
}));

vi.mock("../../valkey", () => ({ default: null }));

import { milestoneSyncService } from "./MilestoneSyncService";

const RELEASE_MATCH = {
  id: "v1",
  kind: "RELEASE" as const,
  name: "v1.0",
  state: "ACTIVE" as const,
  rawState: "unreleased",
};

function makeExtIssue(overrides: Record<string, any> = {}) {
  return {
    id: "ext-1",
    key: "TPI-1",
    title: "Member issue",
    status: "Open",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAdapterCapabilities = {
    milestones: { kinds: ["RELEASE", "ITERATION"], webhooks: false },
  };
  mockMilestonesFindFirst.mockResolvedValue({
    id: 1,
    projectId: 100,
    milestoneTypesId: 5,
    externalKind: "RELEASE",
    isDeleted: false,
  });
  mockIntegrationProjectFindMany.mockResolvedValue([
    { externalProjectKey: "TPI" },
  ]);
  mockGetExternalMilestones.mockResolvedValue({
    items: [RELEASE_MATCH],
    hasMore: false,
  });
  mockMilestonesUpsert.mockResolvedValue({ id: 1 });
  mockMilestoneIssueUpsert.mockResolvedValue({});
  mockMilestoneIssueDeleteMany.mockResolvedValue({ count: 0 });
  mockUpsertIssueFromExternal.mockResolvedValue({ id: 900, created: true });
  mockGetMilestoneIssues.mockResolvedValue({
    issues: [makeExtIssue({ id: "ext-1" }), makeExtIssue({ id: "ext-2" })],
    hasMore: false,
  });
});

describe("MilestoneSyncService membership import — delegates to SyncService.upsertIssueFromExternal (D-12)", () => {
  it("routes each fetched member IssueData through SyncService.upsertIssueFromExternal with the correct integrationId/projectId", async () => {
    await milestoneSyncService.performMilestoneRefresh("user-1", 1, "v1");

    expect(mockUpsertIssueFromExternal).toHaveBeenCalledTimes(2);
    expect(mockUpsertIssueFromExternal).toHaveBeenCalledWith(
      expect.anything(),
      1, // integrationId
      100, // projectId
      expect.objectContaining({ id: "ext-1" })
    );
    expect(mockUpsertIssueFromExternal).toHaveBeenCalledWith(
      expect.anything(),
      1,
      100,
      expect.objectContaining({ id: "ext-2" })
    );
  });

  it("does NOT write issue rows through any milestone-private writer — only MilestoneIssue link rows are upserted directly", async () => {
    await milestoneSyncService.performMilestoneRefresh("user-1", 1, "v1");

    // The membership pass must not touch db.issue directly — every Issue
    // row write goes through the mocked SyncService delegate above. This
    // test asserts the MilestoneIssue link upsert happened per member,
    // which only makes sense once delegation (and the resulting local
    // issue id) is wired.
    expect(mockMilestoneIssueUpsert).toHaveBeenCalledTimes(2);
  });
});

describe("MilestoneSyncService membership import — MilestoneIssue SYNCED link creation", () => {
  it("creates a MilestoneIssue row with source: SYNCED for each imported member", async () => {
    await milestoneSyncService.performMilestoneRefresh("user-1", 1, "v1");

    expect(mockMilestoneIssueUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ source: "SYNCED" }),
      })
    );
  });

  it("uses update: {} on the MilestoneIssue upsert so an existing row's source is never overwritten (D-11)", async () => {
    await milestoneSyncService.performMilestoneRefresh("user-1", 1, "v1");

    const calls = mockMilestoneIssueUpsert.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call[0].update).toEqual({});
    }
  });

  it("keys the MilestoneIssue upsert on the composite milestoneId_issueId identity", async () => {
    await milestoneSyncService.performMilestoneRefresh("user-1", 1, "v1");

    expect(mockMilestoneIssueUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          milestoneId_issueId: expect.objectContaining({
            milestoneId: 1,
            issueId: 900,
          }),
        }),
      })
    );
  });
});

describe("MilestoneSyncService membership import — clean skip when adapter lacks getMilestoneIssues", () => {
  it("completes the refresh with no membership calls when the adapter does not declare getMilestoneIssues", async () => {
    // Simulate a non-Jira (or DC) adapter: capabilities declare milestones
    // but the adapter object has no getMilestoneIssues method at all.
    mockAdapterCapabilities = { milestones: false };

    const result = await milestoneSyncService.performMilestoneRefresh(
      "user-1",
      1,
      "v1"
    );

    expect(result.success).toBe(true);
    expect(mockUpsertIssueFromExternal).not.toHaveBeenCalled();
    expect(mockMilestoneIssueUpsert).not.toHaveBeenCalled();
  });
});
