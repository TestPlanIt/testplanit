import { describe, expect, it } from "vitest";
import {
  failRateTrend,
  headlineStats,
  linearFit,
  percentOf,
  rankProjects,
  rateDenominator,
  rowsForProject,
  trendVerdict,
  withRates,
  type ResultsTrendRow,
} from "./resultsTrendShared";

const row = (
  periodStart: string,
  o: Partial<ResultsTrendRow> = {}
): ResultsTrendRow => ({
  project: null,
  periodStart,
  partial: false,
  runs: 1,
  results: 10,
  passed: 8,
  failed: 2,
  skipped: 0,
  other: 0,
  passRate: 80,
  failRate: 20,
  ...o,
});

describe("rates", () => {
  it("leaves skipped results out of the denominator unless asked to count them", () => {
    const counts = { results: 10, skipped: 4 };
    expect(rateDenominator(counts, false)).toBe(6);
    expect(rateDenominator(counts, true)).toBe(10);
  });

  it("rounds to two decimals and has no rate for an empty denominator", () => {
    expect(percentOf(1, 3)).toBe(33.33);
    expect(percentOf(0, 0)).toBeNull();
  });

  it("fills both rates from the counts; other statuses stay in the denominator", () => {
    const rated = withRates(
      {
        project: null,
        periodStart: "2026-09-21",
        partial: false,
        runs: 2,
        results: 10,
        passed: 6,
        failed: 2,
        skipped: 2,
        other: 0,
      },
      false
    );
    expect(rated.passRate).toBe(75);
    expect(rated.failRate).toBe(25);
    const counted = withRates(
      {
        project: null,
        periodStart: "2026-09-21",
        partial: false,
        runs: 2,
        results: 10,
        passed: 6,
        failed: 2,
        skipped: 1,
        other: 1,
      },
      false
    );
    // 9 in the denominator: the "other" result counts, the skipped one does not.
    expect(counted.passRate).toBe(66.67);
    expect(counted.failRate).toBe(22.22);
    const empty = withRates(
      {
        project: null,
        periodStart: "2026-09-21",
        partial: false,
        runs: 1,
        results: 3,
        passed: 0,
        failed: 0,
        skipped: 3,
        other: 0,
      },
      false
    );
    expect(empty.passRate).toBeNull();
    expect(empty.failRate).toBeNull();
  });
});

describe("linearFit", () => {
  it("needs two points", () => {
    expect(linearFit([])).toBeNull();
    expect(linearFit([5])).toBeNull();
  });

  it("recovers an exact line", () => {
    const fit = linearFit([10, 12, 14, 16])!;
    expect(fit.slope).toBeCloseTo(2);
    expect(fit.start).toBeCloseTo(10);
    expect(fit.end).toBeCloseTo(16);
    expect(fit.change).toBeCloseTo(6);
    expect(fit.points).toBe(4);
  });

  it("fits least squares through noisy points", () => {
    const fit = linearFit([1, 3, 2, 4])!;
    expect(fit.slope).toBeCloseTo(0.8);
    expect(fit.intercept).toBeCloseTo(1.3);
  });

  it("fits a flat line to a constant series", () => {
    const fit = linearFit([7, 7, 7])!;
    expect(fit.slope).toBe(0);
    expect(fit.change).toBe(0);
  });
});

describe("trendVerdict", () => {
  it("reads a fall of more than a point as better and a rise as worse", () => {
    expect(trendVerdict(-1.01)).toBe("better");
    expect(trendVerdict(1.01)).toBe("worse");
    expect(trendVerdict(-1)).toBe("steady");
    expect(trendVerdict(1)).toBe("steady");
    expect(trendVerdict(0)).toBe("steady");
  });
});

