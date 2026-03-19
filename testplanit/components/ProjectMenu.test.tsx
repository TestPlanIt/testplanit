import { render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- vi.hoisted for variables used in vi.mock factories ---
const mockUseSession = vi.hoisted(() => vi.fn());
const mockUseTranslations = vi.hoisted(() => vi.fn());
const mockUseParams = vi.hoisted(() => vi.fn());
const mockUsePathname = vi.hoisted(() => vi.fn());
const mockUseProjectPermissions = vi.hoisted(() => vi.fn());

// Stable return object for useProjectPermissions — prevents infinite re-renders
const stablePermissions = vi.hoisted(() => ({
  permissions: { canAddEdit: true, canDelete: true, canClose: true },
  isLoading: false,
  error: null,
}));

// --- Mocks ---
vi.mock("next-auth/react", () => ({
  useSession: mockUseSession,
}));

vi.mock("next-intl", () => ({
  useTranslations: mockUseTranslations,
}));

vi.mock("next/navigation", () => ({
  useParams: mockUseParams,
}));

vi.mock("~/lib/navigation", () => ({
  Link: ({ href, id, className, children, ...rest }: any) => (
    <a href={href} id={id} className={className} {...rest}>
      {children}
    </a>
  ),
  usePathname: mockUsePathname,
}));

vi.mock("~/hooks/useProjectPermissions", () => ({
  useProjectPermissions: mockUseProjectPermissions,
}));

// Mock ProjectDropdownMenu as a simple div
vi.mock("@/components/ProjectDropdownMenu", () => ({
  ProjectDropdownMenu: ({ isCollapsed }: any) => (
    <div data-testid="project-dropdown-menu" data-collapsed={String(isCollapsed)} />
  ),
}));

// Mock shadcn/ui card
vi.mock("@/components/ui/card", () => ({
  Card: ({ className, children, shadow }: any) => (
    <div data-testid="menu-card" data-shadow={shadow} className={className}>
      {children}
    </div>
  ),
  CardContent: ({ className, children }: any) => (
    <div className={className}>{children}</div>
  ),
  CardHeader: ({ className, children }: any) => (
    <div className={className}>{children}</div>
  ),
  CardTitle: ({ children }: any) => <div>{children}</div>,
}));

// Mock Accordion components
vi.mock("@/components/ui/accordion", () => ({
  Accordion: ({ children, value, onValueChange }: any) => (
    <div data-testid="accordion" data-value={JSON.stringify(value)} onClick={() => onValueChange?.([])}>
      {children}
    </div>
  ),
  AccordionItem: ({ children, value, "data-testid": testId }: any) => (
    <div data-testid={testId || `accordion-item-${value}`} data-value={value}>
      {children}
    </div>
  ),
  AccordionTrigger: ({ children, className }: any) => (
    <button data-testid="accordion-trigger" className={className}>
      {children}
    </button>
  ),
  AccordionContent: ({ children }: any) => (
    <div data-testid="accordion-content">{children}</div>
  ),
}));

// Mock button variants
vi.mock("@/components/ui/button", () => ({
  buttonVariants: () => "btn",
}));

// Mock Tooltip
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: any) => <div>{children}</div>,
  TooltipProvider: ({ children }: any) => <div>{children}</div>,
  TooltipTrigger: ({ children, asChild }: any) => (
    <div data-asChild={asChild}>{children}</div>
  ),
  TooltipContent: ({ children }: any) => (
    <div data-testid="tooltip-content">{children}</div>
  ),
}));

import ProjectsMenu from "./ProjectMenu";

const mockAdminSession = {
  data: {
    user: {
      id: "user-admin",
      access: "ADMIN",
      preferences: {},
    },
  },
  status: "authenticated",
};

const mockRegularSession = {
  data: {
    user: {
      id: "user-regular",
      access: "USER",
      preferences: {},
    },
  },
  status: "authenticated",
};

beforeEach(() => {
  // Default: admin user so settings section is visible
  mockUseSession.mockReturnValue(mockAdminSession);

  // useTranslations returns last key segment
  mockUseTranslations.mockReturnValue((key: string, _opts?: any) => {
    const parts = key.split(".");
    return parts[parts.length - 1];
  });

  mockUseParams.mockReturnValue({ projectId: "42" });
  mockUsePathname.mockReturnValue("/en-US/projects/overview/42");

  // Default permissions: canAddEdit=true => show shared steps, reports, settings
  mockUseProjectPermissions.mockReturnValue(stablePermissions);

  // Mock localStorage
  const store: Record<string, string> = {};
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, val: string) => { store[key] = val; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); },
  });
});

