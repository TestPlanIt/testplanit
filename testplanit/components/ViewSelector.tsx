import DynamicIcon from "@/components/DynamicIcon";
import { UserNameCell } from "@/components/tables/UserNameCell";
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Bot,
  CircleCheckBig,
  CircleDashed,
  FileX,
  LayoutTemplate,
  LucideIcon,
  Paperclip,
  Square,
  SquareStack,
  User,
  Users,
  UserX,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo } from "react";
import { dynamicFieldDimensionKey } from "~/lib/repository/filterDimensions";
import { IconName } from "~/types/globals";
import { cn } from "~/utils";

/**
 * Grouping control for the repository/run case list: the "View by" axis
 * Select plus per-option rows with counts. Filtering state lives in the
 * FilterBar's predicates (useRepositoryFilters) — clicking an option row
 * toggles that value in the dimension's row-click predicate via
 * `onToggleFilterValue`, and a row highlights while `isFilterValueActive`
 * says its value is in an active predicate. Axis switching never touches
 * predicates.
 */

interface ViewItem {
  id: string;
  name: string;
  icon: LucideIcon;
  options?: Array<{
    id: string | number | null;
    name: string;
    icon?: { name: string } | null;
    iconColor?: { value: string } | null;
    count?: number;
  }>;
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
    values?: Set<any>;
  };
}

interface ViewSelectorProps {
  selectedItem: string;
  onValueChange: (value: string) => void;
  viewItems: ViewItem[];
  /** Whether a row's value is in an active predicate (null = the "All" row,
   * active while the dimension is unfiltered). */
  isFilterValueActive: (
    dimension: string,
    value: string | number | null
  ) => boolean;
  /** Toggles a row's value in the dimension's row-click predicate
   * (null = the "All" row, which clears the dimension's row-click chips). */
  onToggleFilterValue: (
    dimension: string,
    value: string | number | null
  ) => void;
  isRunMode?: boolean;
  totalCount: number;
  /** Interim rule (spec §13): sidebar counts are filter-blind until the
   * counts engine ships — mute them while any predicate is active. */
  countsMuted?: boolean;
  viewOptions?: {
    templates: Array<{ id: number; name: string; count?: number }>;
    states: Array<{
      id: number;
      name: string;
      count?: number;
      icon?: { name: string } | null;
      iconColor?: { value: string } | null;
    }>;
    creators: Array<{ id: string; name: string; count?: number }>;
    automated: Array<{ value: boolean; count: number }>;
    parameterized: Array<{ value: boolean; count: number }>;
    attachments: Array<{ value: boolean; count: number }>;
    dynamicFields: Record<string, any>;
    tags?: Array<{
      id: number | string;
      name: string;
      count?: number;
    }>;
    issues?: Array<{
      id: number | string;
      name: string;
      count?: number;
    }>;
    testRunOptions?: {
      statuses: Array<{
        id: number;
        name: string;
        color?: { value: string };
        count: number;
      }>;
      assignedTo: Array<{ id: string; name: string; count: number }>;
      untestedCount: number;
      unassignedCount: number;
      totalCount: number;
    };
  };
}

// Above this many options the flat row list becomes unusable, so the axis
// switches to the searchable multi-select used elsewhere in the app.
const SEARCHABLE_OPTION_THRESHOLD = 10;

const COMBOBOX_PAGE_SIZE = 20;

interface FilterListOption {
  id: string | number;
  name: string;
  count?: number;
  icon?: { name: string } | null;
  iconColor?: { value: string } | null;
  color?: { value: string } | null;
}

function FilterRow({
  selected,
  onClick,
  count,
  children,
}: {
  selected: boolean;
  onClick: (event: React.MouseEvent) => void;
  count?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        "w-full flex items-center justify-between text-start text-sm font-normal cursor-pointer hover:bg-accent hover:text-accent-foreground p-2 rounded-md",
        selected && "bg-primary/20 hover:bg-primary/30"
      )}
      onClick={onClick}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">{children}</div>
      {count !== undefined && (
        <span className="text-xs text-muted-foreground shrink-0 ms-2 whitespace-nowrap">
          {count}
        </span>
      )}
    </div>
  );
}

interface FilterOptionListProps {
  options: FilterListOption[];
  isValueSelected: (value: string | number) => boolean;
  onOptionClick: (value: string | number) => void;
  renderCount: (count?: number) => React.ReactNode;
  renderOptionLabel?: (option: FilterListOption) => React.ReactNode;
  placeholder: string;
}

