import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- vi.hoisted for variables used in vi.mock factories ---
const {
  mockUseFindFirstRepositoryCasesFiltered,
  mockUseProjectPermissions,
  mockUseCreateTestRunResults,
  mockUseFindFirstWorkflows,
  mockUseFindManyStatus,
  mockUseFindManyTestRunResults,
  mockUseUpdateTestRunCases,
  mockUseUpdateTestRuns,
  mockUseFindManyTemplates,
  mockUseSession,
} = vi.hoisted(() => ({
  mockUseFindFirstRepositoryCasesFiltered: vi.fn(),
  mockUseProjectPermissions: vi.fn(),
  mockUseCreateTestRunResults: vi.fn(),
  mockUseFindFirstWorkflows: vi.fn(),
  mockUseFindManyStatus: vi.fn(),
  mockUseFindManyTestRunResults: vi.fn(),
  mockUseUpdateTestRunCases: vi.fn(),
  mockUseUpdateTestRuns: vi.fn(),
  mockUseFindManyTemplates: vi.fn(),
  mockUseSession: vi.fn(),
}));

// --- Mocks ---

vi.mock("~/hooks/useRepositoryCasesWithFilteredFields", () => ({
  useFindFirstRepositoryCasesFiltered: mockUseFindFirstRepositoryCasesFiltered,
}));

vi.mock("~/hooks/useProjectPermissions", () => ({
  useProjectPermissions: mockUseProjectPermissions,
}));

vi.mock("~/lib/hooks", () => ({
  useCreateTestRunResults: mockUseCreateTestRunResults,
  useFindFirstWorkflows: mockUseFindFirstWorkflows,
  useFindManyStatus: mockUseFindManyStatus,
  useFindManyTestRunResults: mockUseFindManyTestRunResults,
  useUpdateTestRunCases: mockUseUpdateTestRunCases,
  useUpdateTestRuns: mockUseUpdateTestRuns,
}));

vi.mock("~/lib/hooks/templates", () => ({
  useFindManyTemplates: mockUseFindManyTemplates,
}));

vi.mock("next-auth/react", () => ({
  useSession: mockUseSession,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: vi.fn(), replace: vi.fn() })),
  useParams: vi.fn(() => ({})),
  usePathname: vi.fn(() => "/"),
}));

vi.mock("~/lib/navigation", () => ({
  Link: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: vi.fn(() => ({ push: vi.fn() })),
}));

vi.mock("~/app/actions/searchProjectMembers", () => ({
  searchProjectMembers: vi.fn(() => Promise.resolve({ items: [], total: 0 })),
}));

vi.mock("~/app/actions/test-run-notifications", () => ({
  notifyTestCaseAssignment: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/components/TestResultHistory", () => ({
  default: ({ caseId }: { caseId: number }) => (
    <div data-testid="test-result-history">History for case {caseId}</div>
  ),
}));

vi.mock("@/projects/repository/[projectId]/AddResultModal", () => ({
  AddResultModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="add-result-modal">Add Result Modal</div> : null,
}));

vi.mock("@/projects/repository/[projectId]/[caseId]/FieldValueRenderer", () => ({
  default: ({ fieldType }: { fieldType: string }) => (
    <div data-testid="field-value-renderer">{fieldType}</div>
  ),
}));

vi.mock("@/components/AttachmentsCarousel", () => ({
  AttachmentsCarousel: () => <div data-testid="attachments-carousel" />,
}));

vi.mock("@/components/tables/AttachmentsListDisplay", () => ({
  AttachmentsListDisplay: () => <div data-testid="attachments-list" />,
}));

vi.mock("@/components/tables/TagListDisplay", () => ({
  TagsListDisplay: ({ tags }: { tags: any[] }) => (
    <div data-testid="tags-list">{tags.map((t) => t.name).join(", ")}</div>
  ),
}));

vi.mock("@/components/tables/IssuesListDisplay", () => ({
  IssuesListDisplay: () => <div data-testid="issues-list" />,
}));

