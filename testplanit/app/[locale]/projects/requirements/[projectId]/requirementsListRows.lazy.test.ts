// Wave 0 scaffold (phase 28-01) for the lazy-mode row-derivation unit lane
// (SCALE-02), converted by 28-12 once the roots/expand route carries a
// server-computed hasChildren flag (28-RESEARCH Pitfall 1: today's
// flattenRequirementRows re-derives hasChildren from the in-memory
// childrenMap, which is wrong for any root whose children haven't been
// fetched yet under lazy mode).

import { describe, expect, it } from "vitest";

import {
  flattenLazyRequirementRows,
  type LazyRequirementSourceRow,
  type RequirementListSortConfig,
} from "./requirementsListRows";

const nameAsc: RequirementListSortConfig = {
  column: "name",
  direction: "asc",
};

// Local fixture factory -- a lazily loaded row already carries
// `hasChildren` PER ROW straight from the server (28-08's
// `RequirementTreeRow`), unlike `requirementsListRows.test.ts`'s
// `makeRequirement`, which derives it locally from a full `childrenMap`.
function makeLazyRow(args: {
  id: number;
  name: string;
  parentId?: number | null;
  hasChildren?: boolean;
  title?: string | null;
}): LazyRequirementSourceRow {
  return {
    id: args.id,
    name: args.name,
    title: args.title ?? args.name,
    parentId: args.parentId ?? null,
    integrationId: null,
    requirementDetachedAt: null,
    isRequirement: true,
    externalStatus: null,
    status: null,
    createdAt: null,
    priority: null,
    hasChildren: args.hasChildren ?? false,
  } as unknown as LazyRequirementSourceRow;
}

describe("requirementsListRows lazy-mode derivations", () => {
  it("trusts the server hasChildren flag instead of re-deriving it from childrenMap", () => {
    // A loaded root whose children have not been fetched: nothing else is
    // in the loaded set, so a childrenMap-derived answer would be false --
    // Pitfall 1's exact failure mode. The server already told us the truth.
    const root = makeLazyRow({ id: 1, name: "Root", hasChildren: true });

    const rows = flattenLazyRequirementRows({
      rows: [root],
      expandedByIssueId: {},
      sortConfig: nameAsc,
      coverage: undefined,
      matchedIds: null,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].hasChildren).toBe(true);
  });

  it("fetching a root's children does not change its hasChildren, and the children render beneath it sorted", () => {
    const root = makeLazyRow({ id: 1, name: "Root", hasChildren: true });
    const childB = makeLazyRow({ id: 2, name: "B Child", parentId: 1 });
    const childA = makeLazyRow({ id: 3, name: "A Child", parentId: 1 });

    const rows = flattenLazyRequirementRows({
      rows: [root, childB, childA],
      expandedByIssueId: { 1: true },
      sortConfig: nameAsc,
      coverage: undefined,
      matchedIds: null,
    });

    expect(rows.map((r) => r.id)).toEqual([1, 3, 2]);
    expect(rows[0].hasChildren).toBe(true);
    expect(rows[0].depth).toBe(0);
    expect(rows[1].depth).toBe(1);
    expect(rows[2].depth).toBe(1);
  });

  it("a row whose parent is not in the loaded set renders at the top level instead of disappearing", () => {
    // Only the child arrived (its ancestor chain was pruned for some other
    // reason) -- it must still render, not be dropped and not be silently
    // re-parented to some unrelated loaded row.
    const orphan = makeLazyRow({ id: 5, name: "Orphan", parentId: 999 });
    const root = makeLazyRow({ id: 1, name: "Root", hasChildren: false });

    const rows = flattenLazyRequirementRows({
      rows: [root, orphan],
      expandedByIssueId: {},
      sortConfig: nameAsc,
      coverage: undefined,
      matchedIds: null,
    });

    expect(rows.map((r) => r.id).sort((a, b) => a - b)).toEqual([1, 5]);
    expect(rows.find((r) => r.id === 5)!.depth).toBe(0);
  });

  it("never emits the same row twice, even if it arrived as both an ancestor and a child", () => {
    const root = makeLazyRow({ id: 1, name: "Root", hasChildren: true });
    const child = makeLazyRow({ id: 2, name: "Child", parentId: 1 });
    // The same row delivered twice -- once as a plain fetched child, once
    // again as if it were also an ancestor of some other match.
    const rows = flattenLazyRequirementRows({
      rows: [root, child, child],
      expandedByIssueId: { 1: true },
      sortConfig: nameAsc,
      coverage: undefined,
      matchedIds: null,
    });

    expect(rows.filter((r) => r.id === 2)).toHaveLength(1);
  });

  it("renders a match's ancestors as context rows, not as matches", () => {
    const root = makeLazyRow({ id: 1, name: "Root", hasChildren: true });
    const mid = makeLazyRow({
      id: 2,
      name: "Mid",
      parentId: 1,
      hasChildren: true,
    });
    const leaf = makeLazyRow({ id: 3, name: "Leaf Match", parentId: 2 });

    const rows = flattenLazyRequirementRows({
      rows: [root, mid, leaf],
      expandedByIssueId: { 1: true, 2: true },
      sortConfig: nameAsc,
      coverage: undefined,
      matchedIds: new Set([3]),
    });

    expect(rows.find((r) => r.id === 3)!.isMatch).toBe(true);
    expect(rows.find((r) => r.id === 1)!.isMatch).toBe(false);
    expect(rows.find((r) => r.id === 2)!.isMatch).toBe(false);
  });

  it("when not filtering, isMatch is left undefined rather than forced true on every row", () => {
    const root = makeLazyRow({ id: 1, name: "Root" });

    const rows = flattenLazyRequirementRows({
      rows: [root],
      expandedByIssueId: {},
      sortConfig: nameAsc,
      coverage: undefined,
      matchedIds: null,
    });

    expect(rows[0].isMatch).toBeUndefined();
  });

  it("keeps the depth<100 cap when assembling a partially loaded tree", () => {
    const chain: LazyRequirementSourceRow[] = [];
    const expandedByIssueId: Record<number, boolean> = {};
    for (let i = 1; i <= 150; i++) {
      chain.push(
        makeLazyRow({
          id: i,
          name: `Level ${i}`,
          parentId: i === 1 ? null : i - 1,
          hasChildren: i < 150,
        })
      );
      if (i < 150) expandedByIssueId[i] = true;
    }

    const rows = flattenLazyRequirementRows({
      rows: chain,
      expandedByIssueId,
      sortConfig: nameAsc,
      coverage: undefined,
      matchedIds: null,
    });

    expect(rows.length).toBeLessThanOrEqual(100);
    expect(rows.every((row) => row.depth < 100)).toBe(true);
  });
});
