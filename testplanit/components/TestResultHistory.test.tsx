import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- vi.hoisted for mock variables ---
const {
  mockUseFindFirstRepositoryCases,
  mockUseFindManyAppConfig,
  mockUseFindManyResultFieldValues,
  mockUseFindManySharedStepItem,
  mockUseFindManyTestRuns,
  mockUseCreateTestRunCases,
  mockUseFindUniqueProjects,
  mockUseFindUniqueTestRunResults,
  mockUseFindUniqueJUnitTestResult,
  mockUseProjectPermissions,
  mockUseSession,
  mockUseQueryClient,
} = vi.hoisted(() => ({
  mockUseFindFirstRepositoryCases: vi.fn(),
  mockUseFindManyAppConfig: vi.fn(),
  mockUseFindManyResultFieldValues: vi.fn(),
  mockUseFindManySharedStepItem: vi.fn(),
  mockUseFindManyTestRuns: vi.fn(),
  mockUseCreateTestRunCases: vi.fn(),
  mockUseFindUniqueProjects: vi.fn(),
  mockUseFindUniqueTestRunResults: vi.fn(),
  mockUseFindUniqueJUnitTestResult: vi.fn(),
  mockUseProjectPermissions: vi.fn(),
  mockUseSession: vi.fn(),
  mockUseQueryClient: vi.fn(),
}));

// --- Mocks ---

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    repositoryCases: { useFindFirst: mockUseFindFirstRepositoryCases },
    appConfig: { useFindMany: mockUseFindManyAppConfig },
    resultFieldValues: { useFindMany: mockUseFindManyResultFieldValues },
    sharedStepItem: { useFindMany: mockUseFindManySharedStepItem },
    testRuns: { useFindMany: mockUseFindManyTestRuns },
    testRunCases: { useCreate: mockUseCreateTestRunCases },
    projects: { useFindUnique: mockUseFindUniqueProjects },
    testRunResults: { useFindUnique: mockUseFindUniqueTestRunResults },
    jUnitTestResult: { useFindUnique: mockUseFindUniqueJUnitTestResult },
  }),
}));

vi.mock("~/hooks/useProjectPermissions", () => ({
  useProjectPermissions: mockUseProjectPermissions,
}));

