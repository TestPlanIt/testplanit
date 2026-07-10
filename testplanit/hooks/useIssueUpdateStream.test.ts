import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  isIssueBearingQueryKey,
  scheduleIssueInvalidation,
} from "./useIssueUpdateStream";

describe("isIssueBearingQueryKey", () => {
  it("matches issue-family model queries regardless of args", () => {
    expect(isIssueBearingQueryKey(["zenstack", "Issue", "findMany", {}])).toBe(
      true
    );
    expect(
      isIssueBearingQueryKey([
        "zenstack",
        "MilestoneIssue",
        "findMany",
        { where: { milestoneId: 450 } },
      ])
    ).toBe(true);
    expect(
      isIssueBearingQueryKey(["zenstack", "RepositoryCaseIssue", "count", {}])
    ).toBe(true);
  });

  it("matches parent-model queries whose args pull issue relations", () => {
    expect(
      isIssueBearingQueryKey([
        "zenstack",
        "Sessions",
        "findMany",
        { include: { issues: true } },
      ])
    ).toBe(true);
    expect(
      isIssueBearingQueryKey([
        "zenstack",
        "RepositoryCases",
        "findMany",
        { include: { caseIssues: { include: { issue: true } } } },
      ])
    ).toBe(true);
  });

  it("skips zenstack queries that carry no issue data", () => {
    expect(
      isIssueBearingQueryKey([
        "zenstack",
        "Projects",
        "findMany",
        { where: { isDeleted: false } },
      ])
    ).toBe(false);
    expect(
      isIssueBearingQueryKey([
        "zenstack",
        "Notification",
        "findMany",
        { where: { userId: "u1" }, take: 20 },
      ])
    ).toBe(false);
    expect(
      isIssueBearingQueryKey([
        "zenstack",
        "TestRuns",
        "findMany",
        { include: { state: true, milestone: true } },
      ])
    ).toBe(false);
  });

  it("never matches non-zenstack keys", () => {
    expect(isIssueBearingQueryKey(["batchTestRunSummaries", [1, 2]])).toBe(
      false
    );
    expect(isIssueBearingQueryKey("issues")).toBe(false);
    expect(isIssueBearingQueryKey(undefined)).toBe(false);
  });
});

describe("scheduleIssueInvalidation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("coalesces a burst of calls into a single invalidation pass", () => {
    const invalidateQueries = vi.fn();
    const client = { invalidateQueries } as any;

    // Simulate 39 subscriber callbacks + a second SSE event in one burst.
    for (let i = 0; i < 40; i++) scheduleIssueInvalidation(client);
    expect(invalidateQueries).not.toHaveBeenCalled();

    vi.advanceTimersByTime(250);
    expect(invalidateQueries).toHaveBeenCalledTimes(1);

    // A later, separate burst schedules a fresh pass.
    scheduleIssueInvalidation(client);
    vi.advanceTimersByTime(250);
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
  });

  it("invalidates with the issue-bearing predicate", () => {
    const invalidateQueries = vi.fn();
    scheduleIssueInvalidation({ invalidateQueries } as any);
    vi.advanceTimersByTime(250);

    const { predicate } = invalidateQueries.mock.calls[0][0];
    expect(
      predicate({ queryKey: ["zenstack", "MilestoneIssue", "findMany", {}] })
    ).toBe(true);
    expect(
      predicate({ queryKey: ["zenstack", "Projects", "findMany", {}] })
    ).toBe(false);
  });
});
