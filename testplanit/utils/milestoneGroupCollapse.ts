/**
 * Collapse bookkeeping shared by the milestone-grouped lists (test runs,
 * sessions).
 *
 * Each list keys its groups by its own field, so callers pass a direct-count
 * accessor rather than their group map. That also keeps this module free of
 * any import back into a display component, so the recursion below stays
 * testable on plain objects.
 */

/** Collapse-state key for the "No milestone" group, which has no id. */
export const UNSCHEDULED_GROUP_KEY = "unscheduled";

export interface MilestoneNode {
  id: number;
  children?: MilestoneNode[];
}

/** Items grouped directly under one milestone, excluding its descendants. */
export type DirectItemCount = (milestoneId: number) => number;

/**
 * Items in this milestone plus everything under it. Collapsing a parent hides
 * its descendant groups too, so the header count has to speak for the whole
 * subtree or it under-reports what just disappeared.
 */
export function countItemsInSubtree(
  milestone: MilestoneNode,
  directCount: DirectItemCount
): number {
  return (
    directCount(milestone.id) +
    (milestone.children ?? []).reduce(
      (sum, child) => sum + countItemsInSubtree(child, directCount),
      0
    )
  );
}

/**
 * Collapse-state keys for every milestone group that actually renders — the
 * same "has items at or below me" test the renderers use. Ancestors with no
 * items of their own still render (and so still collapse) when a descendant
 * has some; a branch with no items anywhere contributes nothing.
 */
export function collectRenderedMilestoneKeys(
  milestone: MilestoneNode,
  directCount: DirectItemCount
): string[] {
  const childKeys = (milestone.children ?? []).flatMap((child) =>
    collectRenderedMilestoneKeys(child, directCount)
  );
  if (directCount(milestone.id) > 0 || childKeys.length > 0) {
    return [String(milestone.id), ...childKeys];
  }
  return [];
}

/**
 * Reads persisted collapse state, tolerating an absent, unparseable, or
 * stale-shaped value by starting fully expanded — never by throwing on a page
 * whose list would otherwise render fine.
 */
export function parseStoredCollapsedGroups(stored: string | null): Set<string> {
  if (!stored) return new Set();
  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? new Set(parsed.map(String)) : new Set();
  } catch {
    return new Set();
  }
}