/**
 * Renders the filter options for the selected view axis. Short lists stay as
 * clickable rows; long lists render the shared MultiAsyncCombobox so they can
 * be searched and paged through.
 */
function FilterOptionList({
  options,
  isValueSelected,
  onOptionClick,
  renderCount,
  renderOptionLabel,
  placeholder,
}: FilterOptionListProps) {
  const renderLabel = useCallback(
    (option: FilterListOption) =>
      renderOptionLabel ? (
        renderOptionLabel(option)
      ) : (
        <>
          {option.icon && (
            <DynamicIcon
              name={option.icon.name as IconName}
              className="w-4 h-4 shrink-0"
              color={option.iconColor?.value}
            />
          )}
          <span className="truncate">{option.name}</span>
        </>
      ),
    [renderOptionLabel]
  );

  const selectedOptions = useMemo(
    () => options.filter((option) => isValueSelected(option.id)),
    [options, isValueSelected]
  );

  const fetchOptions = useCallback(
    (query: string, page: number, pageSize: number) => {
      const search = query.trim().toLowerCase();
      const matches = search
        ? options.filter((option) => option.name.toLowerCase().includes(search))
        : options;
      return Promise.resolve({
        results: matches.slice(page * pageSize, page * pageSize + pageSize),
        total: matches.length,
      });
    },
    [options]
  );

  const handleComboboxChange = useCallback(
    (selected: FilterListOption[]) => {
      // Diff against the active set and toggle each changed value. The
      // combobox has no select-all (hideSelectAll), so changes arrive one
      // value at a time.
      const next = new Set(selected.map((option) => option.id));
      for (const option of options) {
        if (isValueSelected(option.id) !== next.has(option.id)) {
          onOptionClick(option.id);
        }
      }
    },
    [options, isValueSelected, onOptionClick]
  );

  if (options.length <= SEARCHABLE_OPTION_THRESHOLD) {
    return (
      <>
        {options.map((option) => (
          <FilterRow
            key={option.id}
            selected={isValueSelected(option.id)}
            onClick={() => onOptionClick(option.id)}
            count={renderCount(option.count)}
          >
            {renderLabel(option)}
          </FilterRow>
        ))}
      </>
    );
  }

  return (
    <div className="py-1" data-testid="view-filter-combobox">
      <MultiAsyncCombobox<FilterListOption>
        value={selectedOptions}
        onValueChange={handleComboboxChange}
        fetchOptions={fetchOptions}
        renderOption={(option) => (
          <div className="flex items-center justify-between w-full min-w-0 gap-2">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {renderLabel(option)}
            </div>
            <span className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">
              {renderCount(option.count)}
            </span>
          </div>
        )}
        renderSelectedOption={(option) => (
          <span className="truncate">{option.name}</span>
        )}
        getOptionValue={(option) => option.id}
        getOptionLabel={(option) => option.name}
        placeholder={placeholder}
        pageSize={COMBOBOX_PAGE_SIZE}
        hideSelectAll
      />
    </div>
  );
}

