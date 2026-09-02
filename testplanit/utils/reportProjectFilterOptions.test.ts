import { describe, expect, it } from "vitest";

import {
  mergeSeenProjectOptions,
  withLatestProjectCounts,
} from "./reportProjectFilterOptions";

const A = { id: 1, name: "Apollo" };
const B = { id: 2, name: "Borealis" };
const C = { id: 3, name: "Cassini" };

describe("mergeSeenProjectOptions", () => {
  it("keeps a project the newest response no longer lists", () => {
    // Exactly the multi-select case: one project is picked, the response comes
    // back narrowed, and the others must still be there to be picked too.
    const seen = mergeSeenProjectOptions([], [A, B, C]);
    const afterPickingApollo = mergeSeenProjectOptions(seen, [A]);

    expect(afterPickingApollo.map((p) => p.id)).toEqual([1, 2, 3]);
  });

  it("adds newly-seen projects at the end", () => {
    const merged = mergeSeenProjectOptions([A, B], [C]);
    expect(merged.map((p) => p.id)).toEqual([1, 2, 3]);
  });

  it("returns the same array when nothing is new", () => {
    const seen = [A, B];
    expect(mergeSeenProjectOptions(seen, [A, B])).toBe(seen);
    expect(mergeSeenProjectOptions(seen, [])).toBe(seen);
    expect(mergeSeenProjectOptions(seen, undefined)).toBe(seen);
    expect(mergeSeenProjectOptions(seen, null)).toBe(seen);
  });

  it("ignores malformed entries", () => {
    const merged = mergeSeenProjectOptions(
      [],
      [A, null, { id: "x", name: "no" }, { id: 9 }, B]
    );
    expect(merged.map((p) => p.id)).toEqual([1, 2]);
  });
});

describe("withLatestProjectCounts", () => {
  it("takes counts from the newest response", () => {
    const options = withLatestProjectCounts(
      [A, B],
      [
        { id: 1, count: 12 },
        { id: 2, count: 4 },
      ]
    );
    expect(options).toEqual([
      { id: 1, name: "Apollo", count: 12 },
      { id: 2, name: "Borealis", count: 4 },
    ]);
  });

  it("shows zero for a project the current filters exclude", () => {
    const options = withLatestProjectCounts([A, B], [{ id: 1, count: 12 }]);
    expect(options[1]).toEqual({ id: 2, name: "Borealis", count: 0 });
  });

  it("survives a missing or malformed response", () => {
    expect(withLatestProjectCounts([A], undefined)).toEqual([
      { id: 1, name: "Apollo", count: 0 },
    ]);
    expect(withLatestProjectCounts([A], [{ id: 1 }])).toEqual([
      { id: 1, name: "Apollo", count: 0 },
    ]);
  });
});
