// Real assertions for HYG-01's linked-defect list (converted from the Wave 0
// placeholder titles landed by 23-01).
//
// This is the milestone page's LINKED-DEFECT list, not MilestoneIssue
// membership — a different axis entirely. Membership legitimately includes
// requirement rows (an Epic can be both a milestone member on the
// execution axis and a requirement on the capability axis, per the
// perpendicular-axes design from #501); this linked-defect list does not,
// and should exclude them. MemberIssuesColumns.tsx carries its own header
// comment flagging this exact naming collision between the two concepts —
// do not "unify" the two lists into one predicate.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFindMany = vi.fn();
const mockQueryRaw = vi.fn();

vi.mock("~/lib/db", () => ({
  baseDb: {
    issue: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
    },
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
  },
}));

import { getMilestoneLinkedIssues } from "./milestoneSummary";

const MOCK_ISSUE_ROW = {
  id: 42,
  name: "BUG-42",
  title: "Sample defect",
  description: null,
  externalId: null,
  externalKey: null,
  externalUrl: null,
  externalStatus: null,
  data: null,
  issueTypeName: null,
  issueTypeIconUrl: null,
  integrationId: null,
  lastSyncedAt: null,
  integration: null,
};

describe("getMilestoneLinkedIssues", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Only the testRunIds-driven junction query fires (sessionIds is empty
    // in these tests), so a single resolved value covers the one call.
    mockQueryRaw.mockResolvedValue([{ issueId: 42 }]);
    mockFindMany.mockResolvedValue([MOCK_ISSUE_ROW]);
  });

  it("excludes requirement-typed rows from the linked-defect list", async () => {
    await getMilestoneLinkedIssues([1], [], 7);

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: [42] },
          isRequirement: false,
        }),
      })
    );
  });

  it("still returns non-requirement rows for the ids it collected", async () => {
    const issues = await getMilestoneLinkedIssues([1], [], 7);

    expect(issues).toEqual([{ ...MOCK_ISSUE_ROW, projectIds: [7] }]);
  });
});
