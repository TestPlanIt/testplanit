import { beforeEach, describe, expect, it } from "vitest";
import {
  OUTLINE_CTX_INITIAL_BUDGET,
  OUTLINE_CTX_MAX_BUDGET,
  _resetLearnedBudgets,
  getStartingBudget,
  isTimeoutError,
  recordWorkingBudget,
} from "./adaptive-budget";

describe("getStartingBudget", () => {
  beforeEach(() => {
    _resetLearnedBudgets();
  });

  it("returns the initial budget for an integration with no learned state", () => {
    expect(getStartingBudget(42)).toBe(OUTLINE_CTX_INITIAL_BUDGET);
  });

  it("grows the learned budget by the growth factor on subsequent calls", () => {
    recordWorkingBudget(42, 2000);
    // 2000 * 1.5 = 3000
    expect(getStartingBudget(42)).toBe(3000);
  });

  it("caps the starting budget at OUTLINE_CTX_MAX_BUDGET", () => {
    recordWorkingBudget(42, 7000);
    // 7000 * 1.5 = 10500, capped at 8000
    expect(getStartingBudget(42)).toBe(OUTLINE_CTX_MAX_BUDGET);
  });

  it("never returns below the initial budget when growing from a small learned value", () => {
    // A previous timeout chain dropped the learned budget to 200. The next
    // call should still try the initial budget (~1500), not a tiny one — so
    // a single bad call doesn't permanently lock the integration into a
    // useless budget.
    recordWorkingBudget(42, 200);
    expect(getStartingBudget(42)).toBe(OUTLINE_CTX_INITIAL_BUDGET);
  });

  it("returns 0 path: a learned budget of 0 still tries the initial budget next", () => {
    // After a chain that bottomed out at zero context, give it a fresh start.
    recordWorkingBudget(42, 0);
    expect(getStartingBudget(42)).toBe(OUTLINE_CTX_INITIAL_BUDGET);
  });

  it("tracks separate budgets per integration id", () => {
    recordWorkingBudget(1, 3000);
    recordWorkingBudget(2, 500);
    expect(getStartingBudget(1)).toBe(4500); // 3000 * 1.5
    expect(getStartingBudget(2)).toBe(OUTLINE_CTX_INITIAL_BUDGET);
    expect(getStartingBudget(3)).toBe(OUTLINE_CTX_INITIAL_BUDGET);
  });

  it("converges toward the cap with repeated successes", () => {
    let budget = OUTLINE_CTX_INITIAL_BUDGET;
    recordWorkingBudget(42, budget);
    // Each successful call grows the stored value (the route records the
    // budget that actually ran, then getStartingBudget grows from there).
    const sequence: number[] = [];
    for (let i = 0; i < 6; i++) {
      const next = getStartingBudget(42);
      sequence.push(next);
      budget = next;
      recordWorkingBudget(42, budget);
    }
    // 1500 -> 2250 -> 3375 -> 5063 -> 7595 -> 8000 (cap) -> 8000
    expect(sequence).toEqual([2250, 3375, 5063, 7595, 8000, 8000]);
  });
});

describe("isTimeoutError", () => {
  it("identifies the LlmError TIMEOUT shape thrown by the Anthropic adapter", () => {
    expect(isTimeoutError({ code: "TIMEOUT", statusCode: 408 })).toBe(true);
  });

  it("falls back to message matching for plain Error instances", () => {
    expect(isTimeoutError(new Error("Request timeout"))).toBe(true);
    expect(isTimeoutError(new Error("upstream Timeout after 30s"))).toBe(true);
  });

  it("returns false for non-timeout errors", () => {
    expect(isTimeoutError(new Error("Unauthorized"))).toBe(false);
    expect(isTimeoutError({ code: "RATE_LIMITED" })).toBe(false);
    expect(isTimeoutError(null)).toBe(false);
    expect(isTimeoutError(undefined)).toBe(false);
    expect(isTimeoutError("timeout")).toBe(false); // string, not an error
  });
});
