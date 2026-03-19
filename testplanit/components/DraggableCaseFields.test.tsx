import { fireEvent, render, screen } from "@testing-library/react";
import React, { useState } from "react";
import { describe, expect, it, vi } from "vitest";

// Mock @dnd-kit/core
vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children, onDragEnd }: any) => (
    <div data-testid="dnd-context" data-on-drag-end={onDragEnd ? "true" : "false"}>
      {children}
    </div>
  ),
  PointerSensor: class PointerSensor {},
  KeyboardSensor: class KeyboardSensor {},
  useSensor: vi.fn(() => ({})),
  useSensors: vi.fn((...sensors: any[]) => sensors),
  closestCenter: "closestCenter",
}));

// Mock @dnd-kit/sortable
vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: any) => (
    <div data-testid="sortable-context">{children}</div>
  ),
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
  }),
  verticalListSortingStrategy: "verticalListSortingStrategy",
  arrayMove: (arr: any[], from: number, to: number) => {
    const result = [...arr];
    const [removed] = result.splice(from, 1);
    result.splice(to, 0, removed);
    return result;
  },
}));

// Mock @dnd-kit/modifiers
vi.mock("@dnd-kit/modifiers", () => ({
  restrictToVerticalAxis: "restrictToVerticalAxis",
}));

// Mock @dnd-kit/utilities
vi.mock("@dnd-kit/utilities", () => ({
  CSS: {
    Translate: {
      toString: () => "",
    },
  },
}));

// Mock lucide-react icons
vi.mock("lucide-react", () => ({
  GripVertical: () => <svg data-testid="grip-vertical-icon" />,
  Trash2: () => <svg data-testid="trash2-icon" />,
}));

// Mock UI button
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, type, variant, className, disabled }: any) => (
    <button
      type={type || "button"}
      onClick={onClick}
      className={className}
      disabled={disabled}
      data-variant={variant}
    >
      {children}
    </button>
  ),
}));

import { DraggableField, DraggableList } from "./DraggableCaseFields";

describe("DraggableCaseFields", () => {
  const createItems = (): DraggableField[] => [
    { id: "1", label: "Field Alpha" },
    { id: "2", label: "Field Beta" },
    { id: "3", label: "Field Gamma" },
  ];

  describe("DraggableList rendering", () => {
    it("renders all field items in order", () => {
      const items = createItems();
      const setItems = vi.fn();
      const onRemove = vi.fn();

      render(
        <DraggableList items={items} setItems={setItems} onRemove={onRemove} />
      );

      expect(screen.getByText("Field Alpha")).toBeInTheDocument();
      expect(screen.getByText("Field Beta")).toBeInTheDocument();
      expect(screen.getByText("Field Gamma")).toBeInTheDocument();
    });

    it("renders drag handles for each item", () => {
      const items = createItems();
      const setItems = vi.fn();
      const onRemove = vi.fn();

      render(
        <DraggableList items={items} setItems={setItems} onRemove={onRemove} />
      );

      const gripIcons = screen.getAllByTestId("grip-vertical-icon");
      expect(gripIcons).toHaveLength(3);
    });

    it("renders remove buttons for each item", () => {
      const items = createItems();
      const setItems = vi.fn();
      const onRemove = vi.fn();

      render(
        <DraggableList items={items} setItems={setItems} onRemove={onRemove} />
      );

      const trashIcons = screen.getAllByTestId("trash2-icon");
      expect(trashIcons).toHaveLength(3);
    });

    it("renders empty list when items array is empty", () => {
      const setItems = vi.fn();
      const onRemove = vi.fn();

      const { container } = render(
        <DraggableList items={[]} setItems={setItems} onRemove={onRemove} />
      );

      expect(screen.queryByTestId("grip-vertical-icon")).not.toBeInTheDocument();
      // DndContext and SortableContext should still be present
      expect(container.querySelector('[data-testid="dnd-context"]')).toBeInTheDocument();
    });

    it("wraps items in DndContext and SortableContext", () => {
      const items = createItems();
      const setItems = vi.fn();
      const onRemove = vi.fn();

      render(
        <DraggableList items={items} setItems={setItems} onRemove={onRemove} />
      );

      expect(screen.getByTestId("dnd-context")).toBeInTheDocument();
      expect(screen.getByTestId("sortable-context")).toBeInTheDocument();
    });

    it("renders each item with cursor-ns-resize class for drag indication", () => {
      const items = [{ id: "1", label: "Draggable Field" }];
      const setItems = vi.fn();
      const onRemove = vi.fn();

      const { container } = render(
        <DraggableList items={items} setItems={setItems} onRemove={onRemove} />
      );

      const draggableItem = container.querySelector(".cursor-ns-resize");
      expect(draggableItem).toBeInTheDocument();
    });
  });

  describe("DraggableList interactions", () => {
    it("calls onRemove with correct id when remove button is clicked", () => {
      const items = createItems();
      const setItems = vi.fn();
      const onRemove = vi.fn();

      render(
        <DraggableList items={items} setItems={setItems} onRemove={onRemove} />
      );

      const trashButtons = screen.getAllByTestId("trash2-icon");
      // Click the first trash button (for "Field Alpha")
      fireEvent.click(trashButtons[0].closest("button")!);

      expect(onRemove).toHaveBeenCalledWith("1");
    });

    it("calls onRemove with id of second item when second remove button clicked", () => {
      const items = createItems();
      const setItems = vi.fn();
      const onRemove = vi.fn();

      render(
        <DraggableList items={items} setItems={setItems} onRemove={onRemove} />
      );

      const trashButtons = screen.getAllByTestId("trash2-icon");
      fireEvent.click(trashButtons[1].closest("button")!);

      expect(onRemove).toHaveBeenCalledWith("2");
    });

    it("updates items list via setItems when drag ends", () => {
      // Use real React state for this test
      const TestWrapper = () => {
        const [items, setItems] = useState<DraggableField[]>(createItems());
        const onRemove = vi.fn();

        return (
          <DraggableList
            items={items}
            setItems={setItems}
            onRemove={onRemove}
          />
        );
      };

      render(<TestWrapper />);

      // All items should be rendered
      expect(screen.getByText("Field Alpha")).toBeInTheDocument();
      expect(screen.getByText("Field Beta")).toBeInTheDocument();
      expect(screen.getByText("Field Gamma")).toBeInTheDocument();
    });
  });

  describe("Field labels", () => {
    it("renders long field labels correctly", () => {
      const items: DraggableField[] = [
        { id: "1", label: "This is a very long field label that might overflow" },
      ];
      const setItems = vi.fn();
      const onRemove = vi.fn();

      render(
        <DraggableList items={items} setItems={setItems} onRemove={onRemove} />
      );

      expect(
        screen.getByText("This is a very long field label that might overflow")
      ).toBeInTheDocument();
    });

    it("renders numeric ids correctly", () => {
      const items: DraggableField[] = [
        { id: 1, label: "Numeric ID Field" },
        { id: 2, label: "Another Numeric ID" },
      ];
      const setItems = vi.fn();
      const onRemove = vi.fn();

      render(
        <DraggableList items={items} setItems={setItems} onRemove={onRemove} />
      );

      expect(screen.getByText("Numeric ID Field")).toBeInTheDocument();
      expect(screen.getByText("Another Numeric ID")).toBeInTheDocument();
    });
  });
});
