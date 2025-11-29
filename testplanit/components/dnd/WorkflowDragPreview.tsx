import React from "react";
import { useDragLayer, XYCoord } from "react-dnd";
import { ItemTypes } from "~/types/dndTypes";
import DynamicIcon from "@/components/DynamicIcon";
import { CSSProperties } from "react";
import dynamicIconImports from "lucide-react/dynamicIconImports";

// Define the structure of an individual workflow's essential info for preview
interface PreviewWorkflowInfo {
  id: number | string;
  name: string;
  icon?: {
    name: string;
  };
  color?: {
    value: string;
  };
}

// Define the structure of the item collected by useDragLayer
interface CollectedDragItem {
  // For a single dragged item
  id?: number | string;
  name?: string;
  icon?: {
    name: string;
  };
  color?: {
    value: string;
  };
  index?: number;

  // For multiple dragged items (if needed in future)
  draggedItems?: PreviewWorkflowInfo[];
}

// Define the props for the custom drag layer component
interface WorkflowDragLayerProps {}

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
  const transform = `translate(${x}px, ${y}px)`;
  return {
    transform,
    WebkitTransform: transform,
    padding: "8px 12px",
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
  };
}

// The custom drag layer component
export const WorkflowDragPreview: React.FC<WorkflowDragLayerProps> = () => {
  const { itemType, isDragging, item, initialOffset, currentOffset } =
    useDragLayer((monitor) => ({
      item: monitor.getItem() as CollectedDragItem | null,
      itemType: monitor.getItemType(),
      initialOffset: monitor.getInitialSourceClientOffset(),
      currentOffset: monitor.getClientOffset(),
      isDragging: monitor.isDragging(),
    }));

  // Function to render the preview item
  function renderItem() {
    if (!item) return null;

    // console.log("[WORKFLOW_DRAG_PREVIEW] item:", item);
    // console.log("[WORKFLOW_DRAG_PREVIEW] itemType:", itemType);

    switch (itemType) {
      case ItemTypes.WORKFLOW:
        let displayName: string;
        let iconName: keyof typeof dynamicIconImports | undefined;
        let iconColor: string | undefined;

        if (item.draggedItems && item.draggedItems.length > 0) {
          const itemCount = item.draggedItems.length;
          if (itemCount === 1) {
            const firstItem = item.draggedItems[0];
            displayName = firstItem?.name || "Workflow";
            iconName = firstItem?.icon?.name as keyof typeof dynamicIconImports;
            iconColor = firstItem?.color?.value;
          } else {
            displayName = `${itemCount} workflows`;
            // For multiple items, we could use a default icon or the first item's icon
            iconName = item.draggedItems[0]?.icon
              ?.name as keyof typeof dynamicIconImports;
            iconColor = item.draggedItems[0]?.color?.value;
          }
        } else if (item.name) {
          // Single item drag
          displayName = item.name;
          iconName = item.icon?.name as keyof typeof dynamicIconImports;
          iconColor = item.color?.value;
        } else {
          return null;
        }

        return (
          <div
            style={getItemStyles(initialOffset, currentOffset)}
            className="bg-primary/20 border-primary border rounded-md shadow-md text-sm flex items-start max-w-[400px]"
          >
            {iconName && (
              <DynamicIcon
                name={iconName}
                size={20}
                color={iconColor}
                className="shrink-0"
              />
            )}
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
