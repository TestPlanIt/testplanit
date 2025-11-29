import React, { useState, useEffect, useRef } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { useFindManyFieldIcon, useFindManyColor } from "~/lib/hooks";
import { IconName } from "~/types/globals";
import DynamicIcon from "./DynamicIcon";
import { Input } from "@/components/ui/input";
import { ColorPicker } from "@/components/ColorPicker";
import { Ellipsis } from "lucide-react";

interface FieldIconPickerProps {
  onIconSelect: (iconId: number) => void;
  onColorSelect?: (colorId: number) => void; // Make this optional
  initialIconId?: number | null;
  initialColorId?: number | null;
}

export const FieldIconPicker: React.FC<FieldIconPickerProps> = ({
  onIconSelect,
  onColorSelect,
  initialIconId,
  initialColorId,
}) => {
  const { data: allIcons, isLoading: isIconsLoading } = useFindManyFieldIcon({
    orderBy: { name: "asc" },
  });
  const { data: colors, isLoading: isColorsLoading } = useFindManyColor({
    include: { colorFamily: true },
    orderBy: { colorFamily: { order: "asc" } },
  });

  const [selectedIconId, setSelectedIconId] = useState<number | null>(
    initialIconId || null
  );
  const [selectedColorId, setSelectedColorId] = useState<number | null>(
    initialColorId || null
  );
  const [isIconPickerOpen, setIconPickerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isIconPickerOpen) {
      setTimeout(() => {
        if (searchInputRef.current) {
          searchInputRef.current.focus();
        }
      }, 10);
    }
  }, [isIconPickerOpen]);

  useEffect(() => {
    if (allIcons && !selectedIconId && !initialIconId) {
      const layoutListIconId =
        allIcons.find((icon) => icon.name === "layout-list")?.id ??
        allIcons[0]?.id ??
        null;
      setSelectedIconId(layoutListIconId);
      onIconSelect(layoutListIconId!);
    }
  }, [allIcons, selectedIconId, initialIconId, onIconSelect]);

  const filteredIcons = allIcons?.filter((icon) =>
    icon.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleIconSelect = (iconId: number) => {
    setSelectedIconId(iconId);
    onIconSelect(iconId);
  };

  const handleColorSelect = (colorId: number) => {
    setSelectedColorId(colorId);
    onColorSelect?.(colorId); // Optional chaining to handle undefined
  };

  if (
    isIconsLoading ||
    isColorsLoading ||
    !allIcons ||
    allIcons.length === 0 ||
    !colors
  ) {
    return (
      <div>
        <Ellipsis className="w-4 h-4" />
      </div>
    );
  }

  const selectedIcon = allIcons.find((icon) => icon.id === selectedIconId);
  const selectedColorHex =
    colors.find((color) => color.id === selectedColorId)?.value || "#000000";

  return (
    <div className="flex flex-row space-x-1 items-center">
      <div>
        <Select
          onOpenChange={(isOpen) => setIconPickerOpen(isOpen)}
          onValueChange={(value) => handleIconSelect(parseInt(value))}
        >
          <SelectTrigger
            className="w-15 pl-2 pr-0 m-0"
            aria-label="icon-picker"
          >
            {selectedIcon && (
              <DynamicIcon
                name={selectedIcon.name as IconName}
                size={20}
                color={selectedColorHex}
              />
            )}
          </SelectTrigger>
          {isIconPickerOpen && (
            <SelectContent side="right">
              <div className="sticky top-0 z-10">
                <Input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Search icons..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full p-2"
                />
              </div>
              <div className="grid grid-cols-6 gap-2 p-2 overflow-y-auto max-h-60">
                {filteredIcons?.map((icon) => (
                  <SelectItem
                    title={icon.name}
                    key={icon.id}
                    value={icon.id.toString()}
                    className={`flex justify-center items-center p-2 ${icon.id === selectedIconId ? "bg-muted-foreground" : "bg-gray-200"}`}
                  >
                    <DynamicIcon
                      aria-label={icon.name}
                      name={icon.name as IconName}
                      size={20}
                      color={selectedColorHex}
                    />
                  </SelectItem>
                ))}
              </div>
            </SelectContent>
          )}
        </Select>
      </div>
      {onColorSelect && (
        <div className="w-10">
          <ColorPicker
            onColorSelect={handleColorSelect}
            initialColorId={initialColorId}
          />
        </div>
      )}
    </div>
  );
};
