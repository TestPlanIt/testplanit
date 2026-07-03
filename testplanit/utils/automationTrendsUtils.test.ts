import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  baseDb: {
    repositoryCases: { findMany: vi.fn() },
    repositoryCaseVersions: { findMany: vi.fn() },
  },
}));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("~/lib/api-token-auth", () => ({ authenticateRequest: vi.fn() }));
vi.mock("~/server/auth", () => ({ authOptions: {} }));

import type { NextRequest } from "next/server";

import { baseDb } from "@/lib/db";

import {
  automatedStateAt,
  generatePeriods,
  handleAutomationTrendsPOST,
} from "./automationTrendsUtils";

// We need to test the getPeriodDates function which is not exported
// So we'll test it through the module internals or re-implement the logic for testing
// For now, let's test the date period calculation logic directly

type DateGrouping = "daily" | "weekly" | "monthly" | "quarterly" | "annually";

// Re-implement getPeriodDates for testing (mirrors the implementation in automationTrendsUtils.ts)
function getPeriodDates(
  date: Date,
  grouping: DateGrouping
): { start: Date; end: Date } {
  const utcDate = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );

  switch (grouping) {
    case "daily": {
      const start = new Date(utcDate);
      start.setUTCHours(0, 0, 0, 0);
      const end = new Date(utcDate);
      end.setUTCHours(23, 59, 59, 999);
      return { start, end };
    }
    case "weekly": {
      const start = new Date(utcDate);
      const day = start.getUTCDay();
      const daysSinceSunday = day === 0 ? 6 : day - 1;
      start.setUTCDate(start.getUTCDate() - daysSinceSunday);
      start.setUTCHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 6);
      end.setUTCHours(23, 59, 59, 999);
      return { start, end };
    }
    case "monthly": {
      const start = new Date(
        Date.UTC(utcDate.getUTCFullYear(), utcDate.getUTCMonth(), 1, 0, 0, 0, 0)
      );
      const end = new Date(
        Date.UTC(
          utcDate.getUTCFullYear(),
          utcDate.getUTCMonth() + 1,
          1,
          0,
          0,
          0,
          0
        )
      );
      end.setUTCMilliseconds(-1);
      return { start, end };
    }
    case "quarterly": {
      const quarter = Math.floor(utcDate.getUTCMonth() / 3);
      const start = new Date(
        Date.UTC(utcDate.getUTCFullYear(), quarter * 3, 1, 0, 0, 0, 0)
      );
      const end = new Date(
        Date.UTC(utcDate.getUTCFullYear(), quarter * 3 + 3, 1, 0, 0, 0, 0)
      );
      end.setUTCMilliseconds(-1);
      return { start, end };
    }
    case "annually": {
      const start = new Date(
        Date.UTC(utcDate.getUTCFullYear(), 0, 1, 0, 0, 0, 0)
      );
      const end = new Date(
        Date.UTC(utcDate.getUTCFullYear() + 1, 0, 1, 0, 0, 0, 0)
      );
      end.setUTCMilliseconds(-1);
      return { start, end };
    }
    default:
      return getPeriodDates(date, "weekly");
  }
}

