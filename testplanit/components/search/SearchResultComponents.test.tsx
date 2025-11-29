import { describe, it, expect, vi } from "vitest";
import { render, screen } from "~/test/test-utils";
import {
  MetadataItem,
  MetadataSeparator,
  MetadataList,
  StatusBadge,
  TimeEstimate,
  TagList,
  BadgeList,
  ExternalLink,
  DateDisplay,
  SearchHighlight,
} from "./SearchResultComponents";
import React from "react";

// Mock dependencies
vi.mock("@/components/DateFormatter", () => ({
  DateFormatter: ({ date }: { date: string | Date }) => (
    <span data-testid="date-formatter">{typeof date === "string" ? date : date.toISOString()}</span>
  ),
}));

vi.mock("@/components/DurationDisplay", () => ({
  DurationDisplay: ({ seconds }: { seconds: number }) => (
    <span data-testid="duration-display">{seconds}{"s"}</span>
  ),
}));

describe("SearchResultComponents", () => {
  describe("MetadataItem", () => {
    it("should render children with default classes", () => {
      render(<MetadataItem>{"Test metadata"}</MetadataItem>);
      
      const item = screen.getByText("Test metadata");
      expect(item).toBeInTheDocument();
      expect(item).toHaveClass("text-xs");
    });

    it("should apply custom className", () => {
      render(<MetadataItem className="custom-class">{"Test"}</MetadataItem>);
      
      const item = screen.getByText("Test");
      expect(item).toHaveClass("text-xs");
      expect(item).toHaveClass("custom-class");
    });
  });

  describe("MetadataSeparator", () => {
    it("should render bullet separator", () => {
      render(<MetadataSeparator />);
      
      const separator = screen.getByText("•");
      expect(separator).toBeInTheDocument();
      expect(separator).toHaveClass("text-muted-foreground");
    });

    it("should apply custom className", () => {
      render(<MetadataSeparator className="custom-separator" />);
      
      const separator = screen.getByText("•");
      expect(separator).toHaveClass("custom-separator");
    });
  });

  describe("MetadataList", () => {
    it("should render multiple items with separators", () => {
      const items = ["Item 1", "Item 2", "Item 3"];
      const { container } = render(<MetadataList items={items} />);
      
      // Check that the container has all items
      const metadataContainer = container.querySelector('.flex.items-center.gap-2');
      expect(metadataContainer).toHaveTextContent("Item 1");
      expect(metadataContainer).toHaveTextContent("Item 2");
      expect(metadataContainer).toHaveTextContent("Item 3");
      
      // Should have 2 separators for 3 items
      const separators = screen.getAllByText("•");
      expect(separators).toHaveLength(2);
    });

    it("should filter out null and undefined items", () => {
      const items = ["Item 1", null, undefined, "Item 2", null];
      const { container } = render(<MetadataList items={items} />);
      
      const metadataContainer = container.querySelector('.flex.items-center.gap-2');
      expect(metadataContainer).toHaveTextContent("Item 1");
      expect(metadataContainer).toHaveTextContent("Item 2");
      
      // Should have only 1 separator for 2 valid items
      const separators = screen.getAllByText("•");
      expect(separators).toHaveLength(1);
    });

    it("should render empty when all items are null/undefined", () => {
      const items = [null, undefined, null];
      const { container } = render(<MetadataList items={items} />);
      
      const div = container.querySelector("div");
      expect(div).toBeEmptyDOMElement();
    });

    it("should apply custom className", () => {
      const { container } = render(<MetadataList items={["Test"]} className="custom-list" />);
      
      // The div containing the items should have the custom class
      const metadataContainer = container.querySelector('.flex.items-center.gap-2');
      expect(metadataContainer).toHaveClass("custom-list");
      expect(metadataContainer).toHaveClass("flex");
      expect(metadataContainer).toHaveClass("items-center");
    });

    it("should render React components as items", () => {
      const items = [
        <span key="1">{"Component 1"}</span>,
        <div key="2">{"Component 2"}</div>,
      ];
      render(<MetadataList items={items} />);
      
      expect(screen.getByText("Component 1")).toBeInTheDocument();
      expect(screen.getByText("Component 2")).toBeInTheDocument();
    });
  });

  describe("StatusBadge", () => {
    it("should render completed status with green color", () => {
      render(
        <StatusBadge 
          isCompleted={true} 
          completedText="Completed" 
          activeText="Active" 
        />
      );
      
      const badge = screen.getByText("Completed");
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveClass("text-green-600");
    });

    it("should render active status with yellow color", () => {
      render(
        <StatusBadge 
          isCompleted={false} 
          completedText="Completed" 
          activeText="Active" 
        />
      );
      
      const badge = screen.getByText("Active");
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveClass("text-yellow-600");
    });

    it("should apply custom className", () => {
      render(
        <StatusBadge 
          isCompleted={true} 
          completedText="Done" 
          activeText="In Progress"
          className="custom-badge"
        />
      );
      
      const badge = screen.getByText("Done");
      expect(badge).toHaveClass("custom-badge");
    });
  });

  describe("TimeEstimate", () => {
    it("should render time estimate with seconds", () => {
      render(<TimeEstimate label="Estimate" seconds={3600} />);
      
      expect(screen.getByText("Estimate:")).toBeInTheDocument();
      expect(screen.getByTestId("duration-display")).toHaveTextContent("3600s");
    });

    it("should render time estimate with minutes", () => {
      render(<TimeEstimate label="Duration" minutes={60} />);
      
      expect(screen.getByText("Duration:")).toBeInTheDocument();
      expect(screen.getByTestId("duration-display")).toHaveTextContent("3600s");
    });

    it("should prioritize seconds over minutes", () => {
      render(<TimeEstimate label="Time" seconds={120} minutes={60} />);
      
      expect(screen.getByTestId("duration-display")).toHaveTextContent("120s");
    });

    it("should return null when no time provided", () => {
      const { container } = render(<TimeEstimate label="Time" />);
      expect(container.firstChild).toBeNull();
    });

    it("should return null when time is 0", () => {
      const { container } = render(<TimeEstimate label="Time" seconds={0} />);
      expect(container.firstChild).toBeNull();
    });

    it("should apply custom className", () => {
      render(<TimeEstimate label="Time" seconds={60} className="custom-time" />);
      
      // Find the span that contains "Time:" text
      const wrapper = screen.getByText(/Time:/i).closest('span');
      expect(wrapper).toHaveClass("custom-time");
    });
  });

  describe("TagList", () => {
    const tags = [
      { id: 1, name: "Tag1" },
      { id: 2, name: "Tag2" },
      { id: 3, name: "Tag3" },
      { id: 4, name: "Tag4" },
    ];

    it("should render tags with default max visible", () => {
      render(<TagList tags={tags} />);
      
      expect(screen.getByText("Tag1")).toBeInTheDocument();
      expect(screen.getByText("Tag2")).toBeInTheDocument();
      expect(screen.getByText("Tag3")).toBeInTheDocument();
      expect(screen.queryByText("Tag4")).not.toBeInTheDocument();
      expect(screen.getByText("+1")).toBeInTheDocument();
    });

    it("should render all tags when maxVisible is higher", () => {
      render(<TagList tags={tags} maxVisible={5} />);
      
      expect(screen.getByText("Tag1")).toBeInTheDocument();
      expect(screen.getByText("Tag2")).toBeInTheDocument();
      expect(screen.getByText("Tag3")).toBeInTheDocument();
      expect(screen.getByText("Tag4")).toBeInTheDocument();
      expect(screen.queryByText("+")).not.toBeInTheDocument();
    });

    it("should return null for empty tags", () => {
      const { container } = render(<TagList tags={[]} />);
      expect(container.firstChild).toBeNull();
    });

    it("should return null for null tags", () => {
      const { container } = render(<TagList tags={null as any} />);
      expect(container.firstChild).toBeNull();
    });

    it("should apply custom className", () => {
      render(<TagList tags={tags} className="custom-tags" />);
      
      // Find the container div that wraps all tags
      const tagBadge = screen.getByText("Tag1").closest('[class*="rounded-md"]');
      const wrapper = tagBadge?.parentElement;
      expect(wrapper).toHaveClass("custom-tags");
    });

    it("should show correct remaining count", () => {
      render(<TagList tags={tags} maxVisible={1} />);
      
      expect(screen.getByText("+3")).toBeInTheDocument();
    });
  });

  describe("BadgeList", () => {
    it("should render multiple badge items", () => {
      const items = [
        <span key="1">{"Badge 1"}</span>,
        <span key="2">{"Badge 2"}</span>,
      ];
      render(<BadgeList items={items} />);
      
      expect(screen.getByText("Badge 1")).toBeInTheDocument();
      expect(screen.getByText("Badge 2")).toBeInTheDocument();
    });

    it("should filter out null and undefined items", () => {
      const items = [
        <span key="1">{"Badge 1"}</span>,
        null,
        undefined,
        <span key="2">{"Badge 2"}</span>,
      ];
      render(<BadgeList items={items} />);
      
      expect(screen.getByText("Badge 1")).toBeInTheDocument();
      expect(screen.getByText("Badge 2")).toBeInTheDocument();
    });

    it("should apply custom className", () => {
      render(<BadgeList items={[<span key="1">{"Test"}</span>]} className="custom-badges" />);
      
      const wrapper = screen.getByText("Test").parentElement;
      expect(wrapper).toHaveClass("custom-badges");
      expect(wrapper).toHaveClass("flex");
      expect(wrapper).toHaveClass("items-center");
      expect(wrapper).toHaveClass("gap-2");
      expect(wrapper).toHaveClass("mt-1");
    });
  });

  describe("ExternalLink", () => {
    it("should render link text", () => {
      render(<ExternalLink url="https://example.com" />);
      
      const link = screen.getByText("https://example.com");
      expect(link).toBeInTheDocument();
      expect(link).toHaveClass("text-blue-600");
      expect(link).toHaveClass("hover:underline");
    });

    it("should apply custom className", () => {
      render(<ExternalLink url="https://test.com" className="custom-link" />);
      
      const link = screen.getByText("https://test.com");
      expect(link).toHaveClass("custom-link");
    });
  });

  describe("DateDisplay", () => {
    it("should render date without label", () => {
      render(<DateDisplay date="2024-01-15" />);
      
      const formatter = screen.getByTestId("date-formatter");
      expect(formatter).toHaveTextContent("2024-01-15");
    });

    it("should render date with label", () => {
      render(<DateDisplay date="2024-01-15" label="Created" />);
      
      expect(screen.getByText("Created:")).toBeInTheDocument();
      const formatter = screen.getByTestId("date-formatter");
      expect(formatter).toHaveTextContent("2024-01-15");
    });

    it("should accept Date object", () => {
      const date = new Date("2024-01-15T10:30:00Z");
      render(<DateDisplay date={date} />);
      
      const formatter = screen.getByTestId("date-formatter");
      expect(formatter).toHaveTextContent(date.toISOString());
    });

    it("should apply custom className", () => {
      render(<DateDisplay date="2024-01-15" className="custom-date" />);
      
      const wrapper = screen.getByTestId("date-formatter").parentElement;
      expect(wrapper).toHaveClass("custom-date");
      expect(wrapper).toHaveClass("text-xs");
      expect(wrapper).toHaveClass("text-muted-foreground");
    });
  });

  describe("SearchHighlight", () => {
    it("should render highlighted text", () => {
      const highlights = {
        content: ["This is <mark>highlighted</mark> text"],
      };
      
      render(<SearchHighlight highlights={highlights} field="content" />);
      
      const highlight = screen.getByText(/This is/);
      expect(highlight.innerHTML).toContain("<mark>highlighted</mark>");
    });

    it("should return null when no highlights", () => {
      const { container } = render(<SearchHighlight field="content" />);
      expect(container.firstChild).toBeNull();
    });

    it("should return null when field not found", () => {
      const highlights = {
        other: ["Some text"],
      };
      
      const { container } = render(<SearchHighlight highlights={highlights} field="content" />);
      expect(container.firstChild).toBeNull();
    });

    it("should return null when field array is empty", () => {
      const highlights = {
        content: [],
      };
      
      const { container } = render(<SearchHighlight highlights={highlights} field="content" />);
      expect(container.firstChild).toBeNull();
    });

    it("should apply custom className", () => {
      const highlights = {
        content: ["Text"],
      };
      
      render(<SearchHighlight highlights={highlights} field="content" className="custom-highlight" />);
      
      const wrapper = screen.getByText("Text").parentElement;
      expect(wrapper).toHaveClass("custom-highlight");
      expect(wrapper).toHaveClass("text-sm");
      expect(wrapper).toHaveClass("text-muted-foreground");
      expect(wrapper).toHaveClass("mt-2");
    });

    it("should apply line-clamp class to content", () => {
      const highlights = {
        content: ["Very long text that should be clamped"],
      };
      
      render(<SearchHighlight highlights={highlights} field="content" />);
      
      const p = screen.getByText(/Very long text/);
      expect(p).toHaveClass("line-clamp-2");
    });
  });
});