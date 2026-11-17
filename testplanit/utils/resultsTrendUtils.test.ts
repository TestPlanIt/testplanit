import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  baseDb: { $qb: {}, projects: { findMany: vi.fn() } },
}));
vi.mock("~/utils/reportApiUtils", () => ({ authorizeReportRequest: vi.fn() }));

import { buildTrendRows, trendPeriods } from "./resultsTrendUtils";

describe("trendPeriods", () => {
  // Sunday evening in Los Angeles is already Monday in UTC.
  const now = new Date("2026-10-05T03:00:00.000Z");

  it("cuts Monday-start weeks in the given timezone, ending with the current week", () => {
    const la = trendPeriods({
      grouping: "weekly",
      timezone: "America/Los_Angeles",
      now,
    });
    expect(la.periods.map((p) => p.periodStart)).toEqual([
      "2026-07-13",
      "2026-07-20",
      "2026-07-27",
      "2026-08-03",
      "2026-08-10",
      "2026-08-17",
      "2026-08-24",
      "2026-08-31",
      "2026-09-07",
      "2026-09-14",
      "2026-09-21",
      "2026-09-28",
    ]);
    expect(la.periods.map((p) => p.partial).filter(Boolean)).toHaveLength(1);
    expect(la.periods[11].partial).toBe(true);
    // The first Monday, 00:00 Los Angeles time (PDT, UTC−7), and the
    // instant after the current week ends.
    expect(la.from.toISOString()).toBe("2026-07-13T07:00:00.000Z");
    expect(la.to.toISOString()).toBe("2026-10-05T07:00:00.000Z");

    const utc = trendPeriods({ grouping: "weekly", timezone: "UTC", now });
    expect(utc.periods[11].periodStart).toBe("2026-10-05");
    expect(utc.from.toISOString()).toBe("2026-07-20T00:00:00.000Z");
  });

  it("follows a requested date range, never past now, and marks only the current period partial", () => {
    const months = trendPeriods({
      grouping: "monthly",
      timezone: "UTC",
      now,
      startDate: "2026-06-15T00:00:00.000Z",
      endDate: "2026-08-20T00:00:00.000Z",
    });
    expect(months.periods).toEqual([
      { periodStart: "2026-06-01", partial: false },
      { periodStart: "2026-07-01", partial: false },
      { periodStart: "2026-08-01", partial: false },
    ]);
    expect(months.to.toISOString()).toBe("2026-09-01T00:00:00.000Z");

    const future = trendPeriods({
      grouping: "quarterly",
      timezone: "UTC",
      now,
      startDate: "2026-01-01T00:00:00.000Z",
      endDate: "2027-12-31T00:00:00.000Z",
    });
    expect(future.periods.map((p) => p.periodStart)).toEqual([
      "2026-01-01",
      "2026-04-01",
      "2026-07-01",
      "2026-10-01",
    ]);
    expect(future.periods[3].partial).toBe(true);
  });

  it("reads the picker's custom days as calendar days, not instants in the zone", () => {
    // A custom range travels as UTC midnight / end of the UTC day; in a
    // zone behind UTC that instant is still the previous day.
    const custom = trendPeriods({
      grouping: "monthly",
      timezone: "America/Chicago",
      now,
      startDate: "2025-06-01T00:00:00.000Z",
      endDate: "2025-08-31T23:59:59.999Z",
    });
    expect(custom.periods.map((p) => p.periodStart)).toEqual([
      "2025-06-01",
      "2025-07-01",
      "2025-08-01",
    ]);
    // A preset resolves to the zone's own midnight and reads back as is.
    const preset = trendPeriods({
      grouping: "monthly",
      timezone: "America/Chicago",
      now,
      startDate: "2025-06-01T05:00:00.000Z",
    });
    expect(preset.periods[0].periodStart).toBe("2025-06-01");
  });

  it("uses each grouping's default count without a start date", () => {
    expect(
      trendPeriods({ grouping: "daily", timezone: "UTC", now }).periods
    ).toHaveLength(30);
    expect(
      trendPeriods({ grouping: "annually", timezone: "UTC", now }).periods.map(
        (p) => p.periodStart
      )
    ).toEqual([
      "2022-01-01",
      "2023-01-01",
      "2024-01-01",
      "2025-01-01",
      "2026-01-01",
    ]);
  });

  it("caps a very wide range to its most recent periods", () => {
    const days = trendPeriods({
      grouping: "daily",
      timezone: "UTC",
      now,
      startDate: "2020-01-01T00:00:00.000Z",
    });
    expect(days.periods).toHaveLength(400);
    expect(days.periods[399].periodStart).toBe("2026-10-05");
  });
});

