import { describe, expect, it } from "vitest";

import { computeObjectDiff } from "./diff";

/**
 * generic Object diff for outbound `*.updated` events.
 *
 * The helper is used uniformly at the payload layer; Slack formatters
 * drill into the {before, after} maps as needed for rich block rendering.
 * These tests lock the contract that downstream formatters depend on.
 */
describe("computeObjectDiff", () => {
  it("detects primitive value changes and reports the changed key only", () => {
    expect(computeObjectDiff({ a: 1, b: 2 }, { a: 1, b: 3 })).toEqual({
      changedFields: ["b"],
      before: { b: 2 },
      after: { b: 3 },
    });
  });

  it("returns empty changedFields when nothing changed", () => {
    expect(computeObjectDiff({ a: 1 }, { a: 1 })).toEqual({
      changedFields: [],
      before: {},
      after: {},
    });
  });

  it("reports key removed (before has it, after does not) with after.value=undefined", () => {
    expect(computeObjectDiff({ a: 1, b: 2 }, { a: 1 })).toEqual({
      changedFields: ["b"],
      before: { b: 2 },
      after: { b: undefined },
    });
  });

  it("reports key added (after has it, before does not) with before.value=undefined", () => {
    expect(computeObjectDiff({ a: 1 }, { a: 1, b: 2 })).toEqual({
      changedFields: ["b"],
      before: { b: undefined },
      after: { b: 2 },
    });
  });

  it("treats array reorder as unchanged", () => {
    expect(
      computeObjectDiff({ tags: ["a", "b"] }, { tags: ["b", "a"] })
    ).toEqual({
      changedFields: [],
      before: {},
      after: {},
    });
  });

  it("detects array content change", () => {
    expect(
      computeObjectDiff({ tags: ["a", "b"] }, { tags: ["a", "c"] })
    ).toEqual({
      changedFields: ["tags"],
      before: { tags: ["a", "b"] },
      after: { tags: ["a", "c"] },
    });
  });

  it("treats nested objects as a single top-level change (changedFields lists the top-level key only)", () => {
    expect(
      computeObjectDiff({ nested: { x: 1, y: 2 } }, { nested: { x: 1, y: 3 } })
    ).toEqual({
      changedFields: ["nested"],
      before: { nested: { x: 1, y: 2 } },
      after: { nested: { x: 1, y: 3 } },
    });
  });

  it("treats null → value as a change", () => {
    expect(computeObjectDiff({ a: null }, { a: 1 })).toEqual({
      changedFields: ["a"],
      before: { a: null },
      after: { a: 1 },
    });
  });

  it("treats undefined → value as a change", () => {
    expect(computeObjectDiff({ a: undefined }, { a: 1 })).toEqual({
      changedFields: ["a"],
      before: { a: undefined },
      after: { a: 1 },
    });
  });

  it("treats Date instances with the same getTime() as unchanged", () => {
    expect(computeObjectDiff({ d: new Date(0) }, { d: new Date(0) })).toEqual({
      changedFields: [],
      before: {},
      after: {},
    });
  });

  it("treats Date instances with different getTime() as changed", () => {
    const before = new Date(0);
    const after = new Date(1000);
    expect(computeObjectDiff({ d: before }, { d: after })).toEqual({
      changedFields: ["d"],
      before: { d: before },
      after: { d: after },
    });
  });

  it("handles undefined/null inputs by treating them as empty objects", () => {
    expect(computeObjectDiff(undefined, { a: 1 })).toEqual({
      changedFields: ["a"],
      before: { a: undefined },
      after: { a: 1 },
    });
    expect(computeObjectDiff(null, { a: 1 })).toEqual({
      changedFields: ["a"],
      before: { a: undefined },
      after: { a: 1 },
    });
    expect(computeObjectDiff({ a: 1 }, undefined)).toEqual({
      changedFields: ["a"],
      before: { a: 1 },
      after: { a: undefined },
    });
  });

  it("documents NaN behavior — JSON.stringify renders NaN as null so two NaN values are treated as equal (acceptable for the generic helper; emitter sites avoid passing NaN)", () => {
    expect(computeObjectDiff({ a: NaN }, { a: NaN })).toEqual({
      changedFields: [],
      before: {},
      after: {},
    });
  });
});
