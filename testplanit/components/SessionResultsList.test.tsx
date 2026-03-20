import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { Session } from "next-auth";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- vi.hoisted for variables used in vi.mock factories ---
// CRITICAL: Use stable references to prevent infinite useEffect loops caused by new
// array/object references on each mock call.
const mockUseSession = vi.hoisted(() => vi.fn());
const mockUseParams = vi.hoisted(() => vi.fn());
const mockUseTranslations = vi.hoisted(() => vi.fn());
const mockUseLocale = vi.hoisted(() => vi.fn());
const mockUseProjectPermissions = vi.hoisted(() => vi.fn());
const mockUsePathname = vi.hoisted(() => vi.fn());
const mockUseRouter = vi.hoisted(() => vi.fn());

// Stable empty array shared across all hooks that return arrays — prevents
// infinite re-render loops in useEffect([..., data]) dependency arrays
const stableEmptyArray = vi.hoisted(() => [] as any[]);

// Stable form object to prevent infinite loops from useEffect([..., form])
const stableFormObject = vi.hoisted(() => ({
  control: {},
  handleSubmit: vi.fn(),
  register: vi.fn(),
  formState: { errors: {}, defaultValues: {} },
  watch: vi.fn(),
  setValue: vi.fn(),
  getValues: vi.fn(() => ({})),
  reset: vi.fn(),
  trigger: vi.fn().mockResolvedValue(true),
  clearErrors: vi.fn(),
  getFieldState: vi.fn(() => ({ isDirty: false, invalid: false, isTouched: false })),
}));

const mockChildren = vi.hoisted(() => ({ children }: any) => children || null);
const mockField = vi.hoisted(() => ({
  value: "",
  onChange: vi.fn(),
  onBlur: vi.fn(),
  name: "field",
  ref: vi.fn(),
}));

// --- ZenStack hook mocks ---
vi.mock("~/lib/hooks", () => ({
  useFindManySessionResults: vi.fn(() => ({
    data: stableEmptyArray,
    isLoading: false,
    refetch: vi.fn(),
  })),
  useFindManyStatus: vi.fn(() => ({
    data: stableEmptyArray,
    isLoading: false,
  })),
  useFindFirstProjects: vi.fn(() => ({ data: null, isLoading: false })),
  useFindManyTemplateResultAssignment: vi.fn(() => ({
    data: stableEmptyArray,
    isLoading: false,
  })),
  useUpdateSessionResults: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useCreateAttachments: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useUpdateAttachments: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useCreateResultFieldValues: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useUpdateResultFieldValues: vi.fn(() => ({ mutateAsync: vi.fn() })),
}));

// --- next-auth ---
vi.mock("next-auth/react", () => ({
  useSession: mockUseSession,
}));

// --- next/navigation ---
vi.mock("next/navigation", () => ({
  useParams: mockUseParams,
}));

// --- next-intl ---
vi.mock("next-intl", () => ({
  useTranslations: mockUseTranslations,
  useLocale: mockUseLocale,
}));

// --- ~/hooks/useProjectPermissions ---
vi.mock("~/hooks/useProjectPermissions", () => ({
  useProjectPermissions: mockUseProjectPermissions,
}));

// --- ~/lib/navigation ---
vi.mock("~/lib/navigation", () => ({
  Link: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  usePathname: mockUsePathname,
  useRouter: mockUseRouter,
}));

// --- Heavy sub-component mocks ---
vi.mock("@/components/tiptap/TipTapEditor", () => ({
  default: ({ content: _content, readOnly, placeholder }: any) => (
    <div
      data-testid="tiptap-editor"
      data-readonly={readOnly ? "true" : "false"}
      data-placeholder={placeholder}
    />
  ),
}));

vi.mock("@/components/DateFormatter", () => ({
  DateFormatter: ({ date }: { date: any }) => (
    <span data-testid="date-formatter">{new Date(date).toISOString()}</span>
  ),
}));

vi.mock("@/components/AttachmentsCarousel", () => ({
  AttachmentsCarousel: () => <div data-testid="attachments-carousel" />,
}));

vi.mock("@/components/AttachmentsDisplay", () => ({
  AttachmentsDisplay: () => <div data-testid="attachments-display" />,
  AttachmentChanges: vi.fn(),
}));

vi.mock("@/components/UploadAttachments", () => ({
  default: () => <div data-testid="upload-attachments" />,
}));