describe("automationTrendsUtils", () => {
  describe("getPeriodDates", () => {
    describe("daily grouping", () => {
      it("should return start and end of the same day", () => {
        const date = new Date("2024-03-15T14:30:00Z");
        const { start, end } = getPeriodDates(date, "daily");

        expect(start.toISOString()).toBe("2024-03-15T00:00:00.000Z");
        expect(end.toISOString()).toBe("2024-03-15T23:59:59.999Z");
      });

      it("should handle start of day", () => {
        const date = new Date("2024-03-15T00:00:00Z");
        const { start, end } = getPeriodDates(date, "daily");

        expect(start.toISOString()).toBe("2024-03-15T00:00:00.000Z");
        expect(end.toISOString()).toBe("2024-03-15T23:59:59.999Z");
      });

      it("should handle end of day", () => {
        const date = new Date("2024-03-15T23:59:59Z");
        const { start, end } = getPeriodDates(date, "daily");

        expect(start.toISOString()).toBe("2024-03-15T00:00:00.000Z");
        expect(end.toISOString()).toBe("2024-03-15T23:59:59.999Z");
      });
    });

    describe("weekly grouping", () => {
      it("should return Monday to Sunday for a mid-week date (Wednesday)", () => {
        // March 13, 2024 is a Wednesday
        const date = new Date("2024-03-13T14:30:00Z");
        const { start, end } = getPeriodDates(date, "weekly");

        // Week should be Monday March 11 to Sunday March 17
        expect(start.toISOString()).toBe("2024-03-11T00:00:00.000Z");
        expect(end.toISOString()).toBe("2024-03-17T23:59:59.999Z");
      });

      it("should return correct week for Monday", () => {
        // March 11, 2024 is a Monday
        const date = new Date("2024-03-11T14:30:00Z");
        const { start, end } = getPeriodDates(date, "weekly");

        expect(start.toISOString()).toBe("2024-03-11T00:00:00.000Z");
        expect(end.toISOString()).toBe("2024-03-17T23:59:59.999Z");
      });

      it("should return correct week for Sunday", () => {
        // March 17, 2024 is a Sunday
        const date = new Date("2024-03-17T14:30:00Z");
        const { start, end } = getPeriodDates(date, "weekly");

        expect(start.toISOString()).toBe("2024-03-11T00:00:00.000Z");
        expect(end.toISOString()).toBe("2024-03-17T23:59:59.999Z");
      });

      it("should handle week spanning two months", () => {
        // March 30, 2024 is a Saturday, week spans to April
        const date = new Date("2024-03-30T14:30:00Z");
        const { start, end } = getPeriodDates(date, "weekly");

        // Week: Monday March 25 to Sunday March 31
        expect(start.toISOString()).toBe("2024-03-25T00:00:00.000Z");
        expect(end.toISOString()).toBe("2024-03-31T23:59:59.999Z");
      });

      it("should handle week spanning two years", () => {
        // December 31, 2024 is a Tuesday
        const date = new Date("2024-12-31T14:30:00Z");
        const { start, end } = getPeriodDates(date, "weekly");

        // Week: Monday Dec 30, 2024 to Sunday Jan 5, 2025
        expect(start.toISOString()).toBe("2024-12-30T00:00:00.000Z");
        expect(end.toISOString()).toBe("2025-01-05T23:59:59.999Z");
      });
    });

    describe("monthly grouping", () => {
      it("should return first and last day of the month", () => {
        const date = new Date("2024-03-15T14:30:00Z");
        const { start, end } = getPeriodDates(date, "monthly");

        expect(start.toISOString()).toBe("2024-03-01T00:00:00.000Z");
        expect(end.toISOString()).toBe("2024-03-31T23:59:59.999Z");
      });

      it("should handle February in leap year", () => {
        const date = new Date("2024-02-15T14:30:00Z");
        const { start, end } = getPeriodDates(date, "monthly");

        expect(start.toISOString()).toBe("2024-02-01T00:00:00.000Z");
        expect(end.toISOString()).toBe("2024-02-29T23:59:59.999Z");
      });

      it("should handle February in non-leap year", () => {
        const date = new Date("2023-02-15T14:30:00Z");
        const { start, end } = getPeriodDates(date, "monthly");

        expect(start.toISOString()).toBe("2023-02-01T00:00:00.000Z");
        expect(end.toISOString()).toBe("2023-02-28T23:59:59.999Z");
      });

      it("should handle month with 30 days", () => {
        const date = new Date("2024-04-15T14:30:00Z");
        const { start, end } = getPeriodDates(date, "monthly");

        expect(start.toISOString()).toBe("2024-04-01T00:00:00.000Z");
        expect(end.toISOString()).toBe("2024-04-30T23:59:59.999Z");
      });

      it("should handle month with 31 days", () => {
        const date = new Date("2024-01-15T14:30:00Z");
        const { start, end } = getPeriodDates(date, "monthly");

        expect(start.toISOString()).toBe("2024-01-01T00:00:00.000Z");
        expect(end.toISOString()).toBe("2024-01-31T23:59:59.999Z");
      });

      it("should handle December correctly", () => {
        const date = new Date("2024-12-15T14:30:00Z");
        const { start, end } = getPeriodDates(date, "monthly");

        expect(start.toISOString()).toBe("2024-12-01T00:00:00.000Z");
        expect(end.toISOString()).toBe("2024-12-31T23:59:59.999Z");
      });
    });

    describe("quarterly grouping", () => {
      it("should return Q1 (Jan-Mar) for January date", () => {
        const date = new Date("2024-01-15T14:30:00Z");
        const { start, end } = getPeriodDates(date, "quarterly");

        expect(start.toISOString()).toBe("2024-01-01T00:00:00.000Z");
        expect(end.toISOString()).toBe("2024-03-31T23:59:59.999Z");
      });

      it("should return Q1 for February date", () => {
        const date = new Date("2024-02-15T14:30:00Z");
        const { start, end } = getPeriodDates(date, "quarterly");

        expect(start.toISOString()).toBe("2024-01-01T00:00:00.000Z");
        expect(end.toISOString()).toBe("2024-03-31T23:59:59.999Z");
      });

      it("should return Q1 for March date", () => {
        const date = new Date("2024-03-15T14:30:00Z");
        const { start, end } = getPeriodDates(date, "quarterly");

        expect(start.toISOString()).toBe("2024-01-01T00:00:00.000Z");
        expect(end.toISOString()).toBe("2024-03-31T23:59:59.999Z");
      });

      it("should return Q2 (Apr-Jun) for April date", () => {
        const date = new Date("2024-04-15T14:30:00Z");
        const { start, end } = getPeriodDates(date, "quarterly");

        expect(start.toISOString()).toBe("2024-04-01T00:00:00.000Z");
        expect(end.toISOString()).toBe("2024-06-30T23:59:59.999Z");
      });

      it("should return Q3 (Jul-Sep) for August date", () => {
        const date = new Date("2024-08-15T14:30:00Z");
        const { start, end } = getPeriodDates(date, "quarterly");

        expect(start.toISOString()).toBe("2024-07-01T00:00:00.000Z");
        expect(end.toISOString()).toBe("2024-09-30T23:59:59.999Z");
      });

      it("should return Q4 (Oct-Dec) for November date", () => {
        const date = new Date("2024-11-15T14:30:00Z");
        const { start, end } = getPeriodDates(date, "quarterly");

        expect(start.toISOString()).toBe("2024-10-01T00:00:00.000Z");
        expect(end.toISOString()).toBe("2024-12-31T23:59:59.999Z");
      });

      it("should return Q4 for December 31st", () => {
        const date = new Date("2024-12-31T23:59:59Z");
        const { start, end } = getPeriodDates(date, "quarterly");

        expect(start.toISOString()).toBe("2024-10-01T00:00:00.000Z");
        expect(end.toISOString()).toBe("2024-12-31T23:59:59.999Z");
      });
    });

    describe("annually grouping", () => {
      it("should return full year for any date", () => {
        const date = new Date("2024-06-15T14:30:00Z");
        const { start, end } = getPeriodDates(date, "annually");

        expect(start.toISOString()).toBe("2024-01-01T00:00:00.000Z");
        expect(end.toISOString()).toBe("2024-12-31T23:59:59.999Z");
      });

      it("should return correct year for January 1st", () => {
        const date = new Date("2024-01-01T00:00:00Z");
        const { start, end } = getPeriodDates(date, "annually");

        expect(start.toISOString()).toBe("2024-01-01T00:00:00.000Z");
        expect(end.toISOString()).toBe("2024-12-31T23:59:59.999Z");
      });

      it("should return correct year for December 31st", () => {
        const date = new Date("2024-12-31T23:59:59Z");
        const { start, end } = getPeriodDates(date, "annually");

        expect(start.toISOString()).toBe("2024-01-01T00:00:00.000Z");
        expect(end.toISOString()).toBe("2024-12-31T23:59:59.999Z");
      });

      it("should handle leap year", () => {
        const date = new Date("2024-02-29T14:30:00Z");
        const { start, end } = getPeriodDates(date, "annually");

        expect(start.toISOString()).toBe("2024-01-01T00:00:00.000Z");
        expect(end.toISOString()).toBe("2024-12-31T23:59:59.999Z");
      });
    });

    describe("default grouping", () => {
      it("should default to weekly for unknown grouping", () => {
        // March 13, 2024 is a Wednesday
        const date = new Date("2024-03-13T14:30:00Z");
        const { start, end } = getPeriodDates(date, "unknown" as DateGrouping);

        // Should return weekly period (Monday to Sunday)
        expect(start.toISOString()).toBe("2024-03-11T00:00:00.000Z");
        expect(end.toISOString()).toBe("2024-03-17T23:59:59.999Z");
      });
    });

    describe("edge cases", () => {
      it("should handle dates near epoch", () => {
        const date = new Date("1970-01-15T14:30:00Z");
        const { start, end } = getPeriodDates(date, "monthly");

        expect(start.toISOString()).toBe("1970-01-01T00:00:00.000Z");
        expect(end.toISOString()).toBe("1970-01-31T23:59:59.999Z");
      });

      it("should handle far future dates", () => {
        const date = new Date("2099-06-15T14:30:00Z");
        const { start, end } = getPeriodDates(date, "annually");

        expect(start.toISOString()).toBe("2099-01-01T00:00:00.000Z");
        expect(end.toISOString()).toBe("2099-12-31T23:59:59.999Z");
      });

      it("should handle timezone edge case (date near midnight UTC)", () => {
        const date = new Date("2024-03-15T00:00:01Z");
        const { start, end } = getPeriodDates(date, "daily");

        expect(start.toISOString()).toBe("2024-03-15T00:00:00.000Z");
        expect(end.toISOString()).toBe("2024-03-15T23:59:59.999Z");
      });

      it("should handle DST transition dates in UTC (March)", () => {
        // DST doesn't affect UTC, but test for consistency
        const date = new Date("2024-03-10T07:00:00Z");
        const { start, end } = getPeriodDates(date, "daily");

        expect(start.toISOString()).toBe("2024-03-10T00:00:00.000Z");
        expect(end.toISOString()).toBe("2024-03-10T23:59:59.999Z");
      });

      it("should handle DST transition dates in UTC (November)", () => {
        const date = new Date("2024-11-03T06:00:00Z");
        const { start, end } = getPeriodDates(date, "daily");

        expect(start.toISOString()).toBe("2024-11-03T00:00:00.000Z");
        expect(end.toISOString()).toBe("2024-11-03T23:59:59.999Z");
      });
    });
  });

  describe("period boundary calculations", () => {
    it("should not have gap between consecutive daily periods", () => {
      const day1 = new Date("2024-03-15T14:30:00Z");
      const day2 = new Date("2024-03-16T14:30:00Z");

      const period1 = getPeriodDates(day1, "daily");
      const period2 = getPeriodDates(day2, "daily");

      // Period 1 ends at 23:59:59.999 and Period 2 starts at 00:00:00.000
      // The difference should be 1 millisecond
      const gap = period2.start.getTime() - period1.end.getTime();
      expect(gap).toBe(1);
    });

    it("should not have gap between consecutive monthly periods", () => {
      const march = new Date("2024-03-15T14:30:00Z");
      const april = new Date("2024-04-15T14:30:00Z");

      const period1 = getPeriodDates(march, "monthly");
      const period2 = getPeriodDates(april, "monthly");

      const gap = period2.start.getTime() - period1.end.getTime();
      expect(gap).toBe(1);
    });

    it("should not have gap between consecutive quarterly periods", () => {
      const q1 = new Date("2024-02-15T14:30:00Z");
      const q2 = new Date("2024-05-15T14:30:00Z");

      const period1 = getPeriodDates(q1, "quarterly");
      const period2 = getPeriodDates(q2, "quarterly");

      const gap = period2.start.getTime() - period1.end.getTime();
      expect(gap).toBe(1);
    });

    it("should not have gap between consecutive annual periods", () => {
      const year1 = new Date("2024-06-15T14:30:00Z");
      const year2 = new Date("2025-06-15T14:30:00Z");

      const period1 = getPeriodDates(year1, "annually");
      const period2 = getPeriodDates(year2, "annually");

      const gap = period2.start.getTime() - period1.end.getTime();
      expect(gap).toBe(1);
    });
  });
});

