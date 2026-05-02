/**
 * Stripe-style outbound webhook retry curve.
 *
 * Schedule: 0s, 30s, 5m, 30m, 2h, 6h, 12h. Six retries after the initial
 * attempt = 7 total attempts, ~21h total. The function MUST be a pure
 * lookup with no side effects so BullMQ's custom backoffStrategy can
 * call it deterministically from inside the Worker.
 *
 * BullMQ semantics (verified against node_modules/bullmq@5.76.1
 * dist/cjs/classes/job.js:467-488 during planning):
 *   - During processor execution, `job.attemptsMade` is the count of
 *     COMPLETED attempts (0 on first run, 1 before second run, etc.).
 *   - The current attempt number is therefore `job.attemptsMade + 1`.
 *   - On retry, `Backoffs.calculate(...)` is called with
 *     `this.attemptsMade + 1` (line 488) — i.e. the strategy receives the
 *     1-indexed "next attempt about to start" number.
 * This module mirrors that 1-indexing.
 *
 * Tests cover attempts -1 through 8 (max+1) to lock the curve and the
 * post-max clamp behavior.
 */

export const MAX_DISPATCH_ATTEMPTS = 7 as const;

export const OUTBOUND_RETRY_SCHEDULE_MS = Object.freeze([
  0, // attempt 1 — initial; never used as a retry delay
  30_000, // attempt 2 — 30s
  300_000, // attempt 3 — 5m
  1_800_000, // attempt 4 — 30m
  7_200_000, // attempt 5 — 2h
  21_600_000, // attempt 6 — 6h
  43_200_000, // attempt 7 — 12h
]) as readonly number[];

export function retryDelayForAttempt(attemptNumber: number): number {
  if (attemptNumber <= 0) return 0;
  if (attemptNumber > OUTBOUND_RETRY_SCHEDULE_MS.length) {
    return OUTBOUND_RETRY_SCHEDULE_MS[OUTBOUND_RETRY_SCHEDULE_MS.length - 1];
  }
  return OUTBOUND_RETRY_SCHEDULE_MS[attemptNumber - 1];
}
