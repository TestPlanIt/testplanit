import { describe, expect, it } from "vitest";
import {
  EMPTY_TEST_CASE_HEALTH_SUMMARY,
  summarizeTestCaseHealth,
} from "./testCaseHealthSummary";

describe("summarizeTestCaseHealth", () => {
  it("returns the empty summary for no rows", () => {
    expect(summarizeTestCaseHealth([])).toEqual(EMPTY_TEST_CASE_HEALTH_SUMMARY);
  });

  it("counts statuses, stale rows, attention and healthy buckets, and the mean score", () => {
    const summary = summarizeTestCaseHealth([
      { healthStatus: "always_failing", isStale: true, healthScore: 20 },
      { healthStatus: "never_executed", isStale: false, healthScore: 50 },
      { healthStatus: "always_passing", isStale: false, healthScore: 95 },
      { healthStatus: "healthy", isStale: true, healthScore: 70 },
      { healthStatus: "healthy", isStale: false, healthScore: 100 },
    ]);

    expect(summary.total).toBe(5);
    expect(summary.counts).toEqual({
      always_failing: 1,
      never_executed: 1,
      always_passing: 1,
      healthy: 2,
    });
    expect(summary.staleCount).toBe(2);
    // always failing, never executed, or stale; the stale always-failing
    // row counts once
    expect(summary.needsAttention).toBe(3);
    // healthy + always_passing
    expect(summary.healthy).toBe(3);
    // (20 + 50 + 95 + 70 + 100) / 5 = 67
    expect(summary.avgHealthScore).toBe(67);
  });

  it("never puts more cases in Needs Attention than there are cases", () => {
    // Every executed case went stale, the shape that read as "102%".
    const summary = summarizeTestCaseHealth([
      { healthStatus: "always_failing", isStale: true, healthScore: 10 },
      { healthStatus: "always_failing", isStale: true, healthScore: 10 },
      { healthStatus: "always_passing", isStale: true, healthScore: 80 },
      { healthStatus: "healthy", isStale: true, healthScore: 60 },
      { healthStatus: "never_executed", isStale: false, healthScore: 0 },
    ]);

    expect(summary.staleCount).toBe(4);
    expect(summary.needsAttention).toBe(5);
    expect(summary.needsAttention).toBeLessThanOrEqual(summary.total);
  });

  it("ignores null rows and unknown statuses, and averages only numeric scores", () => {
    const summary = summarizeTestCaseHealth([
      null,
      undefined,
      { healthStatus: "mystery", isStale: true, healthScore: 10 },
      { healthStatus: "healthy", isStale: false, healthScore: null },
      { healthStatus: "healthy", isStale: true, healthScore: 90 },
    ]);

    expect(summary.total).toBe(5);
    expect(summary.counts.healthy).toBe(2);
    // The unknown-status row still has a numeric score, so it counts as
    // stale and in the mean, exactly as the chart's row scan always did.
    expect(summary.staleCount).toBe(2);
    expect(summary.avgHealthScore).toBe(50);
  });
});
