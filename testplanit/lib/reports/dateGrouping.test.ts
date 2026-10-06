import { describe, expect, it } from "vitest";
import {
  bucketDateIso,
  generatePeriods,
  isDateGrouping,
  periodBoundsUtc,
} from "./dateGrouping";

describe("dateGrouping", () => {
  // A Wednesday mid-quarter, mid-month, mid-day.
  const wednesday = "2026-05-13T15:30:00.000Z";

  describe("bucketDateIso", () => {
    it("defaults to the UTC day", () => {
      expect(bucketDateIso(wednesday)).toBe("2026-05-13T00:00:00.000Z");
    });

    it("buckets a week to its Monday", () => {
      expect(bucketDateIso(wednesday, "weekly")).toBe(
        "2026-05-11T00:00:00.000Z"
      );
      // Sunday belongs to the week that started the previous Monday.
      expect(bucketDateIso("2026-05-17T23:59:59.999Z", "weekly")).toBe(
        "2026-05-11T00:00:00.000Z"
      );
    });

    it("buckets months, quarters and years to their first day", () => {
      expect(bucketDateIso(wednesday, "monthly")).toBe(
        "2026-05-01T00:00:00.000Z"
      );
      expect(bucketDateIso(wednesday, "quarterly")).toBe(
        "2026-04-01T00:00:00.000Z"
      );
      expect(bucketDateIso(wednesday, "annually")).toBe(
        "2026-01-01T00:00:00.000Z"
      );
    });

    it("accepts Date objects", () => {
      expect(bucketDateIso(new Date(wednesday), "monthly")).toBe(
        "2026-05-01T00:00:00.000Z"
      );
    });
  });

  describe("periodBoundsUtc", () => {
    it("is half-open at the next period's start", () => {
      expect(periodBoundsUtc(wednesday, "weekly")).toEqual({
        gte: new Date("2026-05-11T00:00:00.000Z"),
        lt: new Date("2026-05-18T00:00:00.000Z"),
      });
      expect(periodBoundsUtc(wednesday, "monthly")).toEqual({
        gte: new Date("2026-05-01T00:00:00.000Z"),
        lt: new Date("2026-06-01T00:00:00.000Z"),
      });
      expect(periodBoundsUtc(wednesday)).toEqual({
        gte: new Date("2026-05-13T00:00:00.000Z"),
        lt: new Date("2026-05-14T00:00:00.000Z"),
      });
    });
  });

  it("generatePeriods tiles a range without gaps", () => {
    const periods = generatePeriods(
      new Date("2026-01-15T00:00:00.000Z"),
      new Date("2026-04-02T00:00:00.000Z"),
      "monthly"
    );
    expect(periods.map((p) => p.start.toISOString())).toEqual([
      "2026-01-01T00:00:00.000Z",
      "2026-02-01T00:00:00.000Z",
      "2026-03-01T00:00:00.000Z",
      "2026-04-01T00:00:00.000Z",
    ]);
  });

  it("isDateGrouping accepts only the five periods", () => {
    expect(isDateGrouping("quarterly")).toBe(true);
    expect(isDateGrouping("hourly")).toBe(false);
    expect(isDateGrouping(undefined)).toBe(false);
  });
});
