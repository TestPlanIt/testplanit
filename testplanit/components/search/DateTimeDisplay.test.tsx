import { describe, it, expect, vi } from "vitest";
import { render, screen } from "~/test/test-utils";
import { DateTimeDisplay } from "./DateTimeDisplay";
import React from "react";

// Mock DateFormatter component
vi.mock("@/components/DateFormatter", () => ({
  DateFormatter: ({ 
    date, 
    formatString, 
    timezone 
  }: { 
    date: string | Date; 
    formatString?: string; 
    timezone?: string | null;
  }) => (
    <span data-testid="date-formatter">
      {formatString || "default"} - {typeof date === "string" ? date : date.toISOString()} - {timezone || "no-tz"}
    </span>
  ),
}));

describe("DateTimeDisplay Component", () => {
  it("should render date without label", () => {
    render(<DateTimeDisplay date="2024-01-15" />);
    
    const dateFormatter = screen.getByTestId("date-formatter");
    expect(dateFormatter).toBeInTheDocument();
    expect(dateFormatter).toHaveTextContent("MM-dd-yyyy");
    expect(dateFormatter).toHaveTextContent("2024-01-15");
  });

  it("should render date with label", () => {
    render(<DateTimeDisplay date="2024-01-15" label="Created" />);
    
    expect(screen.getByText("Created:")).toBeInTheDocument();
    const dateFormatter = screen.getByTestId("date-formatter");
    expect(dateFormatter).toBeInTheDocument();
  });

  it("should use time format when showTime is true", () => {
    render(<DateTimeDisplay date="2024-01-15T10:30:00Z" showTime={true} />);
    
    const dateFormatter = screen.getByTestId("date-formatter");
    expect(dateFormatter).toHaveTextContent("MM-dd-yyyy HH:mm");
  });

  it("should use custom format string when provided", () => {
    render(<DateTimeDisplay date="2024-01-15" formatString="yyyy-MM-dd" />);
    
    const dateFormatter = screen.getByTestId("date-formatter");
    expect(dateFormatter).toHaveTextContent("yyyy-MM-dd");
  });

  it("should pass timezone to DateFormatter", () => {
    render(<DateTimeDisplay date="2024-01-15" timezone="America/New_York" />);
    
    const dateFormatter = screen.getByTestId("date-formatter");
    expect(dateFormatter).toHaveTextContent("America/New_York");
  });

  it("should accept Date object", () => {
    const dateObj = new Date("2024-01-15T10:30:00Z");
    render(<DateTimeDisplay date={dateObj} />);
    
    const dateFormatter = screen.getByTestId("date-formatter");
    expect(dateFormatter).toHaveTextContent(dateObj.toISOString());
  });

  it("should apply custom className", () => {
    render(<DateTimeDisplay date="2024-01-15" className="custom-class" />);
    
    const wrapper = screen.getByTestId("date-formatter").parentElement;
    expect(wrapper).toHaveClass("custom-class");
    expect(wrapper).toHaveClass("text-xs");
    expect(wrapper).toHaveClass("text-muted-foreground");
  });

  it("should handle all props together", () => {
    render(
      <DateTimeDisplay 
        date="2024-01-15T10:30:00Z"
        label="Updated"
        showTime={true}
        formatString="dd/MM/yyyy HH:mm:ss"
        timezone="UTC"
        className="highlight"
      />
    );
    
    expect(screen.getByText("Updated:")).toBeInTheDocument();
    const dateFormatter = screen.getByTestId("date-formatter");
    expect(dateFormatter).toHaveTextContent("dd/MM/yyyy HH:mm:ss");
    expect(dateFormatter).toHaveTextContent("UTC");
    
    const wrapper = dateFormatter.parentElement;
    expect(wrapper).toHaveClass("highlight");
  });

  it("should prefer formatString over showTime default", () => {
    render(
      <DateTimeDisplay 
        date="2024-01-15"
        showTime={true}
        formatString="yyyy-MM-dd"
      />
    );
    
    const dateFormatter = screen.getByTestId("date-formatter");
    // Should use formatString, not the showTime default
    expect(dateFormatter).toHaveTextContent("yyyy-MM-dd");
    expect(dateFormatter).not.toHaveTextContent("MM-dd-yyyy HH:mm");
  });
});