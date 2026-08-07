/**
 * Collapse bookkeeping for the run list's milestone groups: the run-shaped
 * bindings over the shared recursion in ~/utils/milestoneGroupCollapse.
 */

import {
  collectRenderedMilestoneKeys as collectKeys,
  countItemsInSubtree,
  type DirectItemCount,
  type MilestoneNode,
} from "~/utils/milestoneGroupCollapse";

export {
  parseStoredCollapsedGroups,
  UNSCHEDULED_GROUP_KEY,
} from "~/utils/milestoneGroupCollapse";

export const collapsedStorageKey = (projectId: number) =>
  `tpi.runs.${projectId}.collapsedMilestones`;

interface RunGroups {
  milestones: { [milestoneId: number]: { testRuns: unknown[] } };
}

const directRunCount =
  (grouped: RunGroups): DirectItemCount =>
  (milestoneId) =>
    grouped.milestones[milestoneId]?.testRuns.length ?? 0;

/** Test runs in this milestone plus everything under it. */
export function countRunsInSubtree(
  milestone: MilestoneNode,
  grouped: RunGroups
): number {
  return countItemsInSubtree(milestone, directRunCount(grouped));
}

/** Collapse-state keys for every milestone group the run list renders. */
export function collectRenderedMilestoneKeys(
  milestone: MilestoneNode,
  grouped: RunGroups
): string[] {
  return collectKeys(milestone, directRunCount(grouped));
}
