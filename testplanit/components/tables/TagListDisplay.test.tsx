import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { TagsListDisplay } from "./TagListDisplay";

// Mock the navigation Link
vi.mock("~/lib/navigation", () => ({
  Link: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

// Mock the UI components
vi.mock("@/components/ui/badge", () => ({
  Badge: ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => (
    <span data-testid="badge" className={className}>
      {children}
    </span>
  ),
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="popover">{children}</div>
  ),
  PopoverTrigger: ({
    children,
    asChild,
  }: {
    children: React.ReactNode;
    asChild?: boolean;
  }) => <div data-testid="popover-trigger">{children}</div>,
  PopoverContent: ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => (
    <div data-testid="popover-content" className={className}>
      {children}
    </div>
  ),
}));

// Mock lucide-react icons
vi.mock("lucide-react", () => ({
  Tag: ({ className }: { className?: string }) => (
    <span data-testid="tag-icon" className={className}>
      {"Tag"}
    </span>
  ),
  TagIcon: ({ className }: { className?: string }) => (
    <span data-testid="tag-list-icon" className={className}>
      {"TagIcon"}
    </span>
  ),
}));

describe("TagsListDisplay", () => {
  const mockTags = [
    { id: 1, name: "Bug" },
    { id: 2, name: "Feature" },
    { id: 3, name: "Enhancement" },
  ];
  const projectId = 123;

  it("renders null when tags is null", () => {
    const { container } = render(
      <TagsListDisplay tags={null} projectId={projectId} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders null when tags array is empty", () => {
    const { container } = render(
      <TagsListDisplay tags={[]} projectId={projectId} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders popover with tag count", () => {
    render(<TagsListDisplay tags={mockTags} projectId={projectId} />);

    expect(screen.getByTestId("popover")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("renders tag icon in trigger", () => {
    render(<TagsListDisplay tags={mockTags} projectId={projectId} />);

    expect(screen.getByTestId("tag-list-icon")).toBeInTheDocument();
  });

  it("renders all tags in popover content", () => {
    render(<TagsListDisplay tags={mockTags} projectId={projectId} />);

    expect(screen.getByText("Bug")).toBeInTheDocument();
    expect(screen.getByText("Feature")).toBeInTheDocument();
    expect(screen.getByText("Enhancement")).toBeInTheDocument();
  });

  it("renders correct links for each tag", () => {
    render(<TagsListDisplay tags={mockTags} projectId={projectId} />);

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(3);
    expect(links[0]).toHaveAttribute("href", "/projects/tags/123/1");
    expect(links[1]).toHaveAttribute("href", "/projects/tags/123/2");
    expect(links[2]).toHaveAttribute("href", "/projects/tags/123/3");
  });

  it("renders tag icons within each tag badge", () => {
    render(<TagsListDisplay tags={mockTags} projectId={projectId} />);

    const tagIcons = screen.getAllByTestId("tag-icon");
    expect(tagIcons).toHaveLength(3);
  });

  it("handles single tag", () => {
    const singleTag = [{ id: 1, name: "Single" }];
    render(<TagsListDisplay tags={singleTag} projectId={projectId} />);

    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("Single")).toBeInTheDocument();
  });

  it("handles tags with long names", () => {
    const longNameTags = [
      { id: 1, name: "This is a very long tag name that might need truncation" },
    ];
    render(<TagsListDisplay tags={longNameTags} projectId={projectId} />);

    expect(
      screen.getByText("This is a very long tag name that might need truncation")
    ).toBeInTheDocument();
  });

  it("handles different project IDs", () => {
    render(<TagsListDisplay tags={mockTags} projectId={999} />);

    const links = screen.getAllByRole("link");
    expect(links[0]).toHaveAttribute("href", "/projects/tags/999/1");
  });

  it("renders badges with correct structure", () => {
    render(<TagsListDisplay tags={mockTags} projectId={projectId} />);

    const badges = screen.getAllByTestId("badge");
    // 1 for the trigger badge + 3 for each tag badge
    expect(badges.length).toBeGreaterThanOrEqual(4);
  });
});
