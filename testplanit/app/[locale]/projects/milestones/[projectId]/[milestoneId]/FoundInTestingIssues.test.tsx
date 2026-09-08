import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FoundInTestingIssues } from "./FoundInTestingIssues";

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

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));
vi.stubGlobal("fetch", mockFetch);

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/components/tables/IssuesDisplay", () => ({
  IssuesDisplay: ({ name }: any) => (
    <span data-testid="issues-display">{name}</span>
  ),
}));

// Render DataTable as a passthrough table so rows/cells appear in
// the DOM without the real fetch-on-scroll virtualizer (which renders 0 rows
// in jsdom — see project memory on useVirtualizedInfiniteList).
vi.mock("@/components/tables/DataTable", () => ({
  DataTable: ({ columns, data, rowTestIdPrefix }: any) => (
    <table data-testid="found-in-testing-data-table">
      <tbody>
        {data.map((row: any, rowIndex: number) => (
          <tr key={row.id ?? rowIndex} data-testid={rowTestIdPrefix}>
            {columns.map((col: any, colIndex: number) => (
              <td key={col.id ?? colIndex}>
                {col.cell
                  ? col.cell({
                      row: { original: row },
                      column: { getSize: () => col.size ?? 150 },
                    })
                  : null}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, ...props }: any) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

function buildIssue(overrides: Partial<any> = {}) {
  return {
    id: 10,
    name: "PROJ-1",
    title: "Sample issue",
    externalId: null,
    externalKey: null,
    externalUrl: null,
    externalStatus: "In Review",
    data: null,
    integrationId: null,
    lastSyncedAt: null,
    integration: null,
    projectIds: [7],
    ...overrides,
  };
}

function mockSummary(issues: any[]) {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      milestoneId: 42,
      totalItems: 0,
      completionRate: 0,
      totalElapsed: 0,
      totalEstimate: 0,
      commentsCount: 0,
      segments: [],
      issues,
      scopeCount: 0,
    }),
  });
}

describe("FoundInTestingIssues", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    window.localStorage.removeItem("tpi.milestone.foundInTesting.collapsed");
  });

  it("fetches the shared milestone summary query and renders issue rows with a count badge", async () => {
    mockSummary([buildIssue()]);

    renderWithQueryClient(
      <FoundInTestingIssues milestoneId={42} memberIssueIds={[]} />
    );

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/milestones/42/summary");
    });
    await waitFor(() => {
      expect(screen.getByTestId("found-in-testing-count")).toHaveTextContent(
        "1"
      );
    });
    expect(screen.getByText("PROJ-1")).toBeInTheDocument();
  });

  it("renders the empty state when there are no found-in-testing issues", async () => {
    mockSummary([]);

    renderWithQueryClient(
      <FoundInTestingIssues milestoneId={42} memberIssueIds={[]} />
    );

    await waitFor(() => {
      expect(screen.getByTestId("found-in-testing-empty")).toBeInTheDocument();
    });
  });

  it("shows the In-scope cross-badge only on rows whose issueId is also a member", async () => {
    mockSummary([
      buildIssue({ id: 10 }),
      buildIssue({ id: 11, name: "PROJ-2" }),
    ]);

    renderWithQueryClient(
      <FoundInTestingIssues milestoneId={42} memberIssueIds={[10]} />
    );

    await waitFor(() => {
      expect(screen.getAllByTestId("found-in-testing-row")).toHaveLength(2);
    });
    // Only one row overlaps with the "in scope" member set.
    expect(
      screen.getAllByTestId("found-in-testing-in-scope-badge")
    ).toHaveLength(1);
  });

  it("collapses the section and remembers the preference in a dedicated localStorage key", async () => {
    mockSummary([]);

    const first = renderWithQueryClient(
      <FoundInTestingIssues milestoneId={42} memberIssueIds={[]} />
    );

    expect(
      await screen.findByTestId("found-in-testing-empty")
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("found-in-testing-collapse-toggle"));
    await waitFor(() =>
      expect(
        screen.queryByTestId("found-in-testing-empty")
      ).not.toBeInTheDocument()
    );
    expect(
      window.localStorage.getItem("tpi.milestone.foundInTesting.collapsed")
    ).toBe("true");

    first.unmount();
    renderWithQueryClient(
      <FoundInTestingIssues milestoneId={42} memberIssueIds={[]} />
    );
    await waitFor(() =>
      expect(
        screen.queryByTestId("found-in-testing-empty")
      ).not.toBeInTheDocument()
    );
    window.localStorage.removeItem("tpi.milestone.foundInTesting.collapsed");
  });

  it("renders the includes-child-milestones caption", async () => {
    mockSummary([]);

    renderWithQueryClient(
      <FoundInTestingIssues milestoneId={42} memberIssueIds={[]} />
    );

    expect(
      await screen.findByText("summary.includesChildMilestones")
    ).toBeInTheDocument();
  });
});
