/**
 * Session-shaped milestone-group collapse bookkeeping.
 *
 * Both functions have to agree with what the renderer actually draws: a group
 * renders when it has sessions at or below itself. If
 * collectRenderedMilestoneKeys drifts from that rule, Collapse-all silently
 * misses groups; if countSessionsInSubtree drifts, a collapsed header
 * under-reports what it hid.
 */

import { describe, expect, it } from "vitest";
import {
  buildSessionListRows,
  collapsedStorageKey,
  collectRenderedMilestoneKeys,
  countSessionsInSubtree,
  parseStoredCollapsedGroups,
  UNSCHEDULED_GROUP_KEY,
} from "./milestoneGroups";

/** Mirrors GroupedSessions.milestones: id -> { testSessions }, counts only. */
const groupsWith = (counts: Record<number, number>) => ({
  milestones: Object.fromEntries(
    Object.entries(counts).map(([id, n]) => [
      id,
      { testSessions: Array.from({ length: n }, (_, i) => i) },
    ])
  ),
});

//  1 ─┬─ 2 ─── 4
//     └─ 3
const tree = {
  id: 1,
  children: [{ id: 2, children: [{ id: 4 }] }, { id: 3 }],
};

describe("countSessionsInSubtree", () => {
  it("counts a leaf's own sessions", () => {
    expect(countSessionsInSubtree({ id: 3 }, groupsWith({ 3: 2 }))).toBe(2);
  });

  it("returns 0 for a milestone with no group entry", () => {
    expect(countSessionsInSubtree({ id: 9 }, groupsWith({ 1: 5 }))).toBe(0);
  });

  it("sums the whole subtree, not just direct sessions", () => {
    expect(
      countSessionsInSubtree(tree, groupsWith({ 1: 1, 2: 2, 3: 3, 4: 4 }))
    ).toBe(10);
  });

  // The header count is the only signal of what a collapsed branch hides, so
  // an empty parent must still report its descendants.
  it("counts descendants of a parent that has no sessions of its own", () => {
    expect(countSessionsInSubtree(tree, groupsWith({ 4: 6 }))).toBe(6);
  });
});

describe("collectRenderedMilestoneKeys", () => {
  it("returns nothing for a branch with no sessions anywhere", () => {
    expect(collectRenderedMilestoneKeys(tree, groupsWith({}))).toEqual([]);
  });

  // The renderer draws an ancestor whose descendant has sessions, so its
  // chevron exists and Collapse-all has to reach it.
  it("includes ancestors that only qualify through a descendant", () => {
    expect(collectRenderedMilestoneKeys(tree, groupsWith({ 4: 1 }))).toEqual([
      "1",
      "2",
      "4",
    ]);
  });

  it("omits sibling branches that have no sessions", () => {
    const keys = collectRenderedMilestoneKeys(tree, groupsWith({ 3: 1 }));
    expect(keys).toEqual(["1", "3"]);
    expect(keys).not.toContain("2");
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
    expect(
      parseStoredCollapsedGroups(
        JSON.stringify(["1", "4", UNSCHEDULED_GROUP_KEY])
      )
    ).toEqual(new Set(["1", "4", "unscheduled"]));
  });

  it("starts fully expanded on unparseable or non-array payloads", () => {
    expect(parseStoredCollapsedGroups("{not json").size).toBe(0);
    expect(parseStoredCollapsedGroups(JSON.stringify({ a: 1 })).size).toBe(0);
  });
});

describe("collapsedStorageKey", () => {
  it("scopes the key to the project", () => {
    expect(collapsedStorageKey(7)).toBe("tpi.sessions.7.collapsedMilestones");
    expect(collapsedStorageKey(7)).not.toBe(collapsedStorageKey(8));
  });

  // Same project, two independent preferences — one must not clobber the
  // other, and the run list's groups must not follow the session list's.
  it("does not collide with the summary or run-list keys", () => {
    expect(collapsedStorageKey(7)).not.toBe("tpi.sessions.7.summaryCollapsed");
    expect(collapsedStorageKey(7)).not.toBe("tpi.runs.7.collapsedMilestones");
  });
});

// The flattening itself is covered in the runs binding's tests; what is
// session-specific is which field the group map is read from.
describe("buildSessionListRows", () => {
  it("reads each milestone's sessions, not its runs", () => {
    const rows = buildSessionListRows<{ id: number }, { id: number }>({
      unscheduled: [],
      grouped: { milestones: { 5: { testSessions: [{ id: 50 }] } } },
      tree: [{ id: 5 }],
      collapsedGroups: new Set<string>(),
      showUnscheduledHeader: true,
      getSessionId: (session) => session.id,
    });

    expect(rows.map((row) => row.kind)).toEqual(["milestone-header", "item"]);
    expect(rows[1]).toMatchObject({ item: { id: 50 }, depth: 1 });
  });
});
