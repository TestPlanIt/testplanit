import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { Session } from "next-auth";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionResultForm } from "./SessionResultForm";

// --- vi.hoisted for variables used in vi.mock factories ---
const mockUseSession = vi.hoisted(() => vi.fn());
const mockUseParams = vi.hoisted(() => vi.fn());
const mockUseTranslations = vi.hoisted(() => vi.fn());
const mockUseLocale = vi.hoisted(() => vi.fn());
const mockUseProjectPermissions = vi.hoisted(() => vi.fn());

// --- ZenStack hook mocks ---
vi.mock("~/lib/hooks", () => ({
  useCreateSessionResults: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useFindManyStatus: vi.fn(() => ({ data: [], isLoading: false })),
  useFindFirstProjects: vi.fn(() => ({ data: null, isLoading: false })),
  useFindFirstSessions: vi.fn(() => ({ data: null, isLoading: false })),
  useFindManyWorkflows: vi.fn(() => ({ data: [], isLoading: false })),
  useFindManyTemplateResultAssignment: vi.fn(() => ({
    data: [],
    isLoading: false,
  })),
  useCreateAttachments: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useCreateResultFieldValues: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useUpdateSessions: vi.fn(() => ({ mutateAsync: vi.fn() })),
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

// --- Heavy sub-component mocks ---
vi.mock("@/components/tiptap/TipTapEditor", () => ({
  default: ({ placeholder }: { placeholder?: string }) => (
    <div data-testid="tiptap-editor" data-placeholder={placeholder} />
  ),
}));

vi.mock("@/components/UploadAttachments", () => ({
  default: () => <div data-testid="upload-attachments" />,
}));

vi.mock("@/components/AttachmentsCarousel", () => ({
  AttachmentsCarousel: () => <div data-testid="attachments-carousel" />,
}));

vi.mock("@/components/TimeTracker", () => ({
  TimeTracker: React.forwardRef((_props: any, _ref: any) => (
    <div data-testid="time-tracker" />
  )),
}));

vi.mock("@/components/issues/UnifiedIssueManager", () => ({
  SimpleUnifiedIssueManager: () => (
    <div data-testid="issue-manager" />
  ),
}));

vi.mock("@/components/LoadingSpinner", () => ({
  default: () => <div data-testid="loading-spinner" />,
}));

// --- ~/lib/navigation ---
vi.mock("~/lib/navigation", () => ({
  Link: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// --- Utility mocks ---
vi.mock("~/utils/colorUtils", () => ({
  getBackgroundStyle: vi.fn(() => ({ backgroundColor: "rgba(59,130,246,0.1)" })),
}));

vi.mock("~/utils/duration", () => ({
  toHumanReadable: vi.fn((val: any) => `${val}s`),
}));

vi.mock("~/utils/fetchSignedUrl", () => ({
  fetchSignedUrl: vi.fn(),
}));

// --- app/constants ---
vi.mock("~/app/constants", () => ({
  emptyEditorContent: { type: "doc", content: [] },
  MAX_DURATION: 86400,
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
    preferences: null as any,
  },
};

const mockStatuses = [
  {
    id: 1,
    name: "Pass",
    order: 1,
    color: { value: "#22C55E" },
  },
  {
    id: 2,
    name: "Fail",
    order: 2,
    color: { value: "#EF4444" },
  },
];

const mockSessionData = {
  id: 1,
  name: "Test Session",
  templateId: null,
  sessionResults: [],
  _count: { sessionResults: 0 },
};

// Shared setup helper
function setupDefaultMocks() {
  mockUseSession.mockReturnValue({
    data: mockSession,
    status: "authenticated",
    update: vi.fn(),
  });
  mockUseParams.mockReturnValue({ projectId: "1", sessionId: "1" });
  // t(key) returns key
  mockUseTranslations.mockReturnValue((key: string, _params?: any) => key);
  mockUseLocale.mockReturnValue("en-US");
  mockUseProjectPermissions.mockReturnValue({
    permissions: { canAddEdit: true },
    isLoading: false,
  });
}

// Import after vi.mock so they use mocked versions
import {
  useFindFirstSessions,
  useFindManyStatus,
  useFindManyTemplateResultAssignment,
} from "~/lib/hooks";

beforeEach(() => {
  vi.clearAllMocks();
  setupDefaultMocks();

  (useFindManyStatus as ReturnType<typeof vi.fn>).mockReturnValue({
    data: mockStatuses,
    isLoading: false,
  });
  (useFindFirstSessions as ReturnType<typeof vi.fn>).mockReturnValue({
    data: mockSessionData,
    isLoading: false,
  });
  (useFindManyTemplateResultAssignment as ReturnType<typeof vi.fn>).mockReturnValue({
    data: [],
    isLoading: false,
  });
});

describe("SessionResultForm", () => {
  it("renders the form with status selector when session data is loaded", () => {
    renderWithQueryClient(
      <SessionResultForm sessionId={1} projectId="1" />
    );

    // Status select trigger should be present
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("renders the notes editor (TipTapEditor)", () => {
    renderWithQueryClient(
      <SessionResultForm sessionId={1} projectId="1" />
    );

    // TipTapEditor mocked component
    const editors = screen.getAllByTestId("tiptap-editor");
    expect(editors.length).toBeGreaterThan(0);
  });

  it("renders the elapsed duration input field", () => {
    renderWithQueryClient(
      <SessionResultForm sessionId={1} projectId="1" />
    );

    // Elapsed input (text type)
    const inputs = screen.getAllByRole("textbox");
    expect(inputs.length).toBeGreaterThan(0);
  });

  it("renders the TimeTracker component", () => {
    renderWithQueryClient(
      <SessionResultForm sessionId={1} projectId="1" />
    );

    expect(screen.getByTestId("time-tracker")).toBeInTheDocument();
  });

  it("renders the save/submit button", () => {
    renderWithQueryClient(
      <SessionResultForm sessionId={1} projectId="1" />
    );

    // The button contains save icon + translation key "actions.save"
    const button = screen.getByRole("button", { name: /actions\.save/i });
    expect(button).toBeInTheDocument();
  });

  it("shows loading spinner when session data is loading", () => {
    (useFindFirstSessions as ReturnType<typeof vi.fn>).mockReturnValue({
      data: null,
      isLoading: true,
    });

    renderWithQueryClient(
      <SessionResultForm sessionId={1} projectId="1" />
    );

    expect(screen.getByTestId("loading-spinner")).toBeInTheDocument();
  });

  it("shows loading spinner when statuses are loading", () => {
    (useFindManyStatus as ReturnType<typeof vi.fn>).mockReturnValue({
      data: null,
      isLoading: true,
    });

    renderWithQueryClient(
      <SessionResultForm sessionId={1} projectId="1" />
    );

    expect(screen.getByTestId("loading-spinner")).toBeInTheDocument();
  });

  it("shows loading spinner when permissions are loading", () => {
    mockUseProjectPermissions.mockReturnValue({
      permissions: null,
      isLoading: true,
    });

    renderWithQueryClient(
      <SessionResultForm sessionId={1} projectId="1" />
    );

    expect(screen.getByTestId("loading-spinner")).toBeInTheDocument();
  });

  it("shows loading spinner when user session is not available", () => {
    mockUseSession.mockReturnValue({
      data: null,
      status: "unauthenticated",
      update: vi.fn(),
    });

    renderWithQueryClient(
      <SessionResultForm sessionId={1} projectId="1" />
    );

    expect(screen.getByTestId("loading-spinner")).toBeInTheDocument();
  });

  it("renders the attachments upload component", () => {
    renderWithQueryClient(
      <SessionResultForm sessionId={1} projectId="1" />
    );

    expect(screen.getByTestId("upload-attachments")).toBeInTheDocument();
  });

  it("renders the issue manager component", () => {
    renderWithQueryClient(
      <SessionResultForm sessionId={1} projectId="1" />
    );

    expect(screen.getByTestId("issue-manager")).toBeInTheDocument();
  });

  it("renders custom template result fields when template has fields", () => {
    const mockTemplateFields = [
      {
        id: 1,
        order: 1,
        resultField: {
          id: 10,
          displayName: "Bug Severity",
          hint: null,
          isRequired: false,
          isRestricted: false,
          defaultValue: null,
          minValue: null,
          maxValue: null,
          initialHeight: null,
          type: { type: "Text" },
          fieldOptions: [],
        },
      },
    ];

    (useFindManyTemplateResultAssignment as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockTemplateFields,
      isLoading: false,
    });

    renderWithQueryClient(
      <SessionResultForm sessionId={1} projectId="1" />
    );

    // The dynamic field label should appear
    expect(screen.getByText("Bug Severity")).toBeInTheDocument();
  });

  it("renders the status options from the statuses list", () => {
    renderWithQueryClient(
      <SessionResultForm sessionId={1} projectId="1" />
    );

    // The first status should be auto-selected (value shown in trigger)
    // The combobox trigger should be present with a status value
    const combobox = screen.getByRole("combobox");
    expect(combobox).toBeInTheDocument();
    // Status names are rendered in SelectItem - at least one should be in DOM
    expect(screen.getByText("Pass")).toBeInTheDocument();
  });
});
