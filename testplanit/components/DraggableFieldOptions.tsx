import React, { useState, useEffect, useCallback } from "react";
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
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { useTranslations } from "next-intl";

import { CSS } from "@dnd-kit/utilities";
import { FieldOptions } from "@prisma/client";
import { FieldIconPicker } from "@/components/FieldIconPicker";

import { Trash2, GripVertical, Edit3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

const columns =
  "grid grid-cols-[30px_120px_auto_70px_70px_50px] items-center py-1 px-4 bg-muted text-sm";

export interface DraggableItemProps extends FieldOptions {
  onRemove: (id: number) => void;
  defaultItem: number | null;
  setDefaultItem?: (id: number) => void;
  handleEnabledChange: (itemId: number, isEnabled: boolean) => void;
  handleIconChange: (itemId: number, newIconId: number) => void;
  handleColorChange: (itemId: number, newColorId: number) => void;
  showDefault: boolean;
  onNameChange: (itemId: number, newName: string) => void;
  setEditingId: React.Dispatch<React.SetStateAction<number | null>>;
  editingId: number | null;
  allNames: string[];
}

const DraggableItem = ({
  id,
  name,
  isEnabled,
  iconId,
  iconColorId,
  onRemove,
  showDefault,
  handleEnabledChange,
  handleIconChange,
  handleColorChange,
  setDefaultItem,
  defaultItem,
  onNameChange,
  editingId,
  setEditingId,
  allNames,
}: DraggableItemProps) => {
  const t = useTranslations();
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id });
  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  };

  let isDefault;
  if (showDefault) {
    isDefault = defaultItem === id;
  }

  const isEditing = editingId === id;
  const [newName, setNewName] = useState(name);
  const [error, setError] = useState("");

  const validateName = useCallback(
    (newName: string) => {
      const isUnique = !allNames.some(
        (existingName) => existingName === newName && newName !== name
      );
      const validChars = /^[a-zA-Z0-9_ ]+$/;
      if (newName.length === 0) {
        return t("common.fields.options.validation.empty");
      } else if (!newName.match(validChars)) {
        return t("common.fields.options.validation.invalidChars");
      } else if (!isUnique) {
        return t("common.fields.options.validation.unique");
      }
      return "";
    },
    [allNames, name, t]
  );

  useEffect(() => {
    setError(validateName(newName));
  }, [newName, allNames, validateName]);

  const handleRadioClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const id = e.currentTarget.value;
    if (setDefaultItem) {
      setDefaultItem(Number(id));
    }
  };

  const handleNameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setNewName(event.target.value);
  };

  const handleEditClick = () => {
    setEditingId(id); // Start editing the item
  };

  const handleBlur = () => {
    setEditingId(null); // Stop editing
    if (!error) {
      onNameChange(id, newName);
    } else {
      setNewName(name);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !error) {
      setEditingId(null); // Stop editing
      onNameChange(id, newName);
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`${columns} cursor-ns-resize`}
      {...attributes}
      {...listeners}
    >
      <GripVertical size={20} />

      <FieldIconPicker
        initialIconId={iconId ?? undefined}
        initialColorId={iconColorId ?? undefined}
        onIconSelect={(newIconId) => handleIconChange(id, newIconId)}
        onColorSelect={(newColorId) => handleColorChange(id, newColorId)}
      />

      {isEditing ? (
        <div className="flex flex-col w-full mr-12 pr-12">
          <Input
            type="text"
            value={newName}
            onChange={handleNameChange}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            className="cursor-ns-resize w-full"
            autoFocus
          />
          {error && <span className="text-destructive text-xs">{error}</span>}
        </div>
      ) : (
        <div className="flex items-center">
          <span className="cursor-ns-resize">{name}</span>
          <Button
            type="button"
            variant="link"
            onClick={handleEditClick}
            className="text-primary ml-2 p-0"
          >
            <Edit3 size={16} />
          </Button>
        </div>
      )}
      {showDefault ? (
        <div className="flex justify-center">
          <RadioGroupItem
            className="flex justify-center"
            value={id.toString()}
            id={`item-${id}`}
            type="button"
            onClick={handleRadioClick}
          />
        </div>
      ) : (
        <span />
      )}
      <div className="flex justify-center">
        <Switch
          checked={isDefault || isEnabled}
          onCheckedChange={(newValue: boolean) =>
            handleEnabledChange(id, newValue)
          }
          disabled={isDefault}
        />
      </div>
      <Button
        disabled={isDefault}
        type="button"
        variant="link"
        onClick={(e) => {
          e.stopPropagation();
          onRemove(id);
        }}
        className="text-destructive p-0 -my-1"
      >
        <Trash2 size={20} />
      </Button>
    </div>
  );
};

