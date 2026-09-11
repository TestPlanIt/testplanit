// The client half of the requirement coverage family's execution scope.
// Its whole reason to exist is that the browser's serializers and the
// server's parsers agree, so this suite imports BOTH sides and asserts the
// round trip rather than re-stating each module's shape twice.

import { describe, expect, it } from "vitest";

import {
  parseExecutionScopeBody,
  parseExecutionScopeQuery,
  toExecutionScope,
  MAX_EXECUTION_SCOPE_IDS,
} from "~/lib/services/executionScopeParam";

import {
  appendExecutionScopeParams,
  executionScopeBodyFields,
  executionScopeKey,
  isExecutionScopeSelectionActive,
  isSnapshotExecutionScoped,
  EMPTY_EXECUTION_SCOPE,
  type RequirementExecutionScopeSelection,
} from "./requirementExecutionScope";

const scope = (
  milestoneIds: number[],
  configIds: number[]
): RequirementExecutionScopeSelection => ({ milestoneIds, configIds });

describe("executionScopeKey", () => {
  it("is empty for an inactive selection, so an unscoped query key is unchanged", () => {
    expect(executionScopeKey(EMPTY_EXECUTION_SCOPE)).toBe("");
    expect(executionScopeKey(undefined)).toBe("");
    expect(executionScopeKey(null)).toBe("");
    expect(executionScopeKey(scope([], []))).toBe("");
  });

  it("is order-insensitive — the same ids clicked in any order share one cache entry", () => {
    expect(executionScopeKey(scope([9, 2, 40], [7, 3]))).toBe(
      executionScopeKey(scope([40, 9, 2], [3, 7]))
    );
    // Numeric, not lexicographic: 10 sorts after 9 on both axes.
    expect(executionScopeKey(scope([10, 9], []))).toBe("m:9,10|c:");
  });

  it("distinguishes the two axes — the same id on milestones vs configurations", () => {
    expect(executionScopeKey(scope([4], []))).not.toBe(
      executionScopeKey(scope([], [4]))
    );
    expect(executionScopeKey(scope([4], []))).toBe("m:4|c:");
    expect(executionScopeKey(scope([], [4]))).toBe("m:|c:4");
  });

  it("separates selections that would otherwise concatenate to the same string", () => {
    // Without the axis delimiter, {m:[1,2],c:[3]} and {m:[1],c:[2,3]} would
    // both read "1,2,3".
    expect(executionScopeKey(scope([1, 2], [3]))).not.toBe(
      executionScopeKey(scope([1], [2, 3]))
    );
  });

  it("does not mutate the caller's arrays while sorting", () => {
    const selection = scope([3, 1, 2], [9, 8]);
    executionScopeKey(selection);
    expect(selection.milestoneIds).toEqual([3, 1, 2]);
    expect(selection.configIds).toEqual([9, 8]);
  });
});

describe("isExecutionScopeSelectionActive", () => {
  it.each([
    [undefined, false],
    [null, false],
    [scope([], []), false],
    [scope([1], []), true],
    [scope([], [1]), true],
    [scope([1], [2]), true],
  ])("%j -> %s", (selection, expected) => {
    expect(
      isExecutionScopeSelectionActive(
        selection as RequirementExecutionScopeSelection | null | undefined
      )
    ).toBe(expected);
  });
});

