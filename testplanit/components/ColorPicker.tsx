import React, { useState } from "react";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { useFindManyColor } from "~/lib/hooks";
import { Color } from "@prisma/client";
import { Ellipsis } from "lucide-react";

interface ColorPickerProps {
  onColorSelect: (colorId: number) => void;
  initialColorId?: number | null;
}

export const ColorPicker: React.FC<ColorPickerProps> = ({
  onColorSelect,
  initialColorId,
}) => {
  const { data: colors, isLoading: isColorsLoading } = useFindManyColor({
    include: { colorFamily: true },
    orderBy: { colorFamily: { order: "asc" } },
  });

  const [selectedColorId, setSelectedColorId] = useState<number | null>(
    initialColorId || null
  );
  const [isColorPickerOpen, setColorPickerOpen] = useState(false);

  const handleColorSelect = (colorId: number) => {
    // console.log("Color selected: ", colorId);
    setSelectedColorId(colorId);
    onColorSelect(colorId);
  };

  if (isColorsLoading || !colors || colors.length === 0) {
    return (
      <div className="flex items-center justify-center w-full h-full">
        <Ellipsis className="w-4 h-4" />
      </div>
    );
  }

  const colorGroups = (colors || []).reduce<{ [key: string]: Color[] }>(
    (groups, color) => {
      const groupName = color.colorFamily.name;
      groups[groupName] = groups[groupName] || [];
      groups[groupName].push(color);
      groups[groupName].sort((a, b) => a.order - b.order);
      return groups;
    },
    {}
  );

  return (
    <Select
      onOpenChange={(isOpen) => setColorPickerOpen(isOpen)}
      onValueChange={(value) => {
        // console.log("onValueChange triggered: ", value);
        handleColorSelect(parseInt(value));
      }}
    >
      <SelectTrigger
        className="p-0 m-0 aspect-square h-full w-full"
        aria-label="color-picker"
      >
        <div
          className="aspect-square min-w-5 min-h-5 w-full rounded-full ml-2"
          style={{
            backgroundColor:
              colors.find((c) => c.id === selectedColorId)?.value || "#000000",
          }}
        />
      </SelectTrigger>
      {isColorPickerOpen && (
        <SelectContent side="right">
          <div className="mt-4 w-full">
            {Object.entries(colorGroups).map(([familyName, colors]) => (
              <div key={familyName}>
                <div className="grid grid-flow-col-dense flex-wrap justify-center items-center">
                  {colors.map((color) => (
                    <SelectItem
                      key={color.id}
                      value={color.id.toString()}
                      className={`grid justify-center items-center m-0 p-0 text-white`}
                      onClick={() => handleColorSelect(color.id)} // Directly handle onClick
                    >
                      <span
                        className={`grid justify-center items-center p-3 m-1 w-6 h-6 rounded-full`}
                        style={{ backgroundColor: color.value }}
                      />
                    </SelectItem>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </SelectContent>
      )}
    </Select>
  );
};
