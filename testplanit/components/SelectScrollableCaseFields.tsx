import { useTranslations } from "next-intl";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
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
  const tCommon = useTranslations("common");
  const sortedFields = fields.sort((a, b) => a.label.localeCompare(b.label));
  const label = tCommon("placeholders.addFieldTo", {
    section:
      type === "result"
        ? tCommon("fields.resultFields")
        : tCommon("fields.caseFields"),
  });

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
      <SelectTrigger
        className="w-[280px]"
        aria-label={label}
        data-testid={`add-${type}-field-select`}
      >
        <SelectValue placeholder={label} />
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
