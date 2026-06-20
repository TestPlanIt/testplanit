import type { TxClient } from "~/lib/zenstack";

/**
 * AppConfig key storing the threshold (in days) before a PENDING review
 * request becomes eligible for a reminder notification. A value of 0
 * disables reminders entirely; any positive integer means "after this many
 * days of no activity, nudge the reviewer." Days are the unit (not hours)
 * so the cadence aligns with daily-digest email subscribers — at one
 * reminder per request per day max, the digest can't accumulate duplicate
 * reminder rows for the same request.
 */
export const REVIEW_REMINDER_THRESHOLD_DAYS_KEY =
  "review_reminder_threshold_days";

/**
 * Default threshold when the AppConfig row is absent. One day covers the
 * common "didn't get to it yesterday" case without becoming noisy for
 * fresh requests. Set to 0 in the AppConfig row to disable reminders.
 */
export const REVIEW_REMINDER_THRESHOLD_DAYS_DEFAULT = 1;

/**
 * Read the review-reminder threshold (days) from the AppConfig table.
 *
 * Server-side helper used by the review-reminder worker case in
 * `workers/forecastWorker.ts`. Mirrors the `Pick<TransactionClient,
 * "appConfig">` shape from `reviewFeatureFlag.ts` so callers can hand
 * either the singleton `prisma` (non-transactional context) or a `tx`
 * handle (inside a `prisma.$transaction` block); the latter participates
 * in the surrounding snapshot isolation.
 *
 * Storage shape:
 *   - Missing row              → default (1 day)
 *   - Numeric value === 0      → 0 (reminders disabled — worker short-circuits)
 *   - Numeric value > 0        → returned as-is
 *   - Anything else            → default (rejects NaN, negative, non-number,
 *                                          string, boolean, null inner values)
 *
 * The AppConfig row is admin-only mutable by schema policy
 * (`@@allow('all', auth().access == 'ADMIN')`), so the threshold cannot
 * be poked by lower-privilege actors.
 */
export async function getReviewReminderThresholdDays(
  tx: Pick<TxClient, "appConfig">
): Promise<number> {
  const row = await tx.appConfig.findUnique({
    where: { key: REVIEW_REMINDER_THRESHOLD_DAYS_KEY },
    select: { value: true },
  });
  if (!row) return REVIEW_REMINDER_THRESHOLD_DAYS_DEFAULT;

  const v = row.value as unknown;
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
    return v;
  }
  if (
    typeof v === "object" &&
    v !== null &&
    typeof (v as { days?: unknown }).days === "number" &&
    Number.isFinite((v as { days: number }).days) &&
    (v as { days: number }).days >= 0
  ) {
    return (v as { days: number }).days;
  }
  return REVIEW_REMINDER_THRESHOLD_DAYS_DEFAULT;
}
