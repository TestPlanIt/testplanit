import { describe, expect, it } from "vitest";
import { DEFAULT_RISK_WEIGHTS, resolveRiskWeights } from "./weights";

describe("resolveRiskWeights", () => {
  it("returns defaults for null, undefined and non-objects", () => {
    expect(resolveRiskWeights(null)).toEqual(DEFAULT_RISK_WEIGHTS);
    expect(resolveRiskWeights(undefined)).toEqual(DEFAULT_RISK_WEIGHTS);
    expect(resolveRiskWeights("nope")).toEqual(DEFAULT_RISK_WEIGHTS);
    expect(resolveRiskWeights(42)).toEqual(DEFAULT_RISK_WEIGHTS);
  });

  it("merges a partial override over the defaults", () => {
    expect(resolveRiskWeights({ failureHistory: 80 })).toEqual({
      ...DEFAULT_RISK_WEIGHTS,
      failureHistory: 80,
    });
  });

  it("accepts zero weights", () => {
    const resolved = resolveRiskWeights({ staleness: 0, defects: 0 });
    expect(resolved.staleness).toBe(0);
    expect(resolved.defects).toBe(0);
  });

  it("falls back to defaults when any provided weight is invalid", () => {
    expect(resolveRiskWeights({ failureHistory: -1 })).toEqual(
      DEFAULT_RISK_WEIGHTS
    );
    expect(resolveRiskWeights({ flakiness: 101 })).toEqual(
      DEFAULT_RISK_WEIGHTS
    );
    expect(resolveRiskWeights({ criticality: "high" })).toEqual(
      DEFAULT_RISK_WEIGHTS
    );
  });

  it("ignores unknown keys", () => {
    expect(resolveRiskWeights({ somethingElse: 5, defects: 20 })).toEqual({
      ...DEFAULT_RISK_WEIGHTS,
      defects: 20,
    });
  });

  it("returns a fresh object every call", () => {
    const first = resolveRiskWeights(null);
    first.failureHistory = 0;
    expect(resolveRiskWeights(null)).toEqual(DEFAULT_RISK_WEIGHTS);
  });
});
