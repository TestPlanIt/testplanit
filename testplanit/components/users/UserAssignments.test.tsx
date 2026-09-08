import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UserAssignments } from "./UserAssignments";

const { mockUsePendingReviewRequests, mockUsePendingReviewsByEntity } =
  vi.hoisted(() => ({
    mockUsePendingReviewRequests: vi.fn(),
    mockUsePendingReviewsByEntity: vi.fn(),
  }));

// The `t` function must be identity-stable across renders (real next-intl
// memoizes it): the column defs depend on it, and a fresh identity per render
// rebuilds the columns, which loops DataTable's visibility sync until the
// test worker dies.
const { stableT } = vi.hoisted(() => ({
  stableT: (key: string, values?: Record<string, unknown>) =>
    values && "count" in values ? `${key}:${values.count}` : key,
}));
vi.mock("next-intl", () => ({
  useTranslations: () => stableT,
  useLocale: () => "en-US",
}));

vi.mock("~/hooks/usePendingReviewRequests", () => ({
  usePendingReviewRequests: (...args: any[]) =>
    mockUsePendingReviewRequests(...args),
}));

vi.mock("~/hooks/usePendingReviewsByEntity", () => ({
  usePendingReviewsByEntity: (...args: any[]) =>
    mockUsePendingReviewsByEntity(...args),
}));

// Entity side-fetches behind usePendingReviewEntityMaps. Empty results keep
// PendingReviewEntity on its `TYPE #id` fallback path, which is all the
// review-row tests assert on.
vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    repositoryCases: { useFindMany: () => ({ data: [] }) },
    testRuns: { useFindMany: () => ({ data: [] }) },
    sessions: { useFindMany: () => ({ data: [] }) },
  }),
}));

vi.mock("~/lib/navigation", () => ({
  Link: ({ href, children, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  // DataTable reads these for its selected-row scroll behavior.
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/users/profile/user-1",
}));

const UNTESTED_STATUS_ID = 10;
const PASSED_STATUS_ID = 20;

const dashboardData = {
  untestedStatusId: UNTESTED_STATUS_ID,
  testRunCasesAssigned: [
    // Two pending cases in the same run collapse into one row.
    {
      id: 1,
      repositoryCaseId: 11,
      testRunId: 100,
      latestResultStatusId: null,
      latestResultIsCompleted: null,
      caseName: "Case 1",
      caseEstimate: null,
      caseForecastManual: 600,
      caseForecastAutomated: null,
      runName: "Run A",
      runIsCompleted: false,
      runForecastManual: null,
      runForecastAutomated: null,
      projectId: 1,
      projectName: "Project One",
      projectIconUrl: null,
    },
    {
      id: 2,
      repositoryCaseId: 12,
      testRunId: 100,
      latestResultStatusId: UNTESTED_STATUS_ID,
      latestResultIsCompleted: false,
      caseName: "Case 2",
      caseEstimate: 300,
      caseForecastManual: null,
      caseForecastAutomated: null,
      runName: "Run A",
      runIsCompleted: false,
      runForecastManual: null,
      runForecastAutomated: null,
      projectId: 1,
      projectName: "Project One",
      projectIconUrl: null,
    },
    // Already executed — excluded.
    {
      id: 3,
      repositoryCaseId: 13,
      testRunId: 100,
      latestResultStatusId: PASSED_STATUS_ID,
      latestResultIsCompleted: true,
      caseName: "Case 3",
      caseEstimate: 300,
      caseForecastManual: null,
      caseForecastAutomated: null,
      runName: "Run A",
      runIsCompleted: false,
      runForecastManual: null,
      runForecastAutomated: null,
      projectId: 1,
      projectName: "Project One",
      projectIconUrl: null,
    },
    // Second open run, sorts before "Run A" by name.
    {
      id: 5,
      repositoryCaseId: 15,
      testRunId: 300,
      latestResultStatusId: null,
      latestResultIsCompleted: null,
      caseName: "Case 5",
      caseEstimate: 120,
      caseForecastManual: null,
      caseForecastAutomated: null,
      runName: "Alpha Run",
      runIsCompleted: false,
      runForecastManual: null,
      runForecastAutomated: null,
      projectId: 1,
      projectName: "Project One",
      projectIconUrl: null,
    },
    // Completed run — excluded entirely.
    {
      id: 4,
      repositoryCaseId: 14,
      testRunId: 200,
      latestResultStatusId: null,
      latestResultIsCompleted: null,
      caseName: "Case 4",
      caseEstimate: 300,
      caseForecastManual: null,
      caseForecastAutomated: null,
      runName: "Run B",
      runIsCompleted: true,
      runForecastManual: null,
      runForecastAutomated: null,
      projectId: 1,
      projectName: "Project One",
      projectIconUrl: null,
    },
  ],
  assignedSessions: [
    {
      id: 7,
      name: "Session S",
      estimate: 3600,
      forecastManual: null,
      forecastAutomated: null,
      projectId: 2,
      projectName: "Project Two",
      projectIconUrl: null,
      totalElapsed: 600,
    },
  ],
};

function renderComponent() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <TooltipProvider>
      <QueryClientProvider client={queryClient}>
        <UserAssignments userId="user-1" />
      </QueryClientProvider>
    </TooltipProvider>
  );
}

function mockFetchWith(data: unknown) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => data,
  }) as any;
}

