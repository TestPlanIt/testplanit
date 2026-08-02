import { render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ExtendedMemberIssue } from "./MemberIssuesColumns";
import { useMemberIssueColumns } from "./MemberIssuesColumns";

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    status: {
      useFindMany: () => ({ data: [] }),
    },
  }),
}));
vi.mock("~/zenstack/schema", () => ({ schema: {} }));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values && values.count !== undefined ? `${key}:${values.count}` : key,
}));

vi.mock("@/components/tables/CaseListDisplay", () => ({
  // The cross-project instance is told apart by its "+" trigger prefix; the
  // stub surfaces the props the cell must set on it (project names + new-tab
  // links + the not-this-project filter).
  CasesListDisplay: ({
    count,
    triggerPrefix,
    showProject,
    openInNewTab,
    filter,
  }: any) => (
    <span
      data-testid={
        triggerPrefix ? "other-projects-cases-stub" : "cases-list-stub"
      }
      data-show-project={showProject ? "true" : undefined}
      data-open-in-new-tab={openInNewTab ? "true" : undefined}
      data-filter={JSON.stringify(filter)}
    >
      {`${triggerPrefix ?? ""}${count ?? ""}`}
    </span>
  ),
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({ children }: any) => <>{children}</>,
  TooltipContent: ({ children }: any) => (
    <div data-testid="tooltip-content">{children}</div>
  ),
}));

vi.mock("@/components/IssueStatusDisplay", () => ({
  IssueStatusDisplay: ({ status }: any) => (
    <span data-testid="status-display">{status}</span>
  ),
}));

vi.mock("~/lib/navigation", () => ({
  Link: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

const translations = {
  selectRow: "Select",
  key: "Key",
  description: "Description",
  status: "Status",
  cases: "Test Cases",
  coverage: "Coverage",
  source: "Source",
  sourceSynced: "Synced",
  sourceManual: "Manual",
  actions: "Actions",
};

const baseRow: ExtendedMemberIssue = {
  milestoneId: 1,
  issueId: 10,
  source: "SYNCED",
  createdAt: new Date(),
  issue: {
    id: 10,
    name: "PROJ-1",
    title: "Sample issue",
    externalStatus: "In Review",
    status: "in review",
  } as any,
  coverage: {
    linkedCaseCount: 2,
    passed: 1,
    failed: 0,
    inProgress: 0,
    notRun: 1,
    uncovered: false,
    statuses: [],
    untested: 0,
  },
};

describe("useMemberIssueColumns", () => {
  it("returns columns for key/description/status/coverage/source", () => {
    const { result } = renderHook(() =>
      useMemberIssueColumns({ translations, projectId: 5 })
    );
    const ids = result.current.map((col) => col.id);
    expect(ids).toEqual([
      "select",
      "key",
      "description",
      "status",
      "cases",
      "coverage",
      "source",
    ]);
  });

  it("adds a row-actions column when renderRowActions is provided", () => {
    const renderRowActions = vi.fn(() => <button>unlink</button>);
    const { result } = renderHook(() =>
      useMemberIssueColumns({ translations, projectId: 5, renderRowActions })
    );
    const ids = result.current.map((col) => col.id);
    expect(ids).toContain("actions");
  });

  it("does not add a row-actions column when renderRowActions is omitted", () => {
    const { result } = renderHook(() =>
      useMemberIssueColumns({ translations, projectId: 5 })
    );
    const ids = result.current.map((col) => col.id);
    expect(ids).not.toContain("actions");
  });

  it("status column reads externalStatus over status (D-02: rides the sync)", () => {
    const { result } = renderHook(() =>
      useMemberIssueColumns({ translations, projectId: 5 })
    );
    const statusCol = result.current.find((col) => col.id === "status");
    expect(statusCol).toBeDefined();
    const accessorFn = (statusCol as any).accessorFn;
    expect(accessorFn(baseRow)).toBe("In Review");
  });

  it("description column decodes HTML entities in the plain-text preview", () => {
    const { result } = renderHook(() =>
      useMemberIssueColumns({ translations, projectId: 5 })
    );
    const descriptionCol = result.current.find(
      (col) => col.id === "description"
    );
    const accessorFn = (descriptionCol as any).accessorFn;
    const row = {
      ...baseRow,
      issue: {
        ...baseRow.issue,
        description:
          "&#39;Up&#39; control doesn&#39;t close &quot;LEP&quot; &amp; more",
      },
    };
    expect(accessorFn(row)).toBe("'Up' control doesn't close \"LEP\" & more");
  });

  it("source column exposes SYNCED vs MANUAL via accessorFn", () => {
    const { result } = renderHook(() =>
      useMemberIssueColumns({ translations, projectId: 5 })
    );
    const sourceCol = result.current.find((col) => col.id === "source");
    const accessorFn = (sourceCol as any).accessorFn;
    expect(accessorFn(baseRow)).toBe("SYNCED");
    expect(accessorFn({ ...baseRow, source: "MANUAL" })).toBe("MANUAL");
  });

  function renderCasesCell(row: ExtendedMemberIssue) {
    const { result } = renderHook(() =>
      useMemberIssueColumns({ translations, projectId: 5 })
    );
    const casesCol = result.current.find((col) => col.id === "cases");
    const cell = (casesCol as any).cell({ row: { original: row } });
    return render(cell);
  }

  it("cases cell totals other-project cases in a separate clickable +N list with a scoping tooltip", () => {
    renderCasesCell({
      ...baseRow,
      caseCount: 2,
      coverage: { ...baseRow.coverage!, otherProjectCaseCount: 3 },
    });

    const total = screen.getByTestId("member-issue-other-project-case-count");
    expect(total).toHaveTextContent("+3");
    // The tooltip names the cross-project scope so the +N can't be misread
    // as this project's count.
    expect(screen.getByTestId("tooltip-content")).toHaveTextContent(
      "casesOtherProjects:3"
    );
    // This project's count stays separate.
    expect(screen.getByTestId("cases-list-stub")).toHaveTextContent("2");

    // The cross-project list must exclude this project, name each case's
    // project, and open cases in a new tab (it navigates cross-project).
    const otherList = screen.getByTestId("other-projects-cases-stub");
    expect(otherList).toHaveAttribute("data-show-project", "true");
    expect(otherList).toHaveAttribute("data-open-in-new-tab", "true");
    expect(JSON.parse(otherList.getAttribute("data-filter")!)).toEqual({
      caseIssues: { some: { issueId: 10 } },
      projectId: { not: 5 },
    });
  });

  it("cases cell renders no cross-project total when all linked cases live in this project", () => {
    renderCasesCell({ ...baseRow, caseCount: 2 });

    expect(
      screen.queryByTestId("member-issue-other-project-case-count")
    ).not.toBeInTheDocument();
  });
});
