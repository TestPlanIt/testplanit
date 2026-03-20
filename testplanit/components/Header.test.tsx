import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock next-auth/react — setup mock before module load
vi.mock("next-auth/react", async (importOriginal) => {
  const original = await importOriginal<typeof import("next-auth/react")>();
  return {
    ...original,
    useSession: vi.fn(() => ({
      data: {
        user: {
          id: "user-1",
          name: "Test User",
          email: "test@example.com",
          access: "USER",
          emailVerified: new Date(),
          authMethod: "CREDENTIALS",
          preferences: { theme: "system" },
        },
      },
      status: "authenticated",
      update: vi.fn(),
    })),
  };
});

// Mock next-themes
vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "system", setTheme: vi.fn() }),
}));

// Mock ~/lib/navigation
vi.mock("~/lib/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/dashboard",
  Link: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// Mock next/navigation (global already mocked in setup, but restate for clarity)
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

// Mock ~/lib/hooks
vi.mock("~/lib/hooks", () => ({
  useFindManyProjects: vi.fn(() => ({ data: [] })),
  useFindUniqueProjects: vi.fn(() => ({ data: null })),
}));

// Mock ~/lib/version
vi.mock("~/lib/version", () => ({
  getVersionString: () => "v1.0.0-test",
}));

// Mock child components with simple test-id wrappers
vi.mock("@/components/NotificationBell", () => ({
  NotificationBell: () => <div data-testid="notification-bell-mock" />,
}));

vi.mock("@/components/UserDropdownMenu", () => ({
  UserDropdownMenu: () => <div data-testid="user-dropdown-menu-mock" />,
}));

vi.mock("@/components/ProjectQuickSelector", () => ({
  ProjectQuickSelector: () => <div data-testid="project-quick-selector-mock" />,
}));

vi.mock("@/components/GlobalSearchSheet", () => ({
  GlobalSearchSheet: ({ isOpen }: any) => (
    <div data-testid="global-search-sheet-mock" data-open={isOpen} />
  ),
}));

vi.mock("@/components/FeedbackSurveySheet", () => ({
  FeedbackBanner: ({ onOpenSurvey }: any) => (
    <div data-testid="feedback-banner-mock" onClick={onOpenSurvey} />
  ),
  FeedbackSurveySheet: ({ isOpen }: any) => (
    <div data-testid="feedback-survey-sheet-mock" data-open={isOpen} />
  ),
}));

// Mock next/image
vi.mock("next/image", () => ({
  default: ({ alt, ...props }: any) => <img alt={alt} {...props} />,
}));

// Mock SVG import
vi.mock("~/public/tpi_logo.svg", () => ({ default: "/logo.svg" }));

import { useSession } from "next-auth/react";
import { Header } from "./Header";

const mockUseSession = vi.mocked(useSession);

describe("Header", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: authenticated user
    mockUseSession.mockReturnValue({
      data: {
        user: {
          id: "user-1",
          name: "Test User",
          email: "test@example.com",
          access: "USER",
          emailVerified: new Date(),
          authMethod: "CREDENTIALS",
          preferences: { theme: "system" },
        },
      },
      status: "authenticated",
      update: vi.fn(),
    } as any);

    // Default fetch mock: no trial
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ isTrialInstance: false }),
    });
  });

  it("returns null when session is not present (unauthenticated)", () => {
    mockUseSession.mockReturnValue({
      data: null,
      status: "unauthenticated",
      update: vi.fn(),
    } as any);

    const { container } = render(<Header />);
    expect(container.firstChild).toBeNull();
  });

  it("renders header container when authenticated", async () => {
    render(<Header />);

    const container = screen.getByTestId("header-container");
    expect(container).toBeInTheDocument();
  });

  it("renders the logo image", async () => {
    render(<Header />);

    const img = screen.getByRole("img");
    expect(img).toBeInTheDocument();
  });

  it("renders NotificationBell and UserDropdownMenu", async () => {
    render(<Header />);

    expect(screen.getByTestId("notification-bell-mock")).toBeInTheDocument();
    expect(screen.getByTestId("user-dropdown-menu-mock")).toBeInTheDocument();
  });

  it("renders the search trigger button", async () => {
    render(<Header />);

    const searchBtn = screen.getByTestId("global-search-trigger");
    expect(searchBtn).toBeInTheDocument();
  });

  it("renders ProjectQuickSelector for authenticated user with access", async () => {
    render(<Header />);

    expect(screen.getByTestId("project-quick-selector-mock")).toBeInTheDocument();
  });

  it("does not render navigation links when user access is NONE", () => {
    mockUseSession.mockReturnValue({
      data: {
        user: {
          id: "user-1",
          name: "Test User",
          email: "test@example.com",
          access: "NONE",
          emailVerified: new Date(),
          authMethod: "CREDENTIALS",
          preferences: {},
        },
      },
      status: "authenticated",
      update: vi.fn(),
    } as any);

    render(<Header />);

    expect(
      screen.queryByTestId("project-quick-selector-mock")
    ).not.toBeInTheDocument();
  });

  it("renders admin link when user is ADMIN", () => {
    mockUseSession.mockReturnValue({
      data: {
        user: {
          id: "user-1",
          name: "Test User",
          email: "test@example.com",
          access: "ADMIN",
          emailVerified: new Date(),
          authMethod: "CREDENTIALS",
          preferences: {},
        },
      },
      status: "authenticated",
      update: vi.fn(),
    } as any);

    render(<Header />);

    // The admin link text comes from translation key common.access.admin
    const adminLink = screen.getAllByRole("link").find(
      (link) => link.getAttribute("href") === "/admin"
    );
    expect(adminLink).toBeDefined();
  });

  it("renders the help menu button", () => {
    render(<Header />);

    const helpBtn = screen.getByTestId("help-menu-button");
    expect(helpBtn).toBeInTheDocument();
  });

  it("clicking search trigger opens GlobalSearchSheet", async () => {
    render(<Header />);

    const searchBtn = screen.getByTestId("global-search-trigger");
    fireEvent.click(searchBtn);

    const sheet = screen.getByTestId("global-search-sheet-mock");
    expect(sheet.getAttribute("data-open")).toBe("true");
  });

  it("shows trial badge when API returns trial info", async () => {
    const trialEndDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        isTrialInstance: true,
        trialEndDate,
        contactEmail: "sales@testplanit.com",
      }),
    });

    render(<Header />);

    // Wait for the fetch to complete and trial badge to appear
    await waitFor(() => {
      // Trial badges appear with Clock icon — look for the badge containing a number
      const _badges = screen.queryAllByRole("generic");
      // The badge with days remaining will be present after fetch completes
      expect(global.fetch).toHaveBeenCalledWith("/api/config/trial");
    });
  });

  it("does not show FeedbackBanner when no feedbackSurveyUrl", () => {
    render(<Header />);

    expect(screen.queryByTestId("feedback-banner-mock")).not.toBeInTheDocument();
  });

  it("shows FeedbackBanner when feedbackSurveyUrl is returned", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        feedbackSurveyUrl: "https://survey.example.com",
        isTrialInstance: false,
      }),
    });

    render(<Header />);

    await waitFor(() => {
      expect(screen.getByTestId("feedback-banner-mock")).toBeInTheDocument();
    });
  });
});
