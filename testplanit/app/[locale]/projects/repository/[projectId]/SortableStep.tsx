import React, { HTMLAttributes } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export interface SortableStepProps {
  id: string;
  children: (props: {
    attributes: HTMLAttributes<any>;
    listeners: Record<string, any> | undefined;
    setNodeRef: (node: HTMLElement | null) => void;
  }) => React.ReactNode;
  readOnly?: boolean;
}

const SortableStep: React.FC<SortableStepProps> = ({
  id,
  children,
  readOnly = false,
}) => {
  const {
    attributes,
    listeners = {}, // Provide a default empty object if listeners is undefined
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      {children({ attributes, listeners, setNodeRef })}
    </div>
  );
};

export default SortableStep;
