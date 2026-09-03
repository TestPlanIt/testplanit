import DynamicIcon from "@/components/DynamicIcon";
import { MultiAsyncCombobox } from "@/components/ui/multi-async-combobox";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Bot,
  CircleDashed,
  FolderOpen,
  LayoutTemplate,
  LucideIcon,
  User,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, type ReactNode } from "react";
import type { AsyncOptionsFetcher } from "~/hooks/useAsyncComboboxOptions";
import { IconName } from "~/types/globals";
import { cn } from "~/utils";

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
  /** Custom row content for the generic renderer below — the requirement
   *  reports' Milestone/Configuration entries use it to show options the
   *  way the rest of the app's pickers do (type icon + source badge, the
   *  Combine icon). The row chrome (selection state, count, click) stays
   *  the generic renderer's. */
  renderOptionContent?: (option: FilterOption) => ReactNode;
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

/** Filter ids with a bespoke branch below; everything else uses the
 * generic renderer. */
const KNOWN_FILTER_IDS = new Set([
  "projects",
  "templates",
  "states",
  "automated",
]);

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
    <div className="flex flex-col w-full space-y-4 overflow-hidden p-0.5">
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
        // text-sm on the whole option list: the rows otherwise inherit the
        // page's base size and read oversized next to every other picker
        // (operator UAT).
        <div className="space-y-1 overflow-hidden text-sm">
          {/* Projects filter */}
          {selectedFilter === "projects" && (
            <>
              <div
                role="button"
                tabIndex={0}
                className={cn(
                  "w-full flex items-center justify-between text-start font-normal cursor-pointer hover:bg-accent hover:text-accent-foreground p-2 rounded-md",
                  isValueSelected("projects", null) &&
                    "bg-primary/20 hover:bg-primary/30"
                )}
                onClick={() => toggleFilterValue("projects", null)}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="truncate">{tFilters("allProjects")}</span>
                </div>
                <span className="text-sm text-muted-foreground shrink-0 ms-2 whitespace-nowrap">
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
                    "w-full flex items-center justify-between text-start font-normal cursor-pointer hover:bg-accent hover:text-accent-foreground p-2 rounded-md",
                    isValueSelected("projects", option.id) &&
                      "bg-primary/20 hover:bg-primary/30"
                  )}
                  onClick={() => toggleFilterValue("projects", option.id)}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
                    <FolderOpen className="w-4 h-4 shrink-0" />
                    <span className="truncate">{option.name}</span>
                  </div>
                  <span className="text-sm text-muted-foreground shrink-0 ms-2 whitespace-nowrap">
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
                  "w-full flex items-center justify-between text-start font-normal cursor-pointer hover:bg-accent hover:text-accent-foreground p-2 rounded-md",
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
                <span className="text-sm text-muted-foreground shrink-0 ms-2 whitespace-nowrap">
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
                    "w-full flex items-center justify-between text-start font-normal cursor-pointer hover:bg-accent hover:text-accent-foreground p-2 rounded-md",
                    isValueSelected("templates", option.id) &&
                      "bg-primary/20 hover:bg-primary/30"
                  )}
                  onClick={() => toggleFilterValue("templates", option.id)}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
                    <LayoutTemplate className="w-4 h-4 shrink-0" />
                    <span className="truncate">{option.name}</span>
                  </div>
                  <span className="text-sm text-muted-foreground shrink-0 ms-2 whitespace-nowrap">
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
                  "w-full flex items-center justify-between text-start font-normal cursor-pointer hover:bg-accent hover:text-accent-foreground p-2 rounded-md",
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
                <span className="text-sm text-muted-foreground shrink-0 ms-2 whitespace-nowrap">
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
                    "w-full flex items-center justify-between text-start font-normal cursor-pointer hover:bg-accent hover:text-accent-foreground p-2 rounded-md",
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
                  <span className="text-sm text-muted-foreground shrink-0 ms-2 whitespace-nowrap">
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
                  "w-full flex items-center justify-between text-start font-normal cursor-pointer hover:bg-accent hover:text-accent-foreground p-2 rounded-md",
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
                <span className="text-sm text-muted-foreground shrink-0 ms-2 whitespace-nowrap">
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
                      "w-full flex items-center justify-between text-start font-normal cursor-pointer hover:bg-accent hover:text-accent-foreground p-2 rounded-md",
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
                    <span className="text-sm text-muted-foreground shrink-0 ms-2 whitespace-nowrap">
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
                    "w-full flex items-center justify-between text-start font-normal cursor-pointer hover:bg-accent hover:text-accent-foreground p-2 rounded-md",
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
                  <span className="text-sm text-muted-foreground shrink-0 ms-2 whitespace-nowrap">
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
                        "w-full flex items-center justify-between text-start font-normal cursor-pointer hover:bg-accent hover:text-accent-foreground p-2 rounded-md",
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
                          "w-full flex items-center justify-between text-start font-normal cursor-pointer hover:bg-accent hover:text-accent-foreground p-2 rounded-md",
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
                        <span className="text-sm text-muted-foreground shrink-0 ms-2 whitespace-nowrap">
                          {option.count || 0}
                        </span>
                      </div>
                    ))}
                  </>
                )}
              </>
            )}

          {/* Every other filter picks its values through the shared
              MultiAsyncCombobox — the same searchable multi-select every
              picker in the app uses (operator direction) — instead of a
              page-length inline list. Selection state still flows through
              the exact `selectedValues`/`onValuesChange` contract; an
              emptied selection clears the axis (the old "All values" row). */}
          {!KNOWN_FILTER_IDS.has(selectedFilter) &&
            !selectedFilter.startsWith("dynamic_") && (
              <GenericFilterValuePicker
                key={selectedFilter}
                filterItem={selectedFilterItem}
                selected={selectedValues[selectedFilter] ?? []}
                onChange={(next) =>
                  onValuesChange(selectedFilter, next.length > 0 ? next : null)
                }
                placeholder={tFilters("allValues")}
              />
            )}
        </div>
      )}
    </div>
  );
}

