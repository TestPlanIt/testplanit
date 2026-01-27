import React from "react";
import { Badge } from "@/components/ui/badge";
import DynamicIcon from "@/components/DynamicIcon";
import { DateFormatter } from "@/components/DateFormatter";
import { IconName } from "~/types/globals";

interface CustomFieldDisplayProps {
  customFields?: Array<{
    fieldId: number;
    fieldName: string;
    fieldType: string;
    value?: any;
    valueKeyword?: string;
    valueNumeric?: number;
    valueBoolean?: boolean;
    valueDate?: string;
    valueArray?: string[];
    fieldOption?: {
      id: number;
      name: string;
      icon?: { name: string };
      iconColor?: { value: string };
    };
    fieldOptions?: Array<{
      id: number;
      name: string;
      icon?: { name: string };
      iconColor?: { value: string };
    }>;
  }>;
  maxItems?: number;
}

export const CustomFieldDisplay: React.FC<CustomFieldDisplayProps> = ({
  customFields,
  maxItems = 3,
}) => {
  if (!customFields || customFields.length === 0) {
    return null;
  }

  const renderFieldValue = (field: (typeof customFields)[0]) => {
    switch (field.fieldType) {
      case "Checkbox":
        return field.valueBoolean ? (
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">
              {field.fieldName}:
            </span>
            <Badge variant="secondary" className="text-xs">
              {"✓"}
            </Badge>
          </div>
        ) : null;

      case "Date":
        return field.valueDate ? (
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">
              {field.fieldName}:
            </span>
            <Badge variant="outline" className="text-xs">
              <DateFormatter date={field.valueDate} />
            </Badge>
          </div>
        ) : null;

      case "Number":
      case "Integer":
        return field.valueNumeric !== null &&
          field.valueNumeric !== undefined ? (
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">
              {field.fieldName}:
            </span>
            <Badge variant="outline" className="text-xs">
              {field.valueNumeric}
            </Badge>
          </div>
        ) : null;

      case "Multi-Select":
        if (
          field.valueArray &&
          field.valueArray.length > 0 &&
          field.fieldOptions
        ) {
          const selectedOptions = field.fieldOptions.filter((opt) =>
            field.valueArray?.includes(opt.id.toString())
          );
          if (selectedOptions.length === 0) return null;

          return (
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground">
                {field.fieldName}:
              </span>
              {selectedOptions.map((opt) => (
                <Badge key={opt.id} variant="secondary" className="text-xs">
                  {opt.icon && (
                    <DynamicIcon
                      name={opt.icon.name as IconName}
                      className="h-3 w-3 mr-1"
                      color={opt.iconColor?.value}
                    />
                  )}
                  {opt.name}
                </Badge>
              ))}
            </div>
          );
        }
        return null;

      case "Select":
      case "Dropdown":
        if (field.fieldOption) {
          return (
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground">
                {field.fieldName}:
              </span>
              <Badge variant="secondary" className="text-xs">
                {field.fieldOption.icon && (
                  <DynamicIcon
                    name={field.fieldOption.icon.name as IconName}
                    className="h-3 w-3 mr-1"
                    color={field.fieldOption.iconColor?.value}
                  />
                )}
                {field.fieldOption.name}
              </Badge>
            </div>
          );
        }
        return null;

      case "Link":
        return field.value ? (
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">
              {field.fieldName}:
            </span>
            <Badge variant="outline" className="text-xs">
              <a
                href={field.value}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                {field.value}
              </a>
            </Badge>
          </div>
        ) : null;

      case "Text String":
      case "Text Long":
        // Text content is already extracted and shown in searchableContent
        // Don't duplicate it here
        return null;

      default:
        return field.value ? (
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">
              {field.fieldName}:
            </span>
            <Badge variant="outline" className="text-xs">
              {field.value}
            </Badge>
          </div>
        ) : null;
    }
  };

  const validFields = customFields
    .map((field, index) => ({ field, element: renderFieldValue(field), index }))
    .filter(({ element }) => element !== null)
    .slice(0, maxItems);

  if (validFields.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-4">
      {validFields.map(({ field, element, index }) => (
        <React.Fragment key={field.fieldId || index}>{element}</React.Fragment>
      ))}
    </div>
  );
};
