import { describe, expect, it } from "vitest";

import { getBillingPeriodKey, getBillingPeriodStart } from "./billingPeriod";

describe("getBillingPeriodStart", () => {
  it("returns first of current month when startDay=1 in mid-month (default behavior)", () => {
    const now = new Date(2026, 3, 15, 12, 0, 0); // Apr 15 2026 12:00 local
    const result = getBillingPeriodStart(1, now);
    expect(result).toEqual(new Date(2026, 3, 1, 0, 0, 0, 0));
  });

  it("returns 15th of current month when startDay=15 and now is Apr 20", () => {
    const now = new Date(2026, 3, 20, 12, 0, 0);
    const result = getBillingPeriodStart(15, now);
    expect(result).toEqual(new Date(2026, 3, 15, 0, 0, 0, 0));
  });

  it("returns 15th of previous month when startDay=15 and now is Apr 10", () => {
    const now = new Date(2026, 3, 10, 12, 0, 0);
    const result = getBillingPeriodStart(15, now);
    expect(result).toEqual(new Date(2026, 2, 15, 0, 0, 0, 0));
  });

  it("returns Apr 15 00:00 when startDay=15 and now is Apr 15 00:00:00 exactly (boundary, inclusive)", () => {
    const now = new Date(2026, 3, 15, 0, 0, 0, 0);
    const result = getBillingPeriodStart(15, now);
    expect(result).toEqual(new Date(2026, 3, 15, 0, 0, 0, 0));
  });

  it("returns Jan 31 00:00 when startDay=31 and now is Feb 10 (non-leap year, normal start)", () => {
    const now = new Date(2026, 1, 10, 12, 0, 0); // Feb 10 2026 (non-leap)
    const result = getBillingPeriodStart(31, now);
    expect(result).toEqual(new Date(2026, 0, 31, 0, 0, 0, 0));
  });

  it("clamps to Feb 28 when startDay=31 and now is Mar 5 (non-leap year)", () => {
    const now = new Date(2026, 2, 5, 12, 0, 0); // Mar 5 2026 (non-leap)
    const result = getBillingPeriodStart(31, now);
    expect(result).toEqual(new Date(2026, 1, 28, 0, 0, 0, 0));
  });

  it("clamps to Feb 29 when startDay=31 and now is Mar 5 (leap year 2028)", () => {
    const now = new Date(2028, 2, 5, 12, 0, 0); // Mar 5 2028 (leap)
    const result = getBillingPeriodStart(31, now);
    expect(result).toEqual(new Date(2028, 1, 29, 0, 0, 0, 0));
  });

  it("clamps to Feb 28 when startDay=29 and now is Mar 1 (non-leap)", () => {
    const now = new Date(2026, 2, 1, 12, 0, 0); // Mar 1 2026 (non-leap)
    const result = getBillingPeriodStart(29, now);
    expect(result).toEqual(new Date(2026, 1, 28, 0, 0, 0, 0));
  });

  it("clamps startDay=30 to Feb 28 in non-leap year and Feb 29 in leap year", () => {
    // Non-leap (2026)
    const nowNonLeap = new Date(2026, 2, 1, 12, 0, 0);
    const resultNonLeap = getBillingPeriodStart(30, nowNonLeap);
    expect(resultNonLeap).toEqual(new Date(2026, 1, 28, 0, 0, 0, 0));

    // Leap (2028)
    const nowLeap = new Date(2028, 2, 1, 12, 0, 0);
    const resultLeap = getBillingPeriodStart(30, nowLeap);
    expect(resultLeap).toEqual(new Date(2028, 1, 29, 0, 0, 0, 0));
  });

  it("coerces invalid startDay (0, 32, NaN) to 1", () => {
    const now = new Date(2026, 3, 15, 12, 0, 0);
    const expected = new Date(2026, 3, 1, 0, 0, 0, 0);
    expect(getBillingPeriodStart(0, now)).toEqual(expected);
    expect(getBillingPeriodStart(32, now)).toEqual(expected);
    expect(getBillingPeriodStart(Number.NaN, now)).toEqual(expected);
    expect(getBillingPeriodStart(-5, now)).toEqual(expected);
  });

  it("crosses year boundary when startDay=15 and now is Jan 10 (returns Dec 15 prev year)", () => {
    const now = new Date(2026, 0, 10, 12, 0, 0); // Jan 10 2026
    const result = getBillingPeriodStart(15, now);
    expect(result).toEqual(new Date(2025, 11, 15, 0, 0, 0, 0));
  });
});

describe("getBillingPeriodKey", () => {
  it("formats March 15 2026 as '2026-03-15'", () => {
    expect(getBillingPeriodKey(new Date(2026, 2, 15))).toBe("2026-03-15");
  });

  it("zero-pads month and day for February 1 2026 -> '2026-02-01'", () => {
    expect(getBillingPeriodKey(new Date(2026, 1, 1))).toBe("2026-02-01");
  });
});
