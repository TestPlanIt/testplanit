import React, { useState, useEffect } from "react";
import { useDragLayer, XYCoord } from "react-dnd";
import { ItemTypes } from "~/types/dndTypes";
import { ListChecks } from "lucide-react";
import { CSSProperties } from "react";

// Define the structure of an individual test case's essential info for preview
interface PreviewTestCaseInfo {
  id: number | string;
  name: string;
}

// Define the structure of the item collected by useDragLayer
// This can represent a single dragged item or multiple dragged items
interface CollectedDragItem {
  // For a single dragged item (original structure)
  id?: number | string;
  folderId?: number | null; // Not used in preview but part of original item
  name?: string; // Used for single item preview
  index?: number; // Not used in preview but part of original item

  // For multiple dragged items
  draggedItems?: PreviewTestCaseInfo[]; // Array of test cases
}

// Define the props for the custom drag layer component
interface CustomDragLayerProps {}

// Define the styles for the layer
const layerStyles: CSSProperties = {
  position: "fixed",
  pointerEvents: "none",
  zIndex: 100, // Ensure it's above other elements
  left: 0,
  top: 0,
  width: "100%",
  height: "100%",
};

// Function to get the transform style based on the current offset
function getItemStyles(
  initialOffset: XYCoord | null,
  currentOffset: XYCoord | null
): CSSProperties {
  if (!initialOffset || !currentOffset) {
    return {
      display: "none",
    };
  }

  const { x, y } = currentOffset;
  // Add a small offset so the preview doesn't obscure what you're dragging over
  const transform = `translate(${x + 10}px, ${y + 10}px)`;
  return {
    transform,
    WebkitTransform: transform,
    padding: "8px 12px",
    display: "inline-flex",
    alignItems: "center",
    gap: "2px",
  };
}

// The custom drag layer component
export const TestCaseDragPreview: React.FC<CustomDragLayerProps> = () => {
  const [pointerOffset, setPointerOffset] = useState<XYCoord | null>(null);

  const {
    itemType,
    isDragging,
    item,
    initialOffset,
    currentOffset: dndOffset,
  } = useDragLayer((monitor) => ({
    item: monitor.getItem() as CollectedDragItem | null,
    itemType: monitor.getItemType(),
    initialOffset: monitor.getInitialSourceClientOffset(),
    currentOffset: monitor.getClientOffset(),
    isDragging: monitor.isDragging(),
  }));

  // Track mouse position continuously for smooth cursor following
  useEffect(() => {
    if (!isDragging) {
      setPointerOffset(null);
      return;
    }

    let rafId: number | null = null;
    let latestX = 0;
    let latestY = 0;

    const handleMouseMove = (e: MouseEvent) => {
      latestX = e.clientX;
      latestY = e.clientY;

      // Use requestAnimationFrame to throttle updates and avoid overwhelming react-dnd
      if (rafId === null) {
        rafId = requestAnimationFrame(() => {
          setPointerOffset({ x: latestX, y: latestY });
          rafId = null;
        });
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [isDragging]);

  // Use the tracked pointer position, falling back to DND offset if pointer not available yet
  const currentOffset = pointerOffset || dndOffset;

  // Function to render the preview item
  function renderItem() {
    if (!item) return null;

    switch (itemType) {
      case ItemTypes.TEST_CASE:
        let displayName: string;

        if (item.draggedItems && item.draggedItems.length > 0) {
          const itemCount = item.draggedItems.length;
          if (itemCount === 1) {
            // If draggedItems has one item, use its name.
            displayName = item.draggedItems[0]?.name || "Test Case";
          } else {
            displayName = `${itemCount} test cases`;
          }
        } else if (item.name) {
          // Fallback to single item drag using the 'name' property directly
          displayName = item.name;
        } else {
          // Fallback if item structure is unexpected or lacks necessary info
          return null;
        }

        return (
          <div
            style={getItemStyles(initialOffset, currentOffset)}
            // Apply Tailwind classes for background and appearance
            className="bg-primary/20 border-primary border rounded-md shadow-md text-sm flex items-start gap-2 max-w-[400px]"
          >
            <ListChecks size={16} className="text-primary shrink-0" />
            {/* Icon */}
            <span className="truncate">{displayName}</span>
          </div>
        );
      default:
        return null;
    }
  }

  // Don't render anything if not dragging or if item is null
  if (!isDragging || !item) {
    return null;
  }

  // Render the layer and the item preview
  return <div style={layerStyles}>{renderItem()}</div>;
};
