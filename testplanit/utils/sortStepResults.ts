interface OrderedStepResult {
  step?: { order?: number | null } | null;
  sharedStepItem?: { order?: number | null } | null;
}

/**
 * Step results in the order of their steps; the items of a shared step group
 * follow the order of the group. A nested query cannot sort by a related
 * record, so the order is applied to the rows it returns.
 */
export function sortStepResults<T extends OrderedStepResult>(
  stepResults: readonly T[]
): T[] {
  return [...stepResults].sort(
    (a, b) =>
      (a.step?.order ?? 0) - (b.step?.order ?? 0) ||
      (a.sharedStepItem?.order ?? 0) - (b.sharedStepItem?.order ?? 0)
  );
}
