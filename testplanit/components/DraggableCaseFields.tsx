import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerActivationConstraint,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { GripVertical, Sparkles, Trash2 } from "lucide-react";
import { siJira } from "simple-icons";

import { CSS } from "@dnd-kit/utilities";

export interface DraggableField {
  id: string | number;
  label: string;
  // Per-template default for the Generate Test Cases wizard. Only meaningful
  // when the list is rendered with onToggleGenerateDefault.
  generateDefaultEnabled?: boolean;
  // Per-template opt-in to show the field's value in the Jira plugin panel.
  // Only meaningful when the list is rendered with onToggleJiraPanel.
  jiraPanelEnabled?: boolean;
}

const DraggableItem = ({
  id,
  label,
  generateDefaultEnabled,
  jiraPanelEnabled,
  onRemove,
  onToggleGenerateDefault,
  onToggleJiraPanel,
}: DraggableField & {
  onRemove: (id: string | number) => void;
  onToggleGenerateDefault?: (id: string | number) => void;
  onToggleJiraPanel?: (id: string | number) => void;
}) => {
  const t = useTranslations("admin.templates");
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

  const generateOn = generateDefaultEnabled !== false;
  // Opposite default from the generate toggle: nothing is exposed to the Jira
  // panel unless an admin explicitly turns it on.
  const jiraOn = jiraPanelEnabled === true;

  const handleToggleGenerate = (e: any) => {
    e.preventDefault();
    e.stopPropagation();
    onToggleGenerateDefault?.(id);
  };

  const handleToggleJira = (e: any) => {
    e.preventDefault();
    e.stopPropagation();
    onToggleJiraPanel?.(id);
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
        <div className="flex items-center">
          {onToggleJiraPanel && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="link"
                  onClick={handleToggleJira}
                  aria-pressed={jiraOn}
                  className={`p-0 -my-1 mr-2 ${
                    jiraOn ? "text-primary" : "text-muted-foreground/40"
                  }`}
                  data-testid={`jira-panel-toggle-${id}`}
                >
                  <svg
                    viewBox="0 0 24 24"
                    width={20}
                    height={20}
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d={siJira.path} />
                  </svg>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {jiraOn ? t("jiraPanelOn") : t("jiraPanelOff")}
              </TooltipContent>
            </Tooltip>
          )}
          {onToggleGenerateDefault && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="link"
                  onClick={handleToggleGenerate}
                  aria-pressed={generateOn}
                  className={`p-0 -my-1 mr-2 ${
                    generateOn ? "text-primary" : "text-muted-foreground/40"
                  }`}
                  data-testid={`generate-default-toggle-${id}`}
                >
                  <Sparkles size={20} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {generateOn ? t("generateDefaultOn") : t("generateDefaultOff")}
              </TooltipContent>
            </Tooltip>
          )}
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
    </div>
  );
};

const DraggableList = ({
  items,
  setItems,
  onRemove,
  onToggleGenerateDefault,
  onToggleJiraPanel,
}: {
  items: DraggableField[];
  setItems: (items: DraggableField[]) => void;
  onRemove: (id: string | number) => void;
  onToggleGenerateDefault?: (id: string | number) => void;
  onToggleJiraPanel?: (id: string | number) => void;
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
            generateDefaultEnabled={item.generateDefaultEnabled}
            jiraPanelEnabled={item.jiraPanelEnabled}
            onRemove={onRemove}
            onToggleGenerateDefault={onToggleGenerateDefault}
            onToggleJiraPanel={onToggleJiraPanel}
          />
        ))}
      </SortableContext>
    </DndContext>
  );
};

export { DraggableList };
