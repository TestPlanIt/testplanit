/**
 * Collapse bookkeeping for the session list's milestone groups: the
 * session-shaped bindings over the shared recursion in
 * ~/utils/milestoneGroupCollapse.
 */

import {
  buildGroupedListRows,
  collectRenderedMilestoneKeys as collectKeys,
  countItemsInSubtree,
  type DirectItemCount,
  type GroupedListRow,
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

/** One rendered line of the session list. */
export type SessionListRow<
  TSession,
  TMilestone extends MilestoneNode = MilestoneNode,
> = GroupedListRow<TSession, TMilestone>;

interface BuildSessionListRowsArgs<TSession, TMilestone extends MilestoneNode> {
  unscheduled: TSession[];
  grouped: {
    milestones: { [milestoneId: number]: { testSessions: TSession[] } };
  };
  tree: TMilestone[];
  collapsedGroups: ReadonlySet<string>;
  showUnscheduledHeader: boolean;
  getSessionId: (session: TSession) => number;
}

/** Session-shaped binding over the shared flattening. */
export function buildSessionListRows<
  TSession,
  TMilestone extends MilestoneNode & { children?: TMilestone[] },
>({
  unscheduled,
  grouped,
  tree,
  collapsedGroups,
  showUnscheduledHeader,
  getSessionId,
}: BuildSessionListRowsArgs<TSession, TMilestone>): SessionListRow<
  TSession,
  TMilestone
>[] {
  return buildGroupedListRows<TSession, TMilestone>({
    unscheduled,
    directItems: (milestoneId) =>
      grouped.milestones[milestoneId]?.testSessions ?? [],
    tree,
    collapsedGroups,
    showUnscheduledHeader,
    getItemKey: getSessionId,
  });
}
