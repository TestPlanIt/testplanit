import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PaginationComponent } from "./Pagination";

// Mock next-intl
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => {
    const translations: Record<string, string> = {
      selectPage: "Select page",
      goToPrevious: "Go to previous page",
      goToNext: "Go to next page",
    };
    return translations[key] || key;
  },
}));

// Mock the UI pagination components
vi.mock("@/components/ui/pagination", () => ({
  Pagination: ({ children }: { children: React.ReactNode }) => (
    <nav data-testid="pagination">{children}</nav>
  ),
  PaginationContent: ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => (
    <ul data-testid="pagination-content" className={className}>
      {children}
    </ul>
  ),
  PaginationItem: ({ children }: { children: React.ReactNode }) => (
    <li data-testid="pagination-item">{children}</li>
  ),
  PaginationLink: ({
    children,
    href,
    onClick,
    isActive,
    className,
  }: {
    children: React.ReactNode;
    href?: string;
    onClick?: (e: React.MouseEvent) => void;
    isActive?: boolean;
    className?: string;
  }) => (
    <a
      href={href}
      onClick={onClick}
      data-testid="pagination-link"
      data-active={isActive}
      className={className}
    >
      {children}
    </a>
  ),
  PaginationPrevious: ({
    href,
    onClick,
    className,
    "aria-disabled": ariaDisabled,
    "aria-label": ariaLabel,
    tabIndex,
  }: {
    href?: string;
    onClick?: (e: React.MouseEvent) => void;
    className?: string;
    "aria-disabled"?: boolean | "true" | "false";
    "aria-label"?: string;
    tabIndex?: number;
  }) => (
    <a
      href={href}
      onClick={onClick}
      data-testid="pagination-previous"
      aria-disabled={ariaDisabled}
      aria-label={ariaLabel}
      tabIndex={tabIndex}
      className={className}
    >
      {"Previous"}
    </a>
  ),
  PaginationNext: ({
    href,
    onClick,
    className,
    "aria-disabled": ariaDisabled,
    "aria-label": ariaLabel,
    tabIndex,
  }: {
    href?: string;
    onClick?: (e: React.MouseEvent) => void;
    className?: string;
    "aria-disabled"?: boolean | "true" | "false";
    "aria-label"?: string;
    tabIndex?: number;
  }) => (
    <a
      href={href}
      onClick={onClick}
      data-testid="pagination-next"
      aria-disabled={ariaDisabled}
      aria-label={ariaLabel}
      tabIndex={tabIndex}
      className={className}
    >
      {"Next"}
    </a>
  ),
  PaginationEllipsis: () => (
    <span data-testid="pagination-ellipsis">{"..."}</span>
  ),
}));

// Mock the Select components
vi.mock("@/components/ui/select", () => ({
  Select: ({
    children,
    value,
    onValueChange,
  }: {
    children: React.ReactNode;
    value?: string;
    onValueChange?: (value: string) => void;
  }) => (
    <div data-testid="select" data-value={value}>
      {React.Children.map(children, (child) => {
        if (React.isValidElement(child)) {
          return React.cloneElement(child as React.ReactElement<any>, {
            onValueChange,
          });
        }
        return child;
      })}
    </div>
  ),
  SelectTrigger: ({
    children,
    "aria-label": ariaLabel,
  }: {
    children: React.ReactNode;
    "aria-label"?: string;
  }) => (
    <button data-testid="select-trigger" aria-label={ariaLabel}>
      {children}
    </button>
  ),
  SelectValue: ({ placeholder }: { placeholder?: React.ReactNode }) => (
    <span data-testid="select-value">{placeholder}</span>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="select-content">{children}</div>
  ),
  SelectGroup: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="select-group">{children}</div>
  ),
  SelectItem: ({
    children,
    value,
  }: {
    children: React.ReactNode;
    value: string;
  }) => (
    <div data-testid="select-item" data-value={value}>
      {children}
    </div>
  ),
}));

