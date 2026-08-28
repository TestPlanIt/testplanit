import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "~/test/test-utils";
import { SearchableEntityType } from "~/types/search";
import { GlobalSearchSheet } from "./GlobalSearchSheet";

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

// Mock UnifiedSearch — renders every test hit as the card link would: an
// anchor carrying the href the sheet derived, firing onResultClick on click.
vi.mock("@/components/UnifiedSearch", () => ({
  UnifiedSearch: ({
    onResultClick,
    getResultHref,
  }: {
    onResultClick?: (hit: any) => void;
    getResultHref?: (hit: any) => string | null;
  }) => (
    <div data-testid="unified-search">
      {[
        {
          testId: "mock-result-repository-case",
          hit: {
            id: 5,
            entityType: SearchableEntityType.REPOSITORY_CASE,
            score: 1.0,
            source: {
              id: 5,
              name: "Test Case",
              projectId: 1,
              isDeleted: false,
            },
          },
        },
        {
          testId: "mock-result-test-run",
          hit: {
            id: 10,
            entityType: SearchableEntityType.TEST_RUN,
            score: 1.0,
            source: {
              id: 10,
              name: "Test Run",
              projectId: 2,
              isDeleted: false,
            },
          },
        },
        {
          testId: "mock-result-session",
          hit: {
            id: 20,
            entityType: SearchableEntityType.SESSION,
            score: 1.0,
            source: { id: 20, name: "Session", projectId: 3, isDeleted: false },
          },
        },
        {
          testId: "mock-result-project",
          hit: {
            id: 30,
            entityType: SearchableEntityType.PROJECT,
            score: 1.0,
            source: { id: 30, name: "My Project", isDeleted: false },
          },
        },
        {
          testId: "mock-result-issue",
          hit: {
            id: 40,
            entityType: SearchableEntityType.ISSUE,
            score: 1.0,
            source: { id: 40, name: "Bug", projectId: 5, isDeleted: false },
          },
        },
        {
          testId: "mock-result-milestone",
          hit: {
            id: 50,
            entityType: SearchableEntityType.MILESTONE,
            score: 1.0,
            source: {
              id: 50,
              name: "Milestone",
              projectId: 6,
              isDeleted: false,
            },
          },
        },
        {
          testId: "mock-result-shared-step",
          hit: {
            id: 60,
            entityType: SearchableEntityType.SHARED_STEP,
            score: 1.0,
            source: {
              id: 60,
              name: "Shared Step",
              projectId: 7,
              isDeleted: false,
            },
          },
        },
        {
          testId: "mock-result-deleted-admin",
          hit: {
            id: 99,
            entityType: SearchableEntityType.REPOSITORY_CASE,
            score: 1.0,
            source: {
              id: 99,
              name: "Deleted Case",
              projectId: 1,
              isDeleted: true,
            },
          },
        },
      ].map(({ testId, hit }) => (
        <a
          key={testId}
          data-testid={testId}
          href={getResultHref?.(hit) ?? undefined}
          onClick={(e) => {
            e.preventDefault();
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            onResultClick?.(hit);
          }}
        >
          {hit.source.name}
        </a>
      ))}
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

    expect(screen.queryByTestId("global-search-sheet")).not.toBeInTheDocument();
  });

  it("renders the sheet title and help button", () => {
    render(<GlobalSearchSheet {...defaultProps} />);

    // Title text appears in the h2 heading (translation key last segment is "title")
    const heading = screen.getByRole("heading");
    expect(heading).toBeInTheDocument();
    expect(heading.textContent).toContain("title");

    // Help popover trigger button. The aria-label now reads from
    // common.aria.help; the test mock returns only the last key segment.
    expect(screen.getByRole("button", { name: "help" })).toBeInTheDocument();

    // Help content rendered inline in mocked popover
    expect(screen.getByTestId("search-help-content")).toBeInTheDocument();
  });

  it("links to the repository case and closes on click", () => {
    const onClose = vi.fn();
    render(<GlobalSearchSheet isOpen={true} onClose={onClose} />);

    const result = screen.getByTestId("mock-result-repository-case");
    expect(result).toHaveAttribute("href", "/projects/repository/1/5");

    fireEvent.click(result);
    expect(onClose).toHaveBeenCalled();
  });

  it("links to the test run and closes on click", () => {
    const onClose = vi.fn();
    render(<GlobalSearchSheet isOpen={true} onClose={onClose} />);

    const result = screen.getByTestId("mock-result-test-run");
    expect(result).toHaveAttribute("href", "/projects/runs/2/10");

    fireEvent.click(result);
    expect(onClose).toHaveBeenCalled();
  });

  it("links to the session and closes on click", () => {
    const onClose = vi.fn();
    render(<GlobalSearchSheet isOpen={true} onClose={onClose} />);

    const result = screen.getByTestId("mock-result-session");
    expect(result).toHaveAttribute("href", "/projects/sessions/3/20");

    fireEvent.click(result);
    expect(onClose).toHaveBeenCalled();
  });

  it("links to the project overview and closes on click", () => {
    const onClose = vi.fn();
    render(<GlobalSearchSheet isOpen={true} onClose={onClose} />);

    const result = screen.getByTestId("mock-result-project");
    expect(result).toHaveAttribute("href", "/projects/overview/30");

    fireEvent.click(result);
    expect(onClose).toHaveBeenCalled();
  });

  it("links to the issue with issueId query param and closes on click", () => {
    const onClose = vi.fn();
    render(<GlobalSearchSheet isOpen={true} onClose={onClose} />);

    const result = screen.getByTestId("mock-result-issue");
    expect(result).toHaveAttribute("href", "/projects/issues/5?issueId=40");

    fireEvent.click(result);
    expect(onClose).toHaveBeenCalled();
  });

  it("links to the milestone and closes on click", () => {
    const onClose = vi.fn();
    render(<GlobalSearchSheet isOpen={true} onClose={onClose} />);

    const result = screen.getByTestId("mock-result-milestone");
    expect(result).toHaveAttribute("href", "/projects/milestones/6/50");

    fireEvent.click(result);
    expect(onClose).toHaveBeenCalled();
  });

  it("links to the shared step with groupId query param and closes on click", () => {
    const onClose = vi.fn();
    render(<GlobalSearchSheet isOpen={true} onClose={onClose} />);

    const result = screen.getByTestId("mock-result-shared-step");
    expect(result).toHaveAttribute(
      "href",
      "/projects/shared-steps/7?groupId=60"
    );

    fireEvent.click(result);
    expect(onClose).toHaveBeenCalled();
  });

  it("links deleted items to admin trash for an admin user", () => {
    // The component calls: const { data: session } = useSession()
    // so useSession() must return { data: { user: { access: "ADMIN" } } }
    mockSessionData.session = {
      data: {
        user: { id: "admin-1", name: "Admin User", access: "ADMIN" },
      },
    } as any;
    render(<GlobalSearchSheet {...defaultProps} />);

    expect(screen.getByTestId("mock-result-deleted-admin")).toHaveAttribute(
      "href",
      "/admin/trash"
    );
  });

  it("links deleted items to the entity for a non-admin user", () => {
    // Session is already non-admin (MEMBER) from beforeEach
    render(<GlobalSearchSheet {...defaultProps} />);

    expect(screen.getByTestId("mock-result-deleted-admin")).toHaveAttribute(
      "href",
      "/projects/repository/1/99"
    );
  });

  it("keeps the sheet open when a result is command-clicked", () => {
    const onClose = vi.fn();
    render(<GlobalSearchSheet isOpen={true} onClose={onClose} />);

    fireEvent.click(screen.getByTestId("mock-result-repository-case"), {
      metaKey: true,
    });

    expect(onClose).not.toHaveBeenCalled();
  });
});
