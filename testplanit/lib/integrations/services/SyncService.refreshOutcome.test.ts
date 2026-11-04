import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DbClient } from "~/lib/zenstack";

/**
 * `performIssueRefreshSystem` reports what it did to the local row so the
 * tracker webhook rules can act on it: the refreshed (or created) issue,
 * the status it had before, and — when an import rule declined an unknown
 * issue — that nothing was imported.
 */

const mocks = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    store,
    issueFindFirst: vi.fn(),
    issueFindUnique: vi.fn(),
    issueUpdate: vi.fn(),
    issueUpsert: vi.fn(),
    integrationFindUnique: vi.fn(),
    projectsFindUnique: vi.fn(),
    membershipFindUnique: vi.fn(),
    membershipUpsert: vi.fn(),
    syncIssue: vi.fn(),
    syncIssueToElasticsearch: vi.fn(),
  };
});

vi.mock("@/lib/rawDb", () => ({
  rawDb: {
    issue: {
      findFirst: (...a: any[]) => mocks.issueFindFirst(...a),
      findUnique: (...a: any[]) => mocks.issueFindUnique(...a),
      update: (...a: any[]) => mocks.issueUpdate(...a),
      upsert: (...a: any[]) => mocks.issueUpsert(...a),
    },
    integration: {
      findUnique: (...a: any[]) => mocks.integrationFindUnique(...a),
    },
    projects: {
      findUnique: (...a: any[]) => mocks.projectsFindUnique(...a),
    },
    issueProjectMembership: {
      findUnique: (...a: any[]) => mocks.membershipFindUnique(...a),
      upsert: (...a: any[]) => mocks.membershipUpsert(...a),
    },
  },
}));
vi.mock("../cache/IssueCache", () => ({
  issueCache: { set: vi.fn(), setMetadata: vi.fn() },
}));
vi.mock("../AuthenticationService", () => ({
  AuthenticationService: { markNeedsReauth: vi.fn() },
}));
vi.mock("../IntegrationManager", () => ({
  integrationManager: {
    getAdapter: vi.fn().mockResolvedValue({
      getCapabilities: () => ({ syncIssue: true }),
      syncIssue: (...a: any[]) => mocks.syncIssue(...a),
    }),
  },
}));
vi.mock("~/services/issueSearch", () => ({
  syncIssueToElasticsearch: mocks.syncIssueToElasticsearch,
}));
vi.mock("../../multiTenantDb", () => ({ getCurrentTenantId: vi.fn() }));
vi.mock("../../queues", () => ({
  getSyncQueue: vi.fn().mockReturnValue(null),
}));
vi.mock("../../auditContextEnqueue", () => ({
  enqueueWithAuditContext: vi.fn(),
}));
vi.mock("../../valkey", () => ({
  default: {
    set: vi.fn(async (key: string) => {
      if (mocks.store.has(key)) return null;
      mocks.store.set(key, "1");
      return "OK";
    }),
    del: vi.fn(async (key: string) => {
      mocks.store.delete(key);
      return 1;
    }),
    publish: vi.fn(async () => 1),
  },
}));

import { syncService } from "./SyncService";

const ISSUE_DATA = {
  id: "10042",
  key: "DEMO-42",
  title: "Checkout totals",
  description: "",
  status: "Ready for QA",
  priority: "High",
  issueType: { id: "10001", name: "Story" },
  labels: ["qa", "backend"],
  url: "https://jira.example/browse/DEMO-42",
  customFields: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.store.clear();
  for (const fn of [
    mocks.issueFindFirst,
    mocks.issueFindUnique,
    mocks.issueUpdate,
    mocks.issueUpsert,
    mocks.integrationFindUnique,
    mocks.projectsFindUnique,
    mocks.membershipFindUnique,
    mocks.membershipUpsert,
    mocks.syncIssue,
    mocks.syncIssueToElasticsearch,
  ]) {
    fn.mockReset();
  }
  mocks.syncIssueToElasticsearch.mockResolvedValue(true);
  mocks.integrationFindUnique.mockResolvedValue({
    id: 3,
    authType: "PERSONAL_ACCESS_TOKEN",
    credentials: { token: "x" },
    provider: "JIRA",
  });
  mocks.syncIssue.mockResolvedValue(ISSUE_DATA);
  mocks.issueUpdate.mockResolvedValue({});
  mocks.issueUpsert.mockResolvedValue({ id: 900, isRequirement: false });
  // Neither the post-update refetch nor the create pre-check finds a row.
  mocks.issueFindUnique.mockResolvedValue(null);
  mocks.projectsFindUnique.mockResolvedValue({ createdBy: "creator-1" });
  // The refreshing project already holds the existing issue.
  mocks.membershipFindUnique.mockResolvedValue({ issueId: 100 });
  mocks.membershipUpsert.mockResolvedValue({});
});

