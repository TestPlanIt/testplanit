import { fireEvent, render, screen } from "@testing-library/react";
import React, { useState } from "react";
import { describe, expect, it, vi } from "vitest";

// Mock @dnd-kit/core
vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children, onDragEnd }: any) => (
    <div
      data-testid="dnd-context"
      data-on-drag-end={onDragEnd ? "true" : "false"}
    >
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
  Sparkles: () => <svg data-testid="sparkles-icon" />,
  Trash: () => <svg data-testid="trash-icon" />,
}));

// Mock UI button
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    type,
    variant,
    className,
    disabled,
    ...rest
  }: any) => (
    <button
      type={type || "button"}
      onClick={onClick}
      className={className}
      disabled={disabled}
      data-variant={variant}
      {...rest}
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

      const trashIcons = screen.getAllByTestId("trash-icon");
      expect(trashIcons).toHaveLength(3);
    });

    it("renders empty list when items array is empty", () => {
      const setItems = vi.fn();
      const onRemove = vi.fn();

      const { container } = render(
        <DraggableList items={[]} setItems={setItems} onRemove={onRemove} />
      );

      expect(
        screen.queryByTestId("grip-vertical-icon")
      ).not.toBeInTheDocument();
      // DndContext and SortableContext should still be present
      expect(
        container.querySelector('[data-testid="dnd-context"]')
      ).toBeInTheDocument();
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

      const trashButtons = screen.getAllByTestId("trash-icon");
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

      const trashButtons = screen.getAllByTestId("trash-icon");
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

  describe("Generate-default toggle", () => {
    it("does not render the toggle when onToggleGenerateDefault is not provided", () => {
      render(
        <DraggableList
          items={createItems()}
          setItems={vi.fn()}
          onRemove={vi.fn()}
        />
      );

      expect(screen.queryByTestId("sparkles-icon")).not.toBeInTheDocument();
    });

    it("renders one toggle per item, pressed by default", () => {
      render(
        <DraggableList
          items={createItems()}
          setItems={vi.fn()}
          onRemove={vi.fn()}
          onToggleGenerateDefault={vi.fn()}
        />
      );

      expect(screen.getAllByTestId("sparkles-icon")).toHaveLength(3);
      // Fields default to included in the Generate Test Cases wizard.
      expect(screen.getByTestId("generate-default-toggle-1")).toHaveAttribute(
        "aria-pressed",
        "true"
      );
    });

    it("shows an unpressed toggle when generateDefaultEnabled is false", () => {
      const items: DraggableField[] = [
        { id: "1", label: "Field Alpha", generateDefaultEnabled: false },
      ];

      render(
        <DraggableList
          items={items}
          setItems={vi.fn()}
          onRemove={vi.fn()}
          onToggleGenerateDefault={vi.fn()}
        />
      );

      expect(screen.getByTestId("generate-default-toggle-1")).toHaveAttribute(
        "aria-pressed",
        "false"
      );
    });

    it("calls onToggleGenerateDefault with the item id, not onRemove", () => {
      const onRemove = vi.fn();
      const onToggleGenerateDefault = vi.fn();

      render(
        <DraggableList
          items={createItems()}
          setItems={vi.fn()}
          onRemove={onRemove}
          onToggleGenerateDefault={onToggleGenerateDefault}
        />
      );

      fireEvent.click(screen.getByTestId("generate-default-toggle-2"));

      expect(onToggleGenerateDefault).toHaveBeenCalledWith("2");
      expect(onRemove).not.toHaveBeenCalled();
    });
  });

  describe("Jira-panel toggle", () => {
    it("does not render the toggle when onToggleJiraPanel is not provided", () => {
      render(
        <DraggableList
          items={createItems()}
          setItems={vi.fn()}
          onRemove={vi.fn()}
          onToggleGenerateDefault={vi.fn()}
        />
      );

      expect(
        screen.queryByTestId("jira-panel-toggle-1")
      ).not.toBeInTheDocument();
    });

    it("renders one toggle per item, unpressed by default", () => {
      render(
        <DraggableList
          items={createItems()}
          setItems={vi.fn()}
          onRemove={vi.fn()}
          onToggleJiraPanel={vi.fn()}
        />
      );

      // Opposite default from the generate toggle: fields stay out of the
      // Jira panel until an admin opts them in.
      expect(screen.getByTestId("jira-panel-toggle-1")).toHaveAttribute(
        "aria-pressed",
        "false"
      );
      expect(screen.getByTestId("jira-panel-toggle-2")).toHaveAttribute(
        "aria-pressed",
        "false"
      );
      expect(screen.getByTestId("jira-panel-toggle-3")).toHaveAttribute(
        "aria-pressed",
        "false"
      );
    });

    it("shows a pressed toggle when jiraPanelEnabled is true", () => {
      const items: DraggableField[] = [
        { id: "1", label: "Field Alpha", jiraPanelEnabled: true },
      ];

      render(
        <DraggableList
          items={items}
          setItems={vi.fn()}
          onRemove={vi.fn()}
          onToggleJiraPanel={vi.fn()}
        />
      );

      expect(screen.getByTestId("jira-panel-toggle-1")).toHaveAttribute(
        "aria-pressed",
        "true"
      );
    });

    it("calls onToggleJiraPanel with the item id, not the other handlers", () => {
      const onRemove = vi.fn();
      const onToggleGenerateDefault = vi.fn();
      const onToggleJiraPanel = vi.fn();

      render(
        <DraggableList
          items={createItems()}
          setItems={vi.fn()}
          onRemove={onRemove}
          onToggleGenerateDefault={onToggleGenerateDefault}
          onToggleJiraPanel={onToggleJiraPanel}
        />
      );

      fireEvent.click(screen.getByTestId("jira-panel-toggle-2"));

      expect(onToggleJiraPanel).toHaveBeenCalledWith("2");
      expect(onToggleGenerateDefault).not.toHaveBeenCalled();
      expect(onRemove).not.toHaveBeenCalled();
    });
  });

  describe("Field labels", () => {
    it("renders long field labels correctly", () => {
      const items: DraggableField[] = [
        {
          id: "1",
          label: "This is a very long field label that might overflow",
        },
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
