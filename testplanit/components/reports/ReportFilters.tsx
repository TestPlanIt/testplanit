import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { IconName } from "~/types/globals";
import {
  LucideIcon,
  LayoutTemplate,
  CircleDashed,
  Bot,
  User,
  FolderOpen,
} from "lucide-react";
import { cn } from "~/utils";
import DynamicIcon from "@/components/DynamicIcon";
import { useTranslations } from "next-intl";
import { useCallback } from "react";

interface FilterOption {
  id: string | number | null;
  name: string;
  icon?: { name: string } | null;
  iconColor?: { value: string } | null;
  count?: number;
}

interface FilterItem {
  id: string;
  name: string;
  icon: LucideIcon;
  options?: FilterOption[];
  field?: {
    type: string;
    fieldId: number;
    options?: Array<{
      id: number;
      name: string;
      icon?: { name: string } | null;
      iconColor?: { value: string } | null;
      count?: number;
    }>;
  };
}

interface ReportFiltersProps {
  selectedFilter: string;
  onFilterChange: (value: string) => void;
  filterItems: FilterItem[];
  selectedValues: Record<string, Array<string | number>>;
  onValuesChange: (
    filterType: string,
    values: Array<string | number> | null
  ) => void;
  totalCount?: number;
}

export function ReportFilters({
  selectedFilter,
  onFilterChange,
  filterItems,
  selectedValues,
  onValuesChange,
  totalCount = 0,
}: ReportFiltersProps) {
  const tFilters = useTranslations("reports.ui.filters");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");

  // Helper function to check if a value is selected
  const isValueSelected = useCallback(
    (filterType: string, value: string | number | null) => {
      const values = selectedValues[filterType];
      if (!values || values.length === 0) return value === null;
      if (value === null) return false;
      return values.includes(value);
    },
    [selectedValues]
  );

  // Helper function to toggle a filter value
  const toggleFilterValue = useCallback(
    (filterType: string, value: string | number | null) => {
      if (value === null) {
        // Clicking "All" - clear this filter type
        onValuesChange(filterType, null);
        return;
      }

      const currentValues = selectedValues[filterType] || [];
      const valueIndex = currentValues.findIndex((v) => v === value);

      if (valueIndex >= 0) {
        // Value already selected, remove it
        const newValues = currentValues.filter((v) => v !== value);
        onValuesChange(filterType, newValues.length > 0 ? newValues : null);
      } else {
        // Value not selected, add it
        onValuesChange(filterType, [...currentValues, value]);
      }
    },
    [selectedValues, onValuesChange]
  );

  // Check if a filter type has any active selections
  const hasActiveFilter = useCallback(
    (filterType: string) => {
      return (
        selectedValues[filterType] && selectedValues[filterType].length > 0
      );
    },
    [selectedValues]
  );

  // Get the selected filter item
  const selectedFilterItem = filterItems.find(
    (item) => item.id === selectedFilter
  );

  return (
    <div className="flex flex-col w-full space-y-4 overflow-hidden">
      <Select value={selectedFilter} onValueChange={onFilterChange}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder={tFilters("selectFilter")} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {filterItems.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                <div className="flex items-center space-x-2">
                  <item.icon className="w-4 h-4" />
                  <div className="flex items-center gap-2">
                    {item.name}
                    {hasActiveFilter(item.id) && (
                      <span className="text-xs bg-primary text-primary-foreground rounded-full px-1.5 py-0.5">
                        {selectedValues[item.id].length}
                      </span>
                    )}
                  </div>
                </div>
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      {selectedFilterItem && (
        <div className="space-y-1 overflow-hidden">
          {/* Projects filter */}
          {selectedFilter === "projects" && (
            <>
              <div
                role="button"
                tabIndex={0}
                className={cn(
                  "w-full flex items-center justify-between text-left font-normal cursor-pointer hover:bg-accent hover:text-accent-foreground p-2 rounded-md",
                  isValueSelected("projects", null) &&
                    "bg-primary/20 hover:bg-primary/30"
                )}
                onClick={() => toggleFilterValue("projects", null)}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="truncate">{tFilters("allProjects")}</span>
                </div>
                <span className="text-sm text-muted-foreground shrink-0 ml-2 whitespace-nowrap">
                  {selectedFilterItem.options?.reduce(
                    (sum, option) => sum + (option.count || 0),
                    0
                  )}
                </span>
              </div>
              {selectedFilterItem.options?.map((option) => (
                <div
                  role="button"
                  tabIndex={0}
                  key={option.id}
                  className={cn(
                    "w-full flex items-center justify-between text-left font-normal cursor-pointer hover:bg-accent hover:text-accent-foreground p-2 rounded-md",
                    isValueSelected("projects", option.id) &&
                      "bg-primary/20 hover:bg-primary/30"
                  )}
                  onClick={() => toggleFilterValue("projects", option.id)}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
                    <FolderOpen className="w-4 h-4 shrink-0" />
                    <span className="truncate">{option.name}</span>
                  </div>
                  <span className="text-sm text-muted-foreground shrink-0 ml-2 whitespace-nowrap">
                    {option.count || 0}
                  </span>
                </div>
              ))}
            </>
          )}

          {/* Templates filter */}
          {selectedFilter === "templates" && (
            <>
              <div
                role="button"
                tabIndex={0}
                className={cn(
                  "w-full flex items-center justify-between text-left font-normal cursor-pointer hover:bg-accent hover:text-accent-foreground p-2 rounded-md",
                  isValueSelected("templates", null) &&
                    "bg-primary/20 hover:bg-primary/30"
                )}
                onClick={() => toggleFilterValue("templates", null)}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="truncate">
                    {tGlobal("repository.views.allTemplates")}
                  </span>
                </div>
                <span className="text-sm text-muted-foreground shrink-0 ml-2 whitespace-nowrap">
                  {selectedFilterItem.options?.reduce(
                    (sum, option) => sum + (option.count || 0),
                    0
                  )}
                </span>
              </div>
              {selectedFilterItem.options?.map((option) => (
                <div
                  role="button"
                  tabIndex={0}
                  key={option.id}
                  className={cn(
                    "w-full flex items-center justify-between text-left font-normal cursor-pointer hover:bg-accent hover:text-accent-foreground p-2 rounded-md",
                    isValueSelected("templates", option.id) &&
                      "bg-primary/20 hover:bg-primary/30"
                  )}
                  onClick={() => toggleFilterValue("templates", option.id)}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
                    <LayoutTemplate className="w-4 h-4 shrink-0" />
                    <span className="truncate">{option.name}</span>
                  </div>
                  <span className="text-sm text-muted-foreground shrink-0 ml-2 whitespace-nowrap">
                    {option.count || 0}
                  </span>
                </div>
              ))}
            </>
          )}

          {/* States filter */}
          {selectedFilter === "states" && (
            <>
              <div
                role="button"
                tabIndex={0}
                className={cn(
                  "w-full flex items-center justify-between text-left font-normal cursor-pointer hover:bg-accent hover:text-accent-foreground p-2 rounded-md",
                  isValueSelected("states", null) &&
                    "bg-primary/20 hover:bg-primary/30"
                )}
                onClick={() => toggleFilterValue("states", null)}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="truncate">
                    {tGlobal("repository.views.allStates")}
                  </span>
                </div>
                <span className="text-sm text-muted-foreground shrink-0 ml-2 whitespace-nowrap">
                  {selectedFilterItem.options?.reduce(
                    (sum, option) => sum + (option.count || 0),
                    0
                  )}
                </span>
              </div>
              {selectedFilterItem.options?.map((option) => (
                <div
                  role="button"
                  tabIndex={0}
                  key={option.id}
                  className={cn(
                    "w-full flex items-center justify-between text-left font-normal cursor-pointer hover:bg-accent hover:text-accent-foreground p-2 rounded-md",
                    isValueSelected("states", option.id) &&
                      "bg-primary/20 hover:bg-primary/30"
                  )}
                  onClick={() => toggleFilterValue("states", option.id)}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
                    <DynamicIcon
                      name={option.icon?.name as IconName}
                      className="w-4 h-4 shrink-0"
                      color={option.iconColor?.value}
                    />
                    <span className="truncate">{option.name}</span>
                  </div>
                  <span className="text-sm text-muted-foreground shrink-0 ml-2 whitespace-nowrap">
                    {option.count || 0}
                  </span>
                </div>
              ))}
            </>
          )}

          {/* Automated filter */}
          {selectedFilter === "automated" && (
            <>
              <div
                role="button"
                tabIndex={0}
                className={cn(
                  "w-full flex items-center justify-between text-left font-normal cursor-pointer hover:bg-accent hover:text-accent-foreground p-2 rounded-md",
                  isValueSelected("automated", null) &&
                    "bg-primary/20 hover:bg-primary/30"
                )}
                onClick={() => toggleFilterValue("automated", null)}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="truncate">
                    {tGlobal("repository.views.allCases")}
                  </span>
                </div>
                <span className="text-sm text-muted-foreground shrink-0 ml-2 whitespace-nowrap">
                  {totalCount}
                </span>
              </div>
              {selectedFilterItem.options?.map((option) => {
                // Expect numeric values (1 for automated, 0 for manual)
                const isAutomated = option.id === 1;
                return (
                  <div
                    role="button"
                    tabIndex={0}
                    key={String(option.id)}
                    className={cn(
                      "w-full flex items-center justify-between text-left font-normal cursor-pointer hover:bg-accent hover:text-accent-foreground p-2 rounded-md",
                      isValueSelected("automated", option.id) &&
                        "bg-primary/20 hover:bg-primary/30"
                    )}
                    onClick={() => toggleFilterValue("automated", option.id)}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
                      {isAutomated ? (
                        <Bot className="w-4 h-4 shrink-0" />
                      ) : (
                        <User className="w-4 h-4 shrink-0" />
                      )}
                      <span className="truncate">{option.name}</span>
                    </div>
                    <span className="text-sm text-muted-foreground shrink-0 ml-2 whitespace-nowrap">
                      {option.count || 0}
                    </span>
                  </div>
                );
              })}
            </>
          )}

          {/* Dynamic fields (e.g., Priority) */}
          {selectedFilter.startsWith("dynamic_") &&
            selectedFilterItem.field && (
              <>
                <div
                  role="button"
                  tabIndex={0}
                  className={cn(
                    "w-full flex items-center justify-between text-left font-normal cursor-pointer hover:bg-accent hover:text-accent-foreground p-2 rounded-md",
                    isValueSelected(selectedFilter, null) &&
                      "bg-primary/20 hover:bg-primary/30"
                  )}
                  onClick={() => toggleFilterValue(selectedFilter, null)}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="truncate">
                      {tGlobal("common.fields.mixed")}
                    </span>
                  </div>
                  <span className="text-sm text-muted-foreground shrink-0 ml-2 whitespace-nowrap">
                    {totalCount}
                  </span>
                </div>

                {/* None option for optional fields */}
                {selectedFilterItem.field.options && (
                  <>
                    <div
                      role="button"
                      tabIndex={0}
                      key="none-option"
                      className={cn(
                        "w-full flex items-center justify-between text-left font-normal cursor-pointer hover:bg-accent hover:text-accent-foreground p-2 rounded-md",
                        isValueSelected(selectedFilter, "none") &&
                          "bg-primary/20 hover:bg-primary/30"
                      )}
                      onClick={() => toggleFilterValue(selectedFilter, "none")}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <CircleDashed className="w-4 h-4 shrink-0 opacity-40" />
                        <span className="truncate">
                          {tCommon("access.none")}
                        </span>
                      </div>
                    </div>

                    {selectedFilterItem.field.options.map((option) => (
                      <div
                        role="button"
                        tabIndex={0}
                        key={`option-${option.id}`}
                        className={cn(
                          "w-full flex items-center justify-between text-left font-normal cursor-pointer hover:bg-accent hover:text-accent-foreground p-2 rounded-md",
                          isValueSelected(selectedFilter, option.id) &&
                            "bg-primary/20 hover:bg-primary/30"
                        )}
                        onClick={() =>
                          toggleFilterValue(selectedFilter, option.id)
                        }
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
                          {option.icon && (
                            <DynamicIcon
                              name={option.icon.name as IconName}
                              className="w-4 h-4 shrink-0"
                              color={option.iconColor?.value}
                            />
                          )}
                          <span className="truncate">{option.name}</span>
                        </div>
                        <span className="text-sm text-muted-foreground shrink-0 ml-2 whitespace-nowrap">
                          {option.count || 0}
                        </span>
                      </div>
                    ))}
                  </>
                )}
              </>
            )}
        </div>
      )}
    </div>
  );
}