describe("automatedStateAt", () => {
  const history = [
    { at: 100, automated: false },
    { at: 300, automated: true },
  ];

  it("reports not-existed before the first version", () => {
    expect(automatedStateAt(history, 50)).toEqual({
      existed: false,
      automated: false,
    });
  });

  it("returns the manual state in effect before a flip", () => {
    expect(automatedStateAt(history, 100)).toEqual({
      existed: true,
      automated: false,
    });
    expect(automatedStateAt(history, 200)).toEqual({
      existed: true,
      automated: false,
    });
  });

  it("returns automated from the flip onward", () => {
    expect(automatedStateAt(history, 300)).toEqual({
      existed: true,
      automated: true,
    });
    expect(automatedStateAt(history, 999)).toEqual({
      existed: true,
      automated: true,
    });
  });

  it("handles a case that flips back to manual", () => {
    const reflip = [
      { at: 100, automated: false },
      { at: 300, automated: true },
      { at: 500, automated: false },
    ];
    expect(automatedStateAt(reflip, 400)).toEqual({
      existed: true,
      automated: true,
    });
    expect(automatedStateAt(reflip, 600)).toEqual({
      existed: true,
      automated: false,
    });
  });

  it("treats empty or undefined history as not existed", () => {
    expect(automatedStateAt(undefined, 100)).toEqual({
      existed: false,
      automated: false,
    });
    expect(automatedStateAt([], 100)).toEqual({
      existed: false,
      automated: false,
    });
  });
});