describe("PaginationComponent", () => {
  const mockOnPageChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("rendering", () => {
    it("returns null when totalPages is less than 2", () => {
      const { container } = render(
        <PaginationComponent
          currentPage={1}
          totalPages={1}
          onPageChange={mockOnPageChange}
        />
      );
      expect(container.firstChild).toBeNull();
    });

    it("renders pagination when totalPages is 2 or more", () => {
      render(
        <PaginationComponent
          currentPage={1}
          totalPages={5}
          onPageChange={mockOnPageChange}
        />
      );
      expect(screen.getByTestId("pagination")).toBeInTheDocument();
    });

    it("renders previous and next buttons", () => {
      render(
        <PaginationComponent
          currentPage={2}
          totalPages={5}
          onPageChange={mockOnPageChange}
        />
      );
      expect(screen.getByTestId("pagination-previous")).toBeInTheDocument();
      expect(screen.getByTestId("pagination-next")).toBeInTheDocument();
    });

    it("renders page number links", () => {
      render(
        <PaginationComponent
          currentPage={1}
          totalPages={3}
          onPageChange={mockOnPageChange}
        />
      );
      const links = screen.getAllByTestId("pagination-link");
      expect(links.length).toBeGreaterThan(0);
    });
  });

  describe("first page behavior", () => {
    it("disables previous button on first page", () => {
      render(
        <PaginationComponent
          currentPage={1}
          totalPages={5}
          onPageChange={mockOnPageChange}
        />
      );
      const prevButton = screen.getByTestId("pagination-previous");
      expect(prevButton).toHaveAttribute("aria-disabled", "true");
      expect(prevButton).toHaveAttribute("tabindex", "-1");
      expect(prevButton).toHaveClass("pointer-events-none");
    });

    it("enables next button on first page when not last", () => {
      render(
        <PaginationComponent
          currentPage={1}
          totalPages={5}
          onPageChange={mockOnPageChange}
        />
      );
      const nextButton = screen.getByTestId("pagination-next");
      expect(nextButton).not.toHaveAttribute("aria-disabled");
    });

    it("marks first page as active", () => {
      render(
        <PaginationComponent
          currentPage={1}
          totalPages={5}
          onPageChange={mockOnPageChange}
        />
      );
      const links = screen.getAllByTestId("pagination-link");
      const firstPageLink = links.find((link) => link.textContent === "1");
      expect(firstPageLink).toHaveAttribute("data-active", "true");
    });
  });

  describe("last page behavior", () => {
    it("disables next button on last page", () => {
      render(
        <PaginationComponent
          currentPage={5}
          totalPages={5}
          onPageChange={mockOnPageChange}
        />
      );
      const nextButton = screen.getByTestId("pagination-next");
      expect(nextButton).toHaveAttribute("aria-disabled", "true");
      expect(nextButton).toHaveAttribute("tabindex", "-1");
      expect(nextButton).toHaveClass("pointer-events-none");
    });

    it("enables previous button on last page", () => {
      render(
        <PaginationComponent
          currentPage={5}
          totalPages={5}
          onPageChange={mockOnPageChange}
        />
      );
      const prevButton = screen.getByTestId("pagination-previous");
      expect(prevButton).not.toHaveAttribute("aria-disabled");
    });
  });

  describe("navigation", () => {
    it("calls onPageChange when clicking next", () => {
      render(
        <PaginationComponent
          currentPage={2}
          totalPages={5}
          onPageChange={mockOnPageChange}
        />
      );
      const nextButton = screen.getByTestId("pagination-next");
      fireEvent.click(nextButton);
      expect(mockOnPageChange).toHaveBeenCalledWith(3);
    });

    it("calls onPageChange when clicking previous", () => {
      render(
        <PaginationComponent
          currentPage={3}
          totalPages={5}
          onPageChange={mockOnPageChange}
        />
      );
      const prevButton = screen.getByTestId("pagination-previous");
      fireEvent.click(prevButton);
      expect(mockOnPageChange).toHaveBeenCalledWith(2);
    });

    it("does not navigate when clicking previous on first page", () => {
      render(
        <PaginationComponent
          currentPage={1}
          totalPages={5}
          onPageChange={mockOnPageChange}
        />
      );
      const prevButton = screen.getByTestId("pagination-previous");
      fireEvent.click(prevButton);
      expect(mockOnPageChange).not.toHaveBeenCalled();
    });

    it("does not navigate when clicking next on last page", () => {
      render(
        <PaginationComponent
          currentPage={5}
          totalPages={5}
          onPageChange={mockOnPageChange}
        />
      );
      const nextButton = screen.getByTestId("pagination-next");
      fireEvent.click(nextButton);
      expect(mockOnPageChange).not.toHaveBeenCalled();
    });

    it("calls onPageChange when clicking a page number", () => {
      render(
        <PaginationComponent
          currentPage={1}
          totalPages={5}
          onPageChange={mockOnPageChange}
        />
      );
      const links = screen.getAllByTestId("pagination-link");
      // Find page 2 link
      const page2Link = links.find((link) => link.textContent === "2");
      if (page2Link) {
        fireEvent.click(page2Link);
        expect(mockOnPageChange).toHaveBeenCalledWith(2);
      }
    });
  });

  describe("ellipsis rendering", () => {
    it("renders ellipsis dropdown for many pages", () => {
      render(
        <PaginationComponent
          currentPage={5}
          totalPages={10}
          onPageChange={mockOnPageChange}
        />
      );
      // Should show ellipsis for hidden pages
      expect(screen.getAllByTestId("select").length).toBeGreaterThan(0);
    });

    it("does not render ellipsis for few pages", () => {
      render(
        <PaginationComponent
          currentPage={2}
          totalPages={3}
          onPageChange={mockOnPageChange}
        />
      );
      expect(screen.queryByTestId("select")).not.toBeInTheDocument();
    });
  });

  describe("edge cases", () => {
    it("handles exactly 2 pages", () => {
      render(
        <PaginationComponent
          currentPage={1}
          totalPages={2}
          onPageChange={mockOnPageChange}
        />
      );
      expect(screen.getByTestId("pagination")).toBeInTheDocument();
      const links = screen.getAllByTestId("pagination-link");
      expect(links.length).toBe(2);
    });

    it("handles middle page in large pagination", () => {
      render(
        <PaginationComponent
          currentPage={50}
          totalPages={100}
          onPageChange={mockOnPageChange}
        />
      );
      expect(screen.getByTestId("pagination")).toBeInTheDocument();
      // Should show page 1, ellipsis, pages around 50, ellipsis, page 100
    });

    it("handles current page at start of range", () => {
      render(
        <PaginationComponent
          currentPage={2}
          totalPages={10}
          onPageChange={mockOnPageChange}
        />
      );
      expect(screen.getByTestId("pagination")).toBeInTheDocument();
    });

    it("handles current page at end of range", () => {
      render(
        <PaginationComponent
          currentPage={9}
          totalPages={10}
          onPageChange={mockOnPageChange}
        />
      );
      expect(screen.getByTestId("pagination")).toBeInTheDocument();
    });
  });

  describe("accessibility", () => {
    it("has proper aria-labels on navigation buttons", () => {
      render(
        <PaginationComponent
          currentPage={2}
          totalPages={5}
          onPageChange={mockOnPageChange}
        />
      );
      expect(screen.getByTestId("pagination-previous")).toHaveAttribute(
        "aria-label",
        "Go to previous page"
      );
      expect(screen.getByTestId("pagination-next")).toHaveAttribute(
        "aria-label",
        "Go to next page"
      );
    });

    it("has aria-label on ellipsis dropdown", () => {
      render(
        <PaginationComponent
          currentPage={5}
          totalPages={10}
          onPageChange={mockOnPageChange}
        />
      );
      const selectTriggers = screen.getAllByTestId("select-trigger");
      selectTriggers.forEach((trigger) => {
        expect(trigger).toHaveAttribute("aria-label", "Select page");
      });
    });
  });
});