export function ViewSelector({
  selectedItem,
  onValueChange,
  viewItems,
  isFilterValueActive,
  onToggleFilterValue,
  isRunMode: _isRunMode,
  totalCount,
  countsMuted = false,
  viewOptions,
}: ViewSelectorProps) {
  const t = useTranslations("repository");
  const tCommon = useTranslations("common");
  const tFilterBar = useTranslations("repository.filterBar");

  // The filter dimension the selected axis maps to: `field_<id>` for dynamic
  // axes, the axis id otherwise ("folders" has no rows).
  const dimensionKey = useMemo(() => {
    if (!selectedItem.startsWith("dynamic_")) return selectedItem;
    const fieldId = parseInt(selectedItem.split("_")[1]);
    return Number.isNaN(fieldId)
      ? selectedItem
      : dynamicFieldDimensionKey(fieldId);
  }, [selectedItem]);

  const isValueSelected = useCallback(
    (value: string | number | null) => isFilterValueActive(dimensionKey, value),
    [isFilterValueActive, dimensionKey]
  );

  const handleFilterClick = useCallback(
    (value: string | number | null) => {
      onToggleFilterValue(dimensionKey, value);
    },
    [onToggleFilterValue, dimensionKey]
  );

  // Interim de-emphasis while chips are active (spec §13): the sidebar counts
  // are filter-blind until the filter-aware counts engine ships.
  const renderCount = useCallback(
    (count?: number): React.ReactNode => {
      const shown = count ?? 0;
      if (!countsMuted) return shown;
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="opacity-50 cursor-help">{shown}</span>
          </TooltipTrigger>
          <TooltipContent>{tFilterBar("countsIgnoreFilters")}</TooltipContent>
        </Tooltip>
      );
    },
    [countsMuted, tFilterBar]
  );

  const listProps = {
    isValueSelected: (value: string | number) => isValueSelected(value),
    onOptionClick: (value: string | number) => handleFilterClick(value),
    renderCount,
    placeholder: tCommon("search"),
  };

  const templateOptions = useMemo<FilterListOption[]>(
    () => viewOptions?.templates ?? [],
    [viewOptions?.templates]
  );

  const stateOptions = useMemo<FilterListOption[]>(
    () => viewOptions?.states ?? [],
    [viewOptions?.states]
  );

  const creatorOptions = useMemo<FilterListOption[]>(
    () => viewOptions?.creators ?? [],
    [viewOptions?.creators]
  );

  const statusOptions = useMemo<FilterListOption[]>(
    () =>
      (
        (viewItems.find((item) => item.id === "status")?.options ??
          []) as FilterListOption[]
      ).filter((option) => option.id != null && option.id !== "untested"),
    [viewItems]
  );

  const assignedToOptions = useMemo<FilterListOption[]>(
    () =>
      (
        (viewItems.find((item) => item.id === "assignedTo")?.options ??
          []) as FilterListOption[]
      ).filter(
        (option) => option.id !== "unassigned" && typeof option.id === "string"
      ),
    [viewItems]
  );

  // Tag/issue axes ship "Any"/"None" sentinels alongside the real values; keep
  // those pinned as rows so they stay one click away.
  const [pinnedTagOptions, tagOptions] = useMemo(() => {
    const all = (
      (viewItems.find((item) => item.id === "tags")?.options ??
        []) as FilterListOption[]
    ).filter((option) => option.id != null);
    return [
      all.filter((option) => option.id === "any" || option.id === "none"),
      all.filter((option) => option.id !== "any" && option.id !== "none"),
    ] as const;
  }, [viewItems]);

  const [pinnedIssueOptions, issueOptions] = useMemo(() => {
    const all = (
      (viewItems.find((item) => item.id === "issues")?.options ??
        []) as FilterListOption[]
    ).filter((option) => option.id != null);
    return [
      all.filter((option) => option.id === "any" || option.id === "none"),
      all.filter((option) => option.id !== "any" && option.id !== "none"),
    ] as const;
  }, [viewItems]);

  // Parse the dynamic field ID format: "dynamic_{fieldId}_{fieldType}"
  const dynamicField = useMemo(() => {
    if (!selectedItem.startsWith("dynamic_")) return undefined;
    const numericFieldId = parseInt(selectedItem.split("_")[1]);
    return Object.values(viewOptions?.dynamicFields || {}).find(
      (field) => field.fieldId === numericFieldId
    );
  }, [selectedItem, viewOptions?.dynamicFields]);

  const dynamicFieldOptions = useMemo<FilterListOption[]>(
    () => dynamicField?.options ?? [],
    [dynamicField]
  );

  return (
    <div className="flex flex-col pt-0.5     w-full">
      <Select value={selectedItem} onValueChange={onValueChange}>
        <SelectTrigger
          className="me-6 ms-1 text-primary text-lg md:text-xl font-extrabold"
          data-testid="view-selector-trigger"
        >
          <SelectValue placeholder={tCommon("placeholders.selectOption")} />
        </SelectTrigger>
        <SelectContent className="text-primary text-lg md:text-xl font-extrabold">
          <SelectGroup>
            {viewItems.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                <div className="flex items-center space-x-1">
                  <item.icon className="w-5 h-5 min-w-5 min-h-5" />
                  <div>{item.name}</div>
                </div>
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      <div className="px-4 space-y-1 pt-2">
        {selectedItem === "templates" && (
          <>
            <FilterRow
              selected={isValueSelected(null)}
              onClick={() => handleFilterClick(null)}
              count={renderCount(
                templateOptions.reduce(
                  (sum, template) => sum + (template.count || 0),
                  0
                )
              )}
            >
              <span className="truncate">{t("views.allTemplates")}</span>
            </FilterRow>
            <FilterOptionList
              {...listProps}
              options={templateOptions}
              renderOptionLabel={(option) => (
                <>
                  <LayoutTemplate className="w-4 h-4 shrink-0" />
                  <span className="truncate">{option.name}</span>
                </>
              )}
            />
          </>
        )}

        {selectedItem === "states" && (
          <>
            <FilterRow
              selected={isValueSelected(null)}
              onClick={() => handleFilterClick(null)}
              count={renderCount(
                stateOptions.reduce((sum, state) => sum + (state.count || 0), 0)
              )}
            >
              <span className="truncate">{t("views.allStates")}</span>
            </FilterRow>
            <FilterOptionList {...listProps} options={stateOptions} />
          </>
        )}

        {selectedItem === "creators" && (
          <>
            <FilterRow
              selected={isValueSelected(null)}
              onClick={() => handleFilterClick(null)}
              count={renderCount(
                creatorOptions.reduce(
                  (sum, creator) => sum + (creator.count || 0),
                  0
                )
              )}
            >
              <Users className="w-4 h-4 shrink-0" />
              <span className="truncate">{t("views.allCreators")}</span>
            </FilterRow>
            <FilterOptionList
              {...listProps}
              options={creatorOptions}
              renderOptionLabel={(option) => (
                <UserNameCell userId={String(option.id)} hideLink={true} />
              )}
            />
          </>
        )}

        {selectedItem === "automated" && (
          <>
            <FilterRow
              selected={isValueSelected(null)}
              onClick={() => handleFilterClick(null)}
              count={renderCount(totalCount)}
            >
              <span className="truncate">{t("views.allCases")}</span>
            </FilterRow>
            {viewOptions?.automated.map(
              (item: { value: boolean; count: number }) => (
                <FilterRow
                  key={item.value.toString()}
                  selected={isValueSelected(item.value ? 1 : 0)}
                  onClick={() => handleFilterClick(item.value ? 1 : 0)}
                  count={renderCount(item.count)}
                >
                  {item.value ? (
                    <Bot className="w-4 h-4 shrink-0" />
                  ) : (
                    <User className="w-4 h-4 shrink-0" />
                  )}
                  <span className="truncate">
                    {item.value
                      ? tCommon("fields.automated")
                      : tCommon("fields.notAutomated")}
                  </span>
                </FilterRow>
              )
            )}
          </>
        )}

        {selectedItem === "parameterized" && (
          <>
            <FilterRow
              selected={isValueSelected(null)}
              onClick={() => handleFilterClick(null)}
              count={renderCount(totalCount)}
            >
              <span className="truncate">{t("views.allCases")}</span>
            </FilterRow>
            {viewOptions?.parameterized?.map(
              (item: { value: boolean; count: number }) => (
                <FilterRow
                  key={item.value.toString()}
                  selected={isValueSelected(item.value ? 1 : 0)}
                  onClick={() => handleFilterClick(item.value ? 1 : 0)}
                  count={renderCount(item.count)}
                >
                  {item.value ? (
                    <SquareStack className="w-4 h-4 shrink-0 text-primary" />
                  ) : (
                    <Square className="w-4 h-4 shrink-0" />
                  )}
                  <span className="truncate">
                    {item.value
                      ? tCommon("fields.parameterized")
                      : tCommon("fields.notParameterized")}
                  </span>
                </FilterRow>
              )
            )}
          </>
        )}

        {selectedItem === "attachments" && (
          <>
            <FilterRow
              selected={isValueSelected(null)}
              onClick={() => handleFilterClick(null)}
              count={renderCount(totalCount)}
            >
              <span className="truncate">{t("views.allCases")}</span>
            </FilterRow>
            {viewOptions?.attachments?.map(
              (item: { value: boolean; count: number }) => (
                <FilterRow
                  key={item.value.toString()}
                  selected={isValueSelected(item.value ? 1 : 0)}
                  onClick={() => handleFilterClick(item.value ? 1 : 0)}
                  count={renderCount(item.count)}
                >
                  {item.value ? (
                    <Paperclip className="w-4 h-4 shrink-0 text-primary" />
                  ) : (
                    <FileX className="w-4 h-4 shrink-0 opacity-60" />
                  )}
                  <span className="truncate">
                    {item.value
                      ? tCommon("fields.hasAttachments")
                      : tCommon("fields.noAttachments")}
                  </span>
                </FilterRow>
              )
            )}
          </>
        )}

        {selectedItem === "status" && (
          <>
            <FilterRow
              selected={isValueSelected(null)}
              onClick={() => handleFilterClick(null)}
              count={renderCount(
                (viewOptions as any)?.testRunOptions?.totalCount || totalCount
              )}
            >
              <CircleCheckBig className="w-4 h-4 shrink-0" />
              <span className="truncate">{tCommon("filters.allStatuses")}</span>
            </FilterRow>
            <FilterRow
              selected={isValueSelected("untested")}
              onClick={() => handleFilterClick("untested")}
              count={renderCount(
                (viewOptions as any)?.testRunOptions?.untestedCount || 0
              )}
            >
              <div
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: "#B1B2B3" }}
              />
              <span className="truncate">{tCommon("labels.untested")}</span>
            </FilterRow>
            <FilterOptionList
              {...listProps}
              options={statusOptions}
              renderOptionLabel={(option) => (
                <>
                  <div
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{
                      backgroundColor: option.color?.value || "#B1B2B3",
                    }}
                  />
                  <span className="truncate">{option.name}</span>
                </>
              )}
            />
          </>
        )}

        {selectedItem === "assignedTo" && (
          <>
            <FilterRow
              selected={isValueSelected(null)}
              onClick={() => handleFilterClick(null)}
              count={renderCount(
                (viewOptions as any)?.testRunOptions?.totalCount || totalCount
              )}
            >
              <Users className="w-4 h-4 shrink-0" />
              <span className="truncate">{t("views.allAssignees")}</span>
            </FilterRow>
            <FilterRow
              selected={isValueSelected("unassigned")}
              onClick={() => handleFilterClick("unassigned")}
              count={renderCount(
                (viewOptions as any)?.testRunOptions?.unassignedCount || 0
              )}
            >
              <UserX className="w-4 h-4 shrink-0" />
              <span className="truncate">{tCommon("labels.unassigned")}</span>
            </FilterRow>
            <FilterOptionList
              {...listProps}
              options={assignedToOptions}
              renderOptionLabel={(option) => (
                <UserNameCell userId={String(option.id)} hideLink={true} />
              )}
            />
          </>
        )}

        {selectedItem === "tags" && (
          <>
            {pinnedTagOptions.map((option) => (
              <FilterRow
                key={option.id}
                selected={isValueSelected(option.id)}
                onClick={() => handleFilterClick(option.id)}
                count={renderCount(option.count)}
              >
                <span className="truncate">{option.name}</span>
              </FilterRow>
            ))}
            <FilterOptionList {...listProps} options={tagOptions} />
          </>
        )}

        {selectedItem === "issues" && (
          <>
            {pinnedIssueOptions.map((option) => (
              <FilterRow
                key={option.id}
                selected={isValueSelected(option.id)}
                onClick={() => handleFilterClick(option.id)}
                count={renderCount(option.count)}
              >
                <span className="truncate">{option.name}</span>
              </FilterRow>
            ))}
            <FilterOptionList {...listProps} options={issueOptions} />
          </>
        )}

        {selectedItem.startsWith("dynamic_") && (
          <>
            <FilterRow
              selected={isValueSelected(null)}
              onClick={() => handleFilterClick(null)}
              count={renderCount(totalCount)}
            >
              <span className="truncate">{tCommon("fields.mixed")}</span>
            </FilterRow>
            {(() => {
              const field = dynamicField;

              if (field?.type === "Checkbox") {
                const checkedCount = (field as any).counts?.hasValue || 0;
                const uncheckedCount = (field as any).counts?.noValue || 0;
                return (
                  <>
                    <FilterRow
                      selected={isValueSelected(1)}
                      onClick={() => handleFilterClick(1)}
                      count={renderCount(checkedCount)}
                    >
                      <span className="truncate">
                        {tCommon("fields.checked")}
                      </span>
                    </FilterRow>
                    <FilterRow
                      selected={isValueSelected(0)}
                      onClick={() => handleFilterClick(0)}
                      count={renderCount(uncheckedCount)}
                    >
                      <span className="truncate">{t("fields.unchecked")}</span>
                    </FilterRow>
                  </>
                );
              }

              // Number/date/text/link/steps axes keep their has-value/no-value
              // rows (the bare `any`/`none` predicates); the operator inputs
              // moved into the FilterBar's chip editors.
              if (field?.type === "Integer" || field?.type === "Number") {
                const noValueCount = (field as any).counts?.noValue || 0;
                const hasValueCount = (field as any).counts?.hasValue || 0;

                return (
                  <>
                    <FilterRow
                      selected={isValueSelected("none")}
                      onClick={() => handleFilterClick("none")}
                      count={renderCount(noValueCount)}
                    >
                      <span className="truncate opacity-40">
                        {t("fields.noValue")}
                      </span>
                    </FilterRow>
                    <FilterRow
                      selected={isValueSelected("any")}
                      onClick={() => handleFilterClick("any")}
                      count={renderCount(hasValueCount)}
                    >
                      <span className="truncate">{t("fields.hasValue")}</span>
                    </FilterRow>
                  </>
                );
              }

              if (field?.type === "Date") {
                const noValueCount = (field as any).counts?.noValue || 0;
                const hasValueCount = (field as any).counts?.hasValue || 0;

                return (
                  <>
                    <FilterRow
                      selected={isValueSelected("none")}
                      onClick={() => handleFilterClick("none")}
                      count={renderCount(noValueCount)}
                    >
                      <span className="truncate opacity-40">
                        {t("fields.noDate")}
                      </span>
                    </FilterRow>
                    <FilterRow
                      selected={isValueSelected("any")}
                      onClick={() => handleFilterClick("any")}
                      count={renderCount(hasValueCount)}
                    >
                      <span className="truncate">{t("fields.hasDate")}</span>
                    </FilterRow>
                  </>
                );
              }

              if (
                field?.type === "Text Long" ||
                field?.type === "Text String"
              ) {
                const hasValueCount = (field as any).counts?.hasValue || 0;
                const noValueCount = (field as any).counts?.noValue || 0;

                return (
                  <>
                    <FilterRow
                      selected={isValueSelected("any")}
                      onClick={() => handleFilterClick("any")}
                      count={renderCount(hasValueCount)}
                    >
                      <span className="truncate">{t("fields.hasText")}</span>
                    </FilterRow>
                    <FilterRow
                      selected={isValueSelected("none")}
                      onClick={() => handleFilterClick("none")}
                      count={renderCount(noValueCount)}
                    >
                      <span className="truncate opacity-40">
                        {t("fields.noText")}
                      </span>
                    </FilterRow>
                  </>
                );
              }

              if (field?.type === "Link") {
                const hasValueCount = (field as any).counts?.hasValue || 0;
                const noValueCount = (field as any).counts?.noValue || 0;

                return (
                  <>
                    <FilterRow
                      selected={isValueSelected("any")}
                      onClick={() => handleFilterClick("any")}
                      count={renderCount(hasValueCount)}
                    >
                      <span className="truncate">{t("fields.hasLink")}</span>
                    </FilterRow>
                    <FilterRow
                      selected={isValueSelected("none")}
                      onClick={() => handleFilterClick("none")}
                      count={renderCount(noValueCount)}
                    >
                      <span className="truncate opacity-40">
                        {t("fields.noLink")}
                      </span>
                    </FilterRow>
                  </>
                );
              }

              if (field?.type === "Steps") {
                const hasValueCount = (field as any).counts?.hasValue || 0;
                const noValueCount = (field as any).counts?.noValue || 0;

                return (
                  <>
                    <FilterRow
                      selected={isValueSelected("any")}
                      onClick={() => handleFilterClick("any")}
                      count={renderCount(hasValueCount)}
                    >
                      <span className="truncate">{t("fields.hasSteps")}</span>
                    </FilterRow>
                    <FilterRow
                      selected={isValueSelected("none")}
                      onClick={() => handleFilterClick("none")}
                      count={renderCount(noValueCount)}
                    >
                      <span className="truncate opacity-40">
                        {t("fields.noSteps")}
                      </span>
                    </FilterRow>
                  </>
                );
              }

              if (field?.options) {
                // Counts are already provided by the API
                const totalWithValues = dynamicFieldOptions.reduce(
                  (sum: number, opt) => sum + (opt.count || 0),
                  0
                );
                const noneCount = totalCount - totalWithValues;

                return (
                  <>
                    {!field.required && (
                      <FilterRow
                        selected={isValueSelected("none")}
                        onClick={() => handleFilterClick("none")}
                        count={renderCount(noneCount)}
                      >
                        <CircleDashed className="w-4 h-4 shrink-0 opacity-40" />
                        <span className="truncate">
                          {tCommon("access.none")}
                        </span>
                      </FilterRow>
                    )}
                    <FilterOptionList
                      {...listProps}
                      options={dynamicFieldOptions}
                    />
                  </>
                );
              }
              return null;
            })()}
          </>
        )}
      </div>
    </div>
  );
}
