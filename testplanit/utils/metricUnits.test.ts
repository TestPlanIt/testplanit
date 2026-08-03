import { describe, expect, it } from "vitest";
import { METRIC_UNITS, metricUnit } from "./metricUnits";

describe("metricUnits", () => {
  it("maps durations to seconds, rates to percent, dates to date", () => {
    expect(metricUnit("avgElapsedTime")).toBe("seconds");
    expect(metricUnit("totalElapsedTime")).toBe("seconds");
    expect(metricUnit("averageElapsed")).toBe("seconds");
    expect(metricUnit("averageDuration")).toBe("seconds");
    expect(metricUnit("totalDuration")).toBe("seconds");
    expect(metricUnit("passRate")).toBe("percent");
    expect(metricUnit("automationRate")).toBe("percent");
    expect(metricUnit("milestoneCompletion")).toBe("percent");
    expect(metricUnit("percentReady")).toBe("percent");
    expect(metricUnit("lastActiveDate")).toBe("date");
    expect(metricUnit("executionCount")).toBe("count");
    expect(metricUnit("testResultCount")).toBe("count");
  });

  it("returns undefined for unmapped ids so heuristics can classify custom presets", () => {
    expect(metricUnit("someCustomMetric")).toBeUndefined();
  });

  it("readiness count metrics stay counts even though their ids look status-like", () => {
    // "passed"/"failed" contain no unit hints — the map is what keeps them
    // from ever being misclassified by a label heuristic.
    for (const id of ["passed", "failed", "inProgress", "notRun"]) {
      expect(METRIC_UNITS[id]).toBe("count");
    }
  });
});