/**
 * The generic filter types' value picker: the shared MultiAsyncCombobox
 * over the item's in-memory option list. Custom row content (the
 * requirement reports' Milestone/Configuration presentation) comes
 * through `FilterItem.renderOptionContent`; everything else renders the
 * plain name with its right-aligned count, matching the combobox default
 * everywhere else in the app.
 */
function GenericFilterValuePicker({
  filterItem,
  selected,
  onChange,
  placeholder,
}: {
  filterItem: FilterItem;
  selected: Array<string | number>;
  onChange: (next: Array<string | number>) => void;
  placeholder: string;
}) {
  const options = useMemo(() => filterItem.options ?? [], [filterItem]);
  const fetchOptions = useMemo<AsyncOptionsFetcher<FilterOption>>(
    () => async (query, page, pageSize) => {
      const lower = query.toLowerCase();
      const filtered = lower
        ? options.filter((option) => option.name.toLowerCase().includes(lower))
        : options;
      const start = page * pageSize;
      return {
        results: filtered.slice(start, start + pageSize),
        total: filtered.length,
      };
    },
    [options]
  );
  // A selected id whose option is gone (a value list that changed under a
  // restored share) still renders as its raw value rather than vanishing
  // from the trigger while staying active in the request.
  const selectedOptions = useMemo(
    () =>
      selected.map(
        (id) =>
          options.find((option) => option.id === id) ?? {
            id,
            name: String(id),
          }
      ),
    [selected, options]
  );

  return (
    <span data-testid={`report-filter-values-${filterItem.id}`}>
      <MultiAsyncCombobox<FilterOption>
        value={selectedOptions}
        onValueChange={(next) =>
          onChange(next.map((option) => option.id as string | number))
        }
        fetchOptions={fetchOptions}
        getOptionValue={(option) => option.id as string | number}
        getOptionLabel={(option) => option.name}
        renderOption={(option) =>
          filterItem.renderOptionContent ? (
            filterItem.renderOptionContent(option)
          ) : (
            <span className="flex min-w-0 flex-1 items-center">
              <span className="min-w-0 flex-1 truncate">{option.name}</span>
              {option.count !== undefined && (
                <span className="ms-2 text-xs text-muted-foreground">
                  {option.count}
                </span>
              )}
            </span>
          )
        }
        placeholder={placeholder}
        ariaLabel={filterItem.name}
        className="min-h-8 w-full text-sm"
        dropdownClassName="p-0 min-w-[280px] max-w-[420px]"
      />
    </span>
  );
}
