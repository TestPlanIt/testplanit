import { describe, expect, it } from "vitest";
import {
  computeAutomatedRunMetrics,
  computeRetryMetrics,
  topSlowestResults,
  wallClockSecondsBetween,
} from "./automatedRunMetrics";

describe("wallClockSecondsBetween", () => {
  it("returns the span in seconds", () => {
    expect(
      wallClockSecondsBetween(
        "2026-08-11T17:41:00.000Z",
        "2026-08-12T00:53:00.000Z"
      )
    ).toBe(7 * 3600 + 12 * 60);
  });

  it("accepts Date objects", () => {
    expect(
      wallClockSecondsBetween(
        new Date("2026-01-01T00:00:00Z"),
        new Date("2026-01-01T00:00:30Z")
      )
    ).toBe(30);
  });

  it("returns null when either end is missing", () => {
    expect(wallClockSecondsBetween(null, "2026-01-01T00:00:00Z")).toBeNull();
    expect(wallClockSecondsBetween("2026-01-01T00:00:00Z", null)).toBeNull();
    expect(wallClockSecondsBetween(undefined, undefined)).toBeNull();
  });

  it("returns null for unparseable dates or a reversed window", () => {
    expect(wallClockSecondsBetween("not-a-date", "2026-01-01")).toBeNull();
    expect(
      wallClockSecondsBetween("2026-01-02T00:00:00Z", "2026-01-01T00:00:00Z")
    ).toBeNull();
  });
});

describe("computeAutomatedRunMetrics", () => {
  it("handles an empty run", () => {
    const metrics = computeAutomatedRunMetrics({ results: [] });
    expect(metrics.totalCount).toBe(0);
    expect(metrics.passRate).toBeNull();
    expect(metrics.totalTime).toBe(0);
    expect(metrics.wallClockSeconds).toBeNull();
    expect(metrics.parallelism).toBeNull();
    expect(metrics.avgTime).toBeNull();
    expect(metrics.medianTime).toBeNull();
    expect(metrics.maxTime).toBeNull();
  });

  it("counts FAILURE and ERROR as failed, SKIPPED as skipped, the rest as passed", () => {
    const metrics = computeAutomatedRunMetrics({
      results: [
        { resultType: "PASSED" },
        { resultType: "FAILURE" },
        { resultType: "ERROR" },
        { resultType: "SKIPPED" },
        // Unmapped/unknown types read as passed, matching the summary
        // service's fallback semantics.
        { resultType: null },
      ],
    });
    expect(metrics.passedCount).toBe(2);
    expect(metrics.failedCount).toBe(2);
    expect(metrics.skippedCount).toBe(1);
    expect(metrics.passRate).toBe(40);
  });

  it("sums, averages, and takes the median over positive times only", () => {
    const metrics = computeAutomatedRunMetrics({
      results: [
        { time: 10 },
        { time: 30 },
        { time: 20 },
        { time: 0 },
        { time: null },
        {},
      ],
    });
    expect(metrics.totalCount).toBe(6);
    expect(metrics.timedCount).toBe(3);
    expect(metrics.totalTime).toBe(60);
    expect(metrics.avgTime).toBe(20);
    expect(metrics.medianTime).toBe(20);
    expect(metrics.maxTime).toBe(30);
  });

  it("averages the two middle values for an even count", () => {
    const metrics = computeAutomatedRunMetrics({
      results: [{ time: 1 }, { time: 2 }, { time: 10 }, { time: 100 }],
    });
    expect(metrics.medianTime).toBe(6);
  });

  it("derives parallelism from total time over the wall-clock window", () => {
    const metrics = computeAutomatedRunMetrics({
      results: Array.from({ length: 10 }, () => ({ time: 50 })),
      firstResultAt: "2026-01-01T00:00:00Z",
      lastResultAt: "2026-01-01T00:01:40Z",
    });
    expect(metrics.wallClockSeconds).toBe(100);
    expect(metrics.parallelism).toBe(5);
  });

  it("suppresses parallelism for a sub-second window", () => {
    const metrics = computeAutomatedRunMetrics({
      results: [{ time: 50 }, { time: 50 }],
      firstResultAt: "2026-01-01T00:00:00.000Z",
      lastResultAt: "2026-01-01T00:00:00.500Z",
    });
    expect(metrics.parallelism).toBeNull();
  });

  it("suppresses parallelism when the ratio exceeds the timed test count", () => {
    // 2 tests totalling 400s inside a 10s window would mean 40 tests running
    // at once — a bulk-import artifact, not a real execution window.
    const metrics = computeAutomatedRunMetrics({
      results: [{ time: 200 }, { time: 200 }],
      firstResultAt: "2026-01-01T00:00:00Z",
      lastResultAt: "2026-01-01T00:00:10Z",
    });
    expect(metrics.wallClockSeconds).toBe(10);
    expect(metrics.parallelism).toBeNull();
  });

  it("keeps a below-1 parallelism (idle gaps between serial tests)", () => {
    const metrics = computeAutomatedRunMetrics({
      results: [{ time: 30 }, { time: 30 }],
      firstResultAt: "2026-01-01T00:00:00Z",
      lastResultAt: "2026-01-01T00:02:00Z",
    });
    expect(metrics.parallelism).toBe(0.5);
  });
});

