import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import DynamicIcon from "@/components/DynamicIcon";
import { IconName } from "~/types/globals";
import { useTranslations } from "next-intl";

interface FilterChip {
  filterType: string;
  filterName: string;
  valueId: string | number;
  valueName: string;
  icon?: { name: string } | null;
  iconColor?: { value: string } | null;
}

interface ReportFilterChipsProps {
  activeFilters: FilterChip[];
  onRemoveFilter: (filterType: string, valueId: string | number) => void;
  onClearAll: () => void;
}

export function ReportFilterChips({
  activeFilters,
  onRemoveFilter,
  onClearAll,
}: ReportFilterChipsProps) {
  const tReports = useTranslations("reports.ui");
  const tGlobal = useTranslations();

  if (activeFilters.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 items-center">
      <span className="text-sm text-muted-foreground">
        {tReports("activeFilters")}
      </span>
      {activeFilters.map((filter, index) => (
        <Badge
          key={`${filter.filterType}-${filter.valueId}-${index}`}
          variant="secondary"
          className="pl-2 pr-1 py-1 gap-1.5"
        >
          <div className="flex items-center gap-1.5">
            {filter.icon && (
              <DynamicIcon
                name={filter.icon.name as IconName}
                className="w-3 h-3"
                color={filter.iconColor?.value}
              />
            )}
            <span className="text-xs">
              {filter.filterName}: {filter.valueName}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-4 w-4 p-0 hover:bg-transparent"
            onClick={() => onRemoveFilter(filter.filterType, filter.valueId)}
          >
            <X className="h-3 w-3" />
          </Button>
        </Badge>
      ))}
      {activeFilters.length > 1 && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs"
          onClick={onClearAll}
        >
          {tGlobal("common.actions.clearAll")}
        </Button>
      )}
    </div>
  );
}
