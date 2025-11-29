import { describe, it, expect, vi } from "vitest";
import { render, screen } from "~/test/test-utils";
import { ProjectNameDisplay } from "./ProjectNameDisplay";
import React from "react";

// Mock dependencies
vi.mock("~/lib/navigation", () => ({
  Link: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className} data-testid="link">
      {children}
    </a>
  ),
}));

vi.mock("@/components/ProjectIcon", () => ({
  ProjectIcon: ({ iconUrl, width, height }: { iconUrl?: string | null; width: number; height: number }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img 
      data-testid="project-icon" 
      src={iconUrl || "default-icon.png"} 
      width={width} 
      height={height} 
      alt="Project Icon"
    />
  ),
}));

// Mock tooltip components
vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <span className={className} data-testid="tooltip-trigger">
      {children}
    </span>
  ),
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tooltip-content">{children}</div>
  ),
}));

describe("ProjectNameDisplay Component", () => {
  const defaultProps = {
    projectName: "Test Project",
    projectId: 123,
  };

  it("should render project name without link by default", () => {
    render(<ProjectNameDisplay {...defaultProps} />);
    
    // Use getAllByText since tooltip duplicates the text
    const projectNames = screen.getAllByText("Test Project");
    expect(projectNames).toHaveLength(2); // One in trigger, one in tooltip content
    expect(screen.queryByTestId("link")).not.toBeInTheDocument();
  });

  it("should render project name with link when showLink is true", () => {
    render(<ProjectNameDisplay {...defaultProps} showLink={true} />);
    
    const link = screen.getByTestId("link");
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/projects/overview/123");
    // Use getAllByText since tooltip duplicates the text
    const projectNames = screen.getAllByText("Test Project");
    expect(projectNames).toHaveLength(2);
  });

  it("should render project icon", () => {
    render(<ProjectNameDisplay {...defaultProps} />);
    
    const icon = screen.getByTestId("project-icon");
    expect(icon).toBeInTheDocument();
    expect(icon).toHaveAttribute("width", "16");
    expect(icon).toHaveAttribute("height", "16");
  });

  it("should render project icon with custom URL", () => {
    render(<ProjectNameDisplay {...defaultProps} iconUrl="https://example.com/icon.png" />);
    
    const icon = screen.getByTestId("project-icon");
    expect(icon).toHaveAttribute("src", "https://example.com/icon.png");
  });

  it("should render project icon with default when iconUrl is null", () => {
    render(<ProjectNameDisplay {...defaultProps} iconUrl={null} />);
    
    const icon = screen.getByTestId("project-icon");
    expect(icon).toHaveAttribute("src", "default-icon.png");
  });

  it("should apply custom className", () => {
    render(<ProjectNameDisplay {...defaultProps} className="custom-class" />);
    
    // Use getAllByText since tooltip duplicates the text, then check the parent container
    const projectNames = screen.getAllByText("Test Project");
    // Get the outer container (not the tooltip trigger)
    const container = projectNames[0].closest('.inline-flex');
    expect(container).toHaveClass("custom-class");
    expect(container).toHaveClass("inline-flex");
    expect(container).toHaveClass("items-center");
  });

  it("should apply custom className to link when showLink is true", () => {
    render(<ProjectNameDisplay {...defaultProps} showLink={true} className="custom-link-class" />);
    
    const link = screen.getByTestId("link");
    expect(link).toHaveClass("custom-link-class");
    expect(link).toHaveClass("hover:underline");
    expect(link).toHaveClass("inline-flex");
    expect(link).toHaveClass("items-center");
  });

  it("should render tooltip trigger with proper classes", () => {
    render(<ProjectNameDisplay {...defaultProps} />);
    
    const tooltipTrigger = screen.getByTestId("tooltip-trigger");
    expect(tooltipTrigger).toHaveClass("text-left");
    expect(tooltipTrigger).toHaveClass("truncate");
    expect(tooltipTrigger).toHaveClass("max-w-[200px]");
    expect(tooltipTrigger).toHaveClass("inline-block");
  });

  it("should render tooltip content with project name", () => {
    render(<ProjectNameDisplay {...defaultProps} />);
    
    const tooltipContent = screen.getByTestId("tooltip-content");
    expect(tooltipContent).toHaveTextContent("Test Project");
  });

  it("should handle long project names", () => {
    const longName = "This is a very long project name that should be truncated in the display";
    render(<ProjectNameDisplay projectName={longName} projectId={456} />);
    
    // Use getAllByText since tooltip duplicates the text
    const projectNames = screen.getAllByText(longName);
    expect(projectNames).toHaveLength(2);
    // The truncation is handled by CSS classes
    const tooltipTrigger = screen.getByTestId("tooltip-trigger");
    expect(tooltipTrigger).toHaveClass("truncate");
    expect(tooltipTrigger).toHaveClass("max-w-[200px]");
  });

  it("should create correct link href based on projectId", () => {
    render(<ProjectNameDisplay projectName="Another Project" projectId={999} showLink={true} />);
    
    const link = screen.getByTestId("link");
    expect(link).toHaveAttribute("href", "/projects/overview/999");
  });

  it("should render with all props", () => {
    render(
      <ProjectNameDisplay 
        projectName="Full Props Project"
        projectId={777}
        iconUrl="https://example.com/custom-icon.png"
        className="my-custom-class"
        showLink={true}
      />
    );
    
    const link = screen.getByTestId("link");
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/projects/overview/777");
    expect(link).toHaveClass("my-custom-class");
    
    const icon = screen.getByTestId("project-icon");
    expect(icon).toHaveAttribute("src", "https://example.com/custom-icon.png");
    
    // Use getAllByText since tooltip duplicates the text
    const projectNames = screen.getAllByText("Full Props Project");
    expect(projectNames).toHaveLength(2);
  });
});