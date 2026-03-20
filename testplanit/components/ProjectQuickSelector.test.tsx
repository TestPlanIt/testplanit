import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- vi.hoisted for variables used in vi.mock factories ---
const mockUseFindManyProjects = vi.hoisted(() => vi.fn());
const mockUseRouter = vi.hoisted(() => vi.fn());
const mockUseTranslations = vi.hoisted(() => vi.fn());
const mockRouterPush = vi.hoisted(() => vi.fn());

// Stable empty array to prevent re-render loops
const _stableEmptyArray = vi.hoisted(() => [] as any[]);

// --- Mocks ---
vi.mock("~/lib/hooks", () => ({
  useFindManyProjects: mockUseFindManyProjects,
}));

vi.mock("~/lib/navigation", () => ({
  useRouter: mockUseRouter,
}));

vi.mock("next-intl", () => ({
  useTranslations: mockUseTranslations,
}));

// Mock next/image as a simple img tag
vi.mock("next/image", () => ({
  default: ({ src, alt, width, height, className }: any) => (
    <img src={src} alt={alt} width={width} height={height} className={className} />
  ),
}));

// Mock Popover components — open/close based on open prop
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ open, onOpenChange, children }: any) => (
    <div data-testid="popover" data-open={String(open)}>
      {/* Pass down toggle to trigger */}
      {React.Children.map(children, (child) =>
        React.cloneElement(child as React.ReactElement<any>, { _onOpenChange: onOpenChange, _open: open })
      )}
    </div>
  ),
  PopoverTrigger: ({ asChild: _asChild, children, _onOpenChange }: any) => {
    const child = React.Children.only(children) as React.ReactElement;
    return React.cloneElement(child as React.ReactElement<any>, {
      onClick: () => _onOpenChange?.(true),
      "data-testid": "popover-trigger",
    });
  },
  PopoverContent: ({ children, _open }: any) =>
    _open ? <div data-testid="popover-content">{children}</div> : null,
}));

// Mock Command components
vi.mock("@/components/ui/command", () => ({
  Command: ({ children, className }: any) => (
    <div data-testid="command" className={className}>
      {children}
    </div>
  ),
  CommandInput: ({ placeholder }: any) => (
    <input
      data-testid="command-input"
      placeholder={placeholder}
      onChange={() => {}}
    />
  ),
  CommandEmpty: ({ children }: any) => (
    <div data-testid="command-empty">{children}</div>
  ),
  CommandGroup: ({ children, className }: any) => (
    <div data-testid="command-group" className={className}>
      {children}
    </div>
  ),
  CommandItem: ({ children, onSelect, value, className }: any) => (
    <div
      data-testid={`command-item-${value}`}
      data-value={value}
      className={className}
      onClick={() => onSelect?.(value)}
      role="option"
    >
      {children}
    </div>
  ),
}));

// Mock Button
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, variant, className, "aria-expanded": ariaExpanded }: any) => (
    <button
      onClick={onClick}
      data-variant={variant}
      className={className}
      aria-expanded={ariaExpanded}
      data-testid="popover-button"
    >
      {children}
    </button>
  ),
}));

import { ProjectQuickSelector } from "./ProjectQuickSelector";

const mockProjects = [
  {
    id: 1,
    name: "Alpha Project",
    iconUrl: null,
    isCompleted: false,
    isDeleted: false,
  },
  {
    id: 2,
    name: "Beta Project",
    iconUrl: "https://example.com/icon.png",
    isCompleted: false,
    isDeleted: false,
  },
  {
    id: 3,
    name: "Gamma Completed",
    iconUrl: null,
    isCompleted: true,
    isDeleted: false,
  },
];

beforeEach(() => {
  mockUseRouter.mockReturnValue({ push: mockRouterPush });
  mockRouterPush.mockClear();

  mockUseTranslations.mockReturnValue((key: string) => {
    const parts = key.split(".");
    return parts[parts.length - 1];
  });

  // Default: projects loaded
  mockUseFindManyProjects.mockReturnValue({
    data: mockProjects,
    isLoading: false,
  });
});

describe("ProjectQuickSelector", () => {
  describe("trigger button", () => {
    it("renders the popover trigger button", () => {
      render(<ProjectQuickSelector />);
      expect(screen.getByTestId("popover-button")).toBeDefined();
    });

    it("trigger button shows projects translation key", () => {
      render(<ProjectQuickSelector />);
      const btn = screen.getByTestId("popover-button");
      // Translation mock returns last key segment: "projects"
      expect(btn.textContent).toContain("projects");
    });
  });

  describe("popover open/close", () => {
    it("popover is closed initially", () => {
      render(<ProjectQuickSelector />);
      const popover = screen.getByTestId("popover");
      expect(popover.getAttribute("data-open")).toBe("false");
    });

    it("opens popover when trigger is clicked", () => {
      render(<ProjectQuickSelector />);
      fireEvent.click(screen.getByTestId("popover-button"));
      expect(screen.getByTestId("popover-content")).toBeDefined();
    });

    it("renders command input when popover is open", () => {
      render(<ProjectQuickSelector />);
      fireEvent.click(screen.getByTestId("popover-button"));
      expect(screen.getByTestId("command-input")).toBeDefined();
    });
  });

  describe("project list", () => {
    it("renders a command item for each project", () => {
      render(<ProjectQuickSelector />);
      fireEvent.click(screen.getByTestId("popover-button"));

      expect(screen.getByTestId("command-item-Alpha Project")).toBeDefined();
      expect(screen.getByTestId("command-item-Beta Project")).toBeDefined();
      expect(screen.getByTestId("command-item-Gamma Completed")).toBeDefined();
    });

    it("renders the 'view all projects' item", () => {
      render(<ProjectQuickSelector />);
      fireEvent.click(screen.getByTestId("popover-button"));

      expect(screen.getByTestId("command-item-view-all-projects")).toBeDefined();
    });

    it("renders project name text for each project", () => {
      render(<ProjectQuickSelector />);
      fireEvent.click(screen.getByTestId("popover-button"));

      expect(screen.getByText("Alpha Project")).toBeDefined();
      expect(screen.getByText("Beta Project")).toBeDefined();
    });

    it("renders image for project with iconUrl", () => {
      render(<ProjectQuickSelector />);
      fireEvent.click(screen.getByTestId("popover-button"));

      const img = screen.getByAltText("Beta Project icon");
      expect(img).toBeDefined();
      expect(img.getAttribute("src")).toBe("https://example.com/icon.png");
    });

    it("shows completed indicator text for completed projects", () => {
      render(<ProjectQuickSelector />);
      fireEvent.click(screen.getByTestId("popover-button"));

      expect(screen.getByText("(Complete)")).toBeDefined();
    });
  });

  describe("navigation on select", () => {
    it("navigates to project repository when a project is selected", () => {
      render(<ProjectQuickSelector />);
      fireEvent.click(screen.getByTestId("popover-button"));

      fireEvent.click(screen.getByTestId("command-item-Alpha Project"));
      expect(mockRouterPush).toHaveBeenCalledWith("/projects/repository/1");
    });

    it("navigates to projects list when view-all is selected", () => {
      render(<ProjectQuickSelector />);
      fireEvent.click(screen.getByTestId("popover-button"));

      fireEvent.click(screen.getByTestId("command-item-view-all-projects"));
      expect(mockRouterPush).toHaveBeenCalledWith("/projects");
    });

    it("navigates to correct project when second project selected", () => {
      render(<ProjectQuickSelector />);
      fireEvent.click(screen.getByTestId("popover-button"));

      fireEvent.click(screen.getByTestId("command-item-Beta Project"));
      expect(mockRouterPush).toHaveBeenCalledWith("/projects/repository/2");
    });
  });

  describe("empty state", () => {
    it("renders CommandEmpty when no projects exist", () => {
      mockUseFindManyProjects.mockReturnValue({ data: [], isLoading: false });
      render(<ProjectQuickSelector />);
      fireEvent.click(screen.getByTestId("popover-button"));

      expect(screen.getByTestId("command-empty")).toBeDefined();
      // Translation mock returns "noProjectsFound" last key
      expect(screen.getByTestId("command-empty").textContent).toContain("noProjectsFound");
    });

    it("does not render project items when data is empty", () => {
      mockUseFindManyProjects.mockReturnValue({ data: [], isLoading: false });
      render(<ProjectQuickSelector />);
      fireEvent.click(screen.getByTestId("popover-button"));

      // Only view-all item should exist
      expect(screen.queryByTestId("command-item-Alpha Project")).toBeNull();
    });
  });

  describe("loading state", () => {
    it("shows loading text in CommandEmpty when isLoading=true", () => {
      mockUseFindManyProjects.mockReturnValue({ data: [], isLoading: true });
      render(<ProjectQuickSelector />);
      fireEvent.click(screen.getByTestId("popover-button"));

      const empty = screen.getByTestId("command-empty");
      // Translation mock returns "loadingProjects"
      expect(empty.textContent).toContain("loadingProjects");
    });
  });
});
