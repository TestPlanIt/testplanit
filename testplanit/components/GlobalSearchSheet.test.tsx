import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "~/test/test-utils";
import { SearchableEntityType } from "~/types/search";
import { GlobalSearchSheet } from "./GlobalSearchSheet";

// Stable mock refs via vi.hoisted()
const { mockRouterPush } = vi.hoisted(() => ({
  mockRouterPush: vi.fn(),
}));

// Mock next-intl
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key.split(".").pop() ?? key,
}));

// Mock next-auth/react — default non-admin session
const mockSessionData = vi.hoisted(() => ({
  session: {
    data: {
      user: { id: "user-1", name: "Test User", access: "MEMBER" },
    },
  },
}));

vi.mock("next-auth/react", () => ({
  useSession: () => mockSessionData.session,
}));

// Mock navigation
vi.mock("~/lib/navigation", () => ({
  useRouter: () => ({
    push: mockRouterPush,
  }),
}));

// Mock UnifiedSearch — renders a button that fires onResultClick with test data
vi.mock("@/components/UnifiedSearch", () => ({
  UnifiedSearch: ({
    onResultClick,
  }: {
    onResultClick?: (hit: any) => void;
  }) => (
    <div data-testid="unified-search">
      <button
        data-testid="mock-result-repository-case"
        onClick={() =>
          onResultClick?.({
            id: 5,
            entityType: SearchableEntityType.REPOSITORY_CASE,
            score: 1.0,
            source: { id: 5, name: "Test Case", projectId: 1, isDeleted: false },
          })
        }
      >
        Click Repository Case
      </button>
      <button
        data-testid="mock-result-test-run"
        onClick={() =>
          onResultClick?.({
            id: 10,
            entityType: SearchableEntityType.TEST_RUN,
            score: 1.0,
            source: { id: 10, name: "Test Run", projectId: 2, isDeleted: false },
          })
        }
      >
        Click Test Run
      </button>
      <button
        data-testid="mock-result-session"
        onClick={() =>
          onResultClick?.({
            id: 20,
            entityType: SearchableEntityType.SESSION,
            score: 1.0,
            source: { id: 20, name: "Session", projectId: 3, isDeleted: false },
          })
        }
      >
        Click Session
      </button>
      <button
        data-testid="mock-result-project"
        onClick={() =>
          onResultClick?.({
            id: 30,
            entityType: SearchableEntityType.PROJECT,
            score: 1.0,
            source: { id: 30, name: "My Project", isDeleted: false },
          })
        }
      >
        Click Project
      </button>
      <button
        data-testid="mock-result-issue"
        onClick={() =>
          onResultClick?.({
            id: 40,
            entityType: SearchableEntityType.ISSUE,
            score: 1.0,
            source: { id: 40, name: "Bug", projectId: 5, isDeleted: false },
          })
        }
      >
        Click Issue
      </button>
      <button
        data-testid="mock-result-milestone"
        onClick={() =>
          onResultClick?.({
            id: 50,
            entityType: SearchableEntityType.MILESTONE,
            score: 1.0,
            source: { id: 50, name: "Milestone", projectId: 6, isDeleted: false },
          })
        }
      >
        Click Milestone
      </button>
      <button
        data-testid="mock-result-shared-step"
        onClick={() =>
          onResultClick?.({
            id: 60,
            entityType: SearchableEntityType.SHARED_STEP,
            score: 1.0,
            source: { id: 60, name: "Shared Step", projectId: 7, isDeleted: false },
          })
        }
      >
        Click Shared Step
      </button>
      <button
        data-testid="mock-result-deleted-admin"
        onClick={() =>
          onResultClick?.({
            id: 99,
            entityType: SearchableEntityType.REPOSITORY_CASE,
            score: 1.0,
            source: { id: 99, name: "Deleted Case", projectId: 1, isDeleted: true },
          })
        }
      >
        Click Deleted Item
      </button>
    </div>
  ),
}));

// Mock SearchHelpContent
vi.mock("@/components/search/SearchHelpContent", () => ({
  SearchHelpContent: () => (
    <div data-testid="search-help-content">Help content</div>
  ),
}));

// Mock Sheet/SheetContent to render children only when open
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({
    open,
    onOpenChange: _onOpenChange,
    children,
  }: {
    open: boolean;
    onOpenChange?: (open: boolean) => void;
    children: React.ReactNode;
  }) => (
    <div data-sheet-open={open ? "true" : "false"}>
      {open ? children : null}
    </div>
  ),
  SheetContent: ({
    children,
    "data-testid": testId,
    ...props
  }: {
    children: React.ReactNode;
    "data-testid"?: string;
    [key: string]: any;
  }) => (
    <div data-testid={testId} {...props}>
      {children}
    </div>
  ),
  SheetHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SheetTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
  SheetDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
}));

// Mock Popover — render content inline (no portal issues in jsdom)
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="popover-root">{children}</div>
  ),
  PopoverTrigger: ({
    children,
    asChild: _asChild,
  }: {
    children: React.ReactNode;
    asChild?: boolean;
  }) => <div data-testid="popover-trigger">{children}</div>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="popover-content">{children}</div>
  ),
}));

