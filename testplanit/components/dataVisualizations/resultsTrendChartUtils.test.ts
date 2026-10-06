import { describe, expect, it } from "vitest";
import {
  formatRate,
  formatSigned,
  periodLabel,
  periodLongLabel,
} from "./resultsTrendChartUtils";
import { heatmapIntensity } from "./ResultsTrendHeatmap";

describe("formatRate", () => {
  it("renders a percent with at most one decimal, and a dash for no rate", () => {
    expect(formatRate(62.5, "en-US")).toBe("62.5%");
    expect(formatRate(100, "en-US")).toBe("100%");
    expect(formatRate(33.333, "en-US", 0)).toBe("33%");
    expect(formatRate(null, "en-US")).toBe("—");
  });
});

describe("formatSigned", () => {
  it("prefixes the sign and uses a real minus", () => {
    expect(formatSigned(2.345, "en-US")).toBe("+2.3");
    expect(formatSigned(-1, "en-US")).toBe("−1.0");
    expect(formatSigned(0.04, "en-US")).toBe("0.0");
    expect(formatSigned(-12.6, "en-US", 0)).toBe("−13");
  });
});

describe("periodLabel", () => {
  it("reads the period key as a calendar date, not an instant, at the grouping's precision", () => {
    expect(periodLabel("2026-09-28", "weekly", "en-US")).toBe("Sep 28");
    expect(periodLabel("2026-09-28", "daily", "en-US")).toBe("Sep 28");
    expect(periodLabel("2026-09-01", "monthly", "en-US")).toBe("Sep 2026");
    expect(periodLabel("2026-07-01", "quarterly", "en-US")).toBe("Q3 2026");
    expect(periodLabel("2026-01-01", "annually", "en-US")).toBe("2026");
    expect(periodLongLabel("2026-09-01", "monthly", "en-US")).toBe(
      "September 2026"
    );
  });
});

describe("heatmapIntensity", () => {
  it("scales to full shading at 35% and stays there above it", () => {
    expect(heatmapIntensity(null)).toBe(0);
    expect(heatmapIntensity(0)).toBe(0);
    expect(heatmapIntensity(17.5)).toBeCloseTo(0.5);
    expect(heatmapIntensity(35)).toBe(1);
    expect(heatmapIntensity(80)).toBe(1);
  });
});