describe("generatePeriods", () => {
  it("generates contiguous monthly periods spanning lo..hi", () => {
    const periods = generatePeriods(
      new Date("2024-01-15T00:00:00Z"),
      new Date("2024-03-10T00:00:00Z"),
      "monthly"
    );
    expect(periods.map((p) => p.start.toISOString())).toEqual([
      "2024-01-01T00:00:00.000Z",
      "2024-02-01T00:00:00.000Z",
      "2024-03-01T00:00:00.000Z",
    ]);
  });

  it("fills gaps rather than skipping periods with no activity", () => {
    const periods = generatePeriods(
      new Date("2024-01-10T00:00:00Z"),
      new Date("2024-04-10T00:00:00Z"),
      "monthly"
    );
    expect(periods).toHaveLength(4); // Jan, Feb, Mar, Apr
  });

  it("returns a single period when lo and hi fall in the same one", () => {
    const periods = generatePeriods(
      new Date("2024-03-15T08:00:00Z"),
      new Date("2024-03-15T20:00:00Z"),
      "daily"
    );
    expect(periods).toHaveLength(1);
  });

  it("returns empty when lo is after hi", () => {
    const periods = generatePeriods(
      new Date("2024-05-01T00:00:00Z"),
      new Date("2024-01-01T00:00:00Z"),
      "monthly"
    );
    expect(periods).toEqual([]);
  });
});

