/**
 * Width (in percent of the bar) for each case segment of a run's status bar.
 *
 * Segments are sized by each case's latest-result elapsed time so a long test
 * reads as a long segment, but the widths are normalized to the segments
 * themselves rather than to the run's total elapsed. The run total counts
 * every attempt and every step time, while a segment knows only its latest
 * result, so dividing by the total leaves the bar partly empty once any case
 * has been re-run or has step timings — which reads as unfinished work.
 *
 * Pending cases and cases whose share would be too thin to see get a fixed
 * minimum, and the remaining width is shared among the others in proportion
 * to their elapsed time. Without any elapsed data every case gets an equal
 * share. The widths always sum to 100 (within floating-point rounding) unless
 * there are more segments than minimums fit, in which case they fall back to
 * an equal split.
 *
 * Shared by the run, milestone and session summary bars; `minPercent` is the
 * floor a segment keeps so it stays visible.
 */
export const MIN_SEGMENT_PERCENT = 3;

export interface SegmentWidthInput {
  elapsed?: number | null;
  isPending: boolean;
}

export function computeStatusBarSegmentWidths(
  items: readonly SegmentWidthInput[],
  hasElapsedData: boolean,
  minPercent: number = MIN_SEGMENT_PERCENT
): number[] {
  const count = items.length;
  if (count === 0) return [];

  const equalSplit = () => items.map(() => 100 / count);
  if (!hasElapsedData || minPercent * count > 100) {
    return equalSplit();
  }

  const weights = items.map((item) =>
    item.isPending ? 0 : Math.max(item.elapsed ?? 0, 0)
  );
  if (weights.every((w) => w === 0)) {
    return equalSplit();
  }

  // Pin segments to the minimum until every proportional share clears it.
  // Each pass pins at least one more segment, so this terminates.
  const pinned = new Set<number>();
  weights.forEach((w, i) => {
    if (w === 0) pinned.add(i);
  });
  for (;;) {
    const free = 100 - minPercent * pinned.size;
    const freeWeight = weights.reduce(
      (sum, w, i) => (pinned.has(i) ? sum : sum + w),
      0
    );
    if (freeWeight === 0) {
      // Everything is pinned (or only zero-weight segments remain).
      return pinned.size === count
        ? equalSplit()
        : weights.map((_, i) =>
            pinned.has(i) ? minPercent : free / (count - pinned.size)
          );
    }
    let changed = false;
    weights.forEach((w, i) => {
      if (!pinned.has(i) && (w / freeWeight) * free < minPercent) {
        pinned.add(i);
        changed = true;
      }
    });
    if (!changed) {
      return weights.map((w, i) =>
        pinned.has(i) ? minPercent : (w / freeWeight) * free
      );
    }
  }
}
