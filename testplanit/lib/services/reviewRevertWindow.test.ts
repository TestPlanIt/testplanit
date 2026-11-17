import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isWithinRevertWindow,
  readRevertDecisionDurationSeconds,
  resolveRevertWindowSeconds,
  REVERT_DECISION_DURATION_KEY,
  REVERT_DECISION_WINDOW_SECONDS_DEFAULT,
} from "./reviewRevertWindow";

afterEach(() => {
  vi.useRealTimers();
});

describe("resolveRevertWindowSeconds", () => {
  it("falls back to the 24h default when nothing is configured", () => {
    // The whole reason this helper exists rather than calling
    // resolveEffectiveWindowSeconds directly: that one returns null
    // (unrestricted) here, which would allow reverting a year-old decision.
    expect(resolveRevertWindowSeconds(null, null)).toBe(
      REVERT_DECISION_WINDOW_SECONDS_DEFAULT
    );
    expect(REVERT_DECISION_WINDOW_SECONDS_DEFAULT).toBe(24 * 60 * 60);
  });

  it("uses the project override when there is no system policy", () => {
    expect(resolveRevertWindowSeconds(null, 600)).toBe(600);
  });

  it("inherits the system ceiling when the project has no override", () => {
    expect(resolveRevertWindowSeconds(7200, null)).toBe(7200);
  });

  it("lets a project tighten below the system ceiling", () => {
    expect(resolveRevertWindowSeconds(7200, 600)).toBe(600);
  });

  it("does NOT let a project loosen beyond the system ceiling", () => {
    expect(resolveRevertWindowSeconds(600, 7200)).toBe(600);
  });

  it("treats a system value of 0 as disabled, with no project override", () => {
    expect(resolveRevertWindowSeconds(0, 7200)).toBe(0);
    expect(resolveRevertWindowSeconds(0, null)).toBe(0);
  });

  it("lets a project disable reverting under a permissive ceiling", () => {
    expect(resolveRevertWindowSeconds(7200, 0)).toBe(0);
  });

  it("never returns null — there is always a bound", () => {
    for (const [sys, proj] of [
      [null, null],
      [null, 0],
      [0, null],
      [3600, null],
      [null, 3600],
    ] as const) {
      expect(resolveRevertWindowSeconds(sys, proj)).not.toBeNull();
    }
  });
});

describe("isWithinRevertWindow", () => {
  it("accepts a decision inside the window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-27T12:00:00Z"));
    const decidedAt = new Date("2026-10-27T11:30:00Z"); // 30 min ago
    expect(isWithinRevertWindow(decidedAt, 3600)).toBe(true);
  });

  it("rejects a decision past the window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-27T12:00:00Z"));
    const decidedAt = new Date("2026-10-27T10:30:00Z"); // 90 min ago
    expect(isWithinRevertWindow(decidedAt, 3600)).toBe(false);
  });

  it("rejects the year-old decision that motivated the bound", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-27T12:00:00Z"));
    const decidedAt = new Date("2025-10-27T12:00:00Z");
    expect(
      isWithinRevertWindow(decidedAt, REVERT_DECISION_WINDOW_SECONDS_DEFAULT)
    ).toBe(false);
  });

  it("treats a zero or negative window as closed", () => {
    expect(isWithinRevertWindow(new Date(), 0)).toBe(false);
    expect(isWithinRevertWindow(new Date(), -1)).toBe(false);
  });
});

describe("readRevertDecisionDurationSeconds", () => {
  function clientReturning(value: unknown) {
    return {
      appConfig: {
        findUnique: vi.fn(async (args: { where: { key: string } }) => {
          expect(args.where.key).toBe(REVERT_DECISION_DURATION_KEY);
          return value === undefined ? null : { value };
        }),
      },
    } as never;
  }

  it("returns null when the AppConfig row is absent", async () => {
    await expect(
      readRevertDecisionDurationSeconds(clientReturning(undefined))
    ).resolves.toBeNull();
  });

  it("reads a JSON number", async () => {
    await expect(
      readRevertDecisionDurationSeconds(clientReturning(1800))
    ).resolves.toBe(1800);
  });

  it("reads 0 as disabled rather than falling through to null", async () => {
    await expect(
      readRevertDecisionDurationSeconds(clientReturning(0))
    ).resolves.toBe(0);
  });

  it("accepts a numeric string defensively", async () => {
    await expect(
      readRevertDecisionDurationSeconds(clientReturning("1800"))
    ).resolves.toBe(1800);
  });

  it("ignores a non-numeric value", async () => {
    await expect(
      readRevertDecisionDurationSeconds(clientReturning("later"))
    ).resolves.toBeNull();
    await expect(
      readRevertDecisionDurationSeconds(clientReturning({}))
    ).resolves.toBeNull();
  });
});
