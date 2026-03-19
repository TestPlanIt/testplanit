import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

// vi.hoisted for mutable drag state reference (prevents infinite re-renders from new object instances)
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

// Mock lucide-react
vi.mock("lucide-react", () => ({
  ListChecks: () => <svg data-testid="list-checks-icon" />,
}));

import { TestCaseDragPreview } from "./TestCaseDragPreview";

describe("TestCaseDragPreview", () => {
  it("renders nothing when not dragging", () => {
    dragState.isDragging = false;
    dragState.item = null;

    const { container } = render(<TestCaseDragPreview />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when item is null even if isDragging is true", () => {
    dragState.isDragging = true;
    dragState.item = null;

    const { container } = render(<TestCaseDragPreview />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the case name when dragging a single test case by name property", () => {
    dragState.isDragging = true;
    dragState.item = { id: 1, name: "My Test Case" };
    dragState.itemType = "testCase";
    dragState.initialOffset = { x: 50, y: 50 };
    dragState.currentOffset = { x: 100, y: 200 };

    render(<TestCaseDragPreview />);
    expect(screen.getByText("My Test Case")).toBeInTheDocument();
  });

  it("renders the case name from draggedItems when array has one item", () => {
    dragState.isDragging = true;
    dragState.item = {
      draggedItems: [{ id: 1, name: "Single Dragged Case" }],
    };
    dragState.itemType = "testCase";
    dragState.initialOffset = { x: 50, y: 50 };
    dragState.currentOffset = { x: 100, y: 200 };

    render(<TestCaseDragPreview />);
    expect(screen.getByText("Single Dragged Case")).toBeInTheDocument();
  });

  it("renders count badge when dragging multiple items", () => {
    dragState.isDragging = true;
    dragState.item = {
      draggedItems: [
        { id: 1, name: "Case 1" },
        { id: 2, name: "Case 2" },
        { id: 3, name: "Case 3" },
      ],
    };
    dragState.itemType = "testCase";
    dragState.initialOffset = { x: 50, y: 50 };
    dragState.currentOffset = { x: 100, y: 200 };

    render(<TestCaseDragPreview />);
    expect(screen.getByText("3 test cases")).toBeInTheDocument();
  });

  it("renders nothing visible when itemType does not match TEST_CASE", () => {
    dragState.isDragging = true;
    dragState.item = { id: 1, name: "Something" };
    dragState.itemType = "workflow"; // Not TEST_CASE

    const { container } = render(<TestCaseDragPreview />);
    // The outer layer div is still rendered, but renderItem() returns null for non-matching type
    // The container should contain the layer div but with null content inside
    const layerDiv = container.firstChild as HTMLElement;
    expect(layerDiv).toBeInTheDocument();
    expect(layerDiv.children.length).toBe(0);
  });

  it("renders nothing when item has no name and no draggedItems", () => {
    dragState.isDragging = true;
    dragState.item = { id: 1 }; // No name or draggedItems
    dragState.itemType = "testCase";
    dragState.initialOffset = { x: 50, y: 50 };
    dragState.currentOffset = { x: 100, y: 200 };

    const { container } = render(<TestCaseDragPreview />);
    const layerDiv = container.firstChild as HTMLElement;
    expect(layerDiv.children.length).toBe(0);
  });

  it("renders the list checks icon when dragging a test case", () => {
    dragState.isDragging = true;
    dragState.item = { id: 1, name: "Test Case With Icon" };
    dragState.itemType = "testCase";
    dragState.initialOffset = { x: 50, y: 50 };
    dragState.currentOffset = { x: 100, y: 200 };

    render(<TestCaseDragPreview />);
    expect(screen.getByTestId("list-checks-icon")).toBeInTheDocument();
  });

  it("applies display:none when no offsets are provided", () => {
    dragState.isDragging = true;
    dragState.item = { id: 1, name: "Test" };
    dragState.itemType = "testCase";
    dragState.initialOffset = null;
    dragState.currentOffset = null;

    const { container } = render(<TestCaseDragPreview />);
    const layerDiv = container.firstChild as HTMLElement;
    // The preview div inside the layer should have display: none
    const previewDiv = layerDiv.firstChild as HTMLElement;
    expect(previewDiv).toHaveStyle({ display: "none" });
  });
});