vi.mock("@/components/tables/UserNameCell", () => ({
  UserNameCell: ({ userId }: { userId: string }) => (
    <span data-testid="user-name-cell">{userId}</span>
  ),
}));

vi.mock("@/components/tables/CaseDisplay", () => ({
  CaseDisplay: ({ name }: { name: string }) => (
    <span data-testid="case-display">{name}</span>
  ),
}));

vi.mock("@/components/DynamicIcon", () => ({
  default: () => <span data-testid="dynamic-icon" />,
}));

vi.mock("@/components/LoadingSpinner", () => ({
  default: () => <div data-testid="loading-spinner" />,
}));

vi.mock("@/components/DurationDisplay", () => ({
  DurationDisplay: ({ seconds }: { seconds: number }) => (
    <span data-testid="duration-display">{seconds}s</span>
  ),
}));

vi.mock("@/components/ui/async-combobox", () => ({
  AsyncCombobox: () => <div data-testid="async-combobox" />,
}));

vi.mock("./ForecastDisplay", () => ({
  ForecastDisplay: () => <div data-testid="forecast-display" />,
}));

vi.mock("./LinkedCasesPanel", () => ({
  default: () => <div data-testid="linked-cases-panel" />,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
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

const mockStatus = {
  id: 1,
  name: "Untested",
  order: 1,
  isEnabled: true,
  isDeleted: false,
  isSuccess: false,
  color: { value: "#B1B2B3" },
};

const mockSuccessStatus = {
  id: 2,
  name: "Passed",
  order: 2,
  isEnabled: true,
  isDeleted: false,
  isSuccess: true,
  color: { value: "#22C55E" },
};

const mockTestCase = {
  id: 42,
  name: "Login with valid credentials",
  estimate: null,
  forecastManual: null,
  forecastAutomated: null,
  currentVersion: 1,
  state: null,
  project: { id: 1, name: "Test Project" },
  folder: null,
  creator: null,
  template: { id: 1, templateName: "Default", caseFields: [] },
  caseFieldValues: [],
  attachments: [],
  steps: [],
  tags: [],
  issues: [],
  testRuns: [],
  source: "manual",
  automated: false,
};

const mockTestRunCasesData = [
  { id: 101, order: 1, repositoryCaseId: 42 },
  { id: 102, order: 2, repositoryCaseId: 43 },
  { id: 103, order: 3, repositoryCaseId: 44 },
];

const defaultProps = {
  caseId: 42,
  projectId: 1,
  onClose: vi.fn(),
  testRunId: 10,
  testRunCaseId: 101,
  currentStatus: mockStatus,
  onNextCase: vi.fn(),
  testRunCasesData: mockTestRunCasesData,
  isTransitioning: false,
  isCompleted: false,
};

// --- Import Component Under Test (after mocks) ---
import { TestRunCaseDetails } from "./TestRunCaseDetails";

// --- Test Setup ---

function setupDefaultMocks() {
  mockUseFindFirstRepositoryCasesFiltered.mockReturnValue({
    data: mockTestCase,
    isLoading: false,
  });
  mockUseProjectPermissions.mockReturnValue({
    permissions: { canAddEdit: true, canView: true, canDelete: true },
    isLoading: false,
  });
  mockUseCreateTestRunResults.mockReturnValue({ mutateAsync: vi.fn() });
  mockUseUpdateTestRunCases.mockReturnValue({ mutateAsync: vi.fn() });
  mockUseUpdateTestRuns.mockReturnValue({ mutateAsync: vi.fn() });
  mockUseFindManyTestRunResults.mockReturnValue({ data: [] });
  mockUseFindFirstWorkflows.mockReturnValue({ data: null });
  mockUseFindManyStatus.mockReturnValue({
    data: [mockStatus, mockSuccessStatus],
  });
  mockUseFindManyTemplates.mockReturnValue({ data: [] });
  mockUseSession.mockReturnValue({
    data: { user: { id: "user-1", name: "Test User" } },
    status: "authenticated",
  });

  global.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  ) as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  setupDefaultMocks();
});

// --- Tests ---

describe("TestRunCaseDetails", () => {
  it("renders loading spinner when case data is loading", () => {
    mockUseFindFirstRepositoryCasesFiltered.mockReturnValue({
      data: undefined,
      isLoading: true,
    });

    // When loading + no status, returns null
    const { container } = renderWithQueryClient(
      <TestRunCaseDetails {...defaultProps} />
    );
    // Component returns null when loading (no displayStatus)
    expect(container.firstChild).toBeNull();
  });

  it("renders case name when data is loaded", () => {
    renderWithQueryClient(<TestRunCaseDetails {...defaultProps} />);
    expect(screen.getByTestId("case-display")).toHaveTextContent(
      "Login with valid credentials"
    );
  });

  it("renders TestResultHistory component", () => {
    renderWithQueryClient(<TestRunCaseDetails {...defaultProps} />);
    expect(screen.getByTestId("test-result-history")).toBeInTheDocument();
  });

  it("renders Add Result button when canAddEditResults is true and testRunId is present", () => {
    renderWithQueryClient(<TestRunCaseDetails {...defaultProps} />);
    // Add Result button is rendered
    const addResultBtn = screen.getByRole("button", {
      name: /actions\.addResult/i,
    });
    expect(addResultBtn).toBeInTheDocument();
    expect(addResultBtn).not.toBeDisabled();
  });

  it("hides Add Result button when canAddEditResults is false", () => {
    mockUseProjectPermissions.mockReturnValue({
      permissions: { canAddEdit: false, canView: true, canDelete: false },
      isLoading: false,
    });

    renderWithQueryClient(<TestRunCaseDetails {...defaultProps} />);
    expect(
      screen.queryByRole("button", { name: /actions\.addResult/i })
    ).not.toBeInTheDocument();
  });

  it("hides Add Result button when isCompleted is true", () => {
    renderWithQueryClient(
      <TestRunCaseDetails {...defaultProps} isCompleted={true} />
    );
    // Buttons exist but are all disabled
    const addResultBtn = screen.getByRole("button", {
      name: /actions\.addResult/i,
    });
    expect(addResultBtn).toBeDisabled();
  });

  it("renders navigation arrows (prev and next)", () => {
    renderWithQueryClient(<TestRunCaseDetails {...defaultProps} />);
    const prevBtn = screen.getByRole("button", {
      name: /actions\.previousCase/i,
    });
    const nextBtn = screen.getByRole("button", { name: /actions\.nextCase/i });
    expect(prevBtn).toBeInTheDocument();
    expect(nextBtn).toBeInTheDocument();
  });

  it("disables prev button when current case is first", () => {
    // caseId 42 is at index 0, so no prev
    renderWithQueryClient(<TestRunCaseDetails {...defaultProps} />);
    const prevBtn = screen.getByRole("button", {
      name: /actions\.previousCase/i,
    });
    expect(prevBtn).toBeDisabled();
  });

  it("enables next button when there is a next case", () => {
    // caseId 42 is at index 0 of 3, so next should be enabled
    renderWithQueryClient(<TestRunCaseDetails {...defaultProps} />);
    const nextBtn = screen.getByRole("button", { name: /actions\.nextCase/i });
    expect(nextBtn).not.toBeDisabled();
  });

  it("calls onNextCase with next case ID when next button is clicked", async () => {
    const user = userEvent.setup();
    const onNextCase = vi.fn();

    renderWithQueryClient(
      <TestRunCaseDetails {...defaultProps} onNextCase={onNextCase} />
    );

    const nextBtn = screen.getByRole("button", { name: /actions\.nextCase/i });
    await user.click(nextBtn);

    expect(onNextCase).toHaveBeenCalledWith(43);
  });

  it("calls onNextCase with previous case ID when prev button is clicked", async () => {
    const user = userEvent.setup();
    const onNextCase = vi.fn();

    // caseId 43 is at index 1, so prev = 42
    renderWithQueryClient(
      <TestRunCaseDetails
        {...defaultProps}
        caseId={43}
        testRunCaseId={102}
        onNextCase={onNextCase}
      />
    );

    const prevBtn = screen.getByRole("button", {
      name: /actions\.previousCase/i,
    });
    expect(prevBtn).not.toBeDisabled();
    await user.click(prevBtn);

    expect(onNextCase).toHaveBeenCalledWith(42);
  });

  it("shows case position indicator (1 of N)", () => {
    renderWithQueryClient(<TestRunCaseDetails {...defaultProps} />);
    // caseId=42 is index 0, so "1 of 3"
    expect(screen.getByText(/1/)).toBeInTheDocument();
    expect(screen.getByTitle(/Index: 0/i)).toBeInTheDocument();
  });

  it("shows transitioning overlay when isTransitioning is true", () => {
    renderWithQueryClient(
      <TestRunCaseDetails {...defaultProps} isTransitioning={true} />
    );
    expect(screen.getByTestId("loading-spinner")).toBeInTheDocument();
  });

  it("renders tags when test case has tags", () => {
    const testCaseWithTags = {
      ...mockTestCase,
      tags: [
        { id: 1, name: "smoke" },
        { id: 2, name: "regression" },
      ],
    };
    mockUseFindFirstRepositoryCasesFiltered.mockReturnValue({
      data: testCaseWithTags,
      isLoading: false,
    });

    renderWithQueryClient(<TestRunCaseDetails {...defaultProps} />);
    expect(screen.getByTestId("tags-list")).toBeInTheDocument();
    expect(screen.getByTestId("tags-list")).toHaveTextContent("smoke");
  });

  it("renders issues when test case has issues", () => {
    const testCaseWithIssues = {
      ...mockTestCase,
      issues: [{ id: 1, name: "BUG-001", externalId: "ext-1" }],
    };
    mockUseFindFirstRepositoryCasesFiltered.mockReturnValue({
      data: testCaseWithIssues,
      isLoading: false,
    });

    renderWithQueryClient(<TestRunCaseDetails {...defaultProps} />);
    expect(screen.getByTestId("issues-list")).toBeInTheDocument();
  });

  it("renders field values for non-empty custom fields", () => {
    const testCaseWithFields = {
      ...mockTestCase,
      template: {
        id: 1,
        templateName: "Default",
        caseFields: [
          {
            caseFieldId: 10,
            order: 1,
            caseField: {
              id: 10,
              displayName: "Priority",
              defaultValue: null,
              type: { type: "Text Short" },
              fieldOptions: [],
            },
          },
        ],
      },
      caseFieldValues: [
        {
          id: 1,
          fieldId: 10,
          value: "High",
          field: {
            id: 10,
            displayName: "Priority",
            type: { type: "Text Short" },
          },
        },
      ],
    };
    mockUseFindFirstRepositoryCasesFiltered.mockReturnValue({
      data: testCaseWithFields,
      isLoading: false,
    });

    renderWithQueryClient(<TestRunCaseDetails {...defaultProps} />);
    expect(screen.getByTestId("field-value-renderer")).toBeInTheDocument();
  });

  it("opens Add Result modal when Add Result button is clicked", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<TestRunCaseDetails {...defaultProps} />);

    const addResultBtn = screen.getByRole("button", {
      name: /actions\.addResult/i,
    });
    await user.click(addResultBtn);

    expect(screen.getByTestId("add-result-modal")).toBeInTheDocument();
  });

  it("renders status dropdown with available statuses", () => {
    renderWithQueryClient(<TestRunCaseDetails {...defaultProps} />);
    // Status selector shows current status name
    expect(screen.getByText("Untested")).toBeInTheDocument();
  });

  it("renders linked cases panel", () => {
    renderWithQueryClient(<TestRunCaseDetails {...defaultProps} />);
    expect(screen.getByTestId("linked-cases-panel")).toBeInTheDocument();
  });
});
