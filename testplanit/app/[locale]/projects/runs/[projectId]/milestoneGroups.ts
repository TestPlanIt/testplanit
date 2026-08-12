/**
 * Collapse bookkeeping for the run list's milestone groups: the run-shaped
 * bindings over the shared recursion in ~/utils/milestoneGroupCollapse.
 */

import {
  collectRenderedMilestoneKeys as collectKeys,
  countItemsInSubtree,
  type DirectItemCount,
  type MilestoneNode,
  UNSCHEDULED_GROUP_KEY as UNSCHEDULED_KEY,
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

/**
 * One rendered line of the run list. The list is a milestone *tree*, but it
 * renders through a single virtualizer, so the tree is flattened to rows and
 * nesting is carried by `depth` rather than by nested elements.
 */
export type RunListRow<TRun, TMilestone extends MilestoneNode = MilestoneNode> =
  | { kind: "unscheduled-header"; key: string; depth: 0 }
  | {
      kind: "milestone-header";
      key: string;
      milestone: TMilestone;
      depth: number;
      /** Runs in this milestone and everything under it — what collapsing hides. */
      subtreeRunCount: number;
    }
  | { kind: "run"; key: string; run: TRun; depth: number };

interface BuildRunListRowsArgs<TRun, TMilestone extends MilestoneNode> {
  unscheduled: TRun[];
  grouped: { milestones: { [milestoneId: number]: { testRuns: TRun[] } } };
  /** Milestone tree, already ranked. Rendered depth-first after the unscheduled group. */
  tree: TMilestone[];
  collapsedGroups: ReadonlySet<string>;
  /**
   * False when every unscheduled run is completed: that group renders no
   * header, so it has no chevron to reopen with and stays expanded whatever
   * the stored collapse state says.
   */
  showUnscheduledHeader: boolean;
  getRunId: (run: TRun) => number;
}

/**
 * Flattens the grouped runs into the exact row sequence the list renders:
 * the unscheduled group first, then each milestone depth-first with its own
 * runs ahead of its children. Collapsed milestones contribute their header
 * and nothing below it — children included, which is what makes collapsing a
 * parent fold away a whole branch. Milestones with no runs at or below them
 * are skipped entirely.
 */
export function buildRunListRows<
  TRun,
  TMilestone extends MilestoneNode & { children?: TMilestone[] },
>({
  unscheduled,
  grouped,
  tree,
  collapsedGroups,
  showUnscheduledHeader,
  getRunId,
}: BuildRunListRowsArgs<TRun, TMilestone>): RunListRow<TRun, TMilestone>[] {
  const rows: RunListRow<TRun, TMilestone>[] = [];
  const directCount = directRunCount(grouped);

  if (unscheduled.length > 0) {
    if (showUnscheduledHeader) {
      rows.push({
        kind: "unscheduled-header",
        key: "header-unscheduled",
        depth: 0,
      });
    }
    const open =
      !showUnscheduledHeader || !collapsedGroups.has(UNSCHEDULED_KEY);
    if (open) {
      unscheduled.forEach((run) => {
        rows.push({ kind: "run", key: `run-${getRunId(run)}`, run, depth: 0 });
      });
    }
  }

  const walk = (milestone: TMilestone, depth: number) => {
    if (countItemsInSubtree(milestone, directCount) === 0) return;

    rows.push({
      kind: "milestone-header",
      key: `header-milestone-${milestone.id}`,
      milestone,
      depth,
      subtreeRunCount: countItemsInSubtree(milestone, directCount),
    });

    if (collapsedGroups.has(String(milestone.id))) return;

    grouped.milestones[milestone.id]?.testRuns.forEach((run) => {
      rows.push({
        kind: "run",
        key: `run-${getRunId(run)}`,
        run,
        depth: depth + 1,
      });
    });

    const children = (milestone.children ?? []) as TMilestone[];
    children.forEach((child) => walk(child, depth + 1));
  };

  tree.forEach((milestone) => walk(milestone, 0));

  return rows;
}
