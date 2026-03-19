import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

// vi.hoisted for mutable drag state
const dragState = vi.hoisted(() => ({
  isDragging: false,
  item: null as any,
  itemType: null as any,
  initialOffset: null as any,
  currentOffset: null as any,
}));

// Mock react-dnd
vi.mock("react-dnd", () => ({
  useDragLayer: (collect: any) =>
    collect({
      getItem: () => dragState.item,
      getItemType: () => dragState.itemType,
      getInitialSourceClientOffset: () => dragState.initialOffset,
      getClientOffset: () => dragState.currentOffset,
      isDragging: () => dragState.isDragging,
    }),
}));

// Mock dndTypes
vi.mock("~/types/dndTypes", () => ({
  ItemTypes: {
    TEST_CASE: "testCase",
    WORKFLOW: "workflow",
    TEST_RUN: "testRun",
  },
}));

// Mock DynamicIcon
vi.mock("@/components/DynamicIcon", () => ({
  default: ({ name, color }: { name: string; color?: string }) => (
    <span data-testid="dynamic-icon" data-icon-name={name} data-color={color} />
  ),
}));

// Mock lucide-react/dynamicIconImports
vi.mock("lucide-react/dynamicIconImports", () => ({
  default: {
    check: () => null,
    star: () => null,
  },
}));

import { WorkflowDragPreview } from "./WorkflowDragPreview";

describe("WorkflowDragPreview", () => {
  it("renders nothing when not dragging", () => {
    dragState.isDragging = false;
    dragState.item = null;

    const { container } = render(<WorkflowDragPreview />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when item is null even if isDragging", () => {
    dragState.isDragging = true;
    dragState.item = null;

    const { container } = render(<WorkflowDragPreview />);
    expect(container.firstChild).toBeNull();
  });

  it("renders workflow name when dragging a single workflow item", () => {
    dragState.isDragging = true;
    dragState.item = { id: 1, name: "My Workflow" };
    dragState.itemType = "workflow";
    dragState.initialOffset = { x: 50, y: 50 };
    dragState.currentOffset = { x: 100, y: 200 };

    render(<WorkflowDragPreview />);
    expect(screen.getByText("My Workflow")).toBeInTheDocument();
  });

  it("renders icon when item has an icon property", () => {
    dragState.isDragging = true;
    dragState.item = { id: 1, name: "Workflow With Icon", icon: { name: "star" } };
    dragState.itemType = "workflow";
    dragState.initialOffset = { x: 50, y: 50 };
    dragState.currentOffset = { x: 100, y: 200 };

    render(<WorkflowDragPreview />);
    const icon = screen.getByTestId("dynamic-icon");
    expect(icon).toBeInTheDocument();
    expect(icon).toHaveAttribute("data-icon-name", "star");
  });

  it("renders with color when item has color property", () => {
    dragState.isDragging = true;
    dragState.item = {
      id: 1,
      name: "Colorful Workflow",
      icon: { name: "check" },
      color: { value: "#ff0000" },
    };
    dragState.itemType = "workflow";
    dragState.initialOffset = { x: 50, y: 50 };
    dragState.currentOffset = { x: 100, y: 200 };

    render(<WorkflowDragPreview />);
    const icon = screen.getByTestId("dynamic-icon");
    expect(icon).toHaveAttribute("data-color", "#ff0000");
  });

  it("renders workflow name from draggedItems when single item", () => {
    dragState.isDragging = true;
    dragState.item = {
      draggedItems: [{ id: 1, name: "Single Dragged Workflow", icon: { name: "star" } }],
    };
    dragState.itemType = "workflow";
    dragState.initialOffset = { x: 50, y: 50 };
    dragState.currentOffset = { x: 100, y: 200 };

    render(<WorkflowDragPreview />);
    expect(screen.getByText("Single Dragged Workflow")).toBeInTheDocument();
  });

  it("renders count label when dragging multiple workflows", () => {
    dragState.isDragging = true;
    dragState.item = {
      draggedItems: [
        { id: 1, name: "Workflow 1" },
        { id: 2, name: "Workflow 2" },
      ],
    };
    dragState.itemType = "workflow";
    dragState.initialOffset = { x: 50, y: 50 };
    dragState.currentOffset = { x: 100, y: 200 };

    render(<WorkflowDragPreview />);
    expect(screen.getByText("2 workflows")).toBeInTheDocument();
  });

  it("renders nothing for non-workflow itemType", () => {
    dragState.isDragging = true;
    dragState.item = { id: 1, name: "Test Case" };
    dragState.itemType = "testCase"; // Not WORKFLOW

    const { container } = render(<WorkflowDragPreview />);
    const layerDiv = container.firstChild as HTMLElement;
    expect(layerDiv).toBeInTheDocument();
    expect(layerDiv.children.length).toBe(0);
  });

  it("renders nothing when item has no name and no draggedItems", () => {
    dragState.isDragging = true;
    dragState.item = { id: 1 }; // No name
    dragState.itemType = "workflow";

    const { container } = render(<WorkflowDragPreview />);
    const layerDiv = container.firstChild as HTMLElement;
    expect(layerDiv.children.length).toBe(0);
  });

  it("does not render icon when item has no icon", () => {
    dragState.isDragging = true;
    dragState.item = { id: 1, name: "No Icon Workflow" }; // No icon
    dragState.itemType = "workflow";
    dragState.initialOffset = { x: 50, y: 50 };
    dragState.currentOffset = { x: 100, y: 200 };

    render(<WorkflowDragPreview />);
    expect(screen.queryByTestId("dynamic-icon")).not.toBeInTheDocument();
    expect(screen.getByText("No Icon Workflow")).toBeInTheDocument();
  });
});
