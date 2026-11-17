import { describe, expect, it } from "vitest";
import {
  MAX_PRIORITY_WEIGHT_ENTRIES,
  NEUTRAL_PRIORITY_WEIGHT,
  optionPositionWeight,
  priorityWeightFor,
  resolvePriorityWeights,
} from "./riskPriorityWeights";

describe("resolvePriorityWeights", () => {
  it("resolves to an empty mapping for null, garbage and non-objects", () => {
    expect(resolvePriorityWeights(null).size).toBe(0);
    expect(resolvePriorityWeights(undefined).size).toBe(0);
    expect(resolvePriorityWeights("sev-1").size).toBe(0);
    expect(resolvePriorityWeights(42).size).toBe(0);
  });

  it("normalizes keys to trimmed lowercase", () => {
    const mapping = resolvePriorityWeights({ " Sev-1 ": 90, BLOCKER: 100 });
    expect(mapping.get("sev-1")).toBe(90);
    expect(mapping.get("blocker")).toBe(100);
  });

  it("skips an unusable entry without disabling the rest", () => {
    const mapping = resolvePriorityWeights({
      high: 101,
      minor: -1,
      bogus: "75",
      blocker: 100,
    });
    expect(mapping.size).toBe(1);
    expect(mapping.get("blocker")).toBe(100);
  });

  it("caps an oversized mapping instead of rejecting it", () => {
    const big: Record<string, number> = {};
    for (let i = 0; i < MAX_PRIORITY_WEIGHT_ENTRIES + 50; i++)
      big[`p${i}`] = 50;
    const mapping = resolvePriorityWeights(big);
    expect(mapping.size).toBe(MAX_PRIORITY_WEIGHT_ENTRIES);
    expect(mapping.get("p0")).toBe(50);
  });
});

describe("priorityWeightFor", () => {
  const mapping = resolvePriorityWeights({ "sev-1": 100, minor: 20 });

  it("reads mapped names case-insensitively", () => {
    expect(priorityWeightFor("Sev-1", mapping)).toBe(100);
    expect(priorityWeightFor(" MINOR ", mapping)).toBe(20);
  });

  it("treats unmapped, null and blank as neutral", () => {
    expect(priorityWeightFor("whatever", mapping)).toBe(
      NEUTRAL_PRIORITY_WEIGHT
    );
    expect(priorityWeightFor(null, mapping)).toBe(NEUTRAL_PRIORITY_WEIGHT);
    expect(priorityWeightFor("  ", mapping)).toBe(NEUTRAL_PRIORITY_WEIGHT);
  });
});

describe("optionPositionWeight", () => {
  it("gives a lone option full weight", () => {
    expect(optionPositionWeight(0, 1)).toBe(100);
    expect(optionPositionWeight(0, 0)).toBe(100);
  });

  it("spaces options evenly from 100 down to 10", () => {
    expect([0, 1, 2, 3].map((p) => optionPositionWeight(p, 4))).toEqual([
      100, 70, 40, 10,
    ]);
    expect([0, 1].map((p) => optionPositionWeight(p, 2))).toEqual([100, 10]);
    expect([0, 1, 2].map((p) => optionPositionWeight(p, 3))).toEqual([
      100, 55, 10,
    ]);
  });

  it("clamps out-of-range positions", () => {
    expect(optionPositionWeight(-1, 4)).toBe(100);
    expect(optionPositionWeight(9, 4)).toBe(10);
  });
});
