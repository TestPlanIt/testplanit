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

// Mock lucide-react icons
vi.mock("lucide-react", () => ({
  ListChecks: () => <svg data-testid="list-checks-icon" />,
  Folder: () => <svg data-testid="folder-icon" />,
}));

import { UnifiedDragPreview } from "./UnifiedDragPreview";

describe("UnifiedDragPreview", () => {
  it("renders nothing when not dragging", () => {
    dragState.isDragging = false;
    dragState.item = null;

    const { container } = render(<UnifiedDragPreview />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when item is null even if isDragging", () => {
    dragState.isDragging = true;
    dragState.item = null;

    const { container } = render(<UnifiedDragPreview />);
    expect(container.firstChild).toBeNull();
  });

  it("renders test case name for TEST_CASE itemType", () => {
    dragState.isDragging = true;
    dragState.item = { id: 1, name: "My Test Case" };
    dragState.itemType = "testCase";
    dragState.initialOffset = { x: 50, y: 50 };
    dragState.currentOffset = { x: 100, y: 200 };

    render(<UnifiedDragPreview />);
    expect(screen.getByText("My Test Case")).toBeInTheDocument();
  });

  it("renders ListChecks icon for TEST_CASE itemType", () => {
    dragState.isDragging = true;
    dragState.item = { id: 1, name: "Test Case" };
    dragState.itemType = "testCase";
    dragState.initialOffset = { x: 50, y: 50 };
    dragState.currentOffset = { x: 100, y: 200 };

    render(<UnifiedDragPreview />);
    expect(screen.getByTestId("list-checks-icon")).toBeInTheDocument();
  });

  it("renders count when multiple test cases are dragged", () => {
    dragState.isDragging = true;
    dragState.item = {
      draggedItems: [
        { id: 1, name: "Case A" },
        { id: 2, name: "Case B" },
      ],
    };
    dragState.itemType = "testCase";
    dragState.initialOffset = { x: 50, y: 50 };
    dragState.currentOffset = { x: 100, y: 200 };

    render(<UnifiedDragPreview />);
    expect(screen.getByText("2 test cases")).toBeInTheDocument();
  });

  it("renders single test case name when draggedItems has one entry", () => {
    dragState.isDragging = true;
    dragState.item = {
      draggedItems: [{ id: 1, name: "Only One Case" }],
    };
    dragState.itemType = "testCase";
    dragState.initialOffset = { x: 50, y: 50 };
    dragState.currentOffset = { x: 100, y: 200 };

    render(<UnifiedDragPreview />);
    expect(screen.getByText("Only One Case")).toBeInTheDocument();
  });

  it("renders folder preview for unknown itemType with text property", () => {
    dragState.isDragging = true;
    dragState.item = { text: "My Folder" };
    dragState.itemType = "someArboristType";
    dragState.initialOffset = { x: 50, y: 50 };
    dragState.currentOffset = { x: 100, y: 200 };

    render(<UnifiedDragPreview />);
    expect(screen.getByText("My Folder")).toBeInTheDocument();
    expect(screen.getByTestId("folder-icon")).toBeInTheDocument();
  });

  it("renders folder preview for unknown itemType with name property", () => {
    dragState.isDragging = true;
    dragState.item = { name: "Folder By Name" };
    dragState.itemType = "unknownDragType";
    dragState.initialOffset = { x: 50, y: 50 };
    dragState.currentOffset = { x: 100, y: 200 };

    render(<UnifiedDragPreview />);
    expect(screen.getByText("Folder By Name")).toBeInTheDocument();
    expect(screen.getByTestId("folder-icon")).toBeInTheDocument();
  });

  it("renders nothing for unknown itemType with no text or name", () => {
    dragState.isDragging = true;
    dragState.item = { id: 999 }; // No text or name
    dragState.itemType = "unknownType";

    const { container } = render(<UnifiedDragPreview />);
    const layerDiv = container.firstChild as HTMLElement;
    expect(layerDiv.children.length).toBe(0);
  });

  it("renders nothing for TEST_CASE with no name and no draggedItems", () => {
    dragState.isDragging = true;
    dragState.item = { id: 1 }; // No name or draggedItems
    dragState.itemType = "testCase";

    const { container } = render(<UnifiedDragPreview />);
    const layerDiv = container.firstChild as HTMLElement;
    expect(layerDiv.children.length).toBe(0);
  });
});