describe("buildTrendRows", () => {
  const periods = [
    { periodStart: "2026-09-21", partial: false },
    { periodStart: "2026-09-28", partial: true },
  ];
  const web = { id: 1, name: "Web" };
  const api = { id: 2, name: "API" };

  it("fills every project and period, sums a combined row, and ranks projects", () => {
    const { rows, projects } = buildTrendRows({
      aggregates: [
        {
          project_id: 1,
          period_start: "2026-09-21",
          runs: 2,
          results: 10,
          passed: 7,
          failed: 2,
          skipped: 1,
          other: 0,
        },
        {
          project_id: 2,
          period_start: "2026-09-21",
          runs: 5,
          results: 100,
          passed: 50,
          failed: 40,
          skipped: 10,
          other: 0,
        },
        {
          project_id: 2,
          period_start: "2026-09-28",
          runs: 1,
          results: 4,
          passed: 4,
          failed: 0,
          skipped: 0,
          other: 0,
        },
        // Outside the window: the run filter bounds the query, so an unknown
        // key is dropped rather than inventing a period.
        {
          project_id: 1,
          period_start: "2026-09-14",
          runs: 9,
          results: 9,
          passed: 9,
          failed: 0,
          skipped: 0,
          other: 0,
        },
      ],
      projects: [web, api],
      periods,
      countSkipped: false,
    });

    expect(projects.map((p) => p.name)).toEqual(["API", "Web"]);
    // 2 periods × (combined + 2 projects), newest period first, combined leading.
    expect(rows).toHaveLength(6);
    expect(
      rows.map((r) => `${r.periodStart} ${r.project?.name ?? "all"}`)
    ).toEqual([
      "2026-09-28 all",
      "2026-09-28 API",
      "2026-09-28 Web",
      "2026-09-21 all",
      "2026-09-21 API",
      "2026-09-21 Web",
    ]);

    const combined = rows[3];
    expect(combined).toMatchObject({
      partial: false,
      runs: 7,
      results: 110,
      passed: 57,
      failed: 42,
      skipped: 11,
      other: 0,
    });
    // 99 in the denominator: skipped results are left out.
    expect(combined.passRate).toBeCloseTo(57.58, 2);
    expect(combined.failRate).toBeCloseTo(42.42, 2);

    const emptyWeb = rows[2];
    expect(emptyWeb).toMatchObject({
      partial: true,
      runs: 0,
      results: 0,
      passRate: null,
      failRate: null,
    });
  });

  it("counts skipped results in the rates when asked", () => {
    const { rows } = buildTrendRows({
      aggregates: [
        {
          project_id: 1,
          period_start: "2026-09-21",
          runs: 1,
          results: 10,
          passed: 5,
          failed: 0,
          skipped: 5,
          other: 0,
        },
      ],
      projects: [web],
      periods,
      countSkipped: true,
    });
    expect(rows.find((r) => r.project?.id === 1 && !r.partial)?.passRate).toBe(
      50
    );
  });

  it("coerces bigint-like counts from the driver", () => {
    const { rows } = buildTrendRows({
      aggregates: [
        {
          project_id: 1,
          period_start: "2026-09-21",
          runs: "3" as any,
          results: "4" as any,
          passed: "4" as any,
          failed: "0" as any,
          skipped: "0" as any,
          other: "0" as any,
        },
      ],
      projects: [web],
      periods,
      countSkipped: false,
    });
    const combined = rows.find((r) => r.project === null && !r.partial)!;
    expect(combined.runs).toBe(3);
    expect(combined.passRate).toBe(100);
  });
});
