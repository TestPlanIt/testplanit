"use client";

import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import DynamicIcon from "@/components/DynamicIcon";
import { SearchableEntityType } from "~/types/search";
import { getEntityLabel, getEntityIcon } from "~/hooks/useSearchContext";
import { cn, type ClassValue } from "~/utils";
import { useTranslations } from "next-intl";

interface EntityTypeSelectorProps {
  availableEntities: SearchableEntityType[];
  selectedEntities: SearchableEntityType[];
  onSelectionChange: (entities: SearchableEntityType[]) => void;
  className?: ClassValue;
}

export function EntityTypeSelector({
  availableEntities,
  selectedEntities,
  onSelectionChange,
  className,
}: EntityTypeSelectorProps) {
  const t = useTranslations();
  const [localSelection, setLocalSelection] =
    useState<SearchableEntityType[]>(selectedEntities);

  const toggleEntityType = (entityType: SearchableEntityType) => {
    const newSelection = localSelection.includes(entityType)
      ? localSelection.filter((e) => e !== entityType)
      : [...localSelection, entityType];

    // Don't allow deselecting all entities
    if (newSelection.length > 0) {
      setLocalSelection(newSelection);
      onSelectionChange(newSelection);
    }
  };

  const toggleAll = () => {
    if (localSelection.length === availableEntities.length) {
      // If all are selected, deselect all except the first one
      const newSelection = [availableEntities[0]];
      setLocalSelection(newSelection);
      onSelectionChange(newSelection);
    } else {
      // Select all
      setLocalSelection(availableEntities);
      onSelectionChange(availableEntities);
    }
  };

  const isAllSelected = localSelection.length === availableEntities.length;

  return (
    <div className={cn("space-y-3", className)}>
      <div className="space-y-3">
        {/* All types checkbox */}
        <div className="flex items-center space-x-2">
          <Checkbox
            id="all-types"
            checked={isAllSelected}
            onCheckedChange={toggleAll}
          />
          <Label
            htmlFor="all-types"
            className="text-sm font-medium cursor-pointer"
          >
            {t("search.allTypes")}
          </Label>
        </div>

        {/* Separator */}
        <div className="border-t pt-2" />

        {/* Individual entity type checkboxes */}
        <div className="space-y-2">
          {availableEntities.map((entityType) => (
            <div key={entityType} className="flex items-center space-x-2">
              <Checkbox
                id={`entity-${entityType}`}
                checked={localSelection.includes(entityType)}
                onCheckedChange={() => toggleEntityType(entityType)}
              />
              <Label
                htmlFor={`entity-${entityType}`}
                className="text-sm cursor-pointer flex items-center gap-2"
              >
                <DynamicIcon
                  name={
                    getEntityIcon(
                      entityType
                    ) as keyof typeof import("lucide-react/dynamicIconImports").default
                  }
                  className="h-4 w-4"
                />
                {getEntityLabel(entityType)}
              </Label>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
