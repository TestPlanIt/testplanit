import React, { useState, useEffect } from "react";
import { useDragLayer, XYCoord } from "react-dnd";
import { Folder } from "lucide-react";
import { CSSProperties } from "react";

// Define the structure of a folder item collected by useDragLayer
interface CollectedDragItem {
  id?: string | number;
  text?: string;
  name?: string;
  [key: string]: any; // react-arborist might add other properties
}

// Define the props for the custom drag layer component
interface FolderDragLayerProps {}

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
    gap: "8px",
  };
}

// The custom drag layer component for folder dragging
export const FolderDragPreview: React.FC<FolderDragLayerProps> = () => {
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

    const handleMouseMove = (e: MouseEvent) => {
      setPointerOffset({ x: e.clientX, y: e.clientY });
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
    };
  }, [isDragging]);

  // Use the tracked pointer position, falling back to DND offset if pointer not available yet
  const currentOffset = pointerOffset || dndOffset;

  // Function to render the preview item
  function renderItem() {
    if (!item) return null;

    // react-arborist items have 'text' property for folder name
    const displayName = item.text || item.name || "Folder";

    return (
      <div
        style={getItemStyles(initialOffset, currentOffset)}
        className="bg-accent rounded-md shadow-md text-sm flex items-center gap-2 max-w-[400px] opacity-90"
      >
        <Folder className="w-4 h-4 shrink-0" />
        <span className="truncate font-medium">{displayName}</span>
      </div>
    );
  }

  // Only render for non-standard drag types (react-arborist uses its own types)
  // Don't render for TEST_CASE or WORKFLOW types as those have their own previews
  const isReactArboristDrag =
    isDragging &&
    itemType !== "testCase" &&
    itemType !== "workflow" &&
    itemType !== null;

  if (!isReactArboristDrag || !item) {
    return null;
  }

  // Render the layer and the item preview
  return <div style={layerStyles}>{renderItem()}</div>;
};
