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

/**
 * One rendered line of a milestone-grouped list. These lists are trees, but
 * they render through a single virtualizer, so the tree is flattened to rows
 * and nesting is carried by `depth` rather than by nested elements.
 */
export type GroupedListRow<TItem, TMilestone extends MilestoneNode> =
  | { kind: "unscheduled-header"; key: string; depth: 0 }
  | {
      kind: "milestone-header";
      key: string;
      milestone: TMilestone;
      depth: number;
      /** Items in this milestone and everything under it — what collapsing hides. */
      subtreeItemCount: number;
    }
  | { kind: "item"; key: string; item: TItem; depth: number };

/** Items grouped directly under one milestone, excluding its descendants. */
export type DirectItems<TItem> = (milestoneId: number) => TItem[];

export interface BuildGroupedListRowsArgs<
  TItem,
  TMilestone extends MilestoneNode,
> {
  unscheduled: TItem[];
  directItems: DirectItems<TItem>;
  /** Milestone tree, already ranked. Rendered depth-first after the unscheduled group. */
  tree: TMilestone[];
  collapsedGroups: ReadonlySet<string>;
  /**
   * False when the unscheduled group renders no header — it then has no
   * chevron to reopen with, so it stays expanded whatever the stored collapse
   * state says.
   */
  showUnscheduledHeader: boolean;
  getItemKey: (item: TItem) => string | number;
}

/**
 * Flattens a milestone-grouped list into the exact row sequence it renders:
 * the unscheduled group first, then each milestone depth-first with its own
 * items ahead of its children. A collapsed milestone contributes its header
 * and nothing below it — children included, which is what makes collapsing a
 * parent fold away a whole branch. Milestones with no items at or below them
 * are skipped entirely, matching collectRenderedMilestoneKeys.
 */
export function buildGroupedListRows<
  TItem,
  TMilestone extends MilestoneNode & { children?: TMilestone[] },
>({
  unscheduled,
  directItems,
  tree,
  collapsedGroups,
  showUnscheduledHeader,
  getItemKey,
}: BuildGroupedListRowsArgs<TItem, TMilestone>): GroupedListRow<
  TItem,
  TMilestone
>[] {
  const rows: GroupedListRow<TItem, TMilestone>[] = [];
  const directCount: DirectItemCount = (id) => directItems(id).length;

  if (unscheduled.length > 0) {
    if (showUnscheduledHeader) {
      rows.push({
        kind: "unscheduled-header",
        key: "header-unscheduled",
        depth: 0,
      });
    }
    if (!showUnscheduledHeader || !collapsedGroups.has(UNSCHEDULED_GROUP_KEY)) {
      unscheduled.forEach((item) => {
        rows.push({
          kind: "item",
          key: `item-${getItemKey(item)}`,
          item,
          depth: 0,
        });
      });
    }
  }

  const walk = (milestone: TMilestone, depth: number) => {
    const subtreeItemCount = countItemsInSubtree(milestone, directCount);
    if (subtreeItemCount === 0) return;

    rows.push({
      kind: "milestone-header",
      key: `header-milestone-${milestone.id}`,
      milestone,
      depth,
      subtreeItemCount,
    });

    if (collapsedGroups.has(String(milestone.id))) return;

    directItems(milestone.id).forEach((item) => {
      rows.push({
        kind: "item",
        key: `item-${getItemKey(item)}`,
        item,
        depth: depth + 1,
      });
    });

    const children = (milestone.children ?? []) as TMilestone[];
    children.forEach((child) => walk(child, depth + 1));
  };

  tree.forEach((milestone) => walk(milestone, 0));

  return rows;
}
