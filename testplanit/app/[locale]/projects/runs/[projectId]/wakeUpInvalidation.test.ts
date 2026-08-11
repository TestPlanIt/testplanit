import { getQueryKey } from "@zenstackhq/tanstack-query/react";
import { describe, expect, it } from "vitest";
import { testRunCasesQueryMatchesRuns } from "./wakeUpInvalidation";

/**
 * The predicate reads the run id out of the `args` slot of a key built by
 * @zenstackhq/tanstack-query. That layout is the library's, not ours, so the
 * first test pins it against the real builder: if an upgrade moves `args`,
 * this fails loudly instead of the page quietly refetching every tile again
 * (matching everything) or none of them (matching nothing).
 */

/** The args TestRunItem's contributor lookup issues, trimmed to what the
 *  predicate reads. */
const tileArgs = (testRunId: number) => ({
  where: { testRunId, isDeleted: false },
  select: { id: true },
});

describe("testRunCasesQueryMatchesRuns", () => {
  it("finds the run id in a key built by the real getQueryKey", () => {
    const key = getQueryKey("TestRunCases", "findMany", tileArgs(7));

    expect(testRunCasesQueryMatchesRuns(key, new Set([7]))).toBe(true);
    expect(testRunCasesQueryMatchesRuns(key, new Set([8]))).toBe(false);
  });

  it("matches only the tiles whose run woke up", () => {
    const runIds = new Set([7, 9]);
    const matched = [5, 7, 8, 9].filter((id) =>
      testRunCasesQueryMatchesRuns(
        getQueryKey("TestRunCases", "findMany", tileArgs(id)),
        runIds
      )
    );
    expect(matched).toEqual([7, 9]);
  });

  it("matches queries that don't pin a scalar testRunId", () => {
    // A cross-run reader can't be attributed, so it keeps the old
    // refetch-on-every-wake-up behaviour rather than going stale.
    const across = getQueryKey("TestRunCases", "findMany", {
      where: { testRunId: { in: [7, 8] }, isDeleted: false },
    });
    const none = getQueryKey("TestRunCases", "count", { where: {} });

    expect(testRunCasesQueryMatchesRuns(across, new Set([99]))).toBe(true);
    expect(testRunCasesQueryMatchesRuns(none, new Set([99]))).toBe(true);
  });

  it("does not match on a run id that only appears elsewhere in the key", () => {
    // Guards against a loosened implementation that scans the whole key:
    // `7` here is the operation-level page size, not a run.
    const key = getQueryKey("TestRunCases", "findMany", {
      where: { testRunId: 1 },
      take: 7,
    });
    expect(testRunCasesQueryMatchesRuns(key, new Set([7]))).toBe(false);
  });
});
