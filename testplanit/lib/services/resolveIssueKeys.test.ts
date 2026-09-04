/**
 * The resolver's whole reason to exist is that a tracker key must land on the
 * SAME `Issue` row the web UI would have written — the dedup key is
 * `(externalId, integrationId)` and `externalId` is the tracker's internal id,
 * not the key, so anything that skips the upstream read produces a duplicate
 * the first time a human links the ticket. These tests pin that it reads
 * upstream exactly when it has to, that a batch pays for each distinct key
 * once, and that one bad key never takes the batch down with it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const issueFindFirst = vi.fn();
const projectIntegrationFindMany = vi.fn();
const performIssueRefreshSystem = vi.fn();

vi.mock("~/lib/db", () => ({
  baseDb: {
    issue: { findFirst: (...args: unknown[]) => issueFindFirst(...args) },
    projectIntegration: {
      findMany: (...args: unknown[]) => projectIntegrationFindMany(...args),
    },
  },
}));

vi.mock("~/lib/integrations/services/SyncService", () => ({
  syncService: {
    performIssueRefreshSystem: (...args: unknown[]) =>
      performIssueRefreshSystem(...args),
  },
}));

const {
  IssueKeyResolutionError,
  resolveIssueKeys,
  resolveIssueTrackerIntegration,
} = await import("./resolveIssueKeys");

const JIRA_MAPPING = {
  integrationId: 7,
  integration: { provider: "JIRA" },
};

beforeEach(() => {
  vi.clearAllMocks();
  projectIntegrationFindMany.mockResolvedValue([JIRA_MAPPING]);
  issueFindFirst.mockResolvedValue(null);
  performIssueRefreshSystem.mockResolvedValue({ success: true });
});

describe("resolveIssueTrackerIntegration", () => {
  it("uses the project's single active issue-tracker integration", async () => {
    await expect(resolveIssueTrackerIntegration(1)).resolves.toEqual({
      integrationId: 7,
      provider: "JIRA",
    });
  });

  it("refuses to guess when the project has more than one", async () => {
    projectIntegrationFindMany.mockResolvedValue([
      JIRA_MAPPING,
      { integrationId: 9, integration: { provider: "GITHUB" } },
    ]);

    await expect(resolveIssueTrackerIntegration(1)).rejects.toThrow(
      /Pass integrationId/
    );
  });

  it("scopes a named integration to the project, so another project's cannot be borrowed", async () => {
    projectIntegrationFindMany.mockResolvedValue([]);

    await expect(resolveIssueTrackerIntegration(1, 42)).rejects.toThrow(
      /Integration 42 is not an active issue-tracker integration on project 1/
    );
    // The project scope is part of the query, not a post-filter.
    expect(projectIntegrationFindMany.mock.calls[0][0].where).toMatchObject({
      projectId: 1,
      isActive: true,
      integrationId: 42,
    });
  });

  it("reports a project with no tracker at all distinctly", async () => {
    projectIntegrationFindMany.mockResolvedValue([]);

    await expect(resolveIssueTrackerIntegration(1)).rejects.toThrow(
      /no active issue-tracker integration/
    );
  });

  it("raises IssueKeyResolutionError so callers can map it to a status", async () => {
    projectIntegrationFindMany.mockResolvedValue([]);

    await expect(resolveIssueTrackerIntegration(1)).rejects.toBeInstanceOf(
      IssueKeyResolutionError
    );
  });
});

describe("resolveIssueKeys", () => {
  it("returns a local row without touching the tracker", async () => {
    issueFindFirst.mockResolvedValue({ id: 55 });

    const out = await resolveIssueKeys({ projectId: 1, keys: ["PROJ-1"] });

    expect(out.get("PROJ-1")).toEqual({ key: "PROJ-1", issueId: 55 });
    expect(performIssueRefreshSystem).not.toHaveBeenCalled();
  });

  it("creates the row from the tracker when the key is unknown here", async () => {
    // Miss, then the post-refresh re-read finds what the upsert wrote.
    issueFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 77 });

    const out = await resolveIssueKeys({ projectId: 3, keys: ["PROJ-9"] });

    expect(out.get("PROJ-9")).toEqual({
      key: "PROJ-9",
      issueId: 77,
      created: true,
    });
    // createIfMissing is what turns a refresh into a resolve.
    expect(performIssueRefreshSystem).toHaveBeenCalledWith(7, "PROJ-9", {
      createIfMissing: { projectId: 3 },
    });
  });

  it("charges one upstream lookup for a key repeated across the batch", async () => {
    issueFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 5 });

    const out = await resolveIssueKeys({
      projectId: 1,
      keys: ["PROJ-1", "PROJ-1", " PROJ-1 "],
    });

    expect(performIssueRefreshSystem).toHaveBeenCalledTimes(1);
    // Every spelling the caller used gets an answer, keyed as they wrote it.
    expect(out.get("PROJ-1")?.issueId).toBe(5);
    expect(out.get(" PROJ-1 ")?.issueId).toBe(5);
  });

  it("fails one key without failing the others", async () => {
    issueFindFirst.mockImplementation(async (args: any) => {
      const key = args.where.OR[0].externalKey;
      return key === "GOOD-1" ? { id: 11 } : null;
    });
    performIssueRefreshSystem.mockResolvedValue({
      success: false,
      error: "Issue does not exist",
    });

    const out = await resolveIssueKeys({
      projectId: 1,
      keys: ["GOOD-1", "TYPO-9"],
    });

    expect(out.get("GOOD-1")?.issueId).toBe(11);
    expect(out.get("TYPO-9")?.issueId).toBeUndefined();
    expect(out.get("TYPO-9")?.error).toBe("Issue does not exist");
  });

  it("caps upstream lookups per call instead of fanning out unbounded", async () => {
    const out = await resolveIssueKeys({
      projectId: 1,
      keys: ["A-1", "A-2", "A-3"],
      maxLookups: 2,
    });

    expect(performIssueRefreshSystem).toHaveBeenCalledTimes(2);
    expect(out.get("A-3")?.error).toMatch(/already made 2 tracker lookups/);
  });

  it("reports a blank key rather than dropping it", async () => {
    const out = await resolveIssueKeys({ projectId: 1, keys: ["  "] });

    expect(out.get("  ")).toEqual({ key: "  ", error: "Issue key is empty." });
    expect(projectIntegrationFindMany).not.toHaveBeenCalled();
  });

  it("names the owning project when the row belongs to a different one", async () => {
    // Local miss, refresh succeeds, but the row it touched is another
    // project's — createIfMissing never fired.
    issueFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ projectId: 99 });

    const out = await resolveIssueKeys({ projectId: 1, keys: ["PROJ-4"] });

    expect(out.get("PROJ-4")?.error).toMatch(/already tracked by project 99/);
  });

  it("says a concurrent sync holds the key rather than claiming it is missing", async () => {
    performIssueRefreshSystem.mockResolvedValue({
      success: true,
      locked: true,
    });

    const out = await resolveIssueKeys({ projectId: 1, keys: ["PROJ-4"] });

    expect(out.get("PROJ-4")?.error).toMatch(/being synced by another request/);
  });

  it("does no work at all for an empty key list", async () => {
    const out = await resolveIssueKeys({ projectId: 1, keys: [] });

    expect(out.size).toBe(0);
    expect(projectIntegrationFindMany).not.toHaveBeenCalled();
  });
});
