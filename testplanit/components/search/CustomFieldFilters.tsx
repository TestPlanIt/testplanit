"use client";

import { useState, useEffect } from "react";
import {
  CustomFieldFilter,
  CustomFieldOperator,
  SearchableEntityType,
} from "~/types/search";
import {
  useFindManyCaseFields,
  useFindManyCaseFieldTypes,
  useFindManyFieldOptions,
} from "~/lib/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Calendar } from "@/components/ui/calendar";
import { Switch } from "@/components/ui/switch";
import { cn } from "~/utils";
import { format } from "date-fns";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CalendarIcon, X, Plus } from "lucide-react";
import { useTranslations } from "next-intl";

// Define custom field operators as constants
const CustomFieldOperators = {
  EQUALS: "equals" as const,
  NOT_EQUALS: "not_equals" as const,
  CONTAINS: "contains" as const,
  NOT_CONTAINS: "not_contains" as const,
  STARTS_WITH: "starts_with" as const,
  ENDS_WITH: "ends_with" as const,
  GREATER_THAN: "gt" as const,
  LESS_THAN: "lt" as const,
  GREATER_THAN_OR_EQUAL: "gte" as const,
  LESS_THAN_OR_EQUAL: "lte" as const,
  BETWEEN: "between" as const,
  IN: "in" as const,
  NOT_IN: "not_in" as const,
  EXISTS: "exists" as const,
  NOT_EXISTS: "not_exists" as const,
} as const;

interface CustomFieldFiltersProps {
  entityType: SearchableEntityType;
  filters: CustomFieldFilter[];
  onFiltersChange: (filters: CustomFieldFilter[]) => void;
  projectId?: number;
  templateIds?: number[];
}

