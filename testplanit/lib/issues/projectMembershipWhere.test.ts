import { describe, expect, it } from "vitest";

import {
  collectIssueProjectIds,
  issueInProjectWhere,
} from "./projectMembershipWhere";

describe("issueInProjectWhere", () => {
  it("reaches an issue through its home project, a membership, or any link", () => {
    const where = issueInProjectWhere(7);
    const arms = where.OR.map((arm) => Object.keys(arm)[0]);
    expect(arms).toEqual([
      "projectId",
      "projectMemberships",
      "caseIssues",
      "milestoneIssues",
      "sessions",
      "testRuns",
      "sessionResults",
      "testRunResults",
      "testRunStepResults",
    ]);
    expect(where.OR[0]).toEqual({ projectId: 7 });
    expect(where.OR[1]).toEqual({
      projectMemberships: { some: { projectId: 7 } },
    });
  });

  it("does not surface an issue through a soft-deleted case or milestone", () => {
    const where = issueInProjectWhere(7);
    expect(where.OR[2]).toEqual({
      caseIssues: { some: { case: { projectId: 7, isDeleted: false } } },
    });
    expect(where.OR[3]).toEqual({
      milestoneIssues: {
        some: { milestone: { projectId: 7, isDeleted: false } },
      },
    });
  });

  it("returns a fresh object each call so callers can spread it safely", () => {
    expect(issueInProjectWhere(1)).not.toBe(issueInProjectWhere(1));
  });
});

describe("collectIssueProjectIds", () => {
  it("unions the home project, memberships, and every link's project", () => {
    const ids = collectIssueProjectIds({
      projectId: 1,
      projectMemberships: [{ projectId: 2 }, { projectId: 1 }],
      caseIssues: [{ case: { projectId: 3 } }],
      milestoneIssues: [{ milestone: { projectId: 4 } }],
      sessions: [{ projectId: 5 }],
      sessionResults: [{ session: { projectId: 6 } }],
      testRuns: [{ projectId: 7 }],
      testRunResults: [{ testRun: { projectId: 8 } }],
      testRunStepResults: [{ testRunResult: { testRun: { projectId: 9 } } }],
    });
    expect([...ids].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("ignores missing relations and null projects", () => {
    const ids = collectIssueProjectIds({
      projectId: null,
      caseIssues: [{ case: null }],
      testRunStepResults: [{ testRunResult: null }],
    });
    expect(ids.size).toBe(0);
  });
});
