import { describe, it, expect, vi } from "vitest";
import { render, screen } from "~/test/test-utils";
import { CustomFieldDisplay } from "./CustomFieldDisplay";
import React from "react";

// Mock dependencies
vi.mock("@/components/DynamicIcon", () => ({
  default: ({
    name,
    className,
    color,
  }: {
    name: string;
    className?: string;
    color?: string;
  }) => (
    <span data-testid={`icon-${name}`} className={className} style={{ color }}>
      {name}
    </span>
  ),
}));

vi.mock("@/components/DateFormatter", () => ({
  DateFormatter: ({ date }: { date: string }) => (
    <span data-testid="date-formatter">
      {new Date(date).toLocaleDateString()}
    </span>
  ),
}));

describe("CustomFieldDisplay Component", () => {
  it("should render nothing when customFields is undefined", () => {
    const { container } = render(<CustomFieldDisplay />);
    expect(container.firstChild).toBeNull();
  });

  it("should render nothing when customFields is empty", () => {
    const { container } = render(<CustomFieldDisplay customFields={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("should render checkbox field when true", () => {
    const customFields = [
      {
        fieldId: 1,
        fieldName: "Is Automated",
        fieldType: "Checkbox",
        valueBoolean: true,
      },
    ];

    render(<CustomFieldDisplay customFields={customFields} />);
    expect(screen.getByText("Is Automated: ✓")).toBeInTheDocument();
  });

  it("should not render checkbox field when false", () => {
    const customFields = [
      {
        fieldId: 1,
        fieldName: "Is Automated",
        fieldType: "Checkbox",
        valueBoolean: false,
      },
    ];

    const { container } = render(
      <CustomFieldDisplay customFields={customFields} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("should render date field", () => {
    const customFields = [
      {
        fieldId: 2,
        fieldName: "Due Date",
        fieldType: "Date",
        valueDate: "2024-01-15T00:00:00Z",
      },
    ];

    render(<CustomFieldDisplay customFields={customFields} />);
    expect(screen.getByText("Due Date:")).toBeInTheDocument();
    expect(screen.getByTestId("date-formatter")).toBeInTheDocument();
  });

  it("should render number field", () => {
    const customFields = [
      {
        fieldId: 3,
        fieldName: "Priority",
        fieldType: "Number",
        valueNumeric: 5,
      },
    ];

    render(<CustomFieldDisplay customFields={customFields} />);
    expect(screen.getByText("Priority: 5")).toBeInTheDocument();
  });

  it("should render integer field", () => {
    const customFields = [
      {
        fieldId: 3,
        fieldName: "Count",
        fieldType: "Integer",
        valueNumeric: 10,
      },
    ];

    render(<CustomFieldDisplay customFields={customFields} />);
    expect(screen.getByText("Count: 10")).toBeInTheDocument();
  });

  it("should render multi-select field with options", () => {
    const customFields = [
      {
        fieldId: 4,
        fieldName: "Tags",
        fieldType: "Multi-Select",
        valueArray: ["1", "2"],
        fieldOptions: [
          {
            id: 1,
            name: "Critical",
            icon: { name: "alert-circle" },
            iconColor: { value: "red" },
          },
          {
            id: 2,
            name: "Performance",
            icon: { name: "zap" },
            iconColor: { value: "yellow" },
          },
          {
            id: 3,
            name: "Security",
            icon: { name: "shield" },
            iconColor: { value: "blue" },
          },
        ],
      },
    ];

    render(<CustomFieldDisplay customFields={customFields} />);
    expect(screen.getByText("Tags:")).toBeInTheDocument();
    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(screen.getByText("Performance")).toBeInTheDocument();
    expect(screen.queryByText("Security")).not.toBeInTheDocument();
    expect(screen.getByTestId("icon-alert-circle")).toBeInTheDocument();
    expect(screen.getByTestId("icon-zap")).toBeInTheDocument();
  });

  it("should render select/dropdown field", () => {
    const customFields = [
      {
        fieldId: 5,
        fieldName: "Status",
        fieldType: "Select",
        fieldOption: {
          id: 1,
          name: "In Progress",
          icon: { name: "clock" },
          iconColor: { value: "orange" },
        },
      },
    ];

    render(<CustomFieldDisplay customFields={customFields} />);
    expect(screen.getByText("Status:")).toBeInTheDocument();
    expect(screen.getByText("In Progress")).toBeInTheDocument();
    expect(screen.getByTestId("icon-clock")).toBeInTheDocument();
  });

  it("should render link field", () => {
    const customFields = [
      {
        fieldId: 6,
        fieldName: "Documentation",
        fieldType: "Link",
        value: "https://example.com",
      },
    ];

    render(<CustomFieldDisplay customFields={customFields} />);
    expect(screen.getByText("Documentation:")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "https://example.com" });
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("should not render text fields", () => {
    const customFields = [
      {
        fieldId: 7,
        fieldName: "Short Text",
        fieldType: "Text String",
        value: "Some text",
      },
      {
        fieldId: 8,
        fieldName: "Long Text",
        fieldType: "Text Long",
        value: "Some long text",
      },
    ];

    const { container } = render(
      <CustomFieldDisplay customFields={customFields} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("should render unknown field types with value", () => {
    const customFields = [
      {
        fieldId: 9,
        fieldName: "Custom Type",
        fieldType: "UnknownType",
        value: "Custom Value",
      },
    ];

    render(<CustomFieldDisplay customFields={customFields} />);
    expect(screen.getByText("Custom Type: Custom Value")).toBeInTheDocument();
  });

  it("should skip fields with null or empty values", () => {
    const customFields = [
      {
        fieldId: 1,
        fieldName: "Field1",
        fieldType: "Text",
        value: null,
      },
      {
        fieldId: 2,
        fieldName: "Field2",
        fieldType: "Number",
        value: undefined,
      },
      {
        fieldId: 3,
        fieldName: "Field3",
        fieldType: "Text",
        value: "",
      },
      {
        fieldId: 4,
        fieldName: "Field4",
        fieldType: "Text",
        value: "Valid Value",
      },
    ];

    render(<CustomFieldDisplay customFields={customFields} />);
    expect(screen.queryByText("Field1:")).not.toBeInTheDocument();
    expect(screen.queryByText("Field2:")).not.toBeInTheDocument();
    expect(screen.queryByText("Field3:")).not.toBeInTheDocument();
    expect(screen.getByText("Field4: Valid Value")).toBeInTheDocument();
  });

  it("should respect maxItems limit", () => {
    const customFields = [
      {
        fieldId: 1,
        fieldName: "Field1",
        fieldType: "Text",
        value: "Value1",
      },
      {
        fieldId: 2,
        fieldName: "Field2",
        fieldType: "Text",
        value: "Value2",
      },
      {
        fieldId: 3,
        fieldName: "Field3",
        fieldType: "Text",
        value: "Value3",
      },
      {
        fieldId: 4,
        fieldName: "Field4",
        fieldType: "Text",
        value: "Value4",
      },
    ];

    render(<CustomFieldDisplay customFields={customFields} maxItems={2} />);
    expect(screen.getByText("Field1: Value1")).toBeInTheDocument();
    expect(screen.getByText("Field2: Value2")).toBeInTheDocument();
    expect(screen.queryByText("Field3: Value3")).not.toBeInTheDocument();
    expect(screen.queryByText("Field4: Value4")).not.toBeInTheDocument();
  });

  it("should handle multi-select with no matching options", () => {
    const customFields = [
      {
        fieldId: 4,
        fieldName: "Tags",
        fieldType: "Multi-Select",
        valueArray: ["999"],
        fieldOptions: [
          {
            id: 1,
            name: "Critical",
          },
          {
            id: 2,
            name: "Performance",
          },
        ],
      },
    ];

    const { container } = render(
      <CustomFieldDisplay customFields={customFields} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("should handle dropdown type same as select", () => {
    const customFields = [
      {
        fieldId: 5,
        fieldName: "Category",
        fieldType: "Dropdown",
        fieldOption: {
          id: 1,
          name: "Bug",
        },
      },
    ];

    render(<CustomFieldDisplay customFields={customFields} />);
    expect(screen.getByText("Category:")).toBeInTheDocument();
    expect(screen.getByText("Bug")).toBeInTheDocument();
  });

  it("should handle number field with zero value", () => {
    const customFields = [
      {
        fieldId: 3,
        fieldName: "Count",
        fieldType: "Number",
        valueNumeric: 0,
      },
    ];

    render(<CustomFieldDisplay customFields={customFields} />);
    expect(screen.getByText("Count: 0")).toBeInTheDocument();
  });
});
