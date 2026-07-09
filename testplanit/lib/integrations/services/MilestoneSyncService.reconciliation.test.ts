import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * RED scaffold (18-01) for the membership reconciliation diff logic — not
 * yet implemented on MilestoneSyncService. Mirrors the auto-track diff
 * idiom (`performProjectMilestoneSync`, MilestoneSyncService.ts:655-686):
 * diff the freshly-fetched external member id set against the currently
 * SYNCED `MilestoneIssue` rows.
 *
 * Pins:
 *  - departed SYNCED links are deleted (raw-db deleteMany scoped
 *    source: "SYNCED"); the underlying Issue row is NOT deleted.
 *  - MANUAL links for departed issues are never deleted (deleteMany
 *    where-clause carries source: "SYNCED", excluding MANUAL).
 *  - an existing MANUAL row for a current Jira member stays MANUAL
 *    (upsert update: {} never downgrades/overwrites source — D-11).
 *  - membership is capped at IMPORT_MAX_CAP (1000); when the external
 *    member count exceeds the cap, only cap members are processed and the
 *    pass records an internal "reached cap" signal on its result.
 *
 * All assertions target the not-yet-implemented reconciliation path — this
 * file MUST fail at authoring time.
 */

// ─── Mocks ────────────────────────────────────────────────────────────────
const mockMilestonesFindFirst = vi.fn();
const mockMilestonesUpsert = vi.fn();
const mockIntegrationProjectFindMany = vi.fn();
const mockMilestoneIssueUpsert = vi.fn();
const mockMilestoneIssueDeleteMany = vi.fn();
const mockMilestoneIssueFindMany = vi.fn();
const mockUpsertIssueFromExternal = vi.fn();
const mockIssueDelete = vi.fn();

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
      findMany: (...args: any[]) => mockMilestoneIssueFindMany(...args),
    },
    issue: {
      delete: (...args: any[]) => mockIssueDelete(...args),
    },
  },
}));

const mockGetExternalMilestones = vi.fn();
const mockGetMilestoneIssues = vi.fn();

vi.mock("../IntegrationManager", () => ({
  integrationManager: {
    getAdapter: vi.fn().mockResolvedValue({
      getCapabilities: () => ({
        milestones: { kinds: ["RELEASE", "ITERATION"], webhooks: false },
      }),
      getExternalMilestones: (...args: any[]) =>
        mockGetExternalMilestones(...args),
      getMilestoneIssues: (...args: any[]) =>
        mockGetMilestoneIssues(...args),
    }),
  },
}));

vi.mock("./SyncService", () => ({
  syncService: {
    upsertIssueFromExternal: (...args: any[]) =>
      mockUpsertIssueFromExternal(...args),
  },
  IMPORT_MAX_CAP: 1000,
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
  mockMilestoneIssueFindMany.mockResolvedValue([]);
  mockUpsertIssueFromExternal.mockImplementation(
    async (_db: any, _integrationId: number, _projectId: number, issueData: any) => ({
      id: issueData.id === "ext-1" ? 900 : 901,
      created: true,
    })
  );
});

describe("MilestoneSyncService reconciliation — departed members", () => {
  it("deletes the SYNCED MilestoneIssue row for a member that left the Jira version/sprint", async () => {
    // Locally, issue 777 was previously a SYNCED member; upstream, the
    // current fetch no longer includes it (only ext-1 remains).
    mockMilestoneIssueFindMany.mockResolvedValue([
      { issueId: 777, source: "SYNCED", issue: { externalId: "ext-departed" } },
    ]);
    mockGetMilestoneIssues.mockResolvedValue({
      issues: [makeExtIssue({ id: "ext-1" })],
      hasMore: false,
    });

    await milestoneSyncService.performMilestoneRefresh("user-1", 1, "v1");

    expect(mockMilestoneIssueDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          milestoneId: 1,
          issueId: expect.objectContaining({ in: expect.arrayContaining([777]) }),
          source: "SYNCED",
        }),
      })
    );
  });

  it("does NOT delete the underlying Issue row for a departed member — only the link", async () => {
    mockMilestoneIssueFindMany.mockResolvedValue([
      { issueId: 777, source: "SYNCED", issue: { externalId: "ext-departed" } },
    ]);
    mockGetMilestoneIssues.mockResolvedValue({
      issues: [makeExtIssue({ id: "ext-1" })],
      hasMore: false,
    });

    await milestoneSyncService.performMilestoneRefresh("user-1", 1, "v1");

    // Positive precondition: reconciliation must actually have run and
    // deleted the SYNCED link (proves this test fails for the right reason
    // pre-implementation, not merely because nothing happened at all).
    expect(mockMilestoneIssueDeleteMany).toHaveBeenCalled();
    expect(mockIssueDelete).not.toHaveBeenCalled();
  });

  it("REGRESSION (CR-01): departure reconciliation works against a client that HONORS `select` — `source` must be in the select or the defensive re-filter turns the pass into dead code", async () => {
    // Unlike the plain mockResolvedValue doubles above (which return full
    // rows regardless of `select`, masking a missing-select bug), this fake
    // projects rows through the query's `select` clause exactly like the
    // real ZenStack/Kysely client: an unselected field comes back undefined.
    const storedLinks = [
      { issueId: 777, source: "SYNCED", issue: { externalId: "ext-departed" } },
    ];
    const projectSelect = (row: any, select: any): any =>
      Object.fromEntries(
        Object.entries(select).map(([key, value]) => [
          key,
          value === true
            ? row[key]
            : projectSelect(row[key], (value as any).select),
        ])
      );
    mockMilestoneIssueFindMany.mockImplementation(async (args: any) =>
      storedLinks.map((row) =>
        args?.select ? projectSelect(row, args.select) : row
      )
    );
    mockGetMilestoneIssues.mockResolvedValue({
      issues: [makeExtIssue({ id: "ext-1" })],
      hasMore: false,
    });

    await milestoneSyncService.performMilestoneRefresh("user-1", 1, "v1");

    // The select shape itself must request `source` (belt) …
    const findManyArgs = mockMilestoneIssueFindMany.mock.calls[0]?.[0];
    expect(findManyArgs?.select).toEqual(
      expect.objectContaining({ issueId: true, source: true })
    );
    // … and the departed member must actually be unlinked (suspenders).
    expect(mockMilestoneIssueDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          milestoneId: 1,
          issueId: expect.objectContaining({
            in: expect.arrayContaining([777]),
          }),
          source: "SYNCED",
        }),
      })
    );
  });

  it("never deletes a MANUAL link for a departed issue — deleteMany where-clause is scoped to source: SYNCED, excluding MANUAL rows", async () => {
    mockMilestoneIssueFindMany.mockResolvedValue([
      { issueId: 777, source: "SYNCED", issue: { externalId: "ext-departed" } },
      { issueId: 778, source: "MANUAL", issue: { externalId: "ext-manual-only" } },
    ]);
    mockGetMilestoneIssues.mockResolvedValue({
      issues: [makeExtIssue({ id: "ext-1" })],
      hasMore: false,
    });

    await milestoneSyncService.performMilestoneRefresh("user-1", 1, "v1");

    const deleteCall = mockMilestoneIssueDeleteMany.mock.calls[0]?.[0];
    expect(deleteCall).toBeTruthy();
    expect(deleteCall.where.source).toBe("SYNCED");
    // The MANUAL row's issueId (778) must not appear in the deleted set.
    expect(deleteCall.where.issueId.in).not.toContain(778);
  });
});