describe("isSnapshotExecutionScoped", () => {
  it("reads an empty array as UNSCOPED on either axis", () => {
    expect(
      isSnapshotExecutionScoped({ scopeMilestoneIds: [], scopeConfigIds: [] })
    ).toBe(false);
  });

  it("reads a populated array as scoped on either axis alone", () => {
    expect(
      isSnapshotExecutionScoped({ scopeMilestoneIds: [9], scopeConfigIds: [] })
    ).toBe(true);
    expect(
      isSnapshotExecutionScoped({ scopeMilestoneIds: [], scopeConfigIds: [4] })
    ).toBe(true);
  });

  it("reads a missing or non-array column (a pre-scope row's raw JSON) as unscoped", () => {
    expect(isSnapshotExecutionScoped({})).toBe(false);
    expect(
      isSnapshotExecutionScoped({
        scopeMilestoneIds: null,
        scopeConfigIds: undefined,
      })
    ).toBe(false);
    expect(
      isSnapshotExecutionScoped({ scopeMilestoneIds: "9", scopeConfigIds: 4 })
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Round trips: client serializer -> server parser. These are the assertions
// that make the two modules one contract instead of two conventions.
// ---------------------------------------------------------------------------

describe("appendExecutionScopeParams round-trips through parseExecutionScopeQuery", () => {
  const roundTrip = (
    selection: RequirementExecutionScopeSelection | undefined | null
  ) => {
    const params = new URLSearchParams();
    appendExecutionScopeParams(params, selection);
    return { params, parsed: parseExecutionScopeQuery(params) };
  };

  it("carries both axes across the wire intact", () => {
    const { params, parsed } = roundTrip(scope([9, 2], [4]));
    expect(params.toString()).toBe("milestoneIds=9%2C2&configIds=4");
    expect(parsed).toEqual({
      ok: true,
      scope: { milestoneIds: [9, 2], configIds: [4] },
    });
  });

  it("omits an inactive axis entirely and the parser reads it back as undefined", () => {
    const { params, parsed } = roundTrip(scope([9], []));
    expect(params.has("configIds")).toBe(false);
    expect(parsed).toEqual({
      ok: true,
      scope: { milestoneIds: [9], configIds: undefined },
    });
  });

  it("writes nothing at all for an inactive selection, so the URL is byte-identical to the pre-scope one", () => {
    for (const selection of [EMPTY_EXECUTION_SCOPE, undefined, null]) {
      const { params, parsed } = roundTrip(selection);
      expect(params.toString()).toBe("");
      expect(parsed).toEqual({ ok: true, scope: undefined });
    }
  });

  it("leaves the caller's other query params untouched", () => {
    const params = new URLSearchParams({ projectId: "5" });
    appendExecutionScopeParams(params, scope([], [4]));
    expect(params.get("projectId")).toBe("5");
    expect(parseExecutionScopeQuery(params)).toEqual({
      ok: true,
      scope: { milestoneIds: undefined, configIds: [4] },
    });
  });

  it("round-trips a selection at the per-axis cap, and one past it is a 400", () => {
    const atCap = Array.from(
      { length: MAX_EXECUTION_SCOPE_IDS },
      (_, i) => i + 1
    );
    expect(roundTrip(scope(atCap, [])).parsed).toEqual({
      ok: true,
      scope: { milestoneIds: atCap, configIds: undefined },
    });

    const pastCap = [...atCap, MAX_EXECUTION_SCOPE_IDS + 1];
    expect(roundTrip(scope(pastCap, [])).parsed).toEqual({ ok: false });
  });
});

describe("executionScopeBodyFields round-trips through parseExecutionScopeBody", () => {
  const roundTrip = (
    selection: RequirementExecutionScopeSelection | undefined | null
  ) => {
    const body = executionScopeBodyFields(selection);
    return {
      body,
      parsed: parseExecutionScopeBody(body.milestoneIds, body.configIds),
    };
  };

  it("carries both axes as arrays", () => {
    const { body, parsed } = roundTrip(scope([9, 2], [4]));
    expect(body).toEqual({ milestoneIds: [9, 2], configIds: [4] });
    expect(parsed).toEqual({
      ok: true,
      scope: { milestoneIds: [9, 2], configIds: [4] },
    });
  });

  it("omits an inactive axis's key rather than sending an empty array", () => {
    const { body, parsed } = roundTrip(scope([], [4]));
    expect(body).toEqual({ configIds: [4] });
    expect("milestoneIds" in body).toBe(false);
    expect(parsed).toEqual({
      ok: true,
      scope: { milestoneIds: undefined, configIds: [4] },
    });
  });

  it("sends no keys at all for an inactive selection", () => {
    for (const selection of [EMPTY_EXECUTION_SCOPE, undefined, null]) {
      const { body, parsed } = roundTrip(selection);
      expect(body).toEqual({});
      expect(parsed).toEqual({ ok: true, scope: undefined });
    }
  });

  it("lands on the same scope the zod-validated body shape's fold produces", () => {
    // The two server-side entry points — the imperative parser and
    // `toExecutionScope` over a zod-parsed body — must agree on what the
    // client sent, or a route's scope depends on which one it happens to use.
    for (const selection of [
      scope([9, 2], [4]),
      scope([9], []),
      scope([], [4]),
      EMPTY_EXECUTION_SCOPE,
    ]) {
      const body = executionScopeBodyFields(selection);
      const imperative = parseExecutionScopeBody(
        body.milestoneIds,
        body.configIds
      );
      expect(imperative).toEqual({ ok: true, scope: toExecutionScope(body) });
    }
  });

  it("survives a JSON round trip (what an actual request body does)", () => {
    const body = JSON.parse(
      JSON.stringify(executionScopeBodyFields(scope([9, 2], [4])))
    );
    expect(parseExecutionScopeBody(body.milestoneIds, body.configIds)).toEqual({
      ok: true,
      scope: { milestoneIds: [9, 2], configIds: [4] },
    });
  });
});
