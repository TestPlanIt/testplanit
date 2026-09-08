import { describe, expect, it } from "vitest";
import {
  buildBurndownSeries,
  toDayKey,
  type MilestoneBurndownData,
} from "./milestoneBurndown";

const day = (d: string) => new Date(`${d}T00:00:00.000Z`);
const execMap = (entries: Record<string, number>) =>
  new Map(Object.entries(entries));

describe("toDayKey", () => {
  it("returns the UTC calendar day for a timestamp", () => {
    expect(toDayKey(new Date("2026-03-04T23:59:59.000Z"))).toBe("2026-03-04");
  });
});

describe("buildBurndownSeries", () => {
  it("returns an empty series when there is no scope", () => {
    const result = buildBurndownSeries({
      milestoneId: 1,
      total: 0,
      start: day("2026-03-01"),
      end: day("2026-03-10"),
      executionsByDay: execMap({ "2026-03-02": 3 }),
      now: day("2026-03-05"),
    });
    expect(result).toEqual<MilestoneBurndownData>({
      milestoneId: 1,
      total: 0,
      start: null,
      end: null,
      hasTarget: false,
      actual: [],
    });
  });

  it("returns an empty series when there is no start anchor", () => {
    const result = buildBurndownSeries({
      milestoneId: 1,
      total: 5,
      start: null,
      end: day("2026-03-10"),
      executionsByDay: execMap({}),
      now: day("2026-03-05"),
    });
    expect(result.actual).toEqual([]);
    expect(result.start).toBeNull();
    expect(result.hasTarget).toBe(false);
  });

  it("burns remaining down across the window and reaches zero", () => {
    // 4 items, one executed each of the first four days of a 5-day window.
    const result = buildBurndownSeries({
      milestoneId: 7,
      total: 4,
      start: day("2026-03-01"),
      end: day("2026-03-05"),
      executionsByDay: execMap({
        "2026-03-01": 1,
        "2026-03-02": 1,
        "2026-03-03": 1,
        "2026-03-04": 1,
      }),
      now: day("2026-03-05"),
    });
    expect(result.hasTarget).toBe(true);
    expect(result.start).toBe("2026-03-01");
    expect(result.end).toBe("2026-03-05");
    expect(result.actual).toEqual([
      { date: "2026-03-01", remaining: 3 },
      { date: "2026-03-02", remaining: 2 },
      { date: "2026-03-03", remaining: 1 },
      { date: "2026-03-04", remaining: 0 },
      { date: "2026-03-05", remaining: 0 },
    ]);
  });

  it("counts executions before the window as already done on day 0", () => {
    const result = buildBurndownSeries({
      milestoneId: 7,
      total: 5,
      start: day("2026-03-03"),
      end: day("2026-03-05"),
      executionsByDay: execMap({
        "2026-02-28": 2, // before the window — already burned
        "2026-03-03": 1,
      }),
      now: day("2026-03-05"),
    });
    expect(result.actual[0]).toEqual({ date: "2026-03-03", remaining: 2 });
    expect(result.actual.at(-1)).toEqual({ date: "2026-03-05", remaining: 2 });
  });

  it("never returns a negative remaining even if executions exceed total", () => {
    const result = buildBurndownSeries({
      milestoneId: 7,
      total: 2,
      start: day("2026-03-01"),
      end: day("2026-03-02"),
      executionsByDay: execMap({ "2026-03-01": 5 }),
      now: day("2026-03-02"),
    });
    expect(result.actual).toEqual([
      { date: "2026-03-01", remaining: 0 },
      { date: "2026-03-02", remaining: 0 },
    ]);
  });

  it("walks to today (not the target) when there is no target date", () => {
    const result = buildBurndownSeries({
      milestoneId: 7,
      total: 3,
      start: day("2026-03-01"),
      end: null,
      executionsByDay: execMap({ "2026-03-01": 1 }),
      now: day("2026-03-03"),
    });
    expect(result.hasTarget).toBe(false);
    expect(result.end).toBeNull();
    expect(result.actual.map((p) => p.date)).toEqual([
      "2026-03-01",
      "2026-03-02",
      "2026-03-03",
    ]);
    expect(result.actual.at(-1)).toEqual({ date: "2026-03-03", remaining: 2 });
  });

  it("without a target, extends to the last execution when it is past today", () => {
    const result = buildBurndownSeries({
      milestoneId: 7,
      total: 3,
      start: day("2026-03-01"),
      end: null,
      executionsByDay: execMap({ "2026-03-04": 1 }),
      now: day("2026-03-02"),
    });
    // last execution (03-04) is after "today" (03-02) → walk covers it.
    expect(result.actual.at(-1)?.date).toBe("2026-03-04");
  });

  it("ignores a target that precedes the start (no backwards ideal line)", () => {
    const result = buildBurndownSeries({
      milestoneId: 7,
      total: 2,
      start: day("2026-03-05"),
      end: day("2026-03-01"),
      executionsByDay: execMap({}),
      now: day("2026-03-05"),
    });
    // A completedAt on/before the start isn't a usable target — no ideal line.
    expect(result.hasTarget).toBe(false);
    expect(result.end).toBeNull();
    expect(result.actual).toEqual([{ date: "2026-03-05", remaining: 2 }]);
  });

  it("caps the number of daily points for a pathological window", () => {
    const result = buildBurndownSeries({
      milestoneId: 7,
      total: 10,
      start: day("2020-01-01"),
      end: day("2030-01-01"),
      executionsByDay: execMap({}),
      now: day("2025-01-01"),
      maxDays: 30,
    });
    expect(result.actual).toHaveLength(30);
  });
});