describe("UserAssignments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePendingReviewRequests.mockReturnValue({
      requests: [],
      isLoading: false,
      enabled: true,
    });
    mockUsePendingReviewsByEntity.mockImplementation(() => new Map());
  });

  it("groups pending cases per open run and lists active sessions", async () => {
    mockFetchWith(dashboardData);

    renderComponent();

    const runRow = await screen.findByTestId("profile-assignments-run-100");
    // Cases 1 + 2 are pending; case 3 has a non-untested result.
    expect(within(runRow).getByText("2")).toBeInTheDocument();
    expect(runRow.textContent).toContain("Run A");
    expect(runRow.textContent).toContain("Project One");

    // Column headers render (requires explicit `id` on the column defs —
    // DataTable's initial-visibility map is keyed off the raw defs' ids).
    const runTable = runRow.closest("table")!;
    for (const header of [
      "common.name",
      "common.fields.project",
      "common.fields.testCases",
      "common.fields.estimate",
    ]) {
      expect(within(runTable).getByText(header)).toBeInTheDocument();
    }
    // Completed run 200 never renders.
    expect(
      screen.queryByTestId("profile-assignments-run-200")
    ).not.toBeInTheDocument();

    const sessionRow = screen.getByTestId("profile-assignments-session-7");
    expect(sessionRow.textContent).toContain("Session S");
    expect(sessionRow.textContent).toContain("Project Two");

    // 600s + 300s pending cases + 3000s session remainder = 65 minutes.
    expect(screen.getByText(/totalWorkEffort/)).toBeInTheDocument();
  });

  it("links run and session rows to their project pages", async () => {
    mockFetchWith(dashboardData);

    renderComponent();

    const runRow = await screen.findByTestId("profile-assignments-run-100");
    expect(runRow.querySelector("a")).toHaveAttribute(
      "href",
      "/projects/runs/1/100"
    );
    const sessionRow = screen.getByTestId("profile-assignments-session-7");
    expect(sessionRow.querySelector("a")).toHaveAttribute(
      "href",
      "/projects/sessions/2/7"
    );
  });

  it("shows the pending-review badge on rows whose entity has a pending review", async () => {
    mockFetchWith(dashboardData);
    mockUsePendingReviewsByEntity.mockImplementation((entityType: string) =>
      entityType === "RUN"
        ? new Map([
            [
              100,
              {
                id: "review-1",
                status: "PENDING",
                assigneeUser: { name: "Reviewer" },
              },
            ],
          ])
        : new Map()
    );

    renderComponent();

    const runRow = await screen.findByTestId("profile-assignments-run-100");
    expect(
      within(runRow).getByTestId("pending-review-badge")
    ).toBeInTheDocument();
    // No SESSION review staged — the session row stays badge-free.
    const sessionRow = screen.getByTestId("profile-assignments-session-7");
    expect(
      within(sessionRow).queryByTestId("pending-review-badge")
    ).not.toBeInTheDocument();
  });

  it("lists pending reviews with a count-first heading", async () => {
    mockFetchWith(dashboardData);
    mockUsePendingReviewRequests.mockReturnValue({
      requests: [
        {
          id: "r1",
          entityType: "CASE",
          entityId: 101,
          projectId: 1,
          project: { id: 1, name: "Project One" },
        },
        {
          id: "r2",
          entityType: "RUN",
          entityId: 300,
          projectId: 2,
          project: { id: 2, name: "Project Two" },
        },
      ],
      isLoading: false,
      enabled: true,
    });

    renderComponent();

    const reviews = await screen.findByTestId("profile-assignments-reviews");
    expect(reviews.textContent).toContain("reviews:2");

    // Side-fetch maps are empty, so entities render their fallback labels.
    const caseRow = screen.getByTestId("profile-assignments-review-r1");
    expect(caseRow.textContent).toContain("CASE #101");
    expect(caseRow.textContent).toContain("Project One");
    const runRow = screen.getByTestId("profile-assignments-review-r2");
    expect(runRow.textContent).toContain("RUN #300");
  });

  it("sorts runs by name via the header column menu", async () => {
    mockFetchWith(dashboardData);

    renderComponent();

    const runRow = await screen.findByTestId("profile-assignments-run-100");
    const runTable = runRow.closest("table")!;
    const rowIds = () =>
      within(runTable)
        .getAllByTestId(/^profile-assignments-run-/)
        .map((el) => el.getAttribute("data-testid"));

    // Default sort is name ascending: "Alpha Run" before "Run A".
    expect(rowIds()).toEqual([
      "profile-assignments-run-300",
      "profile-assignments-run-100",
    ]);

    // Descending via the name column's header menu (the standard sort UI).
    const trigger = within(runTable).getAllByRole("button", {
      name: "columnOptions",
    })[0];
    fireEvent.pointerDown(trigger);
    fireEvent.click(screen.getByText("sortDesc"));
    expect(rowIds()).toEqual([
      "profile-assignments-run-100",
      "profile-assignments-run-300",
    ]);
  });

  it("shows the empty state when nothing is assigned", async () => {
    mockFetchWith({
      untestedStatusId: UNTESTED_STATUS_ID,
      testRunCasesAssigned: [],
      assignedSessions: [],
    });

    renderComponent();

    expect(
      await screen.findByTestId("profile-assignments-empty")
    ).toBeInTheDocument();
  });
});
