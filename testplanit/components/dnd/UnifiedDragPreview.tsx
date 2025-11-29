import React, { useEffect, useRef } from "react";
import { useDragLayer, XYCoord } from "react-dnd";
import { ItemTypes } from "~/types/dndTypes";
import { ListChecks, Folder } from "lucide-react";
import { CSSProperties } from "react";

// Define the structure for test case info
interface PreviewTestCaseInfo {
  id: number | string;
  name: string;
}

// Define the structure of the item collected by useDragLayer
interface CollectedDragItem {
  // For test cases
  id?: number | string;
  folderId?: number | null;
  name?: string;
  index?: number;
  draggedItems?: PreviewTestCaseInfo[];

  // For folders (react-arborist)
  text?: string;

  [key: string]: any;
}

// Define the styles for the layer
const layerStyles: CSSProperties = {
  position: "fixed",
  pointerEvents: "none",
  zIndex: 100,
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

// The unified drag layer component for all drag types
export const UnifiedDragPreview: React.FC = () => {
  const previewRef = useRef<HTMLDivElement>(null);

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

  // Track mouse position and update DOM directly without React re-renders
  useEffect(() => {
    if (!isDragging || !previewRef.current) {
      return;
    }

    const preview = previewRef.current;

    const handleMouseMove = (e: MouseEvent) => {
      // Update transform directly on the DOM element
      const x = e.clientX + 10;
      const y = e.clientY + 10;
      preview.style.transform = `translate(${x}px, ${y}px)`;
    };

    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
    };
  }, [isDragging]);

  // Use the DND offset for initial positioning
  const currentOffset = dndOffset;

  // Function to render the preview item based on type
  function renderItem() {
    if (!item) return null;

    switch (itemType) {
      case ItemTypes.TEST_CASE: {
        let displayName: string;

        if (item.draggedItems && item.draggedItems.length > 0) {
          const itemCount = item.draggedItems.length;
          if (itemCount === 1) {
            displayName = item.draggedItems[0]?.name || "Test Case";
          } else {
            displayName = `${itemCount} test cases`;
          }
        } else if (item.name) {
          displayName = item.name;
        } else {
          return null;
        }

        return (
          <div
            ref={previewRef}
            style={getItemStyles(initialOffset, currentOffset)}
            className="bg-primary/20 border-primary border rounded-md shadow-md text-sm flex items-start gap-2 max-w-[400px]"
          >
            <ListChecks size={16} className="text-primary shrink-0" />
            <span className="truncate">{displayName}</span>
          </div>
        );
      }

      default: {
        // Handle react-arborist folder drag (uses custom item types)
        // If it's not a known type but has drag data, assume it's a folder
        if (item.text || item.name) {
          const displayName = item.text || item.name;
          return (
            <div
              ref={previewRef}
              style={getItemStyles(initialOffset, currentOffset)}
              className="bg-accent rounded-md shadow-md text-sm flex items-center gap-2 max-w-[400px] opacity-90"
            >
              <Folder className="w-4 h-4 shrink-0" />
              <span className="truncate font-medium">{displayName}</span>
            </div>
          );
        }
        return null;
      }
    }
  }

  // Don't render anything if not dragging or if item is null
  if (!isDragging || !item) {
    return null;
  }

  // Render the layer and the item preview
  return <div style={layerStyles}>{renderItem()}</div>;
};
