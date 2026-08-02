import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import React, { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IssuesCard, type IssuesCardHandle } from "./IssuesCard";

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
}

function renderWithQueryClient(ui: React.ReactElement) {
  const testQueryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={testQueryClient}>{ui}</QueryClientProvider>
  );
}

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values && values.count !== undefined ? `${key}:${values.count}` : key,
}));

const { mockFindManyMilestoneIssue } = vi.hoisted(() => ({
  mockFindManyMilestoneIssue: vi.fn(),
}));

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    milestoneIssue: {
      useFindMany: (...args: unknown[]) => mockFindManyMilestoneIssue(...args),
    },
  }),
}));

vi.mock("~/zenstack/schema", () => ({ schema: {} }));

const { mockUseMilestoneSummary } = vi.hoisted(() => ({
  mockUseMilestoneSummary: vi.fn(),
}));

vi.mock("~/hooks/useMilestoneSummary", () => ({
  useMilestoneSummary: (...args: unknown[]) => mockUseMilestoneSummary(...args),
}));

vi.mock("./MemberIssuesTable", () => ({
  MemberIssuesTable: () => <div data-testid="member-issues-table-stub" />,
}));

vi.mock("./FoundInTestingIssues", () => ({
  FoundInTestingIssues: ({ memberIssueIds }: any) => (
    <div data-testid="found-in-testing-stub">
      {JSON.stringify(memberIssueIds)}
    </div>
  ),
}));

describe("IssuesCard", () => {
  beforeEach(() => {
    window.localStorage.removeItem("tpi.milestone.issues.collapsed");
    window.localStorage.removeItem("tpi.milestone.memberIssues.collapsed");
    window.localStorage.removeItem("tpi.milestone.foundInTesting.collapsed");
    mockFindManyMilestoneIssue.mockReturnValue({
      data: [{ issueId: 10 }, { issueId: 11 }],
    });
    mockUseMilestoneSummary.mockReturnValue({
      data: { issues: [{ id: 11 }, { id: 12 }] },
    });
  });

  it("renders one card with both the in-scope and found-in-testing sections", () => {
    renderWithQueryClient(<IssuesCard milestoneId={42} projectId={7} />);

    expect(screen.getByTestId("issues-card")).toBeInTheDocument();
    expect(screen.getByTestId("member-issues-table-stub")).toBeInTheDocument();
    expect(screen.getByTestId("found-in-testing-stub")).toBeInTheDocument();
  });

  it("passes the in-scope member issueIds down to the found-in-testing section", async () => {
    renderWithQueryClient(<IssuesCard milestoneId={42} projectId={7} />);

    await waitFor(() => {
      expect(screen.getByTestId("found-in-testing-stub")).toHaveTextContent(
        "[10,11]"
      );
    });
  });

  it("titles the header with the deduped union of member and found-in-testing issues", () => {
    renderWithQueryClient(<IssuesCard milestoneId={42} projectId={7} />);

    // Members {10, 11} ∪ found-in-testing {11, 12} = 3 distinct issues.
    expect(screen.getByText("labels.issues:3")).toBeInTheDocument();
  });

  it("counts member issues in the header even while the card is collapsed", async () => {
    window.localStorage.setItem("tpi.milestone.issues.collapsed", "true");

    renderWithQueryClient(<IssuesCard milestoneId={42} projectId={7} />);

    // The collapsed accordion unmounts its content (the sections are gone)…
    await waitFor(() => {
      expect(
        screen.queryByTestId("member-issues-table-stub")
      ).not.toBeInTheDocument();
    });
    // …but the header still totals member issues, not just found-in-testing.
    expect(screen.getByText("labels.issues:3")).toBeInTheDocument();
  });

  it("exposes expandInScope/expandFoundInTesting that set their own localStorage keys", () => {
    const ref = createRef<IssuesCardHandle>();
    renderWithQueryClient(
      <IssuesCard ref={ref} milestoneId={42} projectId={7} />
    );

    window.localStorage.setItem("tpi.milestone.memberIssues.collapsed", "true");
    window.localStorage.setItem(
      "tpi.milestone.foundInTesting.collapsed",
      "true"
    );

    act(() => ref.current?.expandInScope());
    expect(
      window.localStorage.getItem("tpi.milestone.memberIssues.collapsed")
    ).toBe("false");

    act(() => ref.current?.expandFoundInTesting());
    expect(
      window.localStorage.getItem("tpi.milestone.foundInTesting.collapsed")
    ).toBe("false");
  });
});
