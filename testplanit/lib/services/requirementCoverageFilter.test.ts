import { describe, expect, it } from "vitest";

import type { RequirementCoverageBreakdown } from "~/lib/services/requirementCoverage";

import {
  matchesRequirementCoverageFilter,
  matchesRequirementCoverageFilters,
} from "./requirementCoverageFilter";

// Established fixture shape for RequirementCoverageBreakdown, shared with
// requirementsListRows.test.ts's identical factory -- the assertions below
// are copied from that file's own `matchesRequirementCoverageFilter` suite
// verbatim, proving this standalone module behaves identically to the
// pre-extraction implementation, not just that the re-export still works.
function makeBreakdown(
  overrides: Partial<RequirementCoverageBreakdown> = {}
): RequirementCoverageBreakdown {
  return {
    linkedCaseCount: 0,
    crossProjectCaseCount: 0,
    directCaseCount: 0,
    directCrossProjectCaseCount: 0,
    passed: 0,
    failed: 0,
    inProgress: 0,
    notRun: 0,
    statuses: [],
    untested: 0,
    uncovered: true,
    status: "UNCOVERED",
    ...overrides,
  };
}

describe("matchesRequirementCoverageFilters (multi-select)", () => {
  it("treats an empty selection as the inactive axis", () => {
    expect(matchesRequirementCoverageFilters([], undefined)).toBe(true);
    expect(matchesRequirementCoverageFilters([], makeBreakdown())).toBe(true);
  });

  it("unions its selections -- a breakdown matching ANY of them matches", () => {
    const untested = makeBreakdown({ uncovered: false, untested: 2 });
    expect(
      matchesRequirementCoverageFilters(["UNCOVERED", "UNTESTED"], untested)
    ).toBe(true);
  });

  it("still excludes a breakdown matching NONE of the selections", () => {
    const passedOnly = makeBreakdown({
      uncovered: false,
      untested: 0,
      statuses: [{ statusId: 5, name: "Passed", color: null, count: 1 }],
    });
    expect(
      matchesRequirementCoverageFilters(["UNCOVERED", "UNTESTED"], passedOnly)
    ).toBe(false);
  });
});

describe("matchesRequirementCoverageFilter", () => {
  it("the empty filter matches everything, including an absent breakdown", () => {
    expect(matchesRequirementCoverageFilter("", undefined)).toBe(true);
    expect(matchesRequirementCoverageFilter("", makeBreakdown())).toBe(true);
  });

  it("an absent breakdown matches only UNCOVERED, mirroring the comparator", () => {
    expect(matchesRequirementCoverageFilter("UNCOVERED", undefined)).toBe(true);
    expect(matchesRequirementCoverageFilter("UNTESTED", undefined)).toBe(false);
    expect(matchesRequirementCoverageFilter("status:1", undefined)).toBe(false);
  });

  it("UNTESTED matches only when untested > 0", () => {
    expect(
      matchesRequirementCoverageFilter(
        "UNTESTED",
        makeBreakdown({ untested: 0 })
      )
    ).toBe(false);
    expect(
      matchesRequirementCoverageFilter(
        "UNTESTED",
        makeBreakdown({ untested: 2 })
      )
    ).toBe(true);
  });

  it("status:<id> matches only a non-zero count for that status id", () => {
    const breakdown = makeBreakdown({
      statuses: [{ statusId: 5, name: "Passed", color: null, count: 3 }],
    });
    expect(matchesRequirementCoverageFilter("status:5", breakdown)).toBe(true);
    expect(matchesRequirementCoverageFilter("status:6", breakdown)).toBe(false);
  });
});