vi.mock("@/components/LoadingSpinner", () => ({
  default: () => <div data-testid="loading-spinner" />,
}));

vi.mock("@/components/tables/UserNameCell", () => ({
  UserNameCell: ({ userId }: { userId: string }) => (
    <span data-testid="user-name-cell">{userId}</span>
  ),
}));

vi.mock("@/components/tables/IssuesListDisplay", () => ({
  IssuesListDisplay: () => <div data-testid="issues-list-display" />,
}));

vi.mock("@/components/issues/UnifiedIssueManager", () => ({
  SimpleUnifiedIssueManager: () => <div data-testid="issue-manager" />,
}));

// --- react-hook-form mocks (stable form reference) ---
vi.mock("react-hook-form", () => ({
  useForm: vi.fn(() => stableFormObject),
  Controller: ({ render: renderFn }: any) => renderFn({ field: mockField }),
  FormProvider: mockChildren,
  useFormContext: vi.fn(() => ({
    control: {},
    getFieldState: vi.fn(() => ({
      invalid: false,
      isDirty: false,
      isTouched: false,
      error: undefined,
    })),
    formState: { errors: {} },
  })),
}));

vi.mock("@hookform/resolvers/zod", () => ({
  zodResolver: vi.fn(() => async () => ({ values: {}, errors: {} })),
}));

vi.mock("@/components/ui/form", () => ({
  Form: mockChildren,
  FormField: ({ render: renderFn }: any) =>
    renderFn({ field: mockField }),
  FormItem: mockChildren,
  FormLabel: mockChildren,
  FormControl: mockChildren,
  FormMessage: () => null,
  FormDescription: mockChildren,
}));

// --- Utility mocks ---
vi.mock("~/utils/colorUtils", () => ({
  getBackgroundStyle: vi.fn(() => ({
    backgroundColor: "rgba(59,130,246,0.1)",
  })),
}));

vi.mock("~/utils/duration", () => ({
  toHumanReadable: vi.fn((val: any) => `${val}s`),
}));

vi.mock("~/utils/fetchSignedUrl", () => ({
  fetchSignedUrl: vi.fn(),
}));

// --- app/constants ---
vi.mock("~/app/constants", () => ({
  emptyEditorContent: { type: "doc", content: [{ type: "paragraph" }] },
  MAX_DURATION: 86400,
}));

// --- sonner toast mock ---
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// --- Helpers ---
function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function renderWithQueryClient(ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      {ui}
    </QueryClientProvider>
  );
}

const mockSession: Session = {
  expires: "2099-01-01",
  user: {
    id: "user-123",
    name: "Test User",
    email: "test@example.com",
    image: "",
    access: "USER",
    preferences: {
      dateFormat: "MM/dd/yyyy",
      timeFormat: "HH:mm",
      timezone: "UTC",
    } as any,
  },
};

const mockStatuses = [
  { id: 1, name: "Pass", order: 1, color: { id: 1, value: "#22C55E" } },
  { id: 2, name: "Fail", order: 2, color: { id: 2, value: "#EF4444" } },
];

const buildMockResult = (overrides: Partial<any> = {}) => ({
  id: 1,
  sessionId: 1,
  statusId: 1,
  resultData: null,
  elapsed: null,
  createdAt: new Date("2024-01-01T10:00:00Z"),
  createdById: "user-123",
  isDeleted: false,
  createdBy: {
    id: "user-123",
    name: "Test User",
  },
  session: {
    id: 1,
    name: "Test Session",
    templateId: null,
  },
  status: {
    id: 1,
    name: "Pass",
    color: { id: 1, value: "#22C55E" },
  },
  attachments: stableEmptyArray,
  resultFieldValues: stableEmptyArray,
  issues: stableEmptyArray,
  ...overrides,
});

// Import after vi.mock
import {
  useFindManySessionResults,
  useFindManyStatus,
} from "~/lib/hooks";
import { SessionResultsList } from "./SessionResultsList";

