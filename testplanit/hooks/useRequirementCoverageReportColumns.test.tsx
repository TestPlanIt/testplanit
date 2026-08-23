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

import { render, renderHook } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${Object.values(params).join("·")}` : key,
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
  it("renders a requirement column and a hierarchy path column", () => {
    const { result } = renderHook(() => useRequirementCoverageGapColumns());
    const columns = result.current;

    expect(columns.map((c: any) => c.id)).toEqual([
      "requirement",
      "requirementPath",
    ]);

    const gapRow = {
      id: 0,
      requirementId: 1,
      requirementKey: "REQ-1",
      requirementTitle: "Enrol domestic students",
      requirementPath: "Enrolments > Enrol domestic students",
      linkedCases: 0,
    };

    const { getByText } = render(
      <>{cellFor(columns, "requirement", gapRow)}</>
    );
    expect(getByText("REQ-1: Enrol domestic students")).toBeInTheDocument();

    const { getByText: getPathText } = render(
      <>{cellFor(columns, "requirementPath", gapRow)}</>
    );
    expect(
      getPathText("Enrolments > Enrol domestic students")
    ).toBeInTheDocument();
  });

  it("renders the uncovered treatment for a null case row", () => {
    const { result } = renderHook(() =>
      useRequirementTraceabilityColumns(10)
    );
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
    const { result } = renderHook(() =>
      useRequirementTraceabilityColumns(10)
    );
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
});
