import { describe, expect, it } from "vitest";

import {
  MAX_DISPATCH_ATTEMPTS,
  OUTBOUND_RETRY_SCHEDULE_MS,
  retryDelayForAttempt,
} from "./retry-delay";

/**
 * Stripe-style outbound retry curve.
 *
 * The schedule is locked at the source: 0s, 30s, 5m, 30m, 2h, 6h, 12h.
 * Six retries after the initial attempt = 7 total attempts. We test
 * attempts 1 through 8 (max+1) plus negative/zero defensive cases to
 * lock the curve and the post-max clamp behavior.
 */
describe("retryDelayForAttempt", () => {
  it.each([
    { attempt: -1, expectedMs: 0, label: "negative attempt clamps to 0" },
    { attempt: 0, expectedMs: 0, label: "zero attempt clamps to 0" },
    { attempt: 1, expectedMs: 0, label: "attempt 1 = 0ms (initial)" },
    { attempt: 2, expectedMs: 30_000, label: "attempt 2 = 30s" },
    { attempt: 3, expectedMs: 300_000, label: "attempt 3 = 5m" },
    { attempt: 4, expectedMs: 1_800_000, label: "attempt 4 = 30m" },
    { attempt: 5, expectedMs: 7_200_000, label: "attempt 5 = 2h" },
    { attempt: 6, expectedMs: 21_600_000, label: "attempt 6 = 6h" },
    { attempt: 7, expectedMs: 43_200_000, label: "attempt 7 = 12h" },
    {
      attempt: 8,
      expectedMs: 43_200_000,
      label: "attempt 8 (max+1) clamps at last known value",
    },
  ])("$label → $expectedMs ms", ({ attempt, expectedMs }) => {
    expect(retryDelayForAttempt(attempt)).toBe(expectedMs);
  });

  it("MAX_DISPATCH_ATTEMPTS equals the schedule length", () => {
    expect(MAX_DISPATCH_ATTEMPTS).toBe(7);
    expect(OUTBOUND_RETRY_SCHEDULE_MS).toHaveLength(MAX_DISPATCH_ATTEMPTS);
  });

  it("OUTBOUND_RETRY_SCHEDULE_MS contains exactly the 7 locked values", () => {
    expect(OUTBOUND_RETRY_SCHEDULE_MS).toEqual([
      0, 30000, 300000, 1800000, 7200000, 21600000, 43200000,
    ]);
  });

  it("OUTBOUND_RETRY_SCHEDULE_MS is frozen so production code cannot mutate the curve", () => {
    expect(Object.isFrozen(OUTBOUND_RETRY_SCHEDULE_MS)).toBe(true);
  });
});
