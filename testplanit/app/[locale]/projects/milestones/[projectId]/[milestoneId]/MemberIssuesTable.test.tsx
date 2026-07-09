import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemberIssuesTable } from "./MemberIssuesTable";

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

// --- Stable mock refs via vi.hoisted() ---
const { mockFindManyMilestoneIssue, mockFindFirstMilestones, mockFetch } =
  vi.hoisted(() => {
    return {
      mockFindManyMilestoneIssue: vi.fn(),
      mockFindFirstMilestones: vi.fn(),
      mockFetch: vi.fn(),
    };
  });

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    milestoneIssue: {
      useFindMany: (...args: any[]) => mockFindManyMilestoneIssue(...args),
    },
    milestones: {
      useFindFirst: (...args: any[]) => mockFindFirstMilestones(...args),
    },
  }),
}));

vi.mock("~/zenstack/schema", () => ({ schema: {} }));

// MilestoneIssueManager (the "Add issue" entry point + upsert/link logic) has
// its own dedicated component test — stub it here to keep this file focused
// on MemberIssuesTable's own data-shaping/filter/render behavior.
vi.mock("@/components/issues/MilestoneIssueManager", () => ({
  MilestoneIssueManager: () => <div data-testid="milestone-issue-manager-stub" />,
  MemberIssueRowActions: () => <div data-testid="member-issue-row-actions-stub" />,
}));

vi.stubGlobal("fetch", mockFetch);

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/components/tables/IssuesDisplay", () => ({
  IssuesDisplay: ({ name }: any) => <span data-testid="issues-display">{name}</span>,
}));

vi.mock("@/components/IssueStatusDisplay", () => ({
  IssueStatusDisplay: ({ status }: any) => (
    <span data-testid="status-display">{status}</span>
  ),
}));

vi.mock("~/lib/navigation", () => ({
  Link: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: any) => <div data-testid="select">{children}</div>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children }: any) => <div>{children}</div>,
  SelectTrigger: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  SelectValue: () => <div />,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  ),
}));

// Render VirtualizedDataTable as a passthrough table so rows/cells appear in
// the DOM without the real fetch-on-scroll virtualizer (which renders 0 rows
// in jsdom — see project memory on useVirtualizedInfiniteList).
const dataTableLastProps: { current: any } = { current: null };
vi.mock("@/components/tables/VirtualizedDataTable", () => ({
  VirtualizedDataTable: (props: any) => {
    dataTableLastProps.current = props;
    const { columns, data } = props;
    return (
      <table data-testid="member-issues-data-table">
        <tbody>
          {data.map((row: any, rowIndex: number) => (
            <tr key={row.issueId ?? rowIndex} data-testid="member-issue-row">
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
    );
  },
}));

function buildRow(overrides: Partial<any> = {}) {
  return {
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
      issueTypeName: "Bug",
    },
    ...overrides,
  };
}

describe("MemberIssuesTable", () => {
  beforeEach(() => {
    mockFindManyMilestoneIssue.mockReset();
    mockFindFirstMilestones.mockReset();
    mockFindFirstMilestones.mockReturnValue({
      data: { integrationId: null },
      isLoading: false,
    });
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
  });

  it("fetches member rows scoped to the single milestoneId (D-15, not allMilestoneIds)", () => {
    mockFindManyMilestoneIssue.mockReturnValue({
      data: [],
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    });

    renderWithQueryClient(<MemberIssuesTable milestoneId={42} projectId={7} />);

    expect(mockFindManyMilestoneIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { milestoneId: 42 },
      })
    );
  });

  it("fetches the coverage breakdown from members/coverage and renders rows", async () => {
    mockFindManyMilestoneIssue.mockReturnValue({
      data: [buildRow()],
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        10: {
          linkedCaseCount: 2,
          passed: 1,
          failed: 0,
          inProgress: 0,
          notRun: 1,
          uncovered: false,
        },
      }),
    });

    renderWithQueryClient(<MemberIssuesTable milestoneId={42} projectId={7} />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/milestones/42/members/coverage");
    });
    await waitFor(() => {
      expect(screen.getByText("PROJ-1")).toBeInTheDocument();
    });
  });

  it("renders the empty state when there are no member rows", async () => {
    mockFindManyMilestoneIssue.mockReturnValue({
      data: [],
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    });

    renderWithQueryClient(<MemberIssuesTable milestoneId={42} projectId={7} />);

    await waitFor(() => {
      expect(screen.getByTestId("member-issues-empty")).toHaveTextContent("empty");
    });
  });

  it("shows the syncing badge while member rows or coverage are in flight", () => {
    mockFindManyMilestoneIssue.mockReturnValue({
      data: [buildRow()],
      isLoading: false,
      isFetching: true,
      refetch: vi.fn(),
    });

    renderWithQueryClient(<MemberIssuesTable milestoneId={42} projectId={7} />);

    expect(screen.getByTestId("member-issues-syncing-badge")).toBeInTheDocument();
  });

  it("does not show the syncing badge when nothing is in flight", async () => {
    mockFindManyMilestoneIssue.mockReturnValue({
      data: [buildRow()],
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    });

    renderWithQueryClient(<MemberIssuesTable milestoneId={42} projectId={7} />);

    // Wait for the coverage query to settle before asserting the syncing
    // badge is gone -- useQuery starts isFetching=true on mount.
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.queryByTestId("member-issues-syncing-badge")).not.toBeInTheDocument();
    });
  });

  it("renders the four filters (text, coverage, source, issue type)", () => {
    mockFindManyMilestoneIssue.mockReturnValue({
      data: [buildRow()],
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    });

    renderWithQueryClient(<MemberIssuesTable milestoneId={42} projectId={7} />);

    expect(screen.getByTestId("member-issues-search")).toBeInTheDocument();
    expect(screen.getByTestId("member-issues-coverage-filter")).toBeInTheDocument();
    expect(screen.getByTestId("member-issues-source-filter")).toBeInTheDocument();
    expect(screen.getByTestId("member-issues-type-filter")).toBeInTheDocument();
  });

  it("never references a nonexistent milestone/issue syncStatus field", () => {
    mockFindManyMilestoneIssue.mockReturnValue({
      data: [buildRow()],
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    });

    renderWithQueryClient(<MemberIssuesTable milestoneId={42} projectId={7} />);
    // The syncing indicator derives from client-side isFetching state, not a
    // persisted syncStatus column (D-03) — nothing in the rendered output
    // should reference `syncStatus`.
    expect(document.body.innerHTML).not.toMatch(/syncStatus/);
  });
});