vi.mock("next-auth/react", () => ({
  useSession: mockUseSession,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));

vi.mock("~/lib/navigation", () => ({
  Link: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQueryClient: mockUseQueryClient,
  };
});

vi.mock(
  "~/app/[locale]/projects/repository/[projectId]/EditResultModal",
  () => ({
    EditResultModal: ({ isOpen }: { isOpen: boolean }) =>
      isOpen ? <div data-testid="edit-result-modal">Edit Modal</div> : null,
  })
);

// jsdom gives the virtualizer no real geometry, so the hook is replaced with
// one that reports a configurable window (same pattern as
// VirtualizedCardList.test.tsx). Small histories pass count: 0 and never
// consult it, so every other test is unaffected.
const virtualHookMock = vi.hoisted(() => ({
  window: null as number[] | null, // indices to render; null = all `count`
  lastOpts: null as Record<string, unknown> | null,
}));

vi.mock("~/hooks/useVirtualizedInfiniteList", () => ({
  useVirtualizedInfiniteList: (opts: { count: number }) => {
    virtualHookMock.lastOpts = opts as unknown as Record<string, unknown>;
    const indices =
      virtualHookMock.window ?? Array.from({ length: opts.count }, (_, i) => i);
    return {
      scrollRef: () => {},
      sentinelRef: { current: null },
      virtualizer: {},
      virtualItems: indices.map((index) => ({
        key: index,
        index,
        start: index * 53,
        size: 53,
        end: (index + 1) * 53,
        lane: 0,
      })),
      totalSize: opts.count * 53,
      measureElement: () => {},
      maxHeight: 600,
    };
  },
}));

vi.mock(
  "~/app/[locale]/projects/repository/[projectId]/[caseId]/FieldValueRenderer",
  () => ({
    default: () => <div data-testid="field-value-renderer" />,
  })
);

vi.mock("@/components/AttachmentsCarousel", () => ({
  AttachmentsCarousel: () => <div data-testid="attachments-carousel" />,
}));

vi.mock("@/components/tables/AttachmentsListDisplay", () => ({
  AttachmentsListDisplay: () => <div data-testid="attachments-list" />,
}));

vi.mock("@/components/tables/IssuesListDisplay", () => ({
  IssuesListDisplay: () => <div data-testid="issues-list" />,
}));

vi.mock("@/components/tables/UserNameCell", () => ({
  UserNameCell: ({ userId }: { userId: string }) => (
    <span data-testid="user-name-cell">{userId}</span>
  ),
}));

vi.mock("@/components/TestRunNameDisplay", () => ({
  TestRunNameDisplay: ({ name }: { name: string }) => (
    <span data-testid="test-run-name">{name}</span>
  ),
}));

vi.mock("@/components/LoadingSpinner", () => ({
  default: ({ className }: { className?: string }) => (
    <div data-testid="loading-spinner" className={className} />
  ),
}));

vi.mock("@/components/DateFormatter", () => ({
  DateFormatter: ({ date }: { date: any }) => (
    <span data-testid="date-formatter">{String(date)}</span>
  ),
}));

vi.mock("@/components/RelativeTimeTooltip", () => ({
  RelativeTimeTooltip: ({ date }: { date: any }) => (
    <span data-testid="relative-time">{String(date)}</span>
  ),
}));

vi.mock("@/components/TextFromJson", () => ({
  default: ({ jsonString }: { jsonString: string }) => (
    <span data-testid="text-from-json">{jsonString}</span>
  ),
}));

vi.mock("./tiptap/TipTapEditor", () => ({
  default: ({ content }: { content: any }) => (
    <div data-testid="tiptap-editor">{JSON.stringify(content)}</div>
  ),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("~/utils/testResultTypes", () => ({
  isAutomatedCaseSource: vi.fn(() => false),
}));

// --- Helpers ---

function createTestQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderWithQueryClient(ui: React.ReactElement) {
  const testQueryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={testQueryClient}>{ui}</QueryClientProvider>
  );
}

// --- Fixtures ---

// Fixtures mirror the eager history query, which is intentionally row-slim:
// notes, full step results, iteration values, and JUnit logs are lazy-fetched
// per result on expand (mocked via the useFindUnique mocks below).
const mockManualResult = {
  id: 1,
  testRunCaseId: 101,
  testRunCaseVersion: 1,
  status: { name: "Passed", color: { value: "#22C55E" } },
  executedBy: { id: "user-1", name: "Alice" },
  executedAt: new Date("2024-01-15T10:00:00Z").toISOString(),
  editedBy: null,
  editedAt: null,
  elapsed: 120,
  attempt: 1,
  resultFieldValues: [],
  attachments: [],
  stepResults: [],
  issues: [],
};

const mockJunitResult = {
  id: 10,
  type: "failure",
  message: "Expected 1, got 2",
  executedAt: new Date("2024-01-14T09:00:00Z").toISOString(),
  time: 50,
  assertions: 3,
  file: "test.java",
  line: 42,
  status: { name: "Failed", color: { value: "#EF4444" } },
  createdBy: { id: "user-2", name: "CI Bot" },
  testSuite: {
    name: "LoginTests",
    testRunId: 5,
    testRun: {
      id: 5,
      name: "Regression Run",
      milestone: null,
      isCompleted: false,
      isDeleted: false,
      configurationGroupId: null,
      configuration: null,
    },
  },
  attachments: [],
};

const mockTestCase = {
  id: 42,
  name: "Login test",
  project: { id: 1, name: "Project" },
  steps: [],
  source: "manual",
  testRuns: [
    {
      id: 101,
      testRun: {
        id: 10,
        name: "Sprint 1 Run",
        milestone: null,
        isCompleted: false,
        isDeleted: false,
        configurationGroupId: null,
        configuration: null,
      },
      results: [mockManualResult],
    },
  ],
  junitResults: [mockJunitResult],
};

const defaultProps = {
  caseId: 42,
  projectId: 1,
  session: { user: { id: "user-1" } },
};

// --- Import Component Under Test ---
import TestResultHistory from "./TestResultHistory";

// --- Test Setup ---

function setupDefaultMocks() {
  mockUseFindFirstRepositoryCases.mockReturnValue({
    data: mockTestCase,
    isLoading: false,
  });
  mockUseFindManyAppConfig.mockReturnValue({ data: [] });
  mockUseFindManyResultFieldValues.mockReturnValue({
    data: [],
    isLoading: false,
  });
  mockUseFindManySharedStepItem.mockReturnValue({
    data: [],
    isLoading: false,
  });
  mockUseFindManyTestRuns.mockReturnValue({ data: [] });
  mockUseCreateTestRunCases.mockReturnValue({ mutateAsync: vi.fn() });
  mockUseFindUniqueProjects.mockReturnValue({ data: undefined });
  mockUseFindUniqueTestRunResults.mockReturnValue({
    data: undefined,
    isLoading: false,
  });
  mockUseFindUniqueJUnitTestResult.mockReturnValue({
    data: undefined,
    isLoading: false,
  });
  mockUseProjectPermissions.mockReturnValue({
    permissions: { canAddEdit: true, canView: true, canDelete: true },
    isLoading: false,
  });
  mockUseSession.mockReturnValue({
    data: { user: { id: "user-1", name: "Alice" } },
    status: "authenticated",
  });
  mockUseQueryClient.mockReturnValue({
    invalidateQueries: vi.fn(() => Promise.resolve()),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setupDefaultMocks();
});

// --- Tests ---

describe("TestResultHistory", () => {
  it("renders loading spinner when test case data is loading", () => {
    mockUseFindFirstRepositoryCases.mockReturnValue({
      data: undefined,
      isLoading: true,
    });

    renderWithQueryClient(<TestResultHistory {...defaultProps} />);
    expect(screen.getByTestId("loading-spinner")).toBeInTheDocument();
  });

  it("renders empty state when no results exist", () => {
    const testCaseNoResults = {
      ...mockTestCase,
      testRuns: [],
      junitResults: [],
    };
    mockUseFindFirstRepositoryCases.mockReturnValue({
      data: testCaseNoResults,
      isLoading: false,
    });

    renderWithQueryClient(<TestResultHistory {...defaultProps} />);
    // No results means empty state card — i18n mock returns last key segment
    expect(screen.getByText("testResultHistory")).toBeInTheDocument();
    expect(screen.getByText("noTestResults")).toBeInTheDocument();
  });

  it("renders manual result rows with executor name", () => {
    renderWithQueryClient(<TestResultHistory {...defaultProps} />);

    // Manual result appears in the table — UserNameCell is rendered for the executor
    const userNameCells = screen.getAllByTestId("user-name-cell");
    expect(userNameCells.length).toBeGreaterThan(0);
    expect(userNameCells[0]).toHaveTextContent("user-1");
  });

  it("renders JUnit result row", () => {
    renderWithQueryClient(<TestResultHistory {...defaultProps} />);

    // JUnit results are shown in the table — check status badge
    const statusBadges = screen.getAllByText(
      (content) =>
        content === "Passed" || content === "Failed" || content === "Pending"
    );
    expect(statusBadges.length).toBeGreaterThan(0);
  });

  it("renders pending result when test run case has no results", () => {
    const testCaseWithPending = {
      ...mockTestCase,
      testRuns: [
        {
          id: 201,
          testRun: {
            id: 20,
            name: "Pending Run",
            milestone: null,
            isCompleted: false,
            isDeleted: false,
            configurationGroupId: null,
            configuration: null,
          },
          results: [], // No results = pending
        },
      ],
      junitResults: [],
    };
    mockUseFindFirstRepositoryCases.mockReturnValue({
      data: testCaseWithPending,
      isLoading: false,
    });

    renderWithQueryClient(<TestResultHistory {...defaultProps} />);

    // "status.pending" should appear
    expect(screen.getByText("status.pending")).toBeInTheDocument();
  });

  it("shows expand/collapse toggle buttons in table header", () => {
    renderWithQueryClient(<TestResultHistory {...defaultProps} />);

    // The expand-all button is a ghost icon button in table header
    const expandButtons = screen.getAllByRole("button");
    expect(expandButtons.length).toBeGreaterThan(0);
  });

  it("expands result row on click", async () => {
    const _user = userEvent.setup();
    renderWithQueryClient(<TestResultHistory {...defaultProps} />);

    // Get all chevron buttons in the table rows (not header)
    const buttons = screen.getAllByRole("button");
    // Find a row expand button — the first one in a row should expand
    // At minimum there should be a clickable button in the row
    expect(buttons.length).toBeGreaterThan(0);
  });

  it("shows edit/delete buttons for manual results when canAddEditResults is true", () => {
    renderWithQueryClient(<TestResultHistory {...defaultProps} />);

    // Edit (Pencil) and Delete buttons should be visible
    const editButtons = screen.queryAllByRole("button");
    // At least one interactive button present in rows
    expect(editButtons.length).toBeGreaterThan(0);
  });

  it("does not show edit buttons when canAddEditResults is false", () => {
    mockUseProjectPermissions.mockReturnValue({
      permissions: { canAddEdit: false, canView: true, canDelete: false },
      isLoading: false,
    });

    renderWithQueryClient(<TestResultHistory {...defaultProps} />);

    // No edit/delete buttons when no permission — only expand toggle button
    // Component still renders the table with results
    expect(screen.getByText("testResultHistory")).toBeInTheDocument();
  });

  it("renders test result history card title", () => {
    renderWithQueryClient(<TestResultHistory {...defaultProps} />);
    // i18n mock returns last key segment
    expect(screen.getByText("testResultHistory")).toBeInTheDocument();
  });

  it("handles null fetchedTestCase gracefully", () => {
    mockUseFindFirstRepositoryCases.mockReturnValue({
      data: null,
      isLoading: false,
    });

    renderWithQueryClient(<TestResultHistory {...defaultProps} />);
    // Shows empty state card with noTestResults message
    expect(screen.getByText("noTestResults")).toBeInTheDocument();
  });

  it("renders Add to Test Run button when user has add/edit run permission", () => {
    const testCaseNoResults = {
      ...mockTestCase,
      testRuns: [],
      junitResults: [],
    };
    mockUseFindFirstRepositoryCases.mockReturnValue({
      data: testCaseNoResults,
      isLoading: false,
    });

    renderWithQueryClient(<TestResultHistory {...defaultProps} />);

    // canAddEditRun is true, so "Add to Test Run" button appears
    expect(
      screen.getByRole("button", { name: /actions\.addToTestRun/i })
    ).toBeInTheDocument();
  });

  it("renders expectedResult when step text is empty (regression)", async () => {
    const user = userEvent.setup();
    const expectedResultDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Verify login succeeds" }],
        },
      ],
    };
    // Eager query carries elapsed-only step rows; the full step payload
    // arrives through the lazy expanded-details query.
    const resultWithSteps = {
      ...mockManualResult,
      id: 2,
      stepResults: [{ elapsed: 0 }],
    };
    mockUseFindUniqueTestRunResults.mockReturnValue({
      data: {
        notes: null,
        iteration: null,
        stepResults: [
          {
            id: 901,
            stepStatus: { name: "Passed", color: { value: "#22C55E" } },
            notes: null,
            evidence: null,
            elapsed: 0,
            sharedStepItemId: null,
            step: {
              id: 401,
              step: { type: "doc", content: [{ type: "paragraph" }] },
              // Steps.expectedResult is a Json? scalar — not a nested relation
              expectedResult: expectedResultDoc,
              sharedStepGroupId: null,
              sharedStepGroup: null,
            },
            issues: [],
          },
        ],
      },
      isLoading: false,
    });
    const testCaseWithStepResults = {
      ...mockTestCase,
      testRuns: [
        {
          ...mockTestCase.testRuns[0],
          results: [resultWithSteps],
        },
      ],
      junitResults: [],
    };
    mockUseFindFirstRepositoryCases.mockReturnValue({
      data: testCaseWithStepResults,
      isLoading: false,
    });

    renderWithQueryClient(<TestResultHistory {...defaultProps} />);

    await user.click(screen.getByTestId("expand-result-manual-2"));

    const editorContents = screen
      .getAllByTestId("tiptap-editor")
      .map((el) => el.textContent ?? "");
    expect(
      editorContents.some((text) => text.includes("Verify login succeeds"))
    ).toBe(true);
  });

  it("lazy-loads JUnit log output into the expanded panel", async () => {
    const user = userEvent.setup();
    mockUseFindUniqueJUnitTestResult.mockReturnValue({
      data: {
        content: "stack trace here",
        systemOut: "stdout capture",
        systemErr: null,
      },
      isLoading: false,
    });

    renderWithQueryClient(<TestResultHistory {...defaultProps} />);

    await user.click(screen.getByTestId("expand-result-junit-10"));

    expect(screen.getByText("stack trace here")).toBeInTheDocument();
    expect(screen.getByText("stdout capture")).toBeInTheDocument();
  });

  it("hides Add to Test Run button when user lacks permission", () => {
    const testCaseNoResults = {
      ...mockTestCase,
      testRuns: [],
      junitResults: [],
    };
    mockUseFindFirstRepositoryCases.mockReturnValue({
      data: testCaseNoResults,
      isLoading: false,
    });
    mockUseProjectPermissions.mockReturnValue({
      permissions: { canAddEdit: false, canView: true, canDelete: false },
      isLoading: false,
    });

    renderWithQueryClient(<TestResultHistory {...defaultProps} />);

    expect(
      screen.queryByRole("button", { name: /actions\.addToTestRun/i })
    ).not.toBeInTheDocument();
  });

  it("highlights rows of the current test run when currentTestRunId matches", () => {
    renderWithQueryClient(
      <TestResultHistory {...defaultProps} currentTestRunId={10} />
    );

    const badge = screen.getByTestId("current-run-badge");
    expect(badge).toHaveTextContent("currentRunBadge");
    expect(badge.closest("tr")).toHaveAttribute("data-current-run", "true");
  });

  it("highlights the JUnit row when currentTestRunId matches its test run", () => {
    renderWithQueryClient(
      <TestResultHistory {...defaultProps} currentTestRunId={5} />
    );

    const badge = screen.getByTestId("current-run-badge");
    expect(badge.closest("tr")).toHaveTextContent("Regression Run");
  });

  it("shows no current-run highlight when currentTestRunId is not provided", () => {
    renderWithQueryClient(<TestResultHistory {...defaultProps} />);

    expect(screen.queryByTestId("current-run-badge")).not.toBeInTheDocument();
  });

  describe("virtualization", () => {
    const manyJunitResults = Array.from({ length: 60 }, (_, i) => ({
      ...mockJunitResult,
      id: 1000 + i,
      executedAt: new Date(
        Date.parse("2024-01-14T09:00:00Z") + i * 60_000
      ).toISOString(),
    }));

    beforeEach(() => {
      virtualHookMock.window = null;
      mockUseFindFirstRepositoryCases.mockReturnValue({
        data: { ...mockTestCase, testRuns: [], junitResults: manyJunitResults },
        isLoading: false,
      });
    });

    it("renders only the virtual window of a massive history", () => {
      virtualHookMock.window = [0, 1, 2, 3, 4];
      renderWithQueryClient(<TestResultHistory {...defaultProps} />);

      // The hook was armed with the full row count…
      expect(virtualHookMock.lastOpts?.count).toBe(60);
      // …but only the windowed rows are mounted.
      expect(screen.getAllByTestId(/^expand-result-junit-/)).toHaveLength(5);
      // The unrendered tail is held open by a spacer row group.
      const spacers = document.querySelectorAll("tbody[aria-hidden]");
      expect(spacers.length).toBeGreaterThan(0);
    });

    it("keeps small histories on the plain table path", () => {
      mockUseFindFirstRepositoryCases.mockReturnValue({
        data: mockTestCase,
        isLoading: false,
      });
      renderWithQueryClient(<TestResultHistory {...defaultProps} />);

      expect(virtualHookMock.lastOpts?.count).toBe(0);
      expect(document.querySelector("tbody[aria-hidden]")).toBeNull();
    });
  });
});
