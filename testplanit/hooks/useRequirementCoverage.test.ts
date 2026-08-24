import { describe, expect, it, vi } from "vitest";

import {
  invalidateRequirementCoverage,
  isRequirementCoverageQueryKey,
} from "./useRequirementCoverage";

describe("isRequirementCoverageQueryKey", () => {
  it("matches this hook's own key for the given project", () => {
    expect(isRequirementCoverageQueryKey(["requirementCoverage", 7], 7)).toBe(
      true
    );
  });

  it("rejects the same key shape for a different project", () => {
    expect(isRequirementCoverageQueryKey(["requirementCoverage", 7], 9)).toBe(
      false
    );
  });

  // F5's whole failure mode was a key that LOOKS like it should match but
  // doesn't -- guard against the inverse mistake here: a predicate written
  // loosely enough (e.g. a `.startsWith`/`.includes` string check) to also
  // catch `useRequirementCoveringCases`' key, which shares a 16-character
  // literal prefix ("requirementCover") with this hook's own root string.
  it("does not match useRequirementCoveringCases' key despite the shared string prefix", () => {
    expect(
      isRequirementCoverageQueryKey(["requirementCoveringCases", 7, 42], 7)
    ).toBe(false);
  });

  it("does not match an unrelated query key", () => {
    expect(isRequirementCoverageQueryKey(["milestoneSummary", 7], 7)).toBe(
      false
    );
    expect(
      isRequirementCoverageQueryKey(["zenstack", "Issue", "findMany", {}], 7)
    ).toBe(false);
  });

  it("rejects a non-array query key", () => {
    expect(
      isRequirementCoverageQueryKey(
        "requirementCoverage" as unknown as readonly unknown[],
        7
      )
    ).toBe(false);
  });
});

describe("invalidateRequirementCoverage", () => {
  it("invalidates using a predicate built from isRequirementCoverageQueryKey", () => {
    const invalidateQueries = vi.fn();
    const queryClient = { invalidateQueries } as any;

    invalidateRequirementCoverage(queryClient, 7);

    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    const { predicate } = invalidateQueries.mock.calls[0][0];
    expect(typeof predicate).toBe("function");

    // Matches this project's coverage query...
    expect(predicate({ queryKey: ["requirementCoverage", 7] })).toBe(true);
    // ...but not a different project's coverage query...
    expect(predicate({ queryKey: ["requirementCoverage", 9] })).toBe(false);
    // ...and not the sibling covering-cases query.
    expect(predicate({ queryKey: ["requirementCoveringCases", 7, 42] })).toBe(
      false
    );
  });
});
