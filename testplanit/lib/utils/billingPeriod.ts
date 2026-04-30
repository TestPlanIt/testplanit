/**
 * Billing-period helpers for LLM cost aggregation.
 *
 * Customers on non-calendar billing cycles (e.g., 15th-to-15th) need spend
 * aggregation, budget alerts, and Reset Spend to align with their actual
 * provider invoice period. `getBillingPeriodStart` returns the most recent
 * occurrence of `startDay` (clamped to the last day of short months) at
 * 00:00:00.000 local time relative to `now`.
 *
 * `getBillingPeriodKey` formats the period start as a `YYYY-MM-DD` ISO
 * date string, used as a key in `LlmProviderConfig.alertThresholdsFired`
 * so threshold firing resets per period (not per calendar month).
 */

/**
 * Returns the most recent occurrence of `startDay` at 00:00:00.000 local
 * time, relative to `now`. Days 29-31 clamp to the last day of the target
 * month (e.g., `startDay=31` in February returns Feb 28 or Feb 29).
 *
 * Invalid `startDay` values (NaN, <1, >31) coerce to 1.
 */
export function getBillingPeriodStart(
  startDay: number,
  now: Date = new Date()
): Date {
  const day =
    Number.isFinite(startDay) && startDay >= 1 && startDay <= 31
      ? Math.floor(startDay)
      : 1;

  // Try current month first
  const candidate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const lastDayOfMonth = new Date(
    candidate.getFullYear(),
    candidate.getMonth() + 1,
    0
  ).getDate();
  candidate.setDate(Math.min(day, lastDayOfMonth));

  if (candidate.getTime() <= now.getTime()) {
    return candidate;
  }

  // Period start is in previous month
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
  const lastDayOfPrev = new Date(
    prev.getFullYear(),
    prev.getMonth() + 1,
    0
  ).getDate();
  prev.setDate(Math.min(day, lastDayOfPrev));
  return prev;
}

/**
 * Formats a billing-period start `Date` as a `YYYY-MM-DD` ISO date string.
 * Used as the per-period key inside `LlmProviderConfig.alertThresholdsFired`.
 */
export function getBillingPeriodKey(start: Date): string {
  const y = start.getFullYear();
  const m = String(start.getMonth() + 1).padStart(2, "0");
  const d = String(start.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
