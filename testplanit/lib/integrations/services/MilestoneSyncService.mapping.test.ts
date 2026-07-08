import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Field mapping from `ExternalMilestone` -> Milestones create/update fields
 * per MAP-01 (RELEASE) / MAP-02 (ITERATION). Exercised indirectly through
 * `performMilestoneRefresh` (the mapping function itself is private), the
 * same pattern `SyncService`'s upsert-field tests use for its private
 * `_createIssueFromExternal` mapping.
 */

// ─── Mocks ────────────────────────────────────────────────────────────────
const mockMilestonesFindFirst = vi.fn();
const mockMilestonesFindUnique = vi.fn();
const mockMilestonesUpsert = vi.fn();
const mockIntegrationProjectFindFirst = vi.fn();

vi.mock("@/lib/rawDb", () => ({
  rawDb: {
    milestones: {
      findFirst: (...args: any[]) => mockMilestonesFindFirst(...args),
      findUnique: (...args: any[]) => mockMilestonesFindUnique(...args),
      upsert: (...args: any[]) => mockMilestonesUpsert(...args),
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

vi.mock("../../valkey", () => ({ default: null })); // fail-open, no lock plumbing needed for mapping tests

import { milestoneSyncService } from "./MilestoneSyncService";

beforeEach(() => {
  vi.clearAllMocks();
  mockMilestonesFindFirst.mockResolvedValue({
    id: 1,
    projectId: 100,
    milestoneTypesId: 5,
    lastSyncedAt: null,
  });
  mockMilestonesFindUnique.mockResolvedValue(null);
  mockMilestonesUpsert.mockResolvedValue({ id: 1 });
  mockIntegrationProjectFindFirst.mockResolvedValue({
    externalProjectKey: "TEST",
  });
});

describe("RELEASE field mapping (MAP-01)", () => {
  it("maps a released version to isCompleted=true with rawState 'released'", async () => {
    mockGetExternalMilestones.mockResolvedValue({
      items: [
        {
          id: "1",
          kind: "RELEASE",
          name: "v1.0",
          description: "First stable release",
          startDate: new Date("2026-01-01"),
          endDate: new Date("2026-02-01"),
          state: "CLOSED",
          rawState: "released",
          url: "https://example.atlassian.net/v1",
        },
      ],
      hasMore: false,
    });

    await milestoneSyncService.performMilestoneRefresh("user-1", 1, "1", {
      minFreshnessSeconds: 0,
    });

    expect(mockMilestonesUpsert).toHaveBeenCalledTimes(1);
    const call = mockMilestonesUpsert.mock.calls[0][0];
    expect(call.create.name).toBe("v1.0");
    expect(call.create.note).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "First stable release" }],
        },
      ],
    });
    expect(call.create.startedAt).toEqual(new Date("2026-01-01"));
    expect(call.create.completedAt).toEqual(new Date("2026-02-01"));
    expect(call.create.isCompleted).toBe(true);
    expect(call.create.isStarted).toBe(false);
    expect(call.create.externalState).toBe("released");
    expect(call.create.externalKind).toBe("RELEASE");
    expect(call.create.externalUrl).toBe("https://example.atlassian.net/v1");
  });

  it("maps an archived version to CLOSED / isCompleted=true", async () => {
    mockGetExternalMilestones.mockResolvedValue({
      items: [
        {
          id: "2",
          kind: "RELEASE",
          name: "v0.9",
          state: "CLOSED",
          rawState: "archived",
        },
      ],
      hasMore: false,
    });

    await milestoneSyncService.performMilestoneRefresh("user-1", 1, "2", {
      minFreshnessSeconds: 0,
    });

    const call = mockMilestonesUpsert.mock.calls[0][0];
    expect(call.create.isCompleted).toBe(true);
    expect(call.create.externalState).toBe("archived");
  });

  it("maps an active (unreleased, past start date) version to isStarted=true", async () => {
    mockGetExternalMilestones.mockResolvedValue({
      items: [
        {
          id: "3",
          kind: "RELEASE",
          name: "v1.1",
          state: "ACTIVE",
          rawState: "unreleased",
        },
      ],
      hasMore: false,
    });

    await milestoneSyncService.performMilestoneRefresh("user-1", 1, "3", {
      minFreshnessSeconds: 0,
    });

    const call = mockMilestonesUpsert.mock.calls[0][0];
    expect(call.create.isStarted).toBe(true);
    expect(call.create.isCompleted).toBe(false);
  });

  it("maps missing description to an omitted note field (not an empty doc, not literal null — ZenStack v3's Kysely CRUD layer rejects null Json)", async () => {
    mockGetExternalMilestones.mockResolvedValue({
      items: [
        {
          id: "4",
          kind: "RELEASE",
          name: "v1.2",
          state: "FUTURE",
          rawState: "unreleased",
        },
      ],
      hasMore: false,
    });

    await milestoneSyncService.performMilestoneRefresh("user-1", 1, "4", {
      minFreshnessSeconds: 0,
    });

    const call = mockMilestonesUpsert.mock.calls[0][0];
    expect(call.create.note).toBeUndefined();
    expect("note" in call.create).toBe(false);
    expect(call.create.isStarted).toBe(false);
    expect(call.create.isCompleted).toBe(false);
  });
});

describe("ITERATION field mapping (MAP-02)", () => {
  it("maps an active sprint (goal -> note) to isStarted=true", async () => {
    mockGetExternalMilestones.mockResolvedValue({
      items: [
        {
          id: "sprint-1",
          kind: "ITERATION",
          name: "Sprint 5",
          description: "Ship the auth rewrite",
          startDate: new Date("2026-03-01"),
          endDate: new Date("2026-03-14"),
          state: "ACTIVE",
          rawState: "active",
        },
      ],
      hasMore: false,
    });

    await milestoneSyncService.performMilestoneRefresh(
      "user-1",
      1,
      "sprint-1",
      { minFreshnessSeconds: 0 }
    );

    const call = mockMilestonesUpsert.mock.calls[0][0];
    expect(call.create.name).toBe("Sprint 5");
    expect(call.create.note).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Ship the auth rewrite" }],
        },
      ],
    });
    expect(call.create.isStarted).toBe(true);
    expect(call.create.isCompleted).toBe(false);
    expect(call.create.externalKind).toBe("ITERATION");
  });

  it("maps a closed sprint to isCompleted=true", async () => {
    mockGetExternalMilestones.mockResolvedValue({
      items: [
        {
          id: "sprint-2",
          kind: "ITERATION",
          name: "Sprint 4",
          state: "CLOSED",
          rawState: "closed",
        },
      ],
      hasMore: false,
    });

    await milestoneSyncService.performMilestoneRefresh(
      "user-1",
      1,
      "sprint-2",
      { minFreshnessSeconds: 0 }
    );

    const call = mockMilestonesUpsert.mock.calls[0][0];
    expect(call.create.isCompleted).toBe(true);
    expect(call.create.isStarted).toBe(false);
  });

  it("maps a future sprint to isStarted=false, isCompleted=false", async () => {
    mockGetExternalMilestones.mockResolvedValue({
      items: [
        {
          id: "sprint-3",
          kind: "ITERATION",
          name: "Sprint 6",
          state: "FUTURE",
          rawState: "future",
        },
      ],
      hasMore: false,
    });

    await milestoneSyncService.performMilestoneRefresh(
      "user-1",
      1,
      "sprint-3",
      { minFreshnessSeconds: 0 }
    );

    const call = mockMilestonesUpsert.mock.calls[0][0];
    expect(call.create.isStarted).toBe(false);
    expect(call.create.isCompleted).toBe(false);
  });
});