describe("failRateTrend", () => {
  it("uses complete periods with a rate only, oldest first", () => {
    const rows = [
      row("2026-09-21", { failRate: 30 }),
      row("2026-09-07", { failRate: 10 }),
      row("2026-09-14", { failRate: null, results: 0 }),
      row("2026-08-31", { failRate: 0 }),
      row("2026-09-28", { failRate: 90, partial: true }),
    ];
    const trend = failRateTrend(rows)!;
    // 0, 10, 30: slope 15, so the line runs from -1.67 to 28.33.
    expect(trend.periodsUsed).toBe(3);
    expect(trend.startRate).toBeCloseTo(-1.67, 1);
    expect(trend.endRate).toBeCloseTo(28.33, 1);
    expect(trend.changePoints).toBeCloseTo(30);
    expect(trend.verdict).toBe("worse");
  });

  it("is null until two complete periods have results", () => {
    expect(
      failRateTrend([
        row("2026-09-21", { failRate: 30 }),
        row("2026-09-28", { failRate: 10, partial: true }),
      ])
    ).toBeNull();
  });
});

describe("headlineStats", () => {
  it("compares the last complete period with the average of up to four before it", () => {
    const rows = [
      row("2026-08-10", { passRate: 50, failRate: 50, results: 100, runs: 10 }),
      row("2026-08-17", { passRate: 60, failRate: 40, results: 100, runs: 10 }),
      row("2026-08-24", { passRate: 70, failRate: 30, results: 100, runs: 10 }),
      row("2026-08-31", { passRate: 80, failRate: 20, results: 100, runs: 10 }),
      row("2026-09-07", { passRate: 90, failRate: 10, results: 100, runs: 10 }),
      row("2026-09-14", { passRate: 95, failRate: 5, results: 150, runs: 12 }),
      row("2026-09-21", {
        passRate: 1,
        failRate: 99,
        results: 5,
        partial: true,
      }),
    ];
    const stats = headlineStats(rows);
    expect(stats.period).toBe("2026-09-14");
    // Baseline is the four periods before: 60, 70, 80, 90 (the first is dropped).
    expect(stats.passRate.current).toBe(95);
    expect(stats.passRate.baseline).toBe(75);
    expect(stats.passRate.delta).toBe(20);
    expect(stats.passRate.baselinePeriods).toBe(4);
    expect(stats.failRate.delta).toBe(-20);
    expect(stats.results.delta).toBe(50);
    expect(stats.runs.delta).toBeCloseTo(20);
  });

  it("leaves empty periods out of a rate baseline but counts their zero volume", () => {
    const rows = [
      row("2026-09-07", {
        passRate: null,
        failRate: null,
        results: 0,
        runs: 0,
      }),
      row("2026-09-14", { passRate: 80, failRate: 20, results: 100, runs: 4 }),
      row("2026-09-21", { passRate: 90, failRate: 10, results: 100, runs: 4 }),
    ];
    const stats = headlineStats(rows);
    expect(stats.passRate.baseline).toBe(80);
    expect(stats.passRate.baselinePeriods).toBe(1);
    expect(stats.results.baseline).toBe(50);
    expect(stats.results.delta).toBe(100);
  });

  it("has nothing to say with no complete period, or no baseline with one", () => {
    expect(
      headlineStats([row("2026-09-21", { partial: true })]).period
    ).toBeNull();
    const single = headlineStats([
      row("2026-09-14"),
      row("2026-09-21", { partial: true }),
    ]);
    expect(single.period).toBe("2026-09-14");
    expect(single.passRate.delta).toBeNull();
    expect(single.results.delta).toBeNull();
  });
});

describe("rowsForProject and rankProjects", () => {
  const web = { id: 1, name: "Web" };
  const api = { id: 2, name: "API" };
  const rows = [
    row("2026-09-14", { project: api, results: 500 }),
    row("2026-09-14", { project: web, results: 50 }),
    row("2026-09-07", { project: web, results: 60 }),
    row("2026-09-14"),
  ];

  it("picks one project's rows oldest first, or the combined rows", () => {
    expect(rowsForProject(rows, 1).map((r) => r.periodStart)).toEqual([
      "2026-09-07",
      "2026-09-14",
    ]);
    expect(rowsForProject(rows, null)).toHaveLength(1);
  });

  it("ranks projects by total results, most first", () => {
    expect(rankProjects([web, api], rows).map((p) => p.name)).toEqual([
      "API",
      "Web",
    ]);
  });
});
