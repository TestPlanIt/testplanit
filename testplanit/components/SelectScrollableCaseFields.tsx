import * as React from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { DraggableField } from "./DraggableCaseFields";

interface SelectScrollableProps {
  fields: DraggableField[];
  onAddField: (field: DraggableField, type: string) => void;
  type: string;
}

export function SelectScrollable({
  fields,
  onAddField,
  type,
}: SelectScrollableProps) {
  const sortedFields = fields.sort((a, b) => a.label.localeCompare(b.label));

  return (
    <Select
      value=""
      onValueChange={(value) => {
        const fieldToAdd = sortedFields.find(
          (field) => `${field.id}` === value
        );
        if (fieldToAdd) {
          onAddField(fieldToAdd, type);
        }
      }}
    >
      <SelectTrigger className="w-[280px]" data-testid={`add-${type}-field-select`}>
        <SelectValue
          placeholder={`Add a field to ${type.charAt(0).toUpperCase() + type.slice(1)} Fields`}
        />
      </SelectTrigger>
      <SelectContent className="max-h-[300px] overflow-auto">
        <SelectGroup>
          {sortedFields.map((field) => (
            <SelectItem key={field.id} value={`${field.id}`}>
              {field.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
