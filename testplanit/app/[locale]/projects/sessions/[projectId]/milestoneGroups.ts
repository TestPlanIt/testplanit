/**
 * Collapse bookkeeping for the session list's milestone groups: the
 * session-shaped bindings over the shared recursion in
 * ~/utils/milestoneGroupCollapse.
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
  `tpi.sessions.${projectId}.collapsedMilestones`;

interface SessionGroups {
  milestones: { [milestoneId: number]: { testSessions: unknown[] } };
}

const directSessionCount =
  (grouped: SessionGroups): DirectItemCount =>
  (milestoneId) =>
    grouped.milestones[milestoneId]?.testSessions.length ?? 0;

/** Sessions in this milestone plus everything under it. */
export function countSessionsInSubtree(
  milestone: MilestoneNode,
  grouped: SessionGroups
): number {
  return countItemsInSubtree(milestone, directSessionCount(grouped));
}

/** Collapse-state keys for every milestone group the session list renders. */
export function collectRenderedMilestoneKeys(
  milestone: MilestoneNode,
  grouped: SessionGroups
): string[] {
  return collectKeys(milestone, directSessionCount(grouped));
}