beforeEach(() => {
  vi.clearAllMocks();

  mockUseSession.mockReturnValue({
    data: mockSession,
    status: "authenticated",
    update: vi.fn(),
  });
  mockUseParams.mockReturnValue({
    projectId: "1",
    sessionId: "1",
    locale: "en-US",
  });
  mockUseTranslations.mockReturnValue((key: string, _params?: any) => key);
  mockUseLocale.mockReturnValue("en-US");
  mockUseProjectPermissions.mockReturnValue({
    permissions: { canAddEdit: true },
    isLoading: false,
  });
  mockUsePathname.mockReturnValue("/en-US/projects/sessions/1/1");
  mockUseRouter.mockReturnValue({ push: vi.fn(), refresh: vi.fn() });

  // Re-mock with stable references after vi.clearAllMocks()
  (useFindManyStatus as ReturnType<typeof vi.fn>).mockReturnValue({
    data: mockStatuses,
    isLoading: false,
  });
  (useFindManySessionResults as ReturnType<typeof vi.fn>).mockReturnValue({
    data: stableEmptyArray,
    isLoading: false,
    refetch: vi.fn(),
  });
  // Re-set stable form (cleared by clearAllMocks)
  stableFormObject.trigger.mockResolvedValue(true);
});

describe("SessionResultsList", () => {
  it("renders empty state when no session results exist", () => {
    renderWithQueryClient(
      <SessionResultsList
        sessionId={1}
        projectId="1"
        canEditResults={true}
        canDeleteResults={true}
        isCompleted={false}
      />
    );

    // noResults translation key - t("noResults") returns "noResults" from our mock
    expect(screen.getByText("noResults")).toBeInTheDocument();
  });

  it("shows loading spinner when results are loading", () => {
    (useFindManySessionResults as ReturnType<typeof vi.fn>).mockReturnValue({
      data: null,
      isLoading: true,
      refetch: vi.fn(),
    });

    renderWithQueryClient(
      <SessionResultsList
        sessionId={1}
        projectId="1"
        canEditResults={true}
        canDeleteResults={true}
        isCompleted={false}
      />
    );

    expect(screen.getByTestId("loading-spinner")).toBeInTheDocument();
  });

  it("shows loading spinner when statuses are loading", () => {
    (useFindManyStatus as ReturnType<typeof vi.fn>).mockReturnValue({
      data: null,
      isLoading: true,
    });

    renderWithQueryClient(
      <SessionResultsList
        sessionId={1}
        projectId="1"
        canEditResults={true}
        canDeleteResults={true}
        isCompleted={false}
      />
    );

    expect(screen.getByTestId("loading-spinner")).toBeInTheDocument();
  });

  it("renders result cards with status name", () => {
    (useFindManySessionResults as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [buildMockResult()],
      isLoading: false,
      refetch: vi.fn(),
    });

    renderWithQueryClient(
      <SessionResultsList
        sessionId={1}
        projectId="1"
        canEditResults={true}
        canDeleteResults={true}
        isCompleted={false}
      />
    );

    expect(screen.getByText("Pass")).toBeInTheDocument();
  });

  it("renders user name cell for each result", () => {
    (useFindManySessionResults as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [buildMockResult()],
      isLoading: false,
      refetch: vi.fn(),
    });

    renderWithQueryClient(
      <SessionResultsList
        sessionId={1}
        projectId="1"
        canEditResults={true}
        canDeleteResults={true}
        isCompleted={false}
      />
    );

    expect(screen.getByTestId("user-name-cell")).toBeInTheDocument();
  });

  it("renders date formatter for result createdAt", () => {
    (useFindManySessionResults as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [buildMockResult()],
      isLoading: false,
      refetch: vi.fn(),
    });

    renderWithQueryClient(
      <SessionResultsList
        sessionId={1}
        projectId="1"
        canEditResults={true}
        canDeleteResults={true}
        isCompleted={false}
      />
    );

    expect(screen.getByTestId("date-formatter")).toBeInTheDocument();
  });

  it("shows edit button when user has canEditResults permission and session is not completed", () => {
    (useFindManySessionResults as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [buildMockResult({ createdById: "user-123" })],
      isLoading: false,
      refetch: vi.fn(),
    });

    renderWithQueryClient(
      <SessionResultsList
        sessionId={1}
        projectId="1"
        canEditResults={true}
        canDeleteResults={true}
        isCompleted={false}
      />
    );

    // Edit button is rendered when !isCompleted && canEditResults
    const editButton = screen.getByTitle("actions.edit");
    expect(editButton).toBeInTheDocument();
  });

  it("hides edit button when session is completed", () => {
    (useFindManySessionResults as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [buildMockResult()],
      isLoading: false,
      refetch: vi.fn(),
    });

    renderWithQueryClient(
      <SessionResultsList
        sessionId={1}
        projectId="1"
        canEditResults={true}
        canDeleteResults={true}
        isCompleted={true}
      />
    );

    expect(screen.queryByTitle("actions.edit")).not.toBeInTheDocument();
  });

  it("hides edit button when user lacks canEditResults permission", () => {
    (useFindManySessionResults as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [buildMockResult()],
      isLoading: false,
      refetch: vi.fn(),
    });

    renderWithQueryClient(
      <SessionResultsList
        sessionId={1}
        projectId="1"
        canEditResults={false}
        canDeleteResults={true}
        isCompleted={false}
      />
    );

    expect(screen.queryByTitle("actions.edit")).not.toBeInTheDocument();
  });

  it("shows delete button when user has canDeleteResults permission and session is not completed", () => {
    (useFindManySessionResults as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [buildMockResult()],
      isLoading: false,
      refetch: vi.fn(),
    });

    renderWithQueryClient(
      <SessionResultsList
        sessionId={1}
        projectId="1"
        canEditResults={true}
        canDeleteResults={true}
        isCompleted={false}
      />
    );

    expect(screen.getByTitle("actions.delete")).toBeInTheDocument();
  });

  it("hides delete button when session is completed", () => {
    (useFindManySessionResults as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [buildMockResult()],
      isLoading: false,
      refetch: vi.fn(),
    });

    renderWithQueryClient(
      <SessionResultsList
        sessionId={1}
        projectId="1"
        canEditResults={true}
        canDeleteResults={true}
        isCompleted={true}
      />
    );

    expect(screen.queryByTitle("actions.delete")).not.toBeInTheDocument();
  });

  it("renders elapsed time when result has elapsed value", () => {
    (useFindManySessionResults as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [buildMockResult({ elapsed: 120 })],
      isLoading: false,
      refetch: vi.fn(),
    });

    renderWithQueryClient(
      <SessionResultsList
        sessionId={1}
        projectId="1"
        canEditResults={true}
        canDeleteResults={true}
        isCompleted={false}
      />
    );

    // toHumanReadable mocked to return "120s"
    expect(screen.getByText("120s")).toBeInTheDocument();
  });

  it("renders attachment count indicator when result has attachments", () => {
    const mockAttachment = {
      id: 1,
      name: "screenshot.png",
      url: "https://example.com/file.png",
      mimeType: "image/png",
      size: BigInt(1024),
      createdAt: new Date(),
      createdById: "user-123",
      isDeleted: false,
      sessionId: null,
      testCaseId: null,
      sessionResultsId: 1,
      note: null,
    };

    (useFindManySessionResults as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [buildMockResult({ attachments: [mockAttachment] })],
      isLoading: false,
      refetch: vi.fn(),
    });

    renderWithQueryClient(
      <SessionResultsList
        sessionId={1}
        projectId="1"
        canEditResults={true}
        canDeleteResults={true}
        isCompleted={false}
      />
    );

    // attachment count "1" is shown
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("renders multiple result cards when multiple results exist", () => {
    (useFindManySessionResults as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [
        buildMockResult({
          id: 1,
          status: { id: 1, name: "Pass", color: { id: 1, value: "#22C55E" } },
        }),
        buildMockResult({
          id: 2,
          status: { id: 2, name: "Fail", color: { id: 2, value: "#EF4444" } },
        }),
      ],
      isLoading: false,
      refetch: vi.fn(),
    });

    renderWithQueryClient(
      <SessionResultsList
        sessionId={1}
        projectId="1"
        canEditResults={true}
        canDeleteResults={true}
        isCompleted={false}
      />
    );

    expect(screen.getByText("Pass")).toBeInTheDocument();
    expect(screen.getByText("Fail")).toBeInTheDocument();
  });

  it("renders copy link button for each result", () => {
    (useFindManySessionResults as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [buildMockResult()],
      isLoading: false,
      refetch: vi.fn(),
    });

    renderWithQueryClient(
      <SessionResultsList
        sessionId={1}
        projectId="1"
        canEditResults={true}
        canDeleteResults={true}
        isCompleted={false}
      />
    );

    const copyLinkButton = screen.getByTitle("actions.copyLink");
    expect(copyLinkButton).toBeInTheDocument();
  });
});
