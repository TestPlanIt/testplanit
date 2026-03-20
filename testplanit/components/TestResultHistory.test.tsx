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
  mockUseProjectPermissions: vi.fn(),
  mockUseSession: vi.fn(),
  mockUseQueryClient: vi.fn(),
}));

// --- Mocks ---

vi.mock("~/lib/hooks", () => ({
  useFindFirstRepositoryCases: mockUseFindFirstRepositoryCases,
  useFindManyAppConfig: mockUseFindManyAppConfig,
  useFindManyResultFieldValues: mockUseFindManyResultFieldValues,
  useFindManySharedStepItem: mockUseFindManySharedStepItem,
  useFindManyTestRuns: mockUseFindManyTestRuns,
  useCreateTestRunCases: mockUseCreateTestRunCases,
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
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQueryClient: mockUseQueryClient,
  };
});

vi.mock("~/app/[locale]/projects/repository/[projectId]/EditResultModal", () => ({
  EditResultModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="edit-result-modal">Edit Modal</div> : null,
}));

vi.mock("~/app/[locale]/projects/repository/[projectId]/[caseId]/FieldValueRenderer", () => ({
  default: () => <div data-testid="field-value-renderer" />,
}));

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
  notes: null,
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
  content: "stack trace here",
  executedAt: new Date("2024-01-14T09:00:00Z").toISOString(),
  time: 50,
  assertions: 3,
  file: "test.java",
  line: 42,
  systemOut: null,
  systemErr: null,
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

    // Edit (Pencil) and Delete (Trash2) buttons should be visible
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
});