describe("MilestoneSyncService reconciliation — MANUAL stickiness (D-11)", () => {
  it("leaves an existing MANUAL row untouched (still MANUAL) for an issue that IS a current Jira member", async () => {
    // issue 900 (ext-1) already has a MANUAL link locally; it's also a
    // current Jira member per the fetch. Sync must not downgrade/overwrite
    // its source.
    mockMilestoneIssueFindMany.mockResolvedValue([
      { issueId: 900, source: "MANUAL", issue: { externalId: "ext-1" } },
    ]);
    mockGetMilestoneIssues.mockResolvedValue({
      issues: [makeExtIssue({ id: "ext-1" })],
      hasMore: false,
    });

    await milestoneSyncService.performMilestoneRefresh("user-1", 1, "v1");

    // The upsert's `update` must be an empty object — it never sets
    // source: "SYNCED" over an existing MANUAL row.
    const upsertCallForMember = mockMilestoneIssueUpsert.mock.calls.find(
      (c) => c[0]?.where?.milestoneId_issueId?.issueId === 900
    );
    expect(upsertCallForMember).toBeTruthy();
    expect(upsertCallForMember![0].update).toEqual({});
  });
});

describe("MilestoneSyncService reconciliation — cap enforcement (IMPORT_MAX_CAP)", () => {
  it("processes only IMPORT_MAX_CAP (1000) members when the external member count exceeds the cap", async () => {
    const manyIssues = Array.from({ length: 1200 }, (_, i) =>
      makeExtIssue({ id: `ext-${i}` })
    );
    mockGetMilestoneIssues.mockResolvedValue({
      issues: manyIssues,
      hasMore: false,
    });

    await milestoneSyncService.performMilestoneRefresh("user-1", 1, "v1");

    expect(mockUpsertIssueFromExternal).toHaveBeenCalledTimes(1000);
  });

  it("records a 'reached cap' signal on the pass result when the cap is exceeded", async () => {
    const manyIssues = Array.from({ length: 1200 }, (_, i) =>
      makeExtIssue({ id: `ext-${i}` })
    );
    mockGetMilestoneIssues.mockResolvedValue({
      issues: manyIssues,
      hasMore: false,
    });

    const result: any = await milestoneSyncService.performMilestoneRefresh(
      "user-1",
      1,
      "v1"
    );

    // Internal signal only (NOT the client-visible overflow surface — see
    // 18-07 which reads the live overflow route as ground truth).
    expect(result.membershipReachedCap).toBe(true);
  });

  it("does NOT set the reached-cap signal when the external member count is within the cap", async () => {
    mockGetMilestoneIssues.mockResolvedValue({
      issues: [makeExtIssue({ id: "ext-1" })],
      hasMore: false,
    });

    const result: any = await milestoneSyncService.performMilestoneRefresh(
      "user-1",
      1,
      "v1"
    );

    // Positive precondition: the refresh must have actually succeeded and
    // processed the member (proves this fails for the right reason
    // pre-implementation, not merely because the call errored out).
    expect(result.success).toBe(true);
    expect(mockUpsertIssueFromExternal).toHaveBeenCalledTimes(1);
    expect(result.membershipReachedCap).toBeFalsy();
  });
});
