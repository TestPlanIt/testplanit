import { describe, expect, it, vi } from "vitest";

import {
  invalidateRequirementCoveringCases,
  isRequirementCoveringCasesQueryKey,
} from "./useRequirementCoveringCases";

describe("isRequirementCoveringCasesQueryKey", () => {
  it("matches this hook's own key for the given project and requirement", () => {
    expect(
      isRequirementCoveringCasesQueryKey(
        ["requirementCoveringCases", 7, 42],
        7,
        42
      )
    ).toBe(true);
  });

  it("matches any requirement under the project when requirementId is omitted", () => {
    expect(
      isRequirementCoveringCasesQueryKey(
        ["requirementCoveringCases", 7, 42],
        7
      )
    ).toBe(true);
    expect(
      isRequirementCoveringCasesQueryKey(
        ["requirementCoveringCases", 7, 99],
        7
      )
    ).toBe(true);
  });

  it("rejects a different project's key even with the same requirementId", () => {
    expect(
      isRequirementCoveringCasesQueryKey(
        ["requirementCoveringCases", 9, 42],
        7,
        42
      )
    ).toBe(false);
  });

  it("rejects a different requirementId within the same project", () => {
    expect(
      isRequirementCoveringCasesQueryKey(
        ["requirementCoveringCases", 7, 99],
        7,
        42
      )
    ).toBe(false);
  });

  // The inverse of useRequirementCoverage.test.ts's own discrimination
  // check -- both literal root strings share a 16-character prefix
  // ("requirementCover"), so a loosely-written predicate on either hook
  // could accidentally match the other's key.
  it("does not match useRequirementCoverage's key despite the shared string prefix", () => {
    expect(
      isRequirementCoveringCasesQueryKey(["requirementCoverage", 7], 7)
    ).toBe(false);
  });

  it("rejects a non-array query key", () => {
    expect(
      isRequirementCoveringCasesQueryKey(
        "requirementCoveringCases" as unknown as readonly unknown[],
        7,
        42
      )
    ).toBe(false);
  });
});

describe("invalidateRequirementCoveringCases", () => {
  it("invalidates using a predicate built from isRequirementCoveringCasesQueryKey", () => {
    const invalidateQueries = vi.fn();
    const queryClient = { invalidateQueries } as any;

    invalidateRequirementCoveringCases(queryClient, 7, 42);

    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    const { predicate } = invalidateQueries.mock.calls[0][0];
    expect(typeof predicate).toBe("function");

    // Matches this requirement's drill-down query...
    expect(
      predicate({ queryKey: ["requirementCoveringCases", 7, 42] })
    ).toBe(true);
    // ...but not a different requirement's drill-down query...
    expect(
      predicate({ queryKey: ["requirementCoveringCases", 7, 99] })
    ).toBe(false);
    // ...and not the sibling rollup query.
    expect(predicate({ queryKey: ["requirementCoverage", 7] })).toBe(false);
  });

  it("omits requirementId to invalidate every open drill-down for the project", () => {
    const invalidateQueries = vi.fn();
    const queryClient = { invalidateQueries } as any;

    invalidateRequirementCoveringCases(queryClient, 7);

    const { predicate } = invalidateQueries.mock.calls[0][0];
    expect(
      predicate({ queryKey: ["requirementCoveringCases", 7, 42] })
    ).toBe(true);
    expect(
      predicate({ queryKey: ["requirementCoveringCases", 7, 99] })
    ).toBe(true);
    expect(
      predicate({ queryKey: ["requirementCoveringCases", 9, 42] })
    ).toBe(false);
  });
});
