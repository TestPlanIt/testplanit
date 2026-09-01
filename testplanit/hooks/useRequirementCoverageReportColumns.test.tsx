// Converted from the Wave 0 title scaffold. See
// useRequirementCoverageReportColumns.tsx's own header comment for why the
// result cell mirrors the PDF exporter's three-way uncovered/status/not-run
// split.
//
// `next-intl` and `~/lib/navigation` are mocked following
// RequirementCoveragePanel.test.tsx's established convention for the exact
// same display primitives (`ProjectNameDisplay`, `TestCaseNameDisplay`) --
// a bare-key translator so header/label assertions target stable keys
// instead of localized strings, and a plain anchor standing in for
// `next-intl/navigation`'s `Link` since it needs no router context this
// hook does not supply. Neither mock hides the seam under test: the column
// definitions, cell logic, and the three-way result branching all run for
// real.

import { fireEvent, render, renderHook } from "@testing-library/react";
import { format } from "date-fns";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDateFnsLocale } from "~/utils/locales";

// Mutable so individual tests can exercise a non-default app locale (F8) --
// declared via vi.hoisted so it's initialized before the hoisted vi.mock
// factory below closes over it.
const mockLocale = vi.hoisted(() => ({ current: "en-US" }));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${Object.values(params).join("·")}` : key,
  useLocale: () => mockLocale.current,
}));

vi.mock("~/lib/navigation", () => ({
  Link: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/ProjectIcon", () => ({
  ProjectIcon: () => <span data-testid="project-icon" />,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({ children }: any) => <span>{children}</span>,
  TooltipContent: ({ children }: any) => (
    <div data-testid="tooltip-content">{children}</div>
  ),
}));

import {
  useRequirementCoverageChangeColumns,
  useRequirementCoverageGapColumns,
  useRequirementTraceabilityColumns,
} from "./useRequirementCoverageReportColumns";

function cellFor(columns: any[], id: string, original: any) {
  const column = columns.find((c) => c.id === id);
  if (!column) throw new Error(`no column with id ${id}`);
  return column.cell({
    getValue: () => original[column.accessorKey ?? id],
    row: { original },
  });
}

describe("useRequirementCoverageReportColumns", () => {
  beforeEach(() => {
    mockLocale.current = "en-US";
  });

  it("renders a requirement column and a hierarchy path column", () => {
    const { result } = renderHook(() => useRequirementCoverageGapColumns());
    const columns = result.current;

    // No NOT_RUN tier in the rows → the Coverage and Linked Cases
    // columns are omitted (both would be constants: "Uncovered" and 0).
    expect(columns.map((c: any) => c.id)).toEqual([
      "requirement",
      "requirementPath",
      "priority",
      "status",
      "uncoveredSince",
    ]);

    const { result: withTier } = renderHook(() =>
      useRequirementCoverageGapColumns([
        { coverageStatus: "UNCOVERED" },
        { coverageStatus: "NOT_RUN" },
      ])
    );
    const tierIds = withTier.current.map((c: any) => c.id);
    expect(tierIds).toContain("coverage");
    expect(tierIds).toContain("linkedCases");

    const gapRow = {
      id: 0,
      requirementId: 1,
      requirementKey: "REQ-1",
      requirementTitle: "Enrol domestic students",
      requirementPath: "Enrolments > Enrol domestic students",
      requirementParentPath: "Enrolments",
      linkedCases: 0,
    };

    const { getByText } = render(
      <>{cellFor(columns, "requirement", gapRow)}</>
    );
    expect(getByText("REQ-1: Enrol domestic students")).toBeInTheDocument();

    // The Path column displays the ANCESTORS-ONLY parent path, never the
    // full path that repeats the requirement's own text as its last
    // segment (operator finding 2026-08-29: in a mostly-flat project the
    // full path made this column a copy of the Requirement column).
    const { getByText: getPathText, queryByText } = render(
      <>{cellFor(columns, "requirementPath", gapRow)}</>
    );
    expect(getPathText("Enrolments")).toBeInTheDocument();
    expect(
      queryByText("Enrolments > Enrol domestic students")
    ).not.toBeInTheDocument();
  });

  it("renders the uncovered treatment for a null case row", () => {
    const { result } = renderHook(() => useRequirementTraceabilityColumns());
    const columns = result.current;

    const gapRow = {
      id: 0,
      requirementId: 1,
      requirementKey: "REQ-1",
      requirementTitle: "Enrol domestic students",
      requirementPath: "Enrolments > Enrol domestic students",
      testCaseId: null,
      testCaseName: null,
      caseProjectId: null,
      caseProjectName: null,
      lastStatusName: null,
      lastStatusColor: null,
      lastExecutedAt: null,
      coverageStatus: "UNCOVERED",
    };

    const { getByTestId, queryByTestId } = render(
      <>{cellFor(columns, "result", gapRow)}</>
    );
    expect(getByTestId("requirement-report-uncovered")).toHaveTextContent(
      "uncovered"
    );
    expect(queryByTestId("requirement-report-not-run")).not.toBeInTheDocument();
  });

  it("renders a not-run treatment for a covering case with no execution", () => {
    const { result } = renderHook(() => useRequirementTraceabilityColumns());
    const columns = result.current;

    const notRunRow = {
      id: 1,
      requirementId: 1,
      requirementKey: "REQ-1",
      requirementTitle: "Enrol domestic students",
      requirementPath: "Enrolments > Enrol domestic students",
      testCaseId: 55,
      testCaseName: "Enrol via portal",
      caseProjectId: 10,
      caseProjectName: "Enrolments",
      lastStatusName: null,
      lastStatusColor: null,
      lastExecutedAt: null,
      coverageStatus: "NOT_RUN",
    };

    const { getByTestId, queryByTestId } = render(
      <>{cellFor(columns, "result", notRunRow)}</>
    );
    expect(getByTestId("requirement-report-not-run")).toHaveTextContent(
      "notRun"
    );
    expect(
      queryByTestId("requirement-report-uncovered")
    ).not.toBeInTheDocument();

    // Distinct from the uncovered row above: this row HAS a linked case
    // (testCaseId is non-null), it just has no in-scope execution yet -- a
    // regression here (e.g. collapsing both to the same treatment) would
    // make a real gap indistinguishable from a merely-not-yet-run case.
    const { getByText } = render(
      <>{cellFor(columns, "testCaseId", notRunRow)}</>
    );
    expect(getByText("Enrol via portal")).toBeInTheDocument();
  });

  // A native requirement (CreateRequirementDialog, or a RequirementsListView
  // rename) writes the SAME trimmed string to its key (requirementKey) and
  // title (requirementTitle) -- unlike every fixture above, which is
  // synced-shaped with a genuinely differing title. Both column sets
  // delegate the Requirement cell to the shared `formatRequirementCellText`
  // helper; these are thin assertions that the column-hook surface actually
  // uses it, not a re-test of the helper's guard logic (see
  // utils/issueDisplayText.test.ts for that).
  it("renders a native requirement's name ONCE, not doubled, in the gap columns", () => {
    const { result } = renderHook(() => useRequirementCoverageGapColumns());
    const columns = result.current;

    const nativeRow = {
      id: 0,
      requirementId: 1,
      requirementKey: "New Requirement",
      requirementTitle: "New Requirement",
      requirementPath: "New Requirement",
      linkedCases: 0,
    };

    const { getByText, queryByText } = render(
      <>{cellFor(columns, "requirement", nativeRow)}</>
    );
    expect(getByText("New Requirement")).toBeInTheDocument();
    expect(
      queryByText("New Requirement: New Requirement")
    ).not.toBeInTheDocument();
  });

  it("renders a native requirement's name ONCE, not doubled, in the traceability columns", () => {
    const { result } = renderHook(() => useRequirementTraceabilityColumns());
    const columns = result.current;

    const nativeRow = {
      id: 0,
      requirementId: 1,
      requirementKey: "New Requirement",
      requirementTitle: "New Requirement",
      requirementPath: "New Requirement",
      testCaseId: null,
      testCaseName: null,
      caseProjectId: null,
      caseProjectName: null,
      lastStatusName: null,
      lastStatusColor: null,
      lastExecutedAt: null,
      coverageStatus: "UNCOVERED",
    };

    const { getByText, queryByText } = render(
      <>{cellFor(columns, "requirement", nativeRow)}</>
    );
    expect(getByText("New Requirement")).toBeInTheDocument();
    expect(
      queryByText("New Requirement: New Requirement")
    ).not.toBeInTheDocument();
  });

  // The gap-row "Generate Test Cases" action exists only when the caller
  // passes a handler. ReportBuilder passes one only when the viewer can
  // add/edit the Test Case Repository AND the project has an active LLM
  // connection; the shared/static viewer never passes one — so the column's
  // absence without a callback is what keeps the action off share links.
  it("appends an actions column that fires the generate callback on the clicked row", () => {
    const onGenerate = vi.fn();
    const { result } = renderHook(() =>
      useRequirementCoverageGapColumns(undefined, onGenerate)
    );
    const ids = result.current.map((c: any) => c.id);
    expect(ids[ids.length - 1]).toBe("actions");

    // Labeled and right-pinned (operator direction 2026-08-31), via the
    // DataTable's meta.isPinned convention.
    const actionsColumn: any = result.current[result.current.length - 1];
    expect(actionsColumn.meta?.isPinned).toBe("right");

    const gapRow = {
      id: 0,
      requirementId: 7,
      requirementKey: "REQ-7",
      requirementTitle: "Enrol domestic students",
      requirementPath: "Enrolments > Enrol domestic students",
      linkedCases: 0,
    };
    const { getByTestId } = render(
      <>{cellFor(result.current, "actions", gapRow)}</>
    );
    fireEvent.click(getByTestId("requirement-gap-generate-7"));
    expect(onGenerate).toHaveBeenCalledTimes(1);
    expect(onGenerate).toHaveBeenCalledWith(gapRow);
  });

  it("omits the actions column when no generate callback is provided", () => {
    // The shared/static viewer's call shape (and the builder's when the
    // viewer lacks repo add/edit or the project has no LLM connection).
    const { result } = renderHook(() => useRequirementCoverageGapColumns());
    expect(result.current.map((c: any) => c.id)).not.toContain("actions");
  });

  it("orders the traceability columns with Coverage between Path and Test Case", () => {
    const { result } = renderHook(() => useRequirementTraceabilityColumns());

    expect(result.current.map((c: any) => c.id)).toEqual([
      "requirement",
      "requirementPath",
      "coverage",
      "testCaseId",
      "result",
      "executedAt",
      "project",
    ]);
  });

  it("renders the classified coverage state with the tree's own vocabulary", () => {
    const { result } = renderHook(() => useRequirementTraceabilityColumns());
    const columns = result.current;

    const baseRow = {
      id: 0,
      requirementId: 1,
      requirementKey: "REQ-1",
      requirementTitle: "Enrol domestic students",
      requirementPath: "Enrolments > Enrol domestic students",
      testCaseId: 55,
      testCaseName: "Enrol via portal",
      caseProjectId: 10,
      caseProjectName: "Enrolments",
      lastStatusName: "Passed",
      lastStatusColor: "#10b981",
      lastExecutedAt: "2026-08-23T14:04:00.000Z",
    };

    const cases: Array<[string, string, string]> = [
      ["PASSED", "requirement-report-coverage-passed", "statusPassed"],
      ["FAILED", "requirement-report-coverage-failed", "statusFailed"],
      ["NOT_RUN", "requirement-report-coverage-not-run", "statusNotRun"],
      ["UNCOVERED", "requirement-report-coverage-uncovered", "uncovered"],
    ];
    for (const [status, testId, label] of cases) {
      const { getByTestId, unmount } = render(
        <>
          {cellFor(columns, "coverage", { ...baseRow, coverageStatus: status })}
        </>
      );
      expect(getByTestId(testId)).toHaveTextContent(label);
      unmount();
    }
  });

  it("names the project on a SAME-project covering case, not only cross-project ones", () => {
    // Operator direction 2026-08-29: a blank Project cell is reserved for
    // the gap row (no case at all) — a local case names its own project.
    const { result } = renderHook(() => useRequirementTraceabilityColumns());
    const columns = result.current;

    const localRow = {
      id: 0,
      requirementId: 1,
      requirementKey: "REQ-1",
      requirementTitle: "Enrol domestic students",
      requirementPath: "Enrolments",
      testCaseId: 55,
      testCaseName: "Enrol via portal",
      caseProjectId: 10,
      caseProjectName: "Web",
      lastStatusName: null,
      lastStatusColor: null,
      lastExecutedAt: null,
      coverageStatus: "NOT_RUN",
    };

    // ProjectNameDisplay renders the name in both the trigger and the
    // (mocked, always-rendered) tooltip content — assert presence, not
    // uniqueness.
    const { getAllByText } = render(
      <>{cellFor(columns, "project", localRow)}</>
    );
    expect(getAllByText("Web").length).toBeGreaterThan(0);

    // The gap row stays blank — it has no case, so it has no project.
    const gapRow = {
      ...localRow,
      testCaseId: null,
      testCaseName: null,
      caseProjectId: null,
      caseProjectName: null,
      coverageStatus: "UNCOVERED",
    };
    const { container } = render(<>{cellFor(columns, "project", gapRow)}</>);
    expect(container).toBeEmptyDOMElement();
  });

  // F8: the Executed At cell must use the app locale (via
  // `getDateFnsLocale`), not date-fns's built-in en-US default -- the
  // established pattern in hooks/useDrillDownColumns.tsx. Compare against
  // the SAME instant formatted through both paths rather than hardcoding an
  // expected string, so this test isn't coupled to the test runner's local
  // timezone -- only to the locale actually flowing through.
  it("formats Executed At using the app locale, not the date-fns default", () => {
    mockLocale.current = "de-DE";

    const executedAt = "2026-08-23T14:04:00.000Z";
    const date = new Date(executedAt);
    const expectedWithAppLocale = format(date, "PPp", {
      locale: getDateFnsLocale("de-DE"),
    });
    const defaultFormatted = format(date, "PPp");
    // Sanity check that de-DE and the date-fns default actually render
    // differently for this instant -- otherwise the assertion below
    // couldn't discriminate a regression.
    expect(expectedWithAppLocale).not.toBe(defaultFormatted);

    const { result } = renderHook(() => useRequirementTraceabilityColumns());
    const columns = result.current;

    const row = {
      id: 0,
      requirementId: 1,
      requirementKey: "REQ-1",
      requirementTitle: "Enrol domestic students",
      requirementPath: "Enrolments > Enrol domestic students",
      testCaseId: 55,
      testCaseName: "Enrol via portal",
      caseProjectId: 10,
      caseProjectName: "Enrolments",
      lastStatusName: "Passed",
      lastStatusColor: "#10b981",
      lastExecutedAt: executedAt,
      coverageStatus: "PASSED",
    };

    const { getByText, queryByText } = render(
      <>{cellFor(columns, "executedAt", row)}</>
    );
    expect(getByText(expectedWithAppLocale)).toBeInTheDocument();
    expect(queryByText(defaultFormatted)).not.toBeInTheDocument();
  });
});

describe("useRequirementCoverageChangeColumns", () => {
  const changeRow = {
    id: 0,
    requirementId: 9,
    requirementKey: "REQ-9",
    requirementTitle: "Refunds",
    requirementPath: "Billing > Refunds",
    requirementParentPath: "Billing",
    requirementIssueTypeName: null,
    requirementIssueTypeIconUrl: null,
    requirementRootId: 1,
    changeKind: "COVERAGE_CHANGED",
    previousCoverageStatus: "UNCOVERED",
    currentCoverageStatus: "FAILED",
    previousLinkedCaseCount: 0,
    currentLinkedCaseCount: 2,
    casesAdded: 2,
    casesRemoved: 0,
    resultsChanged: 0,
  };

  it("pins the column ids the sort utility and CSV builder key on", () => {
    const { result } = renderHook(() => useRequirementCoverageChangeColumns());
    expect(result.current.map((c: any) => c.id)).toEqual([
      "requirement",
      "requirementPath",
      "change",
      "previousCoverage",
      "currentCoverage",
      "previousLinkedCases",
      "currentLinkedCases",
      "casesAdded",
      "casesRemoved",
      "resultsChanged",
    ]);
  });

  it("renders the change kind as a badge and both coverage sides through the shared state cell", () => {
    const { result } = renderHook(() => useRequirementCoverageChangeColumns());
    const columns = result.current;

    const { getByTestId } = render(
      <>
        {cellFor(columns, "change", changeRow)}
        {cellFor(columns, "previousCoverage", changeRow)}
        {cellFor(columns, "currentCoverage", changeRow)}
      </>
    );
    expect(getByTestId("requirement-change-coverage").textContent).toBe(
      "changeCoverage"
    );
    expect(
      getByTestId("requirement-report-coverage-uncovered")
    ).toBeInTheDocument();
    expect(
      getByTestId("requirement-report-coverage-failed")
    ).toBeInTheDocument();
  });

  it("renders a dash for the side a requirement is absent from", () => {
    const { result } = renderHook(() => useRequirementCoverageChangeColumns());
    const removed = {
      ...changeRow,
      changeKind: "REMOVED",
      currentCoverageStatus: null,
      currentLinkedCaseCount: null,
    };
    const { container, getByTestId } = render(
      <>
        {cellFor(result.current, "change", removed)}
        {cellFor(result.current, "currentCoverage", removed)}
        {cellFor(result.current, "currentLinkedCases", removed)}
      </>
    );
    expect(getByTestId("requirement-change-removed")).toBeInTheDocument();
    expect(container.textContent).toContain("—");
    expect(
      container.querySelector('[data-testid^="requirement-report-coverage-"]')
    ).toBeNull();
  });
});