describe("handleAutomationTrendsPOST (project-specific)", () => {
  const makeReq = (body: unknown): NextRequest =>
    ({ json: async () => body }) as unknown as NextRequest;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("counts a manual-then-automated case as manual until its flip period", async () => {
    // Current flag says automated, but it only became automated in March.
    (baseDb.repositoryCases.findMany as any).mockResolvedValue([
      {
        id: 100,
        createdAt: new Date("2024-01-15T00:00:00Z"),
        isDeleted: false,
        automated: true,
        projectId: 1,
        project: { id: 1, name: "Alpha" },
      },
    ]);
    (baseDb.repositoryCaseVersions.findMany as any).mockResolvedValue([
      {
        repositoryCaseId: 100,
        createdAt: new Date("2024-01-15T00:00:00Z"),
        automated: false,
        version: 1,
      },
      {
        repositoryCaseId: 100,
        createdAt: new Date("2024-03-10T00:00:00Z"),
        automated: true,
        version: 2,
      },
    ]);

    const res = await handleAutomationTrendsPOST(
      makeReq({ projectId: 1, dateGrouping: "monthly" }),
      false
    );
    const json = await res.json();

    expect(json.data).toHaveLength(3); // Jan, Feb, Mar
    const [jan, feb, mar] = json.data;

    // Before the flip: counted as manual (NOT back-dated to creation as automated)
    expect(jan.Alpha_manual).toBe(1);
    expect(jan.Alpha_automated).toBe(0);
    expect(feb.Alpha_manual).toBe(1);
    expect(feb.Alpha_automated).toBe(0);

    // From the flip onward: counted as automated
    expect(mar.Alpha_manual).toBe(0);
    expect(mar.Alpha_automated).toBe(1);
    expect(mar.Alpha_percentAutomated).toBe(100);

    // The flip shows up in the period-over-period delta
    expect(mar.Alpha_automatedChange).toBe(1);
    expect(mar.Alpha_manualChange).toBe(-1);
  });

  it("does not exclude cases created before the date-range window", async () => {
    (baseDb.repositoryCases.findMany as any).mockResolvedValue([
      {
        id: 200,
        createdAt: new Date("2023-11-01T00:00:00Z"),
        isDeleted: false,
        automated: false,
        projectId: 1,
        project: { id: 1, name: "Alpha" },
      },
    ]);
    (baseDb.repositoryCaseVersions.findMany as any).mockResolvedValue([
      {
        repositoryCaseId: 200,
        createdAt: new Date("2023-11-01T00:00:00Z"),
        automated: false,
        version: 1,
      },
    ]);

    const res = await handleAutomationTrendsPOST(
      makeReq({
        projectId: 1,
        dateGrouping: "monthly",
        startDate: "2024-01-01T00:00:00Z",
        endDate: "2024-02-28T00:00:00Z",
      }),
      false
    );
    const json = await res.json();

    // The date range governs the period axis (Jan + Feb 2024)...
    expect(json.data).toHaveLength(2);
    // ...and the case created in 2023 still contributes to those periods.
    expect(json.data[0].Alpha_manual).toBe(1);
    expect(json.data[1].Alpha_manual).toBe(1);
  });

  it("returns empty data without querying version history when no cases match", async () => {
    (baseDb.repositoryCases.findMany as any).mockResolvedValue([]);

    const res = await handleAutomationTrendsPOST(
      makeReq({ projectId: 1, dateGrouping: "monthly" }),
      false
    );
    const json = await res.json();

    expect(json.data).toEqual([]);
    expect(json.total).toBe(0);
    expect(baseDb.repositoryCaseVersions.findMany).not.toHaveBeenCalled();
  });
});
