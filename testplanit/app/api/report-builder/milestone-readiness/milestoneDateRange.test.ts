import { describe, expect, it } from "vitest";
import { isMilestoneInDateRange, milestoneDate } from "./milestoneDateRange";

// Local Y/M/D construction (month 1-indexed here) so comparisons are
// timezone-stable; the range strings below are also parsed as local time.
const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);

describe("milestoneDate", () => {
  it("prefers startedAt, then completedAt, then createdAt", () => {
    expect(
      milestoneDate({
        startedAt: d(2025, 8, 1),
        completedAt: d(2025, 9, 1),
        createdAt: d(2025, 7, 1),
      })
    ).toEqual(d(2025, 8, 1));
    expect(
      milestoneDate({
        startedAt: null,
        completedAt: d(2025, 9, 1),
        createdAt: d(2025, 7, 1),
      })
    ).toEqual(d(2025, 9, 1));
    expect(
      milestoneDate({
        startedAt: null,
        completedAt: null,
        createdAt: d(2025, 7, 1),
      })
    ).toEqual(d(2025, 7, 1));
  });
});

describe("isMilestoneInDateRange", () => {
  // Local-time (no trailing Z) so it lines up with the locally-built dates above.
  const range = {
    startDate: "2025-08-01T00:00:00",
    endDate: "2025-10-31T00:00:00",
  };

  it("passes every milestone when no range is set", () => {
    const m = { startedAt: d(2020, 1, 1), createdAt: d(2020, 1, 1) };
    expect(isMilestoneInDateRange(m)).toBe(true);
    expect(isMilestoneInDateRange(m, {})).toBe(true);
  });

  it("includes a milestone whose start date is inside the range", () => {
    expect(
      isMilestoneInDateRange(
        {
          startedAt: d(2025, 9, 15),
          completedAt: null,
          createdAt: d(2025, 1, 1),
        },
        range
      )
    ).toBe(true);
  });

  it("excludes a milestone whose date falls before the range", () => {
    expect(
      isMilestoneInDateRange(
        {
          startedAt: d(2025, 7, 31),
          completedAt: null,
          createdAt: d(2025, 1, 1),
        },
        range
      )
    ).toBe(false);
  });

  it("excludes a milestone whose date falls after the range", () => {
    expect(
      isMilestoneInDateRange(
        {
          startedAt: d(2025, 11, 1),
          completedAt: null,
          createdAt: d(2025, 1, 1),
        },
        range
      )
    ).toBe(false);
  });

  it("filters an undated milestone on its creation date, not open-endedly", () => {
    // The inconsistency this fix targets: startedAt/completedAt null → the chart
    // plots at createdAt. A window-overlap filter treats null as open-ended and
    // keeps it regardless; here it's kept only when createdAt is in range.
    expect(
      isMilestoneInDateRange(
        { startedAt: null, completedAt: null, createdAt: d(2025, 9, 1) },
        range
      )
    ).toBe(true);
    expect(
      isMilestoneInDateRange(
        { startedAt: null, completedAt: null, createdAt: d(2025, 1, 1) },
        range
      )
    ).toBe(false);
  });

  it("includes the whole of the end day", () => {
    expect(
      isMilestoneInDateRange(
        {
          startedAt: new Date(2025, 9, 31, 14, 0),
          completedAt: null,
          createdAt: d(2025, 1, 1),
        },
        range
      )
    ).toBe(true);
  });
});
