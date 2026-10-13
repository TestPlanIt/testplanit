import { describe, expect, it } from "vitest";

import {
  DATE_RANGE_PRESETS,
  parseRelativeDateRange,
  resolveRelativeDateRange,
  resolveRequestDateRange,
  sameRelativeDateRange,
} from "./dateRangePresets";

// Wednesday 2026-09-23, 10:00 in Los Angeles (17:00Z). Mid-week and mid-month,
// so week and month presets have room on both sides.
const NOW = new Date("2026-09-23T17:00:00.000Z");
const LA = "America/Los_Angeles";

const bounds = (
  range: Parameters<typeof resolveRelativeDateRange>[0],
  options: Parameters<typeof resolveRelativeDateRange>[1] = {}
) => {
  const resolved = resolveRelativeDateRange(range, {
    now: NOW,
    timezone: LA,
    ...options,
  });
  return [resolved.startDate, resolved.endDate];
};

describe("resolveRelativeDateRange", () => {
  it("resolves on the given timezone's calendar, as instants", () => {
    // Midnight in LA is 07:00Z; the day ends at 06:59:59.999Z next day.
    expect(bounds({ preset: "today" })).toEqual([
      "2026-09-23T07:00:00.000Z",
      "2026-09-24T06:59:59.999Z",
    ]);
  });

  it("gives a different 'today' on the far side of the date line", () => {
    // 17:00Z on the 23rd is already the 24th in Auckland (UTC+12 until
    // daylight saving starts on the 27th).
    expect(
      bounds({ preset: "today" }, { timezone: "Pacific/Auckland" })
    ).toEqual(["2026-09-23T12:00:00.000Z", "2026-09-24T11:59:59.999Z"]);
  });

  it("falls back to UTC for a missing or unknown timezone", () => {
    const utc = ["2026-09-23T00:00:00.000Z", "2026-09-23T23:59:59.999Z"];
    expect(bounds({ preset: "today" }, { timezone: null })).toEqual(utc);
    expect(bounds({ preset: "today" }, { timezone: "Mars/Olympus" })).toEqual(
      utc
    );
  });

  it.each([
    ["yesterday", "2026-09-22", "2026-09-22"],
    // Today plus the six days before it.
    ["last7Days", "2026-09-17", "2026-09-23"],
    ["last30Days", "2026-08-25", "2026-09-23"],
    // Weeks start on Monday.
    ["thisWeek", "2026-09-21", "2026-09-27"],
    ["lastWeek", "2026-09-14", "2026-09-20"],
    ["last2Weeks", "2026-09-09", "2026-09-23"],
    ["thisMonth", "2026-09-01", "2026-09-30"],
    ["lastMonth", "2026-08-01", "2026-08-31"],
    ["last3Months", "2026-06-23", "2026-09-23"],
    ["thisQuarter", "2026-07-01", "2026-09-30"],
    ["lastQuarter", "2026-04-01", "2026-06-30"],
    ["thisYear", "2026-01-01", "2026-12-31"],
    ["lastYear", "2025-01-01", "2025-12-31"],
    ["last12Months", "2025-09-23", "2026-09-23"],
  ] as const)("%s covers %s to %s", (preset, from, to) => {
    const resolved = resolveRelativeDateRange(
      { preset },
      { now: NOW, timezone: "Etc/UTC" }
    );
    expect(resolved.startDate).toBe(`${from}T00:00:00.000Z`);
    expect(resolved.endDate).toBe(`${to}T23:59:59.999Z`);
  });

  it("covers every preset the menu offers", () => {
    for (const preset of DATE_RANGE_PRESETS) {
      const resolved = resolveRelativeDateRange({ preset }, { now: NOW });
      expect(resolved.from.getTime()).toBeLessThan(resolved.to.getTime());
    }
  });

  it("rolling windows match the equivalent presets", () => {
    const same = (
      rolling: { amount: number; unit: "days" | "weeks" | "months" },
      preset: (typeof DATE_RANGE_PRESETS)[number]
    ) =>
      expect(bounds({ preset: "lastN", ...rolling })).toEqual(
        bounds({ preset })
      );
    same({ amount: 7, unit: "days" }, "last7Days");
    same({ amount: 30, unit: "days" }, "last30Days");
    same({ amount: 2, unit: "weeks" }, "last2Weeks");
    same({ amount: 3, unit: "months" }, "last3Months");
    same({ amount: 12, unit: "months" }, "last12Months");
  });

  it("crosses month, quarter and year boundaries", () => {
    const newYear = new Date("2026-01-01T12:00:00.000Z");
    const at = (preset: (typeof DATE_RANGE_PRESETS)[number]) => {
      const r = resolveRelativeDateRange(
        { preset },
        { now: newYear, timezone: "Etc/UTC" }
      );
      return [r.startDate.slice(0, 10), r.endDate.slice(0, 10)];
    };
    expect(at("yesterday")).toEqual(["2025-12-31", "2025-12-31"]);
    expect(at("lastMonth")).toEqual(["2025-12-01", "2025-12-31"]);
    expect(at("lastQuarter")).toEqual(["2025-10-01", "2025-12-31"]);
    expect(at("lastYear")).toEqual(["2025-01-01", "2025-12-31"]);
    // Thursday 1 Jan 2026: the week began on Monday 29 Dec.
    expect(at("thisWeek")).toEqual(["2025-12-29", "2026-01-04"]);
  });

  it("keeps whole days across a daylight-saving change", () => {
    // Clocks in LA go back on 2026-11-01. "Last 7 days" seen from the 3rd
    // straddles it: the start is still LA midnight (PDT, 07:00Z) and the end
    // LA end-of-day (PST, 07:59:59.999Z).
    const resolved = resolveRelativeDateRange(
      { preset: "last7Days" },
      { now: new Date("2026-11-03T20:00:00.000Z"), timezone: LA }
    );
    expect(resolved.startDate).toBe("2026-10-28T07:00:00.000Z");
    expect(resolved.endDate).toBe("2026-11-04T07:59:59.999Z");
  });

  it("reports the calendar days for a picker to highlight", () => {
    const resolved = resolveRelativeDateRange(
      { preset: "lastWeek" },
      { now: NOW, timezone: "Pacific/Auckland" }
    );
    expect([resolved.fromDay.getDate(), resolved.toDay.getDate()]).toEqual([
      14, 20,
    ]);
  });
});