describe("performIssueRefreshSystem — refresh outcome", () => {
  it("reports an existing issue it updated, with the tracker status it had before", async () => {
    mocks.issueFindFirst.mockResolvedValue({
      id: 100,
      projectId: 7,
      externalStatus: "In Progress",
      status: "Local status",
      isRequirement: true,
      data: null,
    });

    const result = await syncService.performIssueRefreshSystem(3, "DEMO-42", {
      createIfMissing: { projectId: 7, shouldCreate: () => false },
    });

    expect(result).toEqual({
      success: true,
      issue: {
        issueId: 100,
        projectId: 7,
        created: false,
        addedToProject: false,
        previousStatus: "In Progress",
        status: "Ready for QA",
        issueTypeId: "10001",
        labels: ["qa", "backend"],
        // No readable config: the row keeps its own flag.
        isRequirement: true,
        key: "DEMO-42",
        title: "Checkout totals",
        url: "https://jira.example/browse/DEMO-42",
      },
    });
    expect(mocks.issueUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.issueUpsert).not.toHaveBeenCalled();
  });

  it("falls back to the stored status when no tracker status was recorded", async () => {
    mocks.issueFindFirst.mockResolvedValue({
      id: 100,
      projectId: null,
      externalStatus: null,
      status: "Open",
      data: {},
    });

    const result = await syncService.performIssueRefreshSystem(3, "DEMO-42");

    expect(result.issue).toMatchObject({
      issueId: 100,
      projectId: null,
      previousStatus: "Open",
      isRequirement: false,
    });

    mocks.issueFindFirst.mockResolvedValue({ id: 101, data: {} });
    const bare = await syncService.performIssueRefreshSystem(3, "DEMO-42");
    expect(bare.issue?.previousStatus).toBeNull();
  });

  it("reports a pinned requirement override over the row's flag", async () => {
    mocks.issueFindFirst.mockResolvedValue({
      id: 100,
      projectId: 7,
      externalStatus: "To Do",
      isRequirement: true,
      requirementOverride: "FORCE_OFF",
    });
    const result = await syncService.performIssueRefreshSystem(3, "DEMO-42");
    expect(result.issue?.isRequirement).toBe(false);
  });

  it("reports an issue it created, with no previous status", async () => {
    mocks.issueFindFirst.mockResolvedValue(null);
    mocks.issueUpsert.mockResolvedValue({ id: 900, isRequirement: true });
    const shouldCreate = vi.fn().mockResolvedValue(true);

    const result = await syncService.performIssueRefreshSystem(3, "DEMO-42", {
      createIfMissing: { projectId: 7, shouldCreate },
    });

    expect(shouldCreate).toHaveBeenCalledWith(ISSUE_DATA);
    expect(result).toEqual({
      success: true,
      issue: {
        issueId: 900,
        projectId: 7,
        created: true,
        addedToProject: true,
        previousStatus: null,
        status: "Ready for QA",
        issueTypeId: "10001",
        labels: ["qa", "backend"],
        isRequirement: true,
        key: "DEMO-42",
        title: "Checkout totals",
        url: "https://jira.example/browse/DEMO-42",
      },
    });
  });

  it("reports created:false when the upsert revived a row the lookup missed", async () => {
    mocks.issueFindFirst.mockResolvedValue(null);
    mocks.issueFindUnique.mockResolvedValue({
      id: 900,
      projectId: 7,
      _count: { children: 0, caseIssues: 0, milestoneIssues: 0 },
    });

    const result = await syncService.performIssueRefreshSystem(3, "DEMO-42", {
      createIfMissing: { projectId: 7 },
    });

    expect(result.issue).toMatchObject({
      issueId: 900,
      created: false,
      addedToProject: true,
    });
  });

  it("imports nothing when shouldCreate declines the unknown issue", async () => {
    mocks.issueFindFirst.mockResolvedValue(null);

    const result = await syncService.performIssueRefreshSystem(3, "DEMO-42", {
      createIfMissing: { projectId: 7, shouldCreate: async () => false },
    });

    expect(result).toEqual({ success: true, notImported: true });
    expect(mocks.issueUpsert).not.toHaveBeenCalled();
    expect(mocks.issueUpdate).not.toHaveBeenCalled();
    expect(mocks.projectsFindUnique).not.toHaveBeenCalled();
  });

  it("creates the issue as the given user", async () => {
    mocks.issueFindFirst.mockResolvedValue(null);

    await syncService.performIssueRefreshSystem(3, "DEMO-42", {
      createIfMissing: { projectId: 7, createdById: "system-user" },
    });

    expect(mocks.issueUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          createdById: "system-user",
          projectId: 7,
          externalId: "10042",
        }),
      })
    );
  });

  it("creates the issue as the project's creator when no user is given", async () => {
    mocks.issueFindFirst.mockResolvedValue(null);

    await syncService.performIssueRefreshSystem(3, "DEMO-42", {
      createIfMissing: { projectId: 7 },
    });

    expect(mocks.issueUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ createdById: "creator-1" }),
      })
    );
  });
});

