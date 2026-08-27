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

import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { ISSUE_ROLE_SCOPE_COLUMN } from "./issueRoleScope";
import {
  classifyRequirementCoverage,
  getRequirementCoveringCases,
} from "./requirementCoverage";

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

// requirementCoverage (Phase 26 drill-down extension, COV-04). Mocked-client
// proof for getRequirementCoveringCases's latest-result columns, plus a
// source-text guard on the closure builder it deliberately does not touch.
// The rollup/drill-down count-AGREEMENT guarantee (that this extension does
// not change WHICH cases are returned) can only be proven against real
// Postgres recursion — see requirement-covering-cases-status.integration.test.ts.
describe("requirementCoverage (Phase 26 drill-down extension)", () => {
  // getRequirementCoveringCases runs its statement via Kysely
  // sql`...`.execute(db.$qb), the same seam matrixCellCount.test.ts's
  // runCellCountPreflight suite mocks: qbRows yields the one query's rows
  // array, and the $qb executor wraps it in the { rows } shape the service
  // reads.
  let qbRows: ReturnType<typeof vi.fn>;
  let mockDb: {
    $qb: { getExecutor: () => Record<string, unknown> };
  };

  function makeMockDb() {
    qbRows = vi.fn();
    return {
      $qb: {
        getExecutor: () => ({
          transformQuery: (n: unknown) => n,
          compileQuery: (n: unknown) => n,
          executeQuery: async () => ({
            rows: await (qbRows as () => unknown)(),
          }),
        }),
      },
    };
  }

  it("getRequirementCoveringCases returns each case's latest result status and execution time", async () => {
    mockDb = makeMockDb();
    const executedAt = new Date("2026-08-01T12:00:00.000Z");
    qbRows.mockResolvedValueOnce([
      {
        ancestor_id: 10,
        case_id: 100,
        case_name: "Case With Result",
        case_project_id: 1,
        project_name: "Project One",
        status_name: "Passed",
        status_color: "#22c55e",
        is_success: true,
        is_failure: false,
        executed_at: executedAt,
        test_run_id: 55,
      },
    ]);

    const covering = await getRequirementCoveringCases(
      1,
      [10],
      { accessibleProjectIds: null },
      mockDb as never
    );

    const entries = covering.get(10) ?? [];
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      caseId: 100,
      caseName: "Case With Result",
      projectId: 1,
      projectName: "Project One",
      lastStatusName: "Passed",
      lastStatusColor: "#22c55e",
      lastStatusIsSuccess: true,
      lastStatusIsFailure: false,
      lastExecutedAt: executedAt.toISOString(),
      // Carried through so the panel can link this status back to the run it
      // was recorded against.
      lastTestRunId: 55,
    });
  });

  it("getRequirementCoveringCases returns a null status for a case with no execution", async () => {
    mockDb = makeMockDb();
    qbRows.mockResolvedValueOnce([
      {
        ancestor_id: 10,
        case_id: 101,
        case_name: "Case Never Executed",
        case_project_id: 1,
        project_name: "Project One",
        status_name: null,
        status_color: null,
        is_success: null,
        is_failure: null,
        executed_at: null,
        test_run_id: null,
      },
    ]);

    const covering = await getRequirementCoveringCases(
      1,
      [10],
      { accessibleProjectIds: null },
      mockDb as never
    );

    // Present, not dropped — the whole point of the null-status contract.
    const entries = covering.get(10) ?? [];
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      caseId: 101,
      caseName: "Case Never Executed",
      projectId: 1,
      projectName: "Project One",
      lastStatusName: null,
      lastStatusColor: null,
      lastStatusIsSuccess: null,
      lastStatusIsFailure: null,
      lastExecutedAt: null,
      // No execution means no run to link to — null here, never a stray id.
      lastTestRunId: null,
    });
  });

  it("the closure builder is untouched by the drill-down result extension", () => {
    // Raw source-text assertion, deliberately not stripped of comments —
    // this is the one gate in Phase 26 that must predict what the shipped
    // git-grep-based containment gate (issueRoleScope.containment.test.ts)
    // will see, and that gate greps raw text.
    const content = readFileSync("lib/services/requirementCoverage.ts", "utf8");

    const unionAllCount = content.split("UNION ALL").length - 1;
    expect(
      unionAllCount,
      `expected exactly one UNION ALL in requirementCoverage.ts, found ${unionAllCount}`
    ).toBe(1);

    const roleColumnCount = content.split(ISSUE_ROLE_SCOPE_COLUMN).length - 1;
    expect(
      roleColumnCount,
      `expected exactly one occurrence of the role predicate constant ` +
        `(${ISSUE_ROLE_SCOPE_COLUMN}), found ${roleColumnCount}`
    ).toBe(1);

    // Anchored on unique, floor-safe tokens rather than a fixed-width
    // character window — 24-01/24-03/25-12/25-16 all shipped
    // window-anchored scripts that mis-reported.
    const closureStart = content.indexOf("function buildClosureFragment");
    const closureEnd = content.indexOf(
      "/** Row shape returned by the rollup statement",
      closureStart
    );
    expect(closureStart, "buildClosureFragment not found").toBeGreaterThan(-1);
    expect(
      closureEnd,
      "end-of-closure-builder anchor not found after buildClosureFragment"
    ).toBeGreaterThan(closureStart);

    const closureBody = content.slice(closureStart, closureEnd);
    expect(closureBody).toContain('"projectId"');
    expect(closureBody).toContain('"isDeleted"');
    expect(closureBody).toContain("depth < 100");
  });

  it("the status rollup inherits the already-gated covering-case set instead of re-reading RepositoryCases (T-26.2G-07-01)", () => {
    // Disclosure invariant in structural form: status_rollup must draw its
    // rows FROM covering_cases -- which is already visibility-gated -- and
    // must never itself open a fresh join to "RepositoryCases", which
    // would let a project outside the viewer's scope leak status names.
    const content = readFileSync("lib/services/requirementCoverage.ts", "utf8");

    const statusRollupStart = content.indexOf("status_rollup AS (");
    const statusRollupEnd = content.indexOf(
      "statuses_agg AS (",
      statusRollupStart
    );
    expect(statusRollupStart, "status_rollup AS ( not found").toBeGreaterThan(
      -1
    );
    expect(
      statusRollupEnd,
      "statuses_agg AS ( not found after status_rollup"
    ).toBeGreaterThan(statusRollupStart);

    const statusRollupBody = content.slice(statusRollupStart, statusRollupEnd);
    expect(statusRollupBody).toContain("FROM covering_cases");
    expect(statusRollupBody).not.toContain('"RepositoryCases"');
  });

  it("the anchor role predicate occurs exactly once across the whole file, including the new status rollup", () => {
    // Extends the existing roleColumnCount assertion above rather than
    // adding a second, competing copy of it: this task's new CTEs
    // (status_rollup, statuses_agg) read from covering_cases and
    // latest_results only, never from "Issue" directly, so they must not
    // introduce a second occurrence of the shared role-scope column.
    const content = readFileSync("lib/services/requirementCoverage.ts", "utf8");
    const roleColumnCount = content.split(ISSUE_ROLE_SCOPE_COLUMN).length - 1;
    expect(
      roleColumnCount,
      `expected exactly one occurrence of the role predicate constant ` +
        `(${ISSUE_ROLE_SCOPE_COLUMN}) after extending the rollup with ` +
        `statuses[]/untested/directCaseCount/directCrossProjectCaseCount, ` +
        `found ${roleColumnCount}`
    ).toBe(1);
  });
});