describe("parseRelativeDateRange", () => {
  it("reads a preset or a rolling window from a body", () => {
    expect(parseRelativeDateRange({ dateRangePreset: "lastWeek" })).toEqual({
      preset: "lastWeek",
    });
    expect(
      parseRelativeDateRange({
        dateRangePreset: "lastN",
        dateRangeAmount: "14",
        dateRangeUnit: "days",
      })
    ).toEqual({ preset: "lastN", amount: 14, unit: "days" });
  });

  it.each([
    [{}],
    [{ dateRangePreset: null }],
    [{ dateRangePreset: "" }],
    [{ dateRangePreset: "custom" }],
    [{ dateRangePreset: "fortnight" }],
    [{ dateRangePreset: "lastN", dateRangeAmount: 0, dateRangeUnit: "days" }],
    [{ dateRangePreset: "lastN", dateRangeAmount: 1.5, dateRangeUnit: "days" }],
    [{ dateRangePreset: "lastN", dateRangeAmount: 5, dateRangeUnit: "years" }],
    [{ dateRangePreset: "lastN", dateRangeAmount: 5 }],
  ])("treats %j as no relative range", (body) => {
    expect(parseRelativeDateRange(body as any)).toBeNull();
  });
});

describe("resolveRequestDateRange", () => {
  it("prefers the relative range over the stored dates", () => {
    expect(
      resolveRequestDateRange(
        {
          startDate: "2026-01-05T00:00:00.000Z",
          endDate: "2026-01-11T23:59:59.999Z",
          dateRangePreset: "lastWeek",
          dateRangeTimezone: "Etc/UTC",
        },
        NOW
      )
    ).toEqual({
      startDate: "2026-09-14T00:00:00.000Z",
      endDate: "2026-09-20T23:59:59.999Z",
    });
  });

  it("keeps the stored dates when there is no relative range", () => {
    expect(
      resolveRequestDateRange({
        startDate: "2026-01-05T00:00:00.000Z",
        endDate: "2026-01-11T23:59:59.999Z",
      })
    ).toEqual({
      startDate: "2026-01-05T00:00:00.000Z",
      endDate: "2026-01-11T23:59:59.999Z",
    });
    expect(resolveRequestDateRange({})).toEqual({
      startDate: undefined,
      endDate: undefined,
    });
    expect(resolveRequestDateRange(null)).toEqual({
      startDate: undefined,
      endDate: undefined,
    });
  });
});

describe("sameRelativeDateRange", () => {
  it("compares presets and rolling windows", () => {
    expect(
      sameRelativeDateRange({ preset: "lastWeek" }, { preset: "lastWeek" })
    ).toBe(true);
    expect(
      sameRelativeDateRange({ preset: "lastWeek" }, { preset: "thisWeek" })
    ).toBe(false);
    expect(
      sameRelativeDateRange(
        { preset: "lastN", amount: 7, unit: "days" },
        { preset: "lastN", amount: 7, unit: "weeks" }
      )
    ).toBe(false);
    expect(sameRelativeDateRange(null, null)).toBe(true);
    expect(sameRelativeDateRange({ preset: "today" }, null)).toBe(false);
  });
});
