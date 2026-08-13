import { describe, expect, it } from "vitest";
import {
  calendarDateToInstant,
  calendarDayKey,
  fromCalendarDate,
  isCalendarDayAfter,
  isCalendarDayBefore,
  parseUpstreamDate,
  toCalendarDate,
} from "./calendarDate";

// These helpers straddle local time and UTC by design, so the assertions state
// the invariants that hold in every zone rather than literal days — a test
// pinned to one offset would pass in CI and prove nothing about the bug it
// covers. The offset-specific regression lives in DateFormatter.test.tsx, where
// the zone is an explicit input instead of the runtime's.

describe("toCalendarDate", () => {
  it("carries the local calendar day onto UTC midnight", () => {
    const local = new Date(2026, 7, 13, 19, 30); // Aug 13, 7:30 PM local
    const calendar = toCalendarDate(local);

    expect(calendar.getUTCFullYear()).toBe(local.getFullYear());
    expect(calendar.getUTCMonth()).toBe(local.getMonth());
    expect(calendar.getUTCDate()).toBe(local.getDate());
    expect(calendar.getUTCHours()).toBe(0);
    expect(calendar.getUTCMinutes()).toBe(0);
  });

  it("keeps a late-evening time on the day it displays as", () => {
    // The regression this whole module exists for: 11:59 PM must not roll the
    // stored day forward, which is what the raw instant would do west of UTC.
    const lateLocal = new Date(2026, 7, 13, 23, 59);
    expect(calendarDayKey(toCalendarDate(lateLocal))).toBe("2026-08-13");
  });
});

describe("fromCalendarDate", () => {
  it("reads a stored calendar date back as the same local day", () => {
    const stored = new Date("2026-08-13T00:00:00.000Z");
    const local = fromCalendarDate(stored);

    expect(local.getFullYear()).toBe(2026);
    expect(local.getMonth()).toBe(7);
    expect(local.getDate()).toBe(13);
    expect(local.getHours()).toBe(0);
  });

  it("round-trips with toCalendarDate", () => {
    const stored = new Date("2026-08-13T00:00:00.000Z");
    expect(toCalendarDate(fromCalendarDate(stored)).toISOString()).toBe(
      stored.toISOString()
    );
  });
});

describe("calendarDayKey", () => {
  it("keys off the stored day, not the reader's", () => {
    expect(calendarDayKey(new Date("2026-08-13T00:00:00.000Z"))).toBe(
      "2026-08-13"
    );
  });
});

describe("isCalendarDayBefore / isCalendarDayAfter", () => {
  const now = new Date(2026, 7, 13, 19, 0); // Aug 13, 7:00 PM local
  const today = toCalendarDate(now);
  const yesterday = toCalendarDate(new Date(2026, 7, 12));
  const tomorrow = toCalendarDate(new Date(2026, 7, 14));

  it("does not treat the reader's own day as past", () => {
    // The bug: an instant comparison called a due date of today "past" from
    // the moment UTC midnight passed — 7:00 PM the previous evening in GMT-5.
    expect(isCalendarDayBefore(today, now)).toBe(false);
  });

  it("treats the previous day as past", () => {
    expect(isCalendarDayBefore(yesterday, now)).toBe(true);
  });

  it("treats the next day as future and the current one as not", () => {
    expect(isCalendarDayAfter(tomorrow, now)).toBe(true);
    expect(isCalendarDayAfter(today, now)).toBe(false);
  });
});

describe("calendarDateToInstant", () => {
  it("anchors the day at noon UTC so it survives conversion either way", () => {
    const instant = calendarDateToInstant(new Date("2026-08-13T00:00:00.000Z"));
    expect(instant.toISOString()).toBe("2026-08-13T12:00:00.000Z");
  });

  it("holds the day across the offsets a reader can be in", () => {
    const instant = calendarDateToInstant(new Date("2026-08-13T00:00:00.000Z"));
    // UTC-12 through UTC+11 all read noon UTC as Aug 13.
    for (const offsetHours of [-12, -5, 0, 5.5, 11]) {
      const shifted = new Date(
        instant.getTime() + offsetHours * 60 * 60 * 1000
      );
      expect(shifted.toISOString().slice(0, 10)).toBe("2026-08-13");
    }
  });
});

describe("parseUpstreamDate", () => {
  it("parses a bare yyyy-MM-dd as a calendar date at UTC midnight", () => {
    const { date, isCalendarDate } = parseUpstreamDate("2026-08-13");

    expect(isCalendarDate).toBe(true);
    expect(date.toISOString()).toBe("2026-08-13T00:00:00.000Z");
  });

  it("passes a value carrying a time through as an instant", () => {
    const { date, isCalendarDate } = parseUpstreamDate(
      "2026-08-13T10:30:00.000Z"
    );

    expect(isCalendarDate).toBe(false);
    expect(date.toISOString()).toBe("2026-08-13T10:30:00.000Z");
  });

  it("tolerates surrounding whitespace on the date-only form", () => {
    const { date, isCalendarDate } = parseUpstreamDate("  2026-08-13  ");

    expect(isCalendarDate).toBe(true);
    expect(date.toISOString()).toBe("2026-08-13T00:00:00.000Z");
  });
});
