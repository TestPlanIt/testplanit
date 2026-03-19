import { render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- vi.hoisted for variables used in vi.mock factories ---
const mockUseSession = vi.hoisted(() => vi.fn());
const mockUseTranslations = vi.hoisted(() => vi.fn());

// --- Mocks ---
vi.mock("next-auth/react", () => ({
  useSession: mockUseSession,
}));

vi.mock("next-intl", () => ({
  useTranslations: mockUseTranslations,
}));

// Mock Link from ~/lib/navigation as a plain anchor
vi.mock("~/lib/navigation", () => ({
  Link: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// Mock sub-components with complex dependencies
vi.mock("@/components/DateFormatter", () => ({
  DateFormatter: ({ date }: any) => <span data-testid="date-formatter">{String(date)}</span>,
}));

vi.mock("@/components/LoadingSpinner", () => ({
  default: ({ className }: any) => (
    <span data-testid="loading-spinner" className={className} />
  ),
}));

vi.mock("@/components/ProjectIcon", () => ({
  ProjectIcon: ({ height, width }: any) => (
    <span data-testid="project-icon" style={{ height, width }} />
  ),
}));

vi.mock("@/components/MemberList", () => ({
  MemberList: ({ users, maxUsers }: any) => (
    <div data-testid="member-list" data-users={users.length} data-max={maxUsers} />
  ),
}));

// shadcn card components — render as simple divs
vi.mock("@/components/ui/card", () => ({
  Card: ({ className, children }: any) => (
    <div data-testid="card" className={className}>
      {children}
    </div>
  ),
  CardHeader: ({ children }: any) => <div data-testid="card-header">{children}</div>,
  CardTitle: ({ className, children }: any) => (
    <div data-testid="card-title" className={className}>
      {children}
    </div>
  ),
  CardDescription: ({ className, children }: any) => (
    <div data-testid="card-description" className={className}>
      {children}
    </div>
  ),
  CardContent: ({ className, children }: any) => (
    <div data-testid="card-content" className={className}>
      {children}
    </div>
  ),
  CardFooter: ({ className, children }: any) => (
    <div data-testid="card-footer" className={className}>
      {children}
    </div>
  ),
}));

import { ProjectCard } from "./ProjectCard";

const mockSession = {
  user: {
    id: "user-123",
    preferences: { dateFormat: "yyyy-MM-dd", timezone: "UTC" },
  },
};

const baseProject = {
  id: 1,
  name: "Test Project",
  note: "A test project note",
  isCompleted: false,
  iconUrl: null,
  createdAt: new Date("2024-01-01"),
  completedAt: null,
} as any;

const mockUsers = [{ userId: "user-1" }, { userId: "user-2" }];

beforeEach(() => {
  mockUseSession.mockReturnValue({ data: mockSession, status: "authenticated" });
  // useTranslations returns a function that yields the last key segment
  mockUseTranslations.mockReturnValue((key: string, _opts?: any) => {
    const parts = key.split(".");
    return parts[parts.length - 1];
  });
});

describe("ProjectCard", () => {
  it("renders project name as a link for active project", () => {
    const project = { ...baseProject, isCompleted: false };
    render(<ProjectCard project={project} users={mockUsers} />);

    const titleLink = screen.getByRole("link", { name: /test project/i });
    expect(titleLink).toBeDefined();
    expect(titleLink.getAttribute("href")).toContain("/projects/overview/1");
  });

  it("applies active project styling (border-primary) for active project", () => {
    const project = { ...baseProject, isCompleted: false };
    render(<ProjectCard project={project} users={mockUsers} />);

    const card = screen.getByTestId("card");
    expect(card.className).toContain("border-primary");
    expect(card.className).not.toContain("bg-muted-foreground/20");
  });

  it("applies completed project styling (bg-muted-foreground/20) for completed project", () => {
    const project = { ...baseProject, isCompleted: true };
    render(<ProjectCard project={project} users={mockUsers} />);

    const card = screen.getByTestId("card");
    expect(card.className).toContain("bg-muted-foreground/20");
    expect(card.className).toContain("border-muted-foreground");
  });

  it("renders counts when _count is provided with non-zero values", () => {
    const project = {
      ...baseProject,
      _count: {
        milestones: 3,
        testRuns: 5,
        sessions: 2,
        repositoryCases: 10,
        issues: 1,
      },
    };
    render(<ProjectCard project={project} users={mockUsers} />);

    expect(screen.getByText("3")).toBeDefined(); // milestones
    expect(screen.getByText("5")).toBeDefined(); // testRuns
    expect(screen.getByText("2")).toBeDefined(); // sessions
    expect(screen.getByText("10")).toBeDefined(); // repositoryCases
    expect(screen.getByText("1")).toBeDefined(); // issues
  });

  it("does not render count links for zero counts", () => {
    const project = {
      ...baseProject,
      _count: {
        milestones: 0,
        testRuns: 0,
        sessions: 0,
        repositoryCases: 0,
        issues: 0,
      },
    };
    render(<ProjectCard project={project} users={mockUsers} />);

    // No count links for zero values
    const links = screen.queryAllByRole("link");
    // Only the project name link should exist
    expect(links).toHaveLength(1);
  });

  it("does not render count links when _count is null", () => {
    const project = { ...baseProject, _count: null };
    render(<ProjectCard project={project} users={mockUsers} />);

    const links = screen.queryAllByRole("link");
    // Only the project name link should exist
    expect(links).toHaveLength(1);
  });

  it("does not render count links when _count is undefined", () => {
    const project = { ...baseProject };
    // _count not present
    render(<ProjectCard project={project} users={mockUsers} />);

    const links = screen.queryAllByRole("link");
    expect(links).toHaveLength(1);
  });

  it("shows loading spinner for issues when isLoadingIssueCounts=true", () => {
    const project = {
      ...baseProject,
      _count: {
        milestones: 0,
        testRuns: 0,
        sessions: 0,
        repositoryCases: 0,
        issues: 5,
      },
    };
    render(<ProjectCard project={project} users={mockUsers} isLoadingIssueCounts={true} />);

    // Loading spinner should be shown instead of the issue count link
    expect(screen.getByTestId("loading-spinner")).toBeDefined();
    // The issue count should not render as a link
    const issueLink = screen.queryByRole("link", { name: /5/ });
    expect(issueLink).toBeNull();
  });

  it("renders issue count link when isLoadingIssueCounts=false and issueCount > 0", () => {
    const project = {
      ...baseProject,
      _count: {
        milestones: 0,
        testRuns: 0,
        sessions: 0,
        repositoryCases: 0,
        issues: 7,
      },
    };
    render(<ProjectCard project={project} users={mockUsers} isLoadingIssueCounts={false} />);

    expect(screen.queryByTestId("loading-spinner")).toBeNull();
    expect(screen.getByText("7")).toBeDefined();
  });

  it("renders project note in card description", () => {
    const project = { ...baseProject, note: "My important note" };
    render(<ProjectCard project={project} users={mockUsers} />);

    expect(screen.getByText("My important note")).toBeDefined();
  });

  it("does not render card description when note is absent", () => {
    const project = { ...baseProject, note: null };
    render(<ProjectCard project={project} users={mockUsers} />);

    expect(screen.queryByTestId("card-description")).toBeNull();
  });

  it("renders MemberList with correct users prop", () => {
    render(<ProjectCard project={baseProject} users={mockUsers} />);

    const memberList = screen.getByTestId("member-list");
    expect(memberList.getAttribute("data-users")).toBe("2");
    expect(memberList.getAttribute("data-max")).toBe("10");
  });

  it("renders MemberList for empty users array", () => {
    render(<ProjectCard project={baseProject} users={[]} />);

    const memberList = screen.getByTestId("member-list");
    expect(memberList.getAttribute("data-users")).toBe("0");
  });

  it("renders createdAt date via DateFormatter", () => {
    render(<ProjectCard project={baseProject} users={mockUsers} />);

    const dateEl = screen.getByTestId("date-formatter");
    expect(dateEl).toBeDefined();
  });

  it("shows active status label for non-completed project", () => {
    const project = { ...baseProject, isCompleted: false };
    render(<ProjectCard project={project} users={mockUsers} />);

    // The translation mock returns last key: "active"
    expect(screen.getByText("active")).toBeDefined();
  });

  it("shows completedAt date when project is completed", () => {
    const project = {
      ...baseProject,
      isCompleted: true,
      completedAt: new Date("2024-06-01"),
    };
    render(<ProjectCard project={project} users={mockUsers} />);

    const dateEls = screen.getAllByTestId("date-formatter");
    expect(dateEls.length).toBeGreaterThanOrEqual(2); // createdAt + completedAt
  });

  it("renders repository link pointing to correct path", () => {
    const project = {
      ...baseProject,
      _count: {
        milestones: 0,
        testRuns: 0,
        sessions: 0,
        repositoryCases: 5,
        issues: 0,
      },
    };
    render(<ProjectCard project={project} users={mockUsers} />);

    const repositoryLink = screen.getByRole("link", {
      name: (_name, el) => (el as HTMLAnchorElement).href?.includes("/projects/repository/1"),
    });
    expect(repositoryLink).toBeDefined();
  });
});
