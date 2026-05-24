import type { Prisma } from "@prisma/client";

/**
 * AppConfig key storing the threshold (in hours) before a PENDING review
 * request becomes eligible for a reminder notification. The default suits
 * the most common workflow (24h) — admins may tighten or relax it without
 * a redeploy by writing the AppConfig row through the auto-API.
 */
export const REVIEW_REMINDER_THRESHOLD_HOURS_KEY =
  "review_reminder_threshold_hours";

/**
 * Default threshold when the AppConfig row is absent or carries an invalid
 * value (NaN, negative, zero, non-number, etc.). Matches the most common
 * "next business day" cadence.
 */
export const REVIEW_REMINDER_THRESHOLD_HOURS_DEFAULT = 24;

/**
 * Read the review-reminder threshold (hours) from the AppConfig table.
 *
 * Server-side helper used by the review-reminder worker case in
 * `workers/forecastWorker.ts`. Mirrors the `Pick<TransactionClient,
 * "appConfig">` shape from `reviewFeatureFlag.ts` so callers can hand
 * either the singleton `prisma` (non-transactional context) or a `tx`
 * handle (inside a `prisma.$transaction` block); the latter participates
 * in the surrounding snapshot isolation.
 *
 * Storage shape is permissive:
 *   - Missing row         → default
 *   - Numeric value > 0   → returned as-is
 *   - `{ hours: <num> }`  → returned (forward-compat for a future
 *                           structured admin payload)
 *   - Anything else       → default (rejects NaN, negative, zero, strings,
 *                           booleans, null inner values)
 *
 * The AppConfig row is admin-only mutable by schema policy
 * (`@@allow('all', auth().access == 'ADMIN')`), so the threshold cannot
 * be poked by lower-privilege actors.
 */
export async function getReviewReminderThresholdHours(
  tx: Pick<Prisma.TransactionClient, "appConfig">
): Promise<number> {
  const row = await tx.appConfig.findUnique({
    where: { key: REVIEW_REMINDER_THRESHOLD_HOURS_KEY },
    select: { value: true },
  });
  if (!row) return REVIEW_REMINDER_THRESHOLD_HOURS_DEFAULT;

  const v = row.value as unknown;
  if (typeof v === "number" && Number.isFinite(v) && v > 0) {
    return v;
  }
  if (
    typeof v === "object" &&
    v !== null &&
    typeof (v as { hours?: unknown }).hours === "number" &&
    Number.isFinite((v as { hours: number }).hours) &&
    (v as { hours: number }).hours > 0
  ) {
    return (v as { hours: number }).hours;
  }
  return REVIEW_REMINDER_THRESHOLD_HOURS_DEFAULT;
}
