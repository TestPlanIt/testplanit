import { renderHook } from "@testing-library/react";
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
  useTranslations: () => (key: string) => key,
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
});