describe("performIssueRefreshSystem — an existing issue reaching another project", () => {
  const EXISTING = {
    id: 100,
    projectId: 7,
    externalStatus: "In Progress",
    isRequirement: false,
    data: null,
  };

  beforeEach(() => {
    mocks.issueFindFirst.mockResolvedValue(EXISTING);
  });

  it("attaches the issue to the importing project and reports it as added", async () => {
    mocks.membershipFindUnique.mockResolvedValue(null);
    const shouldCreate = vi.fn().mockResolvedValue(true);

    const result = await syncService.performIssueRefreshSystem(3, "DEMO-42", {
      createIfMissing: { projectId: 8, shouldCreate },
    });

    expect(shouldCreate).toHaveBeenCalledWith(ISSUE_DATA);
    expect(mocks.membershipFindUnique).toHaveBeenCalledWith({
      where: { issueId_projectId: { issueId: 100, projectId: 8 } },
      select: { issueId: true },
    });
    expect(mocks.membershipUpsert).toHaveBeenCalledWith({
      where: { issueId_projectId: { issueId: 100, projectId: 8 } },
      create: { issueId: 100, projectId: 8 },
      update: {},
    });
    expect(result.issue).toMatchObject({
      issueId: 100,
      // The home project is untouched.
      projectId: 7,
      created: false,
      addedToProject: true,
      previousStatus: "In Progress",
    });
    // The row was still refreshed.
    expect(mocks.issueUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.issueUpsert).not.toHaveBeenCalled();
    // ...and re-indexed after the new project joined (the refresh indexed
    // it once already, before the membership existed).
    expect(mocks.syncIssueToElasticsearch).toHaveBeenLastCalledWith(100);
    expect(mocks.syncIssueToElasticsearch).toHaveBeenCalledTimes(2);
  });

  it("attaches without an import filter when none is given", async () => {
    mocks.membershipFindUnique.mockResolvedValue(null);

    const result = await syncService.performIssueRefreshSystem(3, "DEMO-42", {
      createIfMissing: { projectId: 8 },
    });

    expect(mocks.membershipUpsert).toHaveBeenCalledTimes(1);
    expect(result.issue?.addedToProject).toBe(true);
  });

  it("is idempotent: a project that already holds the issue is not added again", async () => {
    mocks.membershipFindUnique.mockResolvedValue({ issueId: 100 });
    const shouldCreate = vi.fn().mockResolvedValue(true);

    const result = await syncService.performIssueRefreshSystem(3, "DEMO-42", {
      createIfMissing: { projectId: 8, shouldCreate },
    });

    expect(mocks.membershipUpsert).not.toHaveBeenCalled();
    expect(shouldCreate).not.toHaveBeenCalled();
    expect(result.issue?.addedToProject).toBe(false);
    expect(mocks.issueUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.syncIssueToElasticsearch).toHaveBeenCalledTimes(1);
  });

  it("refreshes but doesn't attach when the project's import rules decline the issue", async () => {
    mocks.membershipFindUnique.mockResolvedValue(null);

    const result = await syncService.performIssueRefreshSystem(3, "DEMO-42", {
      createIfMissing: { projectId: 8, shouldCreate: async () => false },
    });

    expect(mocks.membershipUpsert).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: true,
      issue: { issueId: 100, created: false, addedToProject: false },
    });
    expect(result.notImported).toBeUndefined();
    expect(mocks.issueUpdate).toHaveBeenCalledTimes(1);
  });

  it("never attaches on a manual sync (no createIfMissing)", async () => {
    mocks.membershipFindUnique.mockResolvedValue(null);

    const result = await syncService.performIssueRefreshSystem(3, "DEMO-42");

    expect(mocks.membershipFindUnique).not.toHaveBeenCalled();
    expect(mocks.membershipUpsert).not.toHaveBeenCalled();
    expect(result.issue?.addedToProject).toBe(false);
  });
});

describe("upsertIssueFromExternal", () => {
  it("returns the row's requirement flag and honors createdById", async () => {
    const db = {
      projects: { findUnique: vi.fn().mockResolvedValue({ createdBy: "c" }) },
      issue: {
        upsert: vi.fn().mockResolvedValue({ id: 5, isRequirement: true }),
      },
    };

    const result = await syncService.upsertIssueFromExternal(
      db as unknown as DbClient,
      3,
      7,
      ISSUE_DATA as any,
      { createdById: "system-user" }
    );

    expect(result).toEqual({ id: 5, created: true, isRequirement: true });
    expect(db.issue.upsert.mock.calls[0][0].create.createdById).toBe(
      "system-user"
    );
  });

  it("reports isRequirement false when the row has no flag", async () => {
    const db = {
      projects: { findUnique: vi.fn().mockResolvedValue({ createdBy: "c" }) },
      issue: { upsert: vi.fn().mockResolvedValue({ id: 5 }) },
    };
    const result = await syncService.upsertIssueFromExternal(
      db as unknown as DbClient,
      3,
      7,
      ISSUE_DATA as any
    );
    expect(result.isRequirement).toBe(false);
    expect(db.issue.upsert.mock.calls[0][0].create.createdById).toBe("c");
  });
});
