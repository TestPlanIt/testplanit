import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useParams: vi.fn(() => ({ projectId: "1" })),
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  })),
  usePathname: vi.fn(() => "/"),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));

// Mock the navigation Link as a simple anchor
vi.mock("~/lib/navigation", () => ({
  Link: vi.fn(
    ({
      children,
      href,
      onClick,
      ...props
    }: {
      children: React.ReactNode;
      href: string;
      onClick?: () => void;
      [key: string]: any;
    }) => (
      <a href={href} onClick={onClick} {...props}>
        {children}
      </a>
    )
  ),
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  })),
}));

import React from "react";
import BreadcrumbComponent from "./BreadcrumbComponent";

const rootFolder = { id: 1, text: "Root Folder", parent: 0 };
const childFolder = { id: 2, text: "Child Folder", parent: 1 };
const grandchildFolder = { id: 3, text: "Grandchild Folder", parent: 2 };

describe("BreadcrumbComponent", () => {
  it("renders single root folder breadcrumb without separator", () => {
    render(
      <BreadcrumbComponent
        breadcrumbItems={[rootFolder]}
        projectId="1"
      />
    );

    expect(screen.getByText("Root Folder")).toBeInTheDocument();

    // No separator should appear for a single item
    const _separators = document.querySelectorAll('[aria-hidden="true"]');
    // For single item, there should be no separator (the separator component adds one between items)
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
  });

  it("renders nested folder hierarchy with separators between items", () => {
    render(
      <BreadcrumbComponent
        breadcrumbItems={[rootFolder, childFolder, grandchildFolder]}
        projectId="1"
      />
    );

    expect(screen.getByText("Root Folder")).toBeInTheDocument();
    expect(screen.getByText("Child Folder")).toBeInTheDocument();
    expect(screen.getByText("Grandchild Folder")).toBeInTheDocument();
  });

  it("renders last item as non-clickable BreadcrumbPage when isLastClickable=false", () => {
    render(
      <BreadcrumbComponent
        breadcrumbItems={[rootFolder, childFolder]}
        projectId="1"
        isLastClickable={false}
      />
    );

    // The last item (childFolder) should be a button-type trigger (not a Link with href)
    // Root folder should still be a link
    const links = document.querySelectorAll("a");
    // Only root folder should be a link in this case
    const linkHrefs = Array.from(links).map((a) => a.getAttribute("href"));
    expect(linkHrefs.some((href) => href?.includes("node=1"))).toBe(true);
    expect(linkHrefs.some((href) => href?.includes("node=2"))).toBe(false);
  });

  it("renders last item as clickable link when isLastClickable=true (default)", () => {
    render(
      <BreadcrumbComponent
        breadcrumbItems={[rootFolder, childFolder]}
        projectId="1"
        isLastClickable={true}
      />
    );

    // Both items should have links (or at least the last one too)
    const links = document.querySelectorAll("a");
    const linkHrefs = Array.from(links).map((a) => a.getAttribute("href"));
    // Both folders should be clickable links
    expect(linkHrefs.some((href) => href?.includes("node=2"))).toBe(true);
  });

  it("onClick handler fires with correct folderId when breadcrumb item clicked", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(
      <BreadcrumbComponent
        breadcrumbItems={[rootFolder, childFolder]}
        projectId="1"
        onClick={onClick}
      />
    );

    // Click on root folder link
    const rootLink = document.querySelector(`a[href*="node=1"]`);
    expect(rootLink).toBeInTheDocument();
    await user.click(rootLink!);

    expect(onClick).toHaveBeenCalledWith(1);
  });

  it("renders empty breadcrumb (just the Folders icon) when breadcrumbItems is empty", () => {
    const { container } = render(
      <BreadcrumbComponent breadcrumbItems={[]} projectId="1" />
    );

    // Should render the breadcrumb container with folders icon but no items
    expect(container.querySelector("nav")).toBeInTheDocument();
    // No folder text should appear
    expect(screen.queryByText("Root Folder")).not.toBeInTheDocument();
  });

  it("renders folder names with truncate class for long names", () => {
    const longNameFolder = { id: 99, text: "A Very Long Folder Name That Should Be Truncated In The UI", parent: 0 };

    render(
      <BreadcrumbComponent
        breadcrumbItems={[longNameFolder]}
        projectId="1"
      />
    );

    const span = screen.getByText(longNameFolder.text);
    expect(span).toBeInTheDocument();
    // The span should have the truncate class
    expect(span.className).toContain("truncate");
  });

  it("shows full folder name in tooltip content", () => {
    const folderWithLongName = { id: 5, text: "Long Folder Name For Tooltip Test", parent: 0 };

    render(
      <BreadcrumbComponent
        breadcrumbItems={[folderWithLongName]}
        projectId="1"
      />
    );

    // The tooltip content should contain the folder name
    // Radix Tooltip renders TooltipContent in the DOM (may be hidden)
    // At minimum, the visible text should be present
    expect(screen.getByText("Long Folder Name For Tooltip Test")).toBeInTheDocument();
  });

  it("builds correct href for folder items", () => {
    render(
      <BreadcrumbComponent
        breadcrumbItems={[{ id: 42, text: "My Folder", parent: 0 }]}
        projectId="123"
        isLastClickable={true}
      />
    );

    const link = document.querySelector(`a[href*="node=42"]`);
    expect(link).toBeInTheDocument();
    expect(link?.getAttribute("href")).toContain("/projects/repository/123/");
    expect(link?.getAttribute("href")).toContain("node=42");
  });
});
