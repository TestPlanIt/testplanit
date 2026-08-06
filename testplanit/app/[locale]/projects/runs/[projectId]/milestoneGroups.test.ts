/**
 * Milestone-group collapse bookkeeping.
 *
 * Both functions recurse over the milestone tree, and both have to agree with
 * what the renderer actually draws: a group renders when it has runs at or
 * below itself. If collectRenderedMilestoneKeys drifts from that rule,
 * Collapse-all silently misses groups (or reports "all collapsed" when a
 * visible group is still open); if countRunsInSubtree drifts, a collapsed
 * header under-reports what it hid.
 */

import { describe, expect, it } from "vitest";
import {
  collapsedStorageKey,
  collectRenderedMilestoneKeys,
  countRunsInSubtree,
  parseStoredCollapsedGroups,
  UNSCHEDULED_GROUP_KEY,
} from "./milestoneGroups";

/** Mirrors GroupedTestRuns.milestones: id -> { testRuns }, counts only. */
const groupsWith = (counts: Record<number, number>) => ({
  milestones: Object.fromEntries(
    Object.entries(counts).map(([id, n]) => [
      id,
      { testRuns: Array.from({ length: n }, (_, i) => i) },
    ])
  ),
});

//  1 ─┬─ 2 ─── 4
//     └─ 3
const tree = {
  id: 1,
  children: [{ id: 2, children: [{ id: 4 }] }, { id: 3 }],
};

describe("countRunsInSubtree", () => {
  it("counts a leaf's own runs", () => {
    expect(countRunsInSubtree({ id: 3 }, groupsWith({ 3: 2 }))).toBe(2);
  });

  it("returns 0 for a milestone with no group entry", () => {
    expect(countRunsInSubtree({ id: 9 }, groupsWith({ 1: 5 }))).toBe(0);
  });

  it("sums the whole subtree, not just direct runs", () => {
    expect(
      countRunsInSubtree(tree, groupsWith({ 1: 1, 2: 2, 3: 3, 4: 4 }))
    ).toBe(10);
  });

  // The header count is the only signal of what a collapsed branch hides, so
  // an empty parent must still report its descendants.
  it("counts descendants of a parent that has no runs of its own", () => {
    expect(countRunsInSubtree(tree, groupsWith({ 4: 6 }))).toBe(6);
  });

  it("ignores runs belonging to milestones outside the subtree", () => {
    expect(
      countRunsInSubtree({ id: 2, children: [] }, groupsWith({ 1: 9, 2: 1 }))
    ).toBe(1);
  });
});

describe("collectRenderedMilestoneKeys", () => {
  it("returns nothing for a branch with no runs anywhere", () => {
    expect(collectRenderedMilestoneKeys(tree, groupsWith({}))).toEqual([]);
  });

  it("returns the milestone when it has its own runs", () => {
    expect(
      collectRenderedMilestoneKeys({ id: 3 }, groupsWith({ 3: 1 }))
    ).toEqual(["3"]);
  });

  // The renderer draws an ancestor whose descendant has runs, so its chevron
  // exists and Collapse-all has to reach it.
  it("includes ancestors that only qualify through a descendant", () => {
    expect(collectRenderedMilestoneKeys(tree, groupsWith({ 4: 1 }))).toEqual([
      "1",
      "2",
      "4",
    ]);
  });

  it("omits sibling branches that have no runs", () => {
    const keys = collectRenderedMilestoneKeys(tree, groupsWith({ 3: 1 }));
    expect(keys).toEqual(["1", "3"]);
    expect(keys).not.toContain("2");
  });

  it("lists every rendered group in a fully populated tree", () => {
    expect(
      collectRenderedMilestoneKeys(tree, groupsWith({ 1: 1, 2: 1, 3: 1, 4: 1 }))
    ).toEqual(["1", "2", "4", "3"]);
  });

  it("returns string keys, matching the collapse set", () => {
    expect(
      collectRenderedMilestoneKeys({ id: 5 }, groupsWith({ 5: 1 }))
    ).toEqual(["5"]);
  });
});

describe("parseStoredCollapsedGroups", () => {
  it("starts fully expanded when nothing is stored", () => {
    expect(parseStoredCollapsedGroups(null).size).toBe(0);
  });

  it("restores stored keys", () => {
    const restored = parseStoredCollapsedGroups(
      JSON.stringify(["1", "4", UNSCHEDULED_GROUP_KEY])
    );
    expect(restored).toEqual(new Set(["1", "4", "unscheduled"]));
  });

  // Older builds could have written numeric ids; the collapse set is keyed by
  // string, so a number must not silently stop matching.
  it("normalizes numeric ids to strings", () => {
    expect(parseStoredCollapsedGroups(JSON.stringify([1, 2]))).toEqual(
      new Set(["1", "2"])
    );
  });

  it("starts fully expanded on unparseable or non-array payloads", () => {
    expect(parseStoredCollapsedGroups("{not json").size).toBe(0);
    expect(parseStoredCollapsedGroups(JSON.stringify({ a: 1 })).size).toBe(0);
  });
});

describe("collapsedStorageKey", () => {
  it("scopes the key to the project", () => {
    expect(collapsedStorageKey(7)).toBe("tpi.runs.7.collapsedMilestones");
    expect(collapsedStorageKey(7)).not.toBe(collapsedStorageKey(8));
  });

  // Same project, two independent preferences — one must not clobber the other.
  it("does not collide with the filter-chip key", () => {
    expect(collapsedStorageKey(7)).not.toBe("tpi.runs.7.filters");
  });
});
