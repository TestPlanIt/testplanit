// Unit-lane proof for requirementCoverage's pure classification function
// (COV-01's precedence ladder). No database, no mocks — the function this
// suite targets takes a plain count tuple and returns a status, so it
// needs neither a $queryRaw stub nor a live connection. The rollup query
// itself (the recursive CTE that produces those counts) can only be
// proven against a live database — see
// requirement-coverage-rollup.integration.test.ts for that half.
//
// Run via:
//   cd testplanit && pnpm exec vitest run lib/services/requirementCoverage.test.ts

import { describe, expect, it } from "vitest";

import { classifyRequirementCoverage } from "./requirementCoverage";

describe("requirementCoverage classification (COV-01, pure)", () => {
  it("returns UNCOVERED when a requirement has no covering cases", () => {
    expect(
      classifyRequirementCoverage({
        linkedCaseCount: 0,
        crossProjectCaseCount: 0,
        passed: 0,
        failed: 0,
        inProgress: 0,
        notRun: 0,
      })
    ).toBe("UNCOVERED");
  });

  it("returns FAILED when any covering case's latest result failed, even when others passed", () => {
    // Two covering cases, one failed and one passed — a fifty-percent pass
    // rate must still classify as FAILED, proving failure precedence is
    // not a majority vote.
    expect(
      classifyRequirementCoverage({
        linkedCaseCount: 2,
        crossProjectCaseCount: 0,
        passed: 1,
        failed: 1,
        inProgress: 0,
        notRun: 0,
      })
    ).toBe("FAILED");
  });

  it("returns PASSED only when every covering case's latest result passed", () => {
    expect(
      classifyRequirementCoverage({
        linkedCaseCount: 3,
        crossProjectCaseCount: 0,
        passed: 3,
        failed: 0,
        inProgress: 0,
        notRun: 0,
      })
    ).toBe("PASSED");

    // Passed-plus-anything-else does not reach PASSED.
    expect(
      classifyRequirementCoverage({
        linkedCaseCount: 3,
        crossProjectCaseCount: 0,
        passed: 2,
        failed: 0,
        inProgress: 1,
        notRun: 0,
      })
    ).not.toBe("PASSED");
  });

  it("returns NOT_RUN when cases are linked but none failed and not all passed", () => {
    // In-progress-only.
    expect(
      classifyRequirementCoverage({
        linkedCaseCount: 1,
        crossProjectCaseCount: 0,
        passed: 0,
        failed: 0,
        inProgress: 1,
        notRun: 0,
      })
    ).toBe("NOT_RUN");

    // Not-run-only.
    expect(
      classifyRequirementCoverage({
        linkedCaseCount: 1,
        crossProjectCaseCount: 0,
        passed: 0,
        failed: 0,
        inProgress: 0,
        notRun: 1,
      })
    ).toBe("NOT_RUN");

    // Mixed pass-and-neutral: passed-plus-in-progress must NOT read as
    // PASSED.
    expect(
      classifyRequirementCoverage({
        linkedCaseCount: 2,
        crossProjectCaseCount: 0,
        passed: 1,
        failed: 0,
        inProgress: 1,
        notRun: 0,
      })
    ).toBe("NOT_RUN");
  });
});

// Test inventory scaffold for the covering-cases latest-result extension
// (COV-01/COV-02, criterion 5). Titles only — converted by 26-03.
describe("requirementCoverage (Phase 26 drill-down extension)", () => {
  it.todo(
    "getRequirementCoveringCases returns each case's latest result status and execution time"
  );
  it.todo(
    "getRequirementCoveringCases returns a null status for a case with no execution"
  );
  it.todo("the closure builder is untouched by the drill-down result extension");
});
