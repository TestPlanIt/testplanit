/**
 * Date helpers shared by the milestone-readiness route and its test.
 *
 * The report filters and plots milestones on a single date. Keeping the filter
 * and the plot keyed off the SAME date is the whole point of this module — see
 * `isMilestoneInDateRange`.
 */

interface MilestoneDates {
  startedAt?: Date | string | null;
  completedAt?: Date | string | null;
  createdAt: Date | string;
}

/**
 * The single date a milestone occupies on a time axis / date filter. Synced
 * milestones often have no `startedAt`, so fall back to the target/end date,
 * then the row's creation — every milestone resolves to a real date.
 */
export function milestoneDate(m: MilestoneDates): Date {
  return new Date(m.startedAt ?? m.completedAt ?? m.createdAt);
}

/**
 * Whether a milestone falls inside the report's date filter.
 *
 * Filtering keys off the SAME effective date the chart plots
 * (`milestoneDate`), NOT a start/end window overlap. A window filter lets an
 * undated milestone — which plots at its creation date — pass (null start/end
 * reads as open-ended) yet render outside the visible range. Matching the
 * filter to the plotted date keeps the two consistent. The end bound is
 * inclusive of the whole day.
 */
export function isMilestoneInDateRange(
  m: MilestoneDates,
  range?: { startDate?: string | null; endDate?: string | null }
): boolean {
  if (!range?.startDate && !range?.endDate) return true;
  const t = milestoneDate(m).getTime();
  if (range.startDate && t < new Date(range.startDate).getTime()) return false;
  if (range.endDate) {
    const end = new Date(range.endDate);
    end.setHours(23, 59, 59, 999);
    if (t > end.getTime()) return false;
  }
  return true;
}
