import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    status: {
      useFindMany: () => ({ data: [] }),
    },
  }),
}));

vi.mock("@/components/iterations/IterationStatusLegendPopover", () => ({
  IterationStatusLegendPopover: () => (
    <div data-testid="iteration-status-legend-stub" />
  ),
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

const { mockToastInfo, mockToastError, mockRouterPush } = vi.hoisted(() => ({
  mockToastInfo: vi.fn(),
  mockToastError: vi.fn(),
  mockRouterPush: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    info: (...args: any[]) => mockToastInfo(...args),
    error: (...args: any[]) => mockToastError(...args),
    success: vi.fn(),
  },
}));

vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({ checked, onCheckedChange, ...props }: any) => (
    <input
      type="checkbox"
      checked={checked === true}
      onChange={(e: any) => onCheckedChange?.(e.target.checked)}
      {...props}
    />
  ),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/components/tables/CaseListDisplay", () => ({
  CasesListDisplay: ({ count, isLoading }: any) => (
    <span data-testid="cases-list-display">
      {isLoading ? "loading" : String(count)}
    </span>
  ),
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
  useRouter: () => ({ push: mockRouterPush }),
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
    const { columns, data, rowSelection, onRowSelectionChange, getRowId } =
      props;
    // Minimal TanStack row-selection shim: getIsSelected/toggleSelected read
    // and write the controlled rowSelection prop keyed via getRowId, so the
    // select-column cell behaves like the real table in jsdom.
    const rowHandle = (row: any, rowIndex: number) => {
      const id = getRowId ? getRowId(row, rowIndex) : String(rowIndex);
      return {
        original: row,
        getIsSelected: () => Boolean(rowSelection?.[id]),
        toggleSelected: (value: boolean) =>
          onRowSelectionChange?.({ ...(rowSelection ?? {}), [id]: value }),
      };
    };
    return (
      <table data-testid="member-issues-data-table">
        <tbody>
          {data.map((row: any, rowIndex: number) => (
            <tr key={row.issueId ?? rowIndex} data-testid="member-issue-row">
              {columns.map((col: any, colIndex: number) => (
                <td key={col.id ?? colIndex}>
                  {col.cell
                    ? col.cell({
                        row: rowHandle(row, rowIndex),
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

  it("shows the member total in the section header", () => {
    mockFindManyMilestoneIssue.mockReturnValue({
      data: [
        buildRow(),
        buildRow({ issueId: 11, issue: { id: 11, name: "ISS-11" } }),
      ],
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    });
    renderWithQueryClient(<MemberIssuesTable milestoneId={450} projectId={370} />);
    expect(screen.getByTestId("member-issues-count")).toHaveTextContent("2");
  });

  it("aggregates per-status totals and uncovered count in the header strip", async () => {
    mockFindManyMilestoneIssue.mockReturnValue({
      data: [
        buildRow(),
        buildRow({ issueId: 11, issue: { id: 11, name: "ISS-11" } }),
        buildRow({ issueId: 12, issue: { id: 12, name: "ISS-12" } }),
      ],
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        10: {
          linkedCaseCount: 3,
          passed: 2,
          failed: 1,
          inProgress: 0,
          notRun: 0,
          uncovered: false,
          statuses: [
            { statusId: 1, name: "Passed", color: "#0f0", count: 2 },
            { statusId: 2, name: "Failed", color: "#f00", count: 1 },
          ],
          untested: 0,
        },
        11: {
          linkedCaseCount: 2,
          passed: 1,
          failed: 0,
          inProgress: 0,
          notRun: 1,
          uncovered: false,
          statuses: [{ statusId: 1, name: "Passed", color: "#0f0", count: 1 }],
          untested: 1,
        },
        12: {
          linkedCaseCount: 0,
          passed: 0,
          failed: 0,
          inProgress: 0,
          notRun: 0,
          uncovered: true,
          statuses: [],
          untested: 0,
        },
      }),
    });

    renderWithQueryClient(<MemberIssuesTable milestoneId={450} projectId={370} />);

    // The strip can render early (pre-coverage every row counts as
    // uncovered) — wait for the aggregated status pips specifically.
    await waitFor(() => {
      expect(screen.getByLabelText("Passed: 3")).toBeInTheDocument();
    });
    const strip = screen.getByTestId("member-issues-coverage-totals");
    // Passed 2+1=3, Failed 1, Untested 1, 1 uncovered issue.
    expect(within(strip).getByLabelText("Failed: 1")).toBeInTheDocument();
    expect(within(strip).getByLabelText("labels.untested: 1")).toBeInTheDocument();
    expect(screen.getByTestId("member-issues-totals-uncovered")).toBeInTheDocument();
  });

  it("collapses the section and remembers the preference in localStorage", async () => {
    window.localStorage.removeItem("tpi.milestone.memberIssues.collapsed");
    mockFindManyMilestoneIssue.mockReturnValue({
      data: [],
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    });
    const first = renderWithQueryClient(
      <MemberIssuesTable milestoneId={450} projectId={370} />
    );

    expect(screen.getByTestId("member-issues-search")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("member-issues-collapse-toggle"));
    await waitFor(() =>
      expect(screen.queryByTestId("member-issues-search")).not.toBeInTheDocument()
    );
    expect(
      window.localStorage.getItem("tpi.milestone.memberIssues.collapsed")
    ).toBe("true");

    first.unmount();
    renderWithQueryClient(<MemberIssuesTable milestoneId={450} projectId={370} />);
    // The post-mount effect reads the stored preference and collapses.
    await waitFor(() =>
      expect(screen.queryByTestId("member-issues-search")).not.toBeInTheDocument()
    );
    window.localStorage.removeItem("tpi.milestone.memberIssues.collapsed");
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

describe("MemberIssuesTable — create test run from selected issues", () => {
  const respond = (payload: any) => ({ ok: true, json: async () => payload });

  const parseQ = (url: string) =>
    JSON.parse(new URL(url, "http://localhost").searchParams.get("q") ?? "{}");

  beforeEach(() => {
    mockFindManyMilestoneIssue.mockReset();
    mockFindFirstMilestones.mockReset();
    mockFindFirstMilestones.mockReturnValue({
      data: { integrationId: null },
      isLoading: false,
    });
    mockFetch.mockReset();
    mockToastInfo.mockReset();
    mockToastError.mockReset();
    mockRouterPush.mockReset();
    sessionStorage.clear();

    mockFindManyMilestoneIssue.mockReturnValue({
      data: [
        buildRow(),
        buildRow({
          issueId: 11,
          issue: {
            id: 11,
            name: "PROJ-2",
            title: "Second issue",
            externalStatus: "Open",
            status: "open",
            issueTypeName: "Story",
          },
        }),
      ],
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    });
  });

  function mockFetchRoutes({
    linkedCaseIds = [101, 102],
    eligibleCaseIds = [101],
    excludeNotStarted = false,
  }: {
    linkedCaseIds?: number[];
    eligibleCaseIds?: number[];
    excludeNotStarted?: boolean;
  } = {}) {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("/members/coverage")) return respond({});
      if (url.includes("/members/overflow"))
        return respond({ members: [], linkedCount: 0, cap: 0, overflowTotal: 0 });
      if (url.includes("repositoryCases/count")) {
        return respond({ data: linkedCaseIds.length });
      }
      if (url.includes("repositoryCases/findMany")) {
        const q = parseQ(url);
        if (q.where?.caseIssues) {
          return respond({
            data: linkedCaseIds.map((id) => ({
              id,
              // 999 is never a selected issue — the handoff must drop it.
              caseIssues: [{ issueId: 10 }, { issueId: 999 }],
            })),
          });
        }
        return respond({ data: eligibleCaseIds.map((id) => ({ id })) });
      }
      if (url.includes("projects/findFirst")) {
        return respond({ data: { excludeNotStartedFromRuns: excludeNotStarted } });
      }
      return respond({});
    });
  }

  it("shows the create-run button once a row is selected and hands off via sessionStorage + openAddRun", async () => {
    mockFetchRoutes({ linkedCaseIds: [101, 102] });

    renderWithQueryClient(<MemberIssuesTable milestoneId={42} projectId={7} />);

    // No selection -> no button.
    expect(screen.queryByTestId("member-issues-create-run")).not.toBeInTheDocument();

    const checkboxes = await screen.findAllByTestId("member-issue-row-select");
    fireEvent.click(checkboxes[0]);

    const button = await screen.findByTestId("member-issues-create-run");
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockRouterPush).toHaveBeenCalledWith(
        "/projects/runs/7?openAddRun=true"
      );
    });
    expect(
      JSON.parse(sessionStorage.getItem("createTestRun_selectedCases") ?? "[]")
    ).toEqual([101, 102]);
    // Pre-linked issues: only SELECTED issues that contributed a seeded
    // case (the decoy 999 on every case link must be dropped).
    expect(
      JSON.parse(sessionStorage.getItem("createTestRun_linkedIssues") ?? "[]")
    ).toEqual([10]);
    expect(sessionStorage.getItem("createTestRun_milestoneId")).toBe("42");

    // The case-resolution query targets exactly the selected issueIds.
    const caseCall = mockFetch.mock.calls
      .map(([url]: any[]) => url)
      .find((url: string) => url.includes("repositoryCases/findMany"));
    const q = parseQ(caseCall);
    expect(q.where).toEqual({
      isDeleted: false,
      caseIssues: { some: { issueId: { in: [10] } } },
    });
  });

  it("selects every row through the header toggle-all checkbox", async () => {
    mockFetchRoutes();

    renderWithQueryClient(<MemberIssuesTable milestoneId={42} projectId={7} />);
    const checkboxes = await screen.findAllByTestId("member-issue-row-select");
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);

    const button = await screen.findByTestId("member-issues-create-run");
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockRouterPush).toHaveBeenCalled();
    });
    const caseCall = mockFetch.mock.calls
      .map(([url]: any[]) => url)
      .find((url: string) => url.includes("repositoryCases/findMany"));
    expect(parseQ(caseCall).where.caseIssues.some.issueId.in.sort()).toEqual([
      10, 11,
    ]);
  });

  it("toasts and stays put when the selected issues have no linked cases", async () => {
    mockFetchRoutes({ linkedCaseIds: [] });

    renderWithQueryClient(<MemberIssuesTable milestoneId={42} projectId={7} />);
    const checkboxes = await screen.findAllByTestId("member-issue-row-select");
    fireEvent.click(checkboxes[0]);
    fireEvent.click(await screen.findByTestId("member-issues-create-run"));

    await waitFor(() => {
      expect(mockToastInfo).toHaveBeenCalledWith("createRunNoCases");
    });
    expect(mockRouterPush).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("createTestRun_selectedCases")).toBeNull();
    expect(sessionStorage.getItem("createTestRun_linkedIssues")).toBeNull();
    expect(sessionStorage.getItem("createTestRun_milestoneId")).toBeNull();
  });

  it("honors excludeNotStartedFromRuns: filters ineligible cases, toasts the skipped count, seeds the rest", async () => {
    mockFetchRoutes({
      linkedCaseIds: [101, 102, 103],
      eligibleCaseIds: [101],
      excludeNotStarted: true,
    });

    renderWithQueryClient(<MemberIssuesTable milestoneId={42} projectId={7} />);
    const checkboxes = await screen.findAllByTestId("member-issue-row-select");
    fireEvent.click(checkboxes[0]);
    fireEvent.click(await screen.findByTestId("member-issues-create-run"));

    await waitFor(() => {
      expect(mockRouterPush).toHaveBeenCalledWith(
        "/projects/runs/7?openAddRun=true"
      );
    });
    expect(mockToastInfo).toHaveBeenCalledWith(
      "projects.settings.advanced.excludeNotStarted.skippedToast"
    );
    expect(
      JSON.parse(sessionStorage.getItem("createTestRun_selectedCases") ?? "[]")
    ).toEqual([101]);

    // The eligibility query is scoped to the linked ids with the
    // NOT_STARTED workflow exclusion, mirroring the repository flow.
    const eligibleCall = mockFetch.mock.calls
      .map(([url]: any[]) => url)
      .filter((url: string) => url.includes("repositoryCases/findMany"))
      .map(parseQ)
      .find((q: any) => q.where?.state);
    expect(eligibleCall.where).toEqual({
      id: { in: [101, 102, 103] },
      state: { workflowType: { not: "NOT_STARTED" } },
    });
  });

  it("surfaces a resolver failure as an error toast without navigating", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("repositoryCases/findMany"))
        return { ok: false, status: 500, json: async () => ({}) };
      if (url.includes("/members/overflow"))
        return respond({ members: [], linkedCount: 0, cap: 0, overflowTotal: 0 });
      return respond({});
    });

    renderWithQueryClient(<MemberIssuesTable milestoneId={42} projectId={7} />);
    const checkboxes = await screen.findAllByTestId("member-issue-row-select");
    fireEvent.click(checkboxes[0]);
    fireEvent.click(await screen.findByTestId("member-issues-create-run"));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("errors.somethingWentWrong");
    });
    expect(mockRouterPush).not.toHaveBeenCalled();
  });
});

