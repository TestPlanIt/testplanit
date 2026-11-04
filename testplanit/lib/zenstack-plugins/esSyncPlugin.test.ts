import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The issue document indexes every project an issue is visible in, so the
 * join rows that grant that visibility re-index the issue they point at.
 */

const mocks = vi.hoisted(() => ({
  syncIssueToElasticsearch: vi.fn(),
  deleteIssueFromIndex: vi.fn(),
}));

vi.mock("~/services/issueSearch", () => ({
  syncIssueToElasticsearch: mocks.syncIssueToElasticsearch,
  deleteIssueFromIndex: mocks.deleteIssueFromIndex,
}));

import { esSyncPlugin } from "./esSyncPlugin";

const hooks = (esSyncPlugin as any).onEntityMutation.$all;

// The hook fires the syncs without awaiting them (each behind a dynamic
// import), so settle on the call count rather than a fixed number of ticks.
const settled = (count: number) =>
  vi.waitFor(() =>
    expect(mocks.syncIssueToElasticsearch).toHaveBeenCalledTimes(count)
  );

beforeEach(() => {
  mocks.syncIssueToElasticsearch.mockReset().mockResolvedValue(true);
  mocks.deleteIssueFromIndex.mockReset().mockResolvedValue(undefined);
});

describe("esSyncPlugin — issue link rows", () => {
  it.each(["IssueProjectMembership", "RepositoryCaseIssue", "MilestoneIssue"])(
    "re-indexes the issue when a %s row is written",
    async (model) => {
      await hooks.afterEntityMutation({
        model,
        action: "create",
        loadAfterMutationEntities: async () => [
          { issueId: 7, projectId: 2 },
          { issueId: 7, projectId: 3 },
          { issueId: 8, projectId: 2 },
        ],
        beforeMutationEntities: undefined,
      });
      await settled(2);

      expect(mocks.syncIssueToElasticsearch.mock.calls).toEqual([[7], [8]]);
      expect(mocks.deleteIssueFromIndex).not.toHaveBeenCalled();
    }
  );

  it("loads the before image of a deleted link so the issue can be re-indexed", async () => {
    const loadBeforeMutationEntities = vi.fn();
    await hooks.beforeEntityMutation({
      model: "IssueProjectMembership",
      action: "delete",
      loadBeforeMutationEntities,
    });
    expect(loadBeforeMutationEntities).toHaveBeenCalledTimes(1);

    await hooks.afterEntityMutation({
      model: "IssueProjectMembership",
      action: "delete",
      loadAfterMutationEntities: async () => {
        throw new Error("deleted rows have no after image");
      },
      beforeMutationEntities: [{ issueId: 9, projectId: 2 }],
    });
    await settled(1);

    // The issue row itself still exists: it is re-indexed, not dropped.
    expect(mocks.syncIssueToElasticsearch).toHaveBeenCalledWith(9);
    expect(mocks.deleteIssueFromIndex).not.toHaveBeenCalled();
  });

  it("leaves unrelated models alone", async () => {
    const loadAfterMutationEntities = vi.fn();
    await hooks.afterEntityMutation({
      model: "RequirementIssueReference",
      action: "create",
      loadAfterMutationEntities,
      beforeMutationEntities: undefined,
    });
    expect(loadAfterMutationEntities).not.toHaveBeenCalled();
    expect(mocks.syncIssueToElasticsearch).not.toHaveBeenCalled();
  });
});