describe("computeRetryMetrics", () => {
  it("reports zeros for a run without retries", () => {
    const metrics = computeRetryMetrics([
      { id: 1, resultId: 10, resultType: "PASSED" },
      { id: 2, resultId: 11, resultType: "FAILURE" },
    ]);
    expect(metrics.retriesCount).toBe(0);
    expect(metrics.retriedCaseCount).toBe(0);
    expect(metrics.flakyCaseCount).toBe(0);
  });

  it("flags a case that failed then passed on retry", () => {
    const metrics = computeRetryMetrics([
      { id: 1, resultId: 10, resultType: "FAILURE" },
      { id: 1, resultId: 11, resultType: "PASSED" },
      { id: 2, resultId: 12, resultType: "PASSED" },
    ]);
    expect(metrics.retriesCount).toBe(1);
    expect(metrics.retriedCaseCount).toBe(1);
    expect(metrics.flakyCaseCount).toBe(1);
    expect(metrics.flakyCaseIds.has(1)).toBe(true);
    expect(metrics.flakyCaseIds.has(2)).toBe(false);
  });

  it("counts a fail-then-fail retry as retried but not flaky", () => {
    const metrics = computeRetryMetrics([
      { id: 1, resultId: 10, resultType: "FAILURE" },
      { id: 1, resultId: 11, resultType: "ERROR" },
    ]);
    expect(metrics.retriesCount).toBe(1);
    expect(metrics.retriedCaseCount).toBe(1);
    expect(metrics.flakyCaseCount).toBe(0);
  });

  it("does not flag a pass-then-pass duplicate or a fail-then-skip", () => {
    const metrics = computeRetryMetrics([
      { id: 1, resultId: 10, resultType: "PASSED" },
      { id: 1, resultId: 11, resultType: "PASSED" },
      { id: 2, resultId: 12, resultType: "FAILURE" },
      { id: 2, resultId: 13, resultType: "SKIPPED" },
    ]);
    expect(metrics.retriesCount).toBe(2);
    expect(metrics.flakyCaseCount).toBe(0);
  });

  it("orders attempts by executedAt, not input order", () => {
    // Pass arrived first in the array but ran LAST — still flaky.
    const metrics = computeRetryMetrics([
      {
        id: 1,
        resultId: 11,
        resultType: "PASSED",
        executedAt: "2026-01-01T00:10:00Z",
      },
      {
        id: 1,
        resultId: 10,
        resultType: "FAILURE",
        executedAt: "2026-01-01T00:00:00Z",
      },
    ]);
    expect(metrics.flakyCaseCount).toBe(1);
  });

  it("falls back to result id order for same-instant attempts (bulk imports)", () => {
    const executedAt = "2026-01-01T00:00:00Z";
    const metrics = computeRetryMetrics([
      { id: 1, resultId: 11, resultType: "PASSED", executedAt },
      { id: 1, resultId: 10, resultType: "FAILURE", executedAt },
    ]);
    expect(metrics.flakyCaseCount).toBe(1);
  });

  it("excludes parameterized cases — their rows are iterations, not retries", () => {
    const metrics = computeRetryMetrics([
      { id: 1, resultId: 10, resultType: "FAILURE", hasParameters: true },
      { id: 1, resultId: 11, resultType: "PASSED", hasParameters: true },
    ]);
    expect(metrics.retriesCount).toBe(0);
    expect(metrics.flakyCaseCount).toBe(0);
  });
});

describe("topSlowestResults", () => {
  it("returns the longest results first, excluding missing/zero times", () => {
    const results = [
      { name: "a", time: 5 },
      { name: "b", time: 50 },
      { name: "c", time: null },
      { name: "d", time: 0 },
      { name: "e", time: 20 },
    ];
    expect(topSlowestResults(results, 2).map((r) => r.name)).toEqual([
      "b",
      "e",
    ]);
  });

  it("does not mutate the input order", () => {
    const results = [
      { name: "a", time: 5 },
      { name: "b", time: 50 },
    ];
    topSlowestResults(results, 1);
    expect(results.map((r) => r.name)).toEqual(["a", "b"]);
  });
});
