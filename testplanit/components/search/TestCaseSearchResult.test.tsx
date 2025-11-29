import { describe, it, expect } from "vitest";
import { render, screen } from "~/test/test-utils";
import { TestCaseSearchResult } from "./TestCaseSearchResult";
import React from "react";

describe("TestCaseSearchResult Component", () => {
  describe("Basic rendering", () => {
    it("should render test case name", () => {
      const testCase = {
        id: 1,
        name: "Test Case Name",
      };
      
      render(<TestCaseSearchResult testCase={testCase} />);
      expect(screen.getByText("Test Case Name")).toBeInTheDocument();
    });

    it("should render fallback text when name is missing", () => {
      const testCase = {
        id: 123,
      };
      
      render(<TestCaseSearchResult testCase={testCase} />);
      expect(screen.getByText("Case 123")).toBeInTheDocument();
    });

    it("should render fallback with Unknown when both name and id are missing", () => {
      const testCase = {};
      
      render(<TestCaseSearchResult testCase={testCase} />);
      expect(screen.getByText("Case Unknown")).toBeInTheDocument();
    });

    it("should render with string id", () => {
      const testCase = {
        id: "test-123",
      };
      
      render(<TestCaseSearchResult testCase={testCase} />);
      expect(screen.getByText("Case test-123")).toBeInTheDocument();
    });
  });

  describe("Icons", () => {
    it("should show trash icon for deleted test cases", () => {
      const testCase = {
        name: "Deleted Test",
        isDeleted: true,
      };
      
      render(<TestCaseSearchResult testCase={testCase} />);
      
      // Lucide icons render as SVG elements
      const icon = screen.getByText("Deleted Test").parentElement?.querySelector("svg");
      expect(icon).toBeInTheDocument();
      expect(icon).toHaveClass("lucide-trash-2");
    });

    it("should show bot icon for JUNIT source", () => {
      const testCase = {
        name: "Automated Test",
        source: "JUNIT",
      };
      
      render(<TestCaseSearchResult testCase={testCase} />);
      
      const icon = screen.getByText("Automated Test").parentElement?.querySelector("svg");
      expect(icon).toBeInTheDocument();
      expect(icon).toHaveClass("lucide-bot");
    });

    it("should show list-checks icon for manual test cases", () => {
      const testCase = {
        name: "Manual Test",
        source: "MANUAL",
      };
      
      render(<TestCaseSearchResult testCase={testCase} />);
      
      const icon = screen.getByText("Manual Test").parentElement?.querySelector("svg");
      expect(icon).toBeInTheDocument();
      expect(icon).toHaveClass("lucide-list-checks");
    });

    it("should show list-checks icon when no source specified", () => {
      const testCase = {
        name: "Default Test",
      };
      
      render(<TestCaseSearchResult testCase={testCase} />);
      
      const icon = screen.getByText("Default Test").parentElement?.querySelector("svg");
      expect(icon).toBeInTheDocument();
      expect(icon).toHaveClass("lucide-list-checks");
    });

    it("should not show icon when showIcon is false", () => {
      const testCase = {
        name: "No Icon Test",
        source: "JUNIT",
      };
      
      render(<TestCaseSearchResult testCase={testCase} showIcon={false} />);
      
      const container = screen.getByText("No Icon Test").parentElement;
      const icon = container?.querySelector("svg");
      expect(icon).not.toBeInTheDocument();
    });

    it("should prioritize deleted icon over source icon", () => {
      const testCase = {
        name: "Deleted JUNIT Test",
        source: "JUNIT",
        isDeleted: true,
      };
      
      render(<TestCaseSearchResult testCase={testCase} />);
      
      const icon = screen.getByText("Deleted JUNIT Test").parentElement?.querySelector("svg");
      expect(icon).toBeInTheDocument();
      expect(icon).toHaveClass("lucide-trash-2");
      expect(icon).not.toHaveClass("lucide-bot");
    });
  });

  describe("Highlighting", () => {
    it("should render highlighted text when provided", () => {
      const testCase = {
        name: "Test Case",
      };
      const highlight = "Test <mark>Case</mark>";
      
      render(<TestCaseSearchResult testCase={testCase} highlight={highlight} />);
      
      const highlightedElement = screen.getByText((content, element) => {
        return element?.innerHTML === highlight;
      });
      expect(highlightedElement).toBeInTheDocument();
    });

    it("should prioritize highlight over test case name", () => {
      const testCase = {
        name: "Original Name",
      };
      const highlight = "Highlighted <mark>Name</mark>";
      
      render(<TestCaseSearchResult testCase={testCase} highlight={highlight} />);
      
      expect(screen.queryByText("Original Name")).not.toBeInTheDocument();
      const highlightedElement = screen.getByText((content, element) => {
        return element?.innerHTML === highlight;
      });
      expect(highlightedElement).toBeInTheDocument();
    });

    it("should handle empty highlight string", () => {
      const testCase = {
        name: "Test Case",
      };
      
      render(<TestCaseSearchResult testCase={testCase} highlight="" />);
      
      expect(screen.getByText("Test Case")).toBeInTheDocument();
    });
  });

  describe("Container styling", () => {
    it("should have proper flex styling", () => {
      const testCase = {
        name: "Test Case",
      };
      
      const { container } = render(<TestCaseSearchResult testCase={testCase} />);
      
      // The component returns a span with flex classes
      const flexContainer = container.querySelector('.flex');
      expect(flexContainer).toBeInTheDocument();
      expect(flexContainer).toHaveClass("flex");
      expect(flexContainer).toHaveClass("items-center");
      expect(flexContainer).toHaveClass("gap-1");
    });
  });

  describe("Edge cases", () => {
    it("should handle all props together", () => {
      const testCase = {
        id: 456,
        name: "Complete Test",
        source: "JUNIT",
        isDeleted: false,
      };
      const highlight = "Complete <mark>Test</mark>";
      
      render(
        <TestCaseSearchResult 
          testCase={testCase} 
          highlight={highlight}
          showIcon={true}
        />
      );
      
      // Should show highlighted text
      const highlightedElement = screen.getByText((content, element) => {
        return element?.innerHTML === highlight;
      });
      expect(highlightedElement).toBeInTheDocument();
      
      // Should show bot icon (not deleted)
      const icon = highlightedElement.parentElement?.querySelector("svg");
      expect(icon).toBeInTheDocument();
      expect(icon).toHaveClass("lucide-bot");
    });

    it("should handle minimal props", () => {
      render(<TestCaseSearchResult testCase={{}} />);
      
      expect(screen.getByText("Case Unknown")).toBeInTheDocument();
    });

    it("should handle empty name with valid id", () => {
      const testCase = {
        id: 789,
        name: "",
      };
      
      render(<TestCaseSearchResult testCase={testCase} />);
      expect(screen.getByText("Case 789")).toBeInTheDocument();
    });

    it("should handle null/undefined values gracefully", () => {
      const testCase = {
        id: null as any,
        name: undefined as any,
      };
      
      render(<TestCaseSearchResult testCase={testCase} />);
      expect(screen.getByText("Case Unknown")).toBeInTheDocument();
    });
  });
});