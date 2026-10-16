import { describe, expect, it } from "vitest";
import {
  computeStatusBarSegmentWidths,
  MIN_SEGMENT_PERCENT,
} from "./statusBarSegmentWidths";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("computeStatusBarSegmentWidths", () => {
  it("returns nothing for no segments", () => {
    expect(computeStatusBarSegmentWidths([], true)).toEqual([]);
  });

  it("splits equally without elapsed data", () => {
    const widths = computeStatusBarSegmentWidths(
      [
        { elapsed: 10, isPending: false },
        { elapsed: 30, isPending: false },
      ],
      false
    );
    expect(widths).toEqual([50, 50]);
  });

  it("splits equally when every case is pending or has no time", () => {
    const widths = computeStatusBarSegmentWidths(
      [
        { elapsed: null, isPending: true },
        { elapsed: 0, isPending: false },
        { elapsed: null, isPending: false },
      ],
      true
    );
    expect(widths).toEqual([100 / 3, 100 / 3, 100 / 3]);
  });

  it("sizes segments by elapsed and always fills the bar", () => {
    const widths = computeStatusBarSegmentWidths(
      [
        { elapsed: 100, isPending: false },
        { elapsed: 300, isPending: false },
      ],
      true
    );
    expect(widths).toEqual([25, 75]);
  });

  it("fills the bar even when the run total would say otherwise (re-run attempts, step times)", () => {
    // Mirrors the reported bug: latest-result times add up to far less than
    // the run's total elapsed, which also counts earlier attempts.
    const widths = computeStatusBarSegmentWidths(
      [
        { elapsed: 90, isPending: false },
        { elapsed: 0, isPending: false },
        { elapsed: 0, isPending: false },
        { elapsed: 110, isPending: false },
      ],
      true
    );
    expect(sum(widths)).toBeCloseTo(100, 6);
    expect(widths[1]).toBe(MIN_SEGMENT_PERCENT);
    expect(widths[2]).toBe(MIN_SEGMENT_PERCENT);
    expect(widths[0]).toBeCloseTo((90 / 200) * 94, 6);
    expect(widths[3]).toBeCloseTo((110 / 200) * 94, 6);
  });

  it("pins pending and very short cases to the minimum and shares the rest proportionally", () => {
    const widths = computeStatusBarSegmentWidths(
      [
        { elapsed: null, isPending: true },
        { elapsed: 1, isPending: false },
        { elapsed: 500, isPending: false },
        { elapsed: 500, isPending: false },
      ],
      true
    );
    expect(widths[0]).toBe(MIN_SEGMENT_PERCENT);
    expect(widths[1]).toBe(MIN_SEGMENT_PERCENT);
    expect(widths[2]).toBeCloseTo(47, 6);
    expect(widths[3]).toBeCloseTo(47, 6);
    expect(sum(widths)).toBeCloseTo(100, 6);
  });

  it("re-pins segments that drop below the minimum after others are pinned", () => {
    // 2.9% of the free width after the first pins — only caught on a 2nd pass.
    const widths = computeStatusBarSegmentWidths(
      [
        { elapsed: null, isPending: true },
        { elapsed: null, isPending: true },
        { elapsed: 3, isPending: false },
        { elapsed: 97, isPending: false },
      ],
      true
    );
    expect(widths.every((w) => w >= MIN_SEGMENT_PERCENT)).toBe(true);
    expect(sum(widths)).toBeCloseTo(100, 6);
  });

  it("honors a custom minimum (session bar uses 5%)", () => {
    const widths = computeStatusBarSegmentWidths(
      [
        { elapsed: 60, isPending: false },
        { elapsed: 120, isPending: false },
        { elapsed: 0, isPending: false },
      ],
      true,
      5
    );
    expect(widths[2]).toBe(5);
    expect(widths[0]).toBeCloseTo((60 / 180) * 95, 6);
    expect(widths[1]).toBeCloseTo((120 / 180) * 95, 6);
    expect(sum(widths)).toBeCloseTo(100, 6);
  });

  it("falls back to an equal split when minimums would overflow the bar", () => {
    const items = Array.from({ length: 40 }, (_, i) => ({
      elapsed: i,
      isPending: false,
    }));
    const widths = computeStatusBarSegmentWidths(items, true);
    expect(widths.every((w) => w === 100 / 40)).toBe(true);
  });
});
