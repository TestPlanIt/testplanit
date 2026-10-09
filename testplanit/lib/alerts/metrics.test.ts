import { describe, expect, it } from "vitest";
import {
  cooldownElapsed,
  daysBetween,
  evaluateConsecutiveFailures,
  evaluateDurationDeviation,
  evaluateFailureCount,
  evaluateFlakiness,
  evaluateMilestoneBehind,
  evaluateMilestoneOverdue,
  evaluatePassRate,
  evaluateRegression,
  mean,
  median,
  type ResultSample,
} from "./metrics";

const pass = (elapsed: number | null = null): ResultSample => ({
  elapsed,
  isSuccess: true,
  isFailure: false,
});
const fail = (elapsed: number | null = null): ResultSample => ({
  elapsed,
  isSuccess: false,
  isFailure: true,
});
const skip = (elapsed: number | null = null): ResultSample => ({
  elapsed,
  isSuccess: false,
  isFailure: false,
});

describe("mean / median", () => {
  it("handles empty, odd and even inputs", () => {
    expect(mean([])).toBe(0);
    expect(median([])).toBe(0);
    expect(mean([2, 4, 9])).toBe(5);
    expect(median([9, 2, 4])).toBe(4);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

describe("evaluateDurationDeviation", () => {
  const previous = [pass(10), pass(12), pass(11), pass(100), pass(10)];

  it("fires when the new duration is beyond the threshold in the chosen direction", () => {
    const verdict = evaluateDurationDeviation({
      current: 20,
      previous,
      window: 10,
      minSamples: 3,
      baselineType: "MEDIAN",
      thresholdPercent: 50,
      direction: "ABOVE",
    });
    expect(verdict.baseline).toBe(11);
    expect(verdict.fired).toBe(true);
    expect(verdict.deviationPercent).toBeCloseTo(81.8, 1);
    expect(verdict.sampleCount).toBe(5);
  });

  it("uses the mean when asked, which the outlier drags up", () => {
    const verdict = evaluateDurationDeviation({
      current: 20,
      previous,
      window: 10,
      minSamples: 3,
      baselineType: "MEAN",
      thresholdPercent: 50,
      direction: "ABOVE",
    });
    expect(verdict.baseline).toBeCloseTo(28.6, 1);
    expect(verdict.fired).toBe(false);
  });

  it("respects the direction: a faster result does not fire an ABOVE rule but does fire EITHER", () => {
    const base = {
      current: 2,
      previous,
      window: 10,
      minSamples: 3,
      baselineType: "MEDIAN" as const,
      thresholdPercent: 50,
    };
    expect(
      evaluateDurationDeviation({ ...base, direction: "ABOVE" }).fired
    ).toBe(false);
    expect(
      evaluateDurationDeviation({ ...base, direction: "BELOW" }).fired
    ).toBe(true);
    expect(
      evaluateDurationDeviation({ ...base, direction: "EITHER" }).fired
    ).toBe(true);
  });

  it("only reads the newest `window` durations and ignores results without one", () => {
    const history = [pass(null), pass(50), pass(50), pass(1), pass(1), pass(1)];
    const verdict = evaluateDurationDeviation({
      current: 60,
      previous: history,
      window: 2,
      minSamples: 2,
      baselineType: "MEDIAN",
      thresholdPercent: 10,
      direction: "EITHER",
    });
    expect(verdict.sampleCount).toBe(2);
    expect(verdict.baseline).toBe(50);
    expect(verdict.fired).toBe(true);
  });

  it("stays silent without a duration, below the minimum sample size, or on a zero baseline", () => {
    expect(
      evaluateDurationDeviation({
        current: null,
        previous,
        window: 10,
        minSamples: 1,
        baselineType: "MEDIAN",
        thresholdPercent: 1,
        direction: "EITHER",
      }).reason
    ).toBe("no_elapsed");
    expect(
      evaluateDurationDeviation({
        current: 20,
        previous: previous.slice(0, 2),
        window: 10,
        minSamples: 3,
        baselineType: "MEDIAN",
        thresholdPercent: 1,
        direction: "EITHER",
      }).reason
    ).toBe("insufficient_samples");
    expect(
      evaluateDurationDeviation({
        current: 20,
        previous: [pass(0), pass(0)],
        window: 10,
        minSamples: 2,
        baselineType: "MEDIAN",
        thresholdPercent: 1,
        direction: "EITHER",
      }).reason
    ).toBe("zero_baseline");
  });
});

describe("evaluateRegression", () => {
  it("fires when a failure follows a window of passes", () => {
    const verdict = evaluateRegression({
      current: fail(),
      previous: [pass(), skip(), pass(), pass(), fail()],
      window: 3,
      minSamples: 3,
    });
    expect(verdict).toEqual({ fired: true, passedBefore: 3 });
  });

  it("does not fire on a pass, on a mixed window, or below the minimum", () => {
    expect(
      evaluateRegression({
        current: pass(),
        previous: [pass(), pass()],
        window: 2,
        minSamples: 2,
      }).fired
    ).toBe(false);
    expect(
      evaluateRegression({
        current: fail(),
        previous: [pass(), fail(), pass()],
        window: 3,
        minSamples: 2,
      }).fired
    ).toBe(false);
    expect(
      evaluateRegression({
        current: fail(),
        previous: [pass()],
        window: 3,
        minSamples: 2,
      }).fired
    ).toBe(false);
  });
});

describe("evaluateConsecutiveFailures", () => {
  it("counts the streak through skipped results and fires at the count", () => {
    const verdict = evaluateConsecutiveFailures({
      current: fail(),
      previous: [skip(), fail(), fail(), pass(), fail()],
      count: 3,
    });
    expect(verdict).toEqual({ fired: true, streak: 3 });
  });

  it("does not fire on a pass or a short streak", () => {
    expect(
      evaluateConsecutiveFailures({
        current: pass(),
        previous: [fail()],
        count: 1,
      }).fired
    ).toBe(false);
    expect(
      evaluateConsecutiveFailures({
        current: fail(),
        previous: [pass(), fail()],
        count: 2,
      })
    ).toEqual({ fired: false, streak: 1 });
  });
});

describe("evaluateFlakiness", () => {
  it("counts pass/fail flips within the window, newest result included", () => {
    const verdict = evaluateFlakiness({
      current: fail(),
      previous: [pass(), fail(), pass(), pass(), skip(), fail()],
      window: 10,
      minSamples: 5,
      flipThreshold: 3,
    });
    expect(verdict.flips).toBe(4);
    expect(verdict.sampleCount).toBe(6);
    expect(verdict.fired).toBe(true);
  });

  it("stays silent under the minimum sample size or flip threshold", () => {
    expect(
      evaluateFlakiness({
        current: fail(),
        previous: [pass()],
        window: 10,
        minSamples: 5,
        flipThreshold: 1,
      }).fired
    ).toBe(false);
    expect(
      evaluateFlakiness({
        current: fail(),
        previous: [fail(), fail(), fail(), fail()],
        window: 10,
        minSamples: 3,
        flipThreshold: 1,
      }).fired
    ).toBe(false);
  });
});

describe("run metrics", () => {
  it("pass rate counts only verdict results and needs the minimum sample size", () => {
    expect(
      evaluatePassRate({
        counts: { passed: 8, failed: 2 },
        thresholdPercent: 90,
        minSamples: 10,
      })
    ).toEqual({ fired: true, passRate: 80, sampleCount: 10 });
    expect(
      evaluatePassRate({
        counts: { passed: 8, failed: 1 },
        thresholdPercent: 90,
        minSamples: 10,
      }).fired
    ).toBe(false);
    expect(
      evaluatePassRate({
        counts: { passed: 0, failed: 0 },
        thresholdPercent: 90,
        minSamples: 1,
      }).fired
    ).toBe(false);
  });

  it("failure count fires strictly above the count", () => {
    expect(
      evaluateFailureCount({ counts: { passed: 1, failed: 5 }, count: 5 }).fired
    ).toBe(false);
    expect(
      evaluateFailureCount({ counts: { passed: 1, failed: 6 }, count: 5 })
    ).toEqual({ fired: true, failed: 6 });
  });
});

describe("milestone metrics", () => {
  const now = new Date("2026-10-08T12:00:00Z");

  it("daysBetween rounds future up and past down", () => {
    expect(daysBetween(now, new Date("2026-10-10T18:00:00Z"))).toBe(3);
    expect(daysBetween(now, new Date("2026-10-08T06:00:00Z"))).toBe(-1);
    expect(daysBetween(now, now)).toBe(0);
  });

  it("behind fires only inside the remaining-days window and under the completion bar", () => {
    const base = { completed: 5, total: 10, now, thresholdPercent: 80 };
    expect(
      evaluateMilestoneBehind({
        ...base,
        dueAt: new Date("2026-10-10T12:00:00Z"),
        daysRemaining: 3,
      })
    ).toEqual({ fired: true, completionPercent: 50, daysRemaining: 2 });
    expect(
      evaluateMilestoneBehind({
        ...base,
        dueAt: new Date("2026-10-20T12:00:00Z"),
        daysRemaining: 3,
      }).fired
    ).toBe(false);
    expect(
      evaluateMilestoneBehind({
        ...base,
        completed: 9,
        dueAt: new Date("2026-10-10T12:00:00Z"),
        daysRemaining: 3,
      }).fired
    ).toBe(false);
    expect(
      evaluateMilestoneBehind({
        ...base,
        dueAt: new Date("2026-10-01T12:00:00Z"),
        daysRemaining: 3,
      }).fired
    ).toBe(false);
    expect(
      evaluateMilestoneBehind({
        ...base,
        total: 0,
        completed: 0,
        dueAt: new Date("2026-10-09T12:00:00Z"),
        daysRemaining: 3,
      }).fired
    ).toBe(false);
  });

  it("overdue fires once the due date has passed", () => {
    expect(
      evaluateMilestoneOverdue({ dueAt: new Date("2026-10-05T12:00:00Z"), now })
    ).toEqual({ fired: true, daysOverdue: 3 });
    expect(
      evaluateMilestoneOverdue({ dueAt: new Date("2026-10-09T12:00:00Z"), now })
        .fired
    ).toBe(false);
  });
});

describe("cooldownElapsed", () => {
  const now = new Date("2026-10-08T12:00:00Z");
  it("is open with no previous firing or a zero cooldown", () => {
    expect(cooldownElapsed(null, 60, now)).toBe(true);
    expect(cooldownElapsed(now, 0, now)).toBe(true);
  });
  it("closes inside the window and reopens after it", () => {
    expect(cooldownElapsed(new Date("2026-10-08T11:30:00Z"), 60, now)).toBe(
      false
    );
    expect(cooldownElapsed(new Date("2026-10-08T11:00:00Z"), 60, now)).toBe(
      true
    );
  });
});