describe("ProjectsMenu", () => {
  describe("basic rendering", () => {
    it("renders ProjectDropdownMenu", () => {
      render(<ProjectsMenu isCollapsed={false} onToggleCollapse={vi.fn()} />);
      expect(screen.getByTestId("project-dropdown-menu")).toBeDefined();
    });

    it("renders accordion menu when projectId is valid", () => {
      render(<ProjectsMenu isCollapsed={false} onToggleCollapse={vi.fn()} />);
      expect(screen.getByTestId("accordion")).toBeDefined();
    });

    it("does not render accordion menu when projectId is missing", () => {
      mockUseParams.mockReturnValue({ projectId: undefined });
      render(<ProjectsMenu isCollapsed={false} onToggleCollapse={vi.fn()} />);
      expect(screen.queryByTestId("accordion")).toBeNull();
    });

    it("does not render accordion menu when projectId is non-numeric", () => {
      mockUseParams.mockReturnValue({ projectId: "abc" });
      render(<ProjectsMenu isCollapsed={false} onToggleCollapse={vi.fn()} />);
      expect(screen.queryByTestId("accordion")).toBeNull();
    });
  });

  describe("menu sections", () => {
    it("renders project section", () => {
      render(<ProjectsMenu isCollapsed={false} onToggleCollapse={vi.fn()} />);
      expect(screen.getByTestId("project-menu-section-project")).toBeDefined();
    });

    it("renders management section", () => {
      render(<ProjectsMenu isCollapsed={false} onToggleCollapse={vi.fn()} />);
      expect(screen.getByTestId("project-menu-section-management")).toBeDefined();
    });

    it("renders settings section for ADMIN user", () => {
      render(<ProjectsMenu isCollapsed={false} onToggleCollapse={vi.fn()} />);
      expect(screen.getByTestId("project-menu-section-settings")).toBeDefined();
    });

    it("hides settings section for USER without settings permissions", () => {
      mockUseSession.mockReturnValue(mockRegularSession);
      // Return false permissions for all calls (SharedSteps, Reporting, Settings)
      mockUseProjectPermissions.mockReturnValue({
        permissions: { canAddEdit: false, canDelete: false, canClose: false },
        isLoading: false,
        error: null,
      });
      render(<ProjectsMenu isCollapsed={false} onToggleCollapse={vi.fn()} />);
      expect(screen.queryByTestId("project-menu-section-settings")).toBeNull();
    });

    it("shows settings section for PROJECTADMIN user", () => {
      mockUseSession.mockReturnValue({
        data: { user: { id: "pa-user", access: "PROJECTADMIN", preferences: {} } },
        status: "authenticated",
      });
      render(<ProjectsMenu isCollapsed={false} onToggleCollapse={vi.fn()} />);
      expect(screen.getByTestId("project-menu-section-settings")).toBeDefined();
    });
  });

  describe("menu items", () => {
    it("renders overview link in project section", () => {
      render(<ProjectsMenu isCollapsed={false} onToggleCollapse={vi.fn()} />);
      const overviewLink = document.getElementById("overview-link");
      expect(overviewLink).toBeDefined();
      expect(overviewLink?.getAttribute("href")).toContain("/projects/overview/42");
    });

    it("renders test-cases link in management section", () => {
      render(<ProjectsMenu isCollapsed={false} onToggleCollapse={vi.fn()} />);
      const link = document.getElementById("test-cases-link");
      expect(link).toBeDefined();
      expect(link?.getAttribute("href")).toContain("/projects/repository/42");
    });

    it("renders runs link in management section", () => {
      render(<ProjectsMenu isCollapsed={false} onToggleCollapse={vi.fn()} />);
      const link = document.getElementById("test-runs-link");
      expect(link).toBeDefined();
      expect(link?.getAttribute("href")).toContain("/projects/runs/42");
    });

    it("renders shared-steps link when canSeeSharedSteps is true", () => {
      render(<ProjectsMenu isCollapsed={false} onToggleCollapse={vi.fn()} />);
      const link = document.getElementById("shared-steps-link");
      expect(link).toBeDefined();
    });

    it("hides shared-steps link when permissions deny it", () => {
      // First call (SharedSteps): deny. Second (Reporting): allow. Third (Settings): allow.
      let callCount = 0;
      mockUseProjectPermissions.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // SharedSteps area
          return {
            permissions: { canAddEdit: false, canDelete: false, canClose: false },
            isLoading: false,
            error: null,
          };
        }
        return stablePermissions;
      });
      render(<ProjectsMenu isCollapsed={false} onToggleCollapse={vi.fn()} />);
      expect(document.getElementById("shared-steps-link")).toBeNull();
    });

    it("renders reports link when canSeeReports is true", () => {
      render(<ProjectsMenu isCollapsed={false} onToggleCollapse={vi.fn()} />);
      const link = document.getElementById("reports-link");
      expect(link).toBeDefined();
    });

    it("renders settings integrations link for admin", () => {
      render(<ProjectsMenu isCollapsed={false} onToggleCollapse={vi.fn()} />);
      const link = document.getElementById("settings-integrations-link");
      expect(link).toBeDefined();
      expect(link?.getAttribute("href")).toContain("/projects/settings/42/integrations");
    });

    it("renders milestones link", () => {
      render(<ProjectsMenu isCollapsed={false} onToggleCollapse={vi.fn()} />);
      const link = document.getElementById("milestones-link");
      expect(link).toBeDefined();
      expect(link?.getAttribute("href")).toContain("/projects/milestones/42");
    });
  });

  describe("collapsed state", () => {
    it("passes isCollapsed=true to ProjectDropdownMenu", () => {
      render(<ProjectsMenu isCollapsed={true} onToggleCollapse={vi.fn()} />);
      const dropdown = screen.getByTestId("project-dropdown-menu");
      expect(dropdown.getAttribute("data-collapsed")).toBe("true");
    });

    it("passes isCollapsed=false to ProjectDropdownMenu when expanded", () => {
      render(<ProjectsMenu isCollapsed={false} onToggleCollapse={vi.fn()} />);
      const dropdown = screen.getByTestId("project-dropdown-menu");
      expect(dropdown.getAttribute("data-collapsed")).toBe("false");
    });

    it("applies collapsed styles to AccordionTrigger when isCollapsed=true", () => {
      render(<ProjectsMenu isCollapsed={true} onToggleCollapse={vi.fn()} />);
      const triggers = screen.getAllByTestId("accordion-trigger");
      // Each visible trigger should have the md:max-h-0 collapsed class
      triggers.forEach((trigger) => {
        expect(trigger.className).toContain("md:max-h-0");
      });
    });
  });

  describe("active link highlighting", () => {
    it("highlights the overview link when on overview path", () => {
      mockUsePathname.mockReturnValue("/en-US/projects/overview/42");
      render(<ProjectsMenu isCollapsed={false} onToggleCollapse={vi.fn()} />);

      const overviewLink = document.getElementById("overview-link");
      expect(overviewLink).toBeDefined();
      // Active link should have bg-primary class
      expect(overviewLink?.className).toContain("bg-primary");
    });

    it("highlights the runs link when on runs path", () => {
      mockUsePathname.mockReturnValue("/en-US/projects/runs/42");
      render(<ProjectsMenu isCollapsed={false} onToggleCollapse={vi.fn()} />);

      const runsLink = document.getElementById("test-runs-link");
      expect(runsLink?.className).toContain("bg-primary");
    });

    it("does not highlight overview link when on a different path", () => {
      mockUsePathname.mockReturnValue("/en-US/projects/runs/42");
      render(<ProjectsMenu isCollapsed={false} onToggleCollapse={vi.fn()} />);

      const overviewLink = document.getElementById("overview-link");
      // Active links get "bg-primary text-primary-foreground"; inactive links only get "hover:bg-primary/10"
      // The class "bg-primary" (not as part of hover:bg-primary/10) indicates active state
      const classes = overviewLink?.className ?? "";
      const isActive = classes.split(" ").some((cls) => cls === "bg-primary");
      expect(isActive).toBe(false);
    });
  });
});