// Mock ~/utils/permissions — the component calls isAdmin(session) where session is the data object from useSession
vi.mock("~/utils/permissions", () => ({
  isAdmin: (session: any) => session?.user?.access === "ADMIN",
}));

describe("GlobalSearchSheet", () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset session to non-admin
    mockSessionData.session = {
      data: {
        user: { id: "user-1", name: "Test User", access: "MEMBER" },
      },
    };
  });

  it("renders search sheet when open", () => {
    render(<GlobalSearchSheet {...defaultProps} />);

    expect(screen.getByTestId("global-search-sheet")).toBeInTheDocument();
    expect(screen.getByTestId("unified-search")).toBeInTheDocument();
  });

  it("does not render sheet content when closed", () => {
    render(<GlobalSearchSheet isOpen={false} onClose={vi.fn()} />);

    expect(
      screen.queryByTestId("global-search-sheet")
    ).not.toBeInTheDocument();
  });

  it("renders the sheet title and help button", () => {
    render(<GlobalSearchSheet {...defaultProps} />);

    // Title text appears in the h2 heading (translation key last segment is "title")
    const heading = screen.getByRole("heading");
    expect(heading).toBeInTheDocument();
    expect(heading.textContent).toContain("title");

    // Help popover trigger button
    expect(screen.getByRole("button", { name: "Help" })).toBeInTheDocument();

    // Help content rendered inline in mocked popover
    expect(screen.getByTestId("search-help-content")).toBeInTheDocument();
  });

  it("navigates to repository case on result click", () => {
    const onClose = vi.fn();
    render(<GlobalSearchSheet isOpen={true} onClose={onClose} />);

    fireEvent.click(screen.getByTestId("mock-result-repository-case"));

    expect(mockRouterPush).toHaveBeenCalledWith("/projects/repository/1/5");
    expect(onClose).toHaveBeenCalled();
  });

  it("navigates to test run on result click", () => {
    const onClose = vi.fn();
    render(<GlobalSearchSheet isOpen={true} onClose={onClose} />);

    fireEvent.click(screen.getByTestId("mock-result-test-run"));

    expect(mockRouterPush).toHaveBeenCalledWith("/projects/runs/2/10");
    expect(onClose).toHaveBeenCalled();
  });

  it("navigates to session on result click", () => {
    const onClose = vi.fn();
    render(<GlobalSearchSheet isOpen={true} onClose={onClose} />);

    fireEvent.click(screen.getByTestId("mock-result-session"));

    expect(mockRouterPush).toHaveBeenCalledWith("/projects/sessions/3/20");
    expect(onClose).toHaveBeenCalled();
  });

  it("navigates to project overview on result click", () => {
    const onClose = vi.fn();
    render(<GlobalSearchSheet isOpen={true} onClose={onClose} />);

    fireEvent.click(screen.getByTestId("mock-result-project"));

    expect(mockRouterPush).toHaveBeenCalledWith("/projects/overview/30");
    expect(onClose).toHaveBeenCalled();
  });

  it("navigates to issue with issueId query param on result click", () => {
    const onClose = vi.fn();
    render(<GlobalSearchSheet isOpen={true} onClose={onClose} />);

    fireEvent.click(screen.getByTestId("mock-result-issue"));

    expect(mockRouterPush).toHaveBeenCalledWith(
      "/projects/issues/5?issueId=40"
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("navigates to milestone on result click", () => {
    const onClose = vi.fn();
    render(<GlobalSearchSheet isOpen={true} onClose={onClose} />);

    fireEvent.click(screen.getByTestId("mock-result-milestone"));

    expect(mockRouterPush).toHaveBeenCalledWith("/projects/milestones/6/50");
    expect(onClose).toHaveBeenCalled();
  });

  it("navigates to shared step with groupId query param on result click", () => {
    const onClose = vi.fn();
    render(<GlobalSearchSheet isOpen={true} onClose={onClose} />);

    fireEvent.click(screen.getByTestId("mock-result-shared-step"));

    expect(mockRouterPush).toHaveBeenCalledWith(
      "/projects/shared-steps/7?groupId=60"
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("navigates to admin trash for deleted items when admin user", () => {
    // The component calls: const { data: session } = useSession()
    // so useSession() must return { data: { user: { access: "ADMIN" } } }
    mockSessionData.session = {
      data: {
        user: { id: "admin-1", name: "Admin User", access: "ADMIN" },
      },
    } as any;
    const onClose = vi.fn();
    render(<GlobalSearchSheet isOpen={true} onClose={onClose} />);

    fireEvent.click(screen.getByTestId("mock-result-deleted-admin"));

    expect(mockRouterPush).toHaveBeenCalledWith("/admin/trash");
    expect(onClose).toHaveBeenCalled();
  });

  it("navigates normally for deleted items when non-admin user", () => {
    // Session is already non-admin (MEMBER) from beforeEach
    const onClose = vi.fn();
    render(<GlobalSearchSheet isOpen={true} onClose={onClose} />);

    fireEvent.click(screen.getByTestId("mock-result-deleted-admin"));

    // Non-admin: should navigate to the entity URL, not admin/trash
    expect(mockRouterPush).toHaveBeenCalledWith("/projects/repository/1/99");
    expect(mockRouterPush).not.toHaveBeenCalledWith("/admin/trash");
    expect(onClose).toHaveBeenCalled();
  });
});