describe("MemberIssuesTable — range select and case counts", () => {
  const respond = (payload: any) => ({ ok: true, json: async () => payload });
  const parseQ = (url: string) =>
    JSON.parse(new URL(url, "http://localhost").searchParams.get("q") ?? "{}");

  beforeEach(() => {
    mockFindManyMilestoneIssue.mockReset();
    mockFindFirstMilestones.mockReset();
    mockFindFirstMilestones.mockReturnValue({
      data: { integrationId: null },
      isLoading: false,
    });
    mockFetch.mockReset();
    mockToastInfo.mockReset();
    mockRouterPush.mockReset();
    sessionStorage.clear();

    mockFindManyMilestoneIssue.mockReturnValue({
      data: [10, 11, 12, 13].map((issueId, i) =>
        buildRow({
          issueId,
          issue: {
            id: issueId,
            name: `PROJ-${i + 1}`,
            title: `Issue ${i + 1}`,
            externalStatus: "Open",
            status: "open",
            issueTypeName: "Bug",
          },
        })
      ),
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    });

    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("/members/coverage"))
        return respond({
          10: { linkedCaseCount: 3, passed: 0, failed: 0, inProgress: 0, notRun: 3, uncovered: false, statuses: [], untested: 3 },
          11: { linkedCaseCount: 0, passed: 0, failed: 0, inProgress: 0, notRun: 0, uncovered: true, statuses: [], untested: 0 },
        });
      if (url.includes("/members/overflow"))
        return respond({ members: [], linkedCount: 0, cap: 0, overflowTotal: 0 });
      if (url.includes("repositoryCases/count")) return respond({ data: 7 });
      if (url.includes("repositoryCases/findMany"))
        return respond({ data: [{ id: 101 }] });
      if (url.includes("projects/findFirst"))
        return respond({ data: { excludeNotStartedFromRuns: false } });
      return respond({});
    });
  });

  it("shift-click selects the whole range between the two clicks in view order", async () => {
    renderWithQueryClient(<MemberIssuesTable milestoneId={42} projectId={7} />);
    const checkboxes = await screen.findAllByTestId("member-issue-row-select");
    expect(checkboxes).toHaveLength(4);

    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[3], { shiftKey: true });

    fireEvent.click(await screen.findByTestId("member-issues-create-run"));
    await waitFor(() => {
      expect(mockRouterPush).toHaveBeenCalled();
    });
    const caseCall = mockFetch.mock.calls
      .map(([url]: any[]) => url)
      .find((url: string) => url.includes("repositoryCases/findMany"));
    expect(parseQ(caseCall).where.caseIssues.some.issueId.in.sort()).toEqual([
      10, 11, 12, 13,
    ]);
  });

  it("plain clicks still toggle single rows (and deselect)", async () => {
    renderWithQueryClient(<MemberIssuesTable milestoneId={42} projectId={7} />);
    const checkboxes = await screen.findAllByTestId("member-issue-row-select");

    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[2]);
    fireEvent.click(checkboxes[0]); // deselect the first again

    fireEvent.click(await screen.findByTestId("member-issues-create-run"));
    await waitFor(() => {
      expect(mockRouterPush).toHaveBeenCalled();
    });
    const caseCall = mockFetch.mock.calls
      .map(([url]: any[]) => url)
      .find((url: string) => url.includes("repositoryCases/findMany"));
    expect(parseQ(caseCall).where.caseIssues.some.issueId.in).toEqual([12]);
  });

  it("fetches the distinct linked-case count for the selection (button subtitle)", async () => {
    renderWithQueryClient(<MemberIssuesTable milestoneId={42} projectId={7} />);
    const checkboxes = await screen.findAllByTestId("member-issue-row-select");
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);

    // The count refires per selection change — assert the final selection's
    // query landed, not the first.
    await waitFor(() => {
      const countWheres = mockFetch.mock.calls
        .map(([url]: any[]) => url)
        .filter((url: string) => url.includes("repositoryCases/count"))
        .map((url: string) => parseQ(url).where);
      expect(countWheres).toContainEqual({
        isDeleted: false,
        caseIssues: { some: { issueId: { in: [10, 11] } } },
      });
    });
  });

  it("renders the per-issue linked-cases badge (CasesListDisplay) from coverage data", async () => {
    renderWithQueryClient(<MemberIssuesTable milestoneId={42} projectId={7} />);
    await waitFor(() => {
      const counts = screen
        .getAllByTestId("member-issue-case-count")
        .map((el) => el.textContent);
      // Issues absent from the coverage payload are still loading.
      expect(counts).toEqual(["3", "0", "loading", "loading"]);
    });
  });
});
