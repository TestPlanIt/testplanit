/**
 * Collapse bookkeeping for the run list's milestone groups.
 *
 * Structural parameter types (rather than the display component's concrete
 * ones) keep this module free of any import back into TestRunDisplay, so the
 * recursion below stays testable on plain objects.
 */

/** Collapse-state key for the "No milestone" group, which has no id. */
export const UNSCHEDULED_GROUP_KEY = "unscheduled";

export const collapsedStorageKey = (projectId: number) =>
  `tpi.runs.${projectId}.collapsedMilestones`;

interface MilestoneNode {
  id: number;
  children?: MilestoneNode[];
}

interface RunGroups {
  milestones: { [milestoneId: number]: { testRuns: unknown[] } };
}

/**
 * Test runs in this milestone plus everything under it. Collapsing a parent
 * hides its descendant groups too, so the header count has to speak for the
 * whole subtree or it under-reports what just disappeared.
 */
export function countRunsInSubtree(
  milestone: MilestoneNode,
  grouped: RunGroups
): number {
  return (
    (grouped.milestones[milestone.id]?.testRuns.length ?? 0) +
    (milestone.children ?? []).reduce(
      (sum, child) => sum + countRunsInSubtree(child, grouped),
      0
    )
  );
}

/**
 * Collapse-state keys for every milestone group that actually renders — the
 * same "has runs at or below me" test the renderer uses. Ancestors with no
 * runs of their own still render (and so still collapse) when a descendant
 * has some; a branch with no runs anywhere contributes nothing.
 */
export function collectRenderedMilestoneKeys(
  milestone: MilestoneNode,
  grouped: RunGroups
): string[] {
  const childKeys = (milestone.children ?? []).flatMap((child) =>
    collectRenderedMilestoneKeys(child, grouped)
  );
  const directRuns = grouped.milestones[milestone.id]?.testRuns.length ?? 0;
  if (directRuns > 0 || childKeys.length > 0) {
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
