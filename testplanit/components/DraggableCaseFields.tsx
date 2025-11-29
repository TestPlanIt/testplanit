import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  PointerActivationConstraint,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";

import { Button } from "@/components/ui/button";
import { Trash2, GripVertical } from "lucide-react";

import { CSS } from "@dnd-kit/utilities";

export interface DraggableField {
  id: string | number;
  label: string;
}

const DraggableItem = ({
  id,
  label,
  onRemove,
}: DraggableField & { onRemove: (id: string | number) => void }) => {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  };

  const handleClick = (e: any) => {
    e.preventDefault();
    e.stopPropagation();
    onRemove(id);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="cursor-ns-resize"
    >
      <div className="flex justify-between items-center py-1 px-4 bg-muted-foreground/10 my-1 text-sm ">
        <div className="flex items-center">
          <GripVertical size={20} />
          {label}
        </div>
        <Button
          type="button"
          variant="link"
          onClick={handleClick}
          className="text-destructive p-0 -my-1"
        >
          <Trash2 size={20} />
        </Button>
      </div>
    </div>
  );
};

const DraggableList = ({
  items,
  setItems,
  onRemove,
}: {
  items: DraggableField[];
  setItems: (items: DraggableField[]) => void;
  onRemove: (id: string | number) => void;
}) => {
  const activationConstraint: PointerActivationConstraint = {
    distance: 5, // Requires the pointer to move 5 pixels before activating
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint }),
    useSensor(KeyboardSensor)
  );

  const handleDragEnd = (event: any) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = items.findIndex((item: any) => item.id === active.id);
      const newIndex = items.findIndex((item: any) => item.id === over.id);
      setItems(arrayMove(items, oldIndex, newIndex));
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={items.map((item: any) => item.id)}
        strategy={verticalListSortingStrategy}
      >
        {items.map((item: any) => (
          <DraggableItem
            key={item.id}
            id={item.id}
            label={item.label}
            onRemove={onRemove}
          />
        ))}
      </SortableContext>
    </DndContext>
  );
};

export { DraggableList };