interface DraggableListProps {
  items: FieldOptions[];
  setItems: React.Dispatch<React.SetStateAction<FieldOptions[]>>;
  onRemove: (id: number) => void;
  defaultItem: number | null;
  setDefaultItem: (id: number) => void;
  showDefault: boolean;
  handleEnabledChange: (itemId: number, isEnabled: boolean) => void;
  handleIconChange: (itemId: number, iconId: number) => void;
  handleColorChange: (itemId: number, colorId: number) => void;
}

const DraggableList: React.FC<DraggableListProps> = ({
  items,
  setItems,
  onRemove,
  defaultItem,
  setDefaultItem,
  showDefault,
}: {
  items: FieldOptions[];
  setItems: (items: FieldOptions[]) => void;
  onRemove: (id: number) => void;
  defaultItem: number | null;
  setDefaultItem: (id: number) => void;
  showDefault: boolean;
}) => {
  const t = useTranslations();
  const activationConstraint: PointerActivationConstraint = {
    distance: 5,
  };

  const handleEnabledChange = (itemId: number, isEnabled: boolean) => {
    const updatedItems = items.map((item) =>
      item.id === itemId ? { ...item, isEnabled: isEnabled } : item
    );
    setItems(updatedItems);
  };

  const handleIconChange = (itemId: number, iconId: number) => {
    const updatedItems = items.map((item) =>
      item.id === itemId ? { ...item, iconId: iconId } : item
    );
    setItems(updatedItems);
  };

  const handleColorChange = (itemId: number, colorId: number) => {
    const updatedItems = items.map((item) =>
      item.id === itemId ? { ...item, iconColorId: colorId } : item
    );
    setItems(updatedItems);
  };

  const handleNameChange = (itemId: number, newName: string) => {
    const updatedItems = items.map((item) =>
      item.id === itemId ? { ...item, name: newName } : item
    );
    setItems(updatedItems);
  };

  const [editingId, setEditingId] = useState<number | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint }),
    useSensor(KeyboardSensor, {
      coordinateGetter: (event, { active, currentCoordinates, context }) => {
        if (editingId !== null) return undefined;
        return sortableKeyboardCoordinates(event, {
          active,
          currentCoordinates,
          context,
        });
      },
      keyboardCodes: {
        start: ["Enter"],
        cancel: ["Escape"],
        end: ["Enter"],
      },
    })
  );

  const handleDragEnd = (event: any) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = items.findIndex((item) => item.id === active.id);
      const newIndex = items.findIndex((item) => item.id === over.id);
      setItems(arrayMove(items, oldIndex, newIndex));
    }
  };

  const setDefaultItemAndEnable = (id: number) => {
    setDefaultItem(id);
    if (showDefault) {
      handleEnabledChange(id, true);
    }
  };

  const handleRadioChange = (value: string) => {
    setDefaultItemAndEnable(Number(value));
  };

  const allNames = items.map((item) => item.name);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      onDragEnd={handleDragEnd}
    >
      <RadioGroup
        value={defaultItem?.toString()}
        onValueChange={handleRadioChange}
      >
        {/* Header */}
        {items.length > 0 && (
          <div
            className={`${columns} shadow-xs text-muted-foreground sticky top-0 z-10 bg-white`}
          >
            <span />
            <span className="ml-2">{t("common.fields.icon")}</span>
            <span>{t("common.fields.options.label")}</span>
            {showDefault ? (
              <span className="ml-2">{t("common.fields.options.default")}</span>
            ) : (
              <span className="ml-2" />
            )}
            <span className="ml-2">{t("common.fields.options.enabled")}</span>
            <span>{t("linkedCases.removeLink")}</span>
          </div>
        )}

        {/* List */}
        <SortableContext
          items={items.map((item) => item.id)}
          strategy={verticalListSortingStrategy}
        >
          {items.map((item) => (
            <DraggableItem
              key={item.id}
              {...item}
              onRemove={onRemove}
              defaultItem={defaultItem}
              setDefaultItem={setDefaultItemAndEnable}
              handleEnabledChange={handleEnabledChange}
              handleIconChange={handleIconChange}
              handleColorChange={handleColorChange}
              showDefault={showDefault}
              onNameChange={handleNameChange}
              editingId={editingId}
              setEditingId={setEditingId}
              allNames={allNames}
            />
          ))}
        </SortableContext>
      </RadioGroup>
    </DndContext>
  );
};

export { DraggableList };
