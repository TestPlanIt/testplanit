import { describe, expect, it } from "vitest";
import {
  parseExecutionScopeBody,
  parseExecutionScopeQuery,
  sameExecutionScope,
  toExecutionScope,
} from "./executionScopeParam";

describe("toExecutionScope", () => {
  it("returns undefined when neither axis is active", () => {
    expect(toExecutionScope({})).toBeUndefined();
    expect(
      toExecutionScope({ milestoneIds: [], configIds: [] })
    ).toBeUndefined();
    expect(
      toExecutionScope({ milestoneIds: null, configIds: null })
    ).toBeUndefined();
  });

  it("keeps the shape when at least one axis is active", () => {
    // The inactive axis rides along as-is ([]); every consumer treats an
    // empty list as inactive, so normalizing it away here would buy nothing.
    expect(toExecutionScope({ milestoneIds: [3], configIds: [] })).toEqual({
      milestoneIds: [3],
      configIds: [],
    });
  });
});

describe("parseExecutionScopeBody", () => {
  it("treats absent and null as inactive", () => {
    expect(parseExecutionScopeBody(undefined, null)).toEqual({
      ok: true,
      scope: undefined,
    });
  });

  it("parses both axes", () => {
    expect(parseExecutionScopeBody([1, 2], [3])).toEqual({
      ok: true,
      scope: { milestoneIds: [1, 2], configIds: [3] },
    });
  });

  it.each([
    ["a string", "1,2"],
    ["a non-integer entry", [1.5]],
    ["a zero id", [0]],
    ["a negative id", [-4]],
  ])("rejects %s", (_label, raw) => {
    expect(parseExecutionScopeBody(raw, undefined)).toEqual({ ok: false });
    expect(parseExecutionScopeBody(undefined, raw)).toEqual({ ok: false });
  });

  it("rejects an axis past the cap", () => {
    const tooMany = Array.from({ length: 201 }, (_, index) => index + 1);
    expect(parseExecutionScopeBody(tooMany, undefined)).toEqual({ ok: false });
  });
});

describe("parseExecutionScopeQuery", () => {
  it("treats a missing key as inactive", () => {
    expect(parseExecutionScopeQuery(new URLSearchParams())).toEqual({
      ok: true,
      scope: undefined,
    });
  });

  it("parses comma-separated ids", () => {
    expect(
      parseExecutionScopeQuery(
        new URLSearchParams("milestoneIds=1,2&configIds=9")
      )
    ).toEqual({ ok: true, scope: { milestoneIds: [1, 2], configIds: [9] } });
  });

  it("rejects a malformed value instead of silently ignoring it", () => {
    expect(
      parseExecutionScopeQuery(new URLSearchParams("milestoneIds=1,x"))
    ).toEqual({ ok: false });
  });

  it("treats an empty value as inactive", () => {
    // `?milestoneIds=` — every part filters out, same as an empty array.
    expect(
      parseExecutionScopeQuery(new URLSearchParams("milestoneIds="))
    ).toEqual({ ok: true, scope: undefined });
  });
});

describe("sameExecutionScope", () => {
  const frame = (m: number[], c: number[]) => ({
    scopeMilestoneIds: m,
    scopeConfigIds: c,
  });

  it("is order-insensitive within an axis", () => {
    expect(sameExecutionScope(frame([2, 1], [5]), frame([1, 2], [5]))).toBe(
      true
    );
  });

  it("distinguishes the two axes", () => {
    expect(sameExecutionScope(frame([1], []), frame([], [1]))).toBe(false);
  });

  it("treats two unscoped frames as equal", () => {
    expect(sameExecutionScope(frame([], []), frame([], []))).toBe(true);
  });
});