export function CustomFieldFilters({
  entityType,
  filters,
  onFiltersChange,
  projectId,
  templateIds = [],
}: CustomFieldFiltersProps) {
  const t = useTranslations();
  const [localFilters, setLocalFilters] =
    useState<CustomFieldFilter[]>(filters);

  // Fetch available custom fields based on entity type
  // Filter by templates assigned to the project
  const { data: caseFields } = useFindManyCaseFields(
    {
      where: {
        isEnabled: true,
        isDeleted: false,
        // Only show fields that are in templates assigned to the project
        ...(templateIds.length > 0 && {
          templates: {
            some: {
              templateId: {
                in: templateIds,
              },
            },
          },
        }),
      },
      include: {
        type: true,
        fieldOptions: {
          include: {
            fieldOption: true,
          },
        },
      },
    },
    {
      enabled: entityType === SearchableEntityType.REPOSITORY_CASE,
    }
  );

  const { data: fieldTypes } = useFindManyCaseFieldTypes();

  // Update local filters when props change
  useEffect(() => {
    setLocalFilters(filters);
  }, [filters]);

  // Add a new filter
  const addFilter = () => {
    if (!caseFields || caseFields.length === 0) return;

    const newFilter: CustomFieldFilter = {
      fieldId: caseFields[0].id,
      fieldName: caseFields[0].displayName,
      fieldType: caseFields[0].type.type,
      operator: CustomFieldOperators.EQUALS,
      value: "",
    };

    const updatedFilters = [...localFilters, newFilter];
    setLocalFilters(updatedFilters);
    onFiltersChange(updatedFilters);
  };

  // Remove a filter
  const removeFilter = (index: number) => {
    const updatedFilters = localFilters.filter((_, i) => i !== index);
    setLocalFilters(updatedFilters);
    onFiltersChange(updatedFilters);
  };

  // Update a filter
  const updateFilter = (index: number, updates: Partial<CustomFieldFilter>) => {
    const updatedFilters = [...localFilters];
    updatedFilters[index] = { ...updatedFilters[index], ...updates };
    setLocalFilters(updatedFilters);
    onFiltersChange(updatedFilters);
  };

  // Get operators for field type
  const getOperatorsForFieldType = (
    fieldType: string
  ): CustomFieldOperator[] => {
    switch (fieldType) {
      case "Text String":
      case "RichText":
      case "Link":
        return [
          CustomFieldOperators.EQUALS,
          CustomFieldOperators.NOT_EQUALS,
          CustomFieldOperators.CONTAINS,
          CustomFieldOperators.NOT_CONTAINS,
          CustomFieldOperators.STARTS_WITH,
          CustomFieldOperators.ENDS_WITH,
        ];
      case "Number":
      case "Integer":
        return [
          CustomFieldOperators.EQUALS,
          CustomFieldOperators.NOT_EQUALS,
          CustomFieldOperators.GREATER_THAN,
          CustomFieldOperators.LESS_THAN,
          CustomFieldOperators.GREATER_THAN_OR_EQUAL,
          CustomFieldOperators.LESS_THAN_OR_EQUAL,
        ];
      case "Date":
        return [
          CustomFieldOperators.EQUALS,
          CustomFieldOperators.NOT_EQUALS,
          CustomFieldOperators.GREATER_THAN,
          CustomFieldOperators.LESS_THAN,
        ];
      case "Checkbox":
        return [CustomFieldOperators.EQUALS];
      case "Dropdown":
      case "Multi-Select":
        return [
          CustomFieldOperators.EQUALS,
          CustomFieldOperators.NOT_EQUALS,
          CustomFieldOperators.IN,
          CustomFieldOperators.NOT_IN,
        ];
      default:
        return [CustomFieldOperators.EQUALS];
    }
  };

  // Render value input based on field type
  const renderValueInput = (
    filter: CustomFieldFilter,
    index: number,
    field: any
  ) => {
    const fieldType = field?.type?.type;

    switch (fieldType) {
      case "Checkbox":
        return (
          <Switch
            checked={filter.value === "true"}
            onCheckedChange={(checked) =>
              updateFilter(index, { value: checked.toString() })
            }
          />
        );

      case "Date":
        return (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-full justify-start text-left font-normal",
                  !filter.value && "text-muted-foreground"
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {filter.value ? (
                  format(new Date(filter.value), "PPP")
                ) : (
                  <span>{t("search.selectDate")}</span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0">
              <Calendar
                mode="single"
                selected={filter.value ? new Date(filter.value) : undefined}
                onSelect={(date) =>
                  updateFilter(index, {
                    value: date ? date.toISOString() : "",
                  })
                }
                autoFocus
              />
            </PopoverContent>
          </Popover>
        );

      case "Dropdown":
        return (
          <Select
            value={filter.value}
            onValueChange={(value) => updateFilter(index, { value })}
          >
            <SelectTrigger>
              <SelectValue placeholder={t("search.selectOption")} />
            </SelectTrigger>
            <SelectContent>
              {field.fieldOptions?.map((option: any) => (
                <SelectItem
                  key={option.fieldOption.id}
                  value={option.fieldOption.id.toString()}
                >
                  {option.fieldOption.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );

      case "Multi-Select":
        const selectedValues = filter.value
          ? filter.value.split(",").filter(Boolean)
          : [];

        return (
          <div className="space-y-2">
            <Select
              onValueChange={(value) => {
                const currentValues = filter.value
                  ? filter.value.split(",").filter(Boolean)
                  : [];
                if (!currentValues.includes(value)) {
                  updateFilter(index, {
                    value: [...currentValues, value].join(","),
                  });
                }
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("search.selectOptions")} />
              </SelectTrigger>
              <SelectContent>
                {field.fieldOptions
                  ?.filter(
                    (option: any) =>
                      !selectedValues.includes(option.fieldOption.id.toString())
                  )
                  .map((option: any) => (
                    <SelectItem
                      key={option.fieldOption.id}
                      value={option.fieldOption.id.toString()}
                    >
                      {option.fieldOption.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <div className="flex flex-wrap gap-1">
              {selectedValues.map((valueId: string) => {
                const option = field.fieldOptions?.find(
                  (opt: any) => opt.fieldOption.id.toString() === valueId
                );
                return (
                  <Badge key={valueId} variant="secondary" className="gap-1">
                    {option?.fieldOption.name || valueId}
                    <X
                      className="h-3 w-3 cursor-pointer"
                      onClick={() => {
                        const newValues = selectedValues.filter(
                          (v: string) => v !== valueId
                        );
                        updateFilter(index, { value: newValues.join(",") });
                      }}
                    />
                  </Badge>
                );
              })}
            </div>
          </div>
        );

      case "Number":
      case "Integer":
        return (
          <Input
            type="number"
            value={filter.value}
            onChange={(e) => updateFilter(index, { value: e.target.value })}
            placeholder={t("search.enterValue")}
            step={fieldType === "Integer" ? "1" : "0.01"}
          />
        );

      default:
        return (
          <Input
            value={filter.value}
            onChange={(e) => updateFilter(index, { value: e.target.value })}
            placeholder={t("search.enterValue")}
          />
        );
    }
  };

  if (!caseFields || caseFields.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">
          {t("search.customFields")}
        </Label>
        <Button
          variant="outline"
          size="sm"
          onClick={addFilter}
          className="gap-1"
        >
          <Plus className="h-3 w-3" />
          {t("search.addFilter")}
        </Button>
      </div>

      {localFilters.length > 0 && (
        <div className="space-y-3">
          {localFilters.map((filter, index) => {
            const field = caseFields.find((f) => f.id === filter.fieldId);
            const fieldType = field?.type?.type || "";
            const availableOperators = getOperatorsForFieldType(fieldType);

            return (
              <div
                key={index}
                className="space-y-2 p-3 border rounded-lg bg-muted/30"
              >
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium">
                    {t("search.filter")} {index + 1}
                  </Label>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => removeFilter(index)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                <div className="grid grid-cols-1 gap-2">
                  {/* Field selector */}
                  <Select
                    value={filter.fieldId.toString()}
                    onValueChange={(value) => {
                      const newField = caseFields.find(
                        (f) => f.id === parseInt(value)
                      );
                      const newFieldType = newField?.type?.type || "";
                      const newOperators =
                        getOperatorsForFieldType(newFieldType);

                      updateFilter(index, {
                        fieldId: parseInt(value),
                        fieldName: newField?.displayName || "",
                        fieldType: newFieldType,
                        operator:
                          newOperators[0] || CustomFieldOperators.EQUALS,
                        value: "",
                      });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {caseFields.map((field) => (
                        <SelectItem key={field.id} value={field.id.toString()}>
                          {field.displayName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Operator selector */}
                  <Select
                    value={filter.operator}
                    onValueChange={(value) =>
                      updateFilter(index, {
                        operator: value as CustomFieldOperator,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {availableOperators.map((operator) => (
                        <SelectItem key={operator} value={operator}>
                          {t(`search.operators.${operator}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Value input */}
                  {renderValueInput(filter, index, field)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {localFilters.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">
          {t("search.noCustomFilters")}
        </p>
      )}
    </div>
  );
}
