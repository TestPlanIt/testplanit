import { describe, expect, it } from "vitest";
import { hasPassStreak } from "./quarantine";

describe("hasPassStreak", () => {
  it("needs the configured number of consecutive passes, newest first", () => {
    expect(hasPassStreak([true, true, true], 3)).toBe(true);
    expect(hasPassStreak([true, true, false, true], 3)).toBe(false);
    expect(hasPassStreak([true, true, true, false], 3)).toBe(true);
  });

  it("is not satisfied before enough results exist", () => {
    expect(hasPassStreak([true, true], 3)).toBe(false);
    expect(hasPassStreak([], 1)).toBe(false);
  });

  it("treats a threshold below one as one", () => {
    expect(hasPassStreak([true], 0)).toBe(true);
    expect(hasPassStreak([false], 0)).toBe(false);
  });
});
