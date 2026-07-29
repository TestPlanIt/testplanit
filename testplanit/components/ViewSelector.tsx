import { DateFilterInput } from "@/components/DateFilterInput";
import DynamicIcon from "@/components/DynamicIcon";
import { LinkFilterInput } from "@/components/LinkFilterInput";
import { NumericFilterInput } from "@/components/NumericFilterInput";
import { StepsFilterInput } from "@/components/StepsFilterInput";
import { UserNameCell } from "@/components/tables/UserNameCell";
import { TextFilterInput } from "@/components/TextFilterInput";
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
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { IconName } from "~/types/globals";
import { cn } from "~/utils";

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
  selectedFilter: Array<string | number> | null;
  onFilterChange: (value: Array<string | number> | null) => void;
  isRunMode?: boolean;
  totalCount: number;
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

const _ALL_VALUES_FILTER = "__ALL__";

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
  selectedFilter: Array<string | number> | null;
  onFilterChange: (value: Array<string | number> | null) => void;
  isValueSelected: (value: string | number | null) => boolean;
  onOptionClick: (
    value: string | number | null,
    event?: React.MouseEvent
  ) => void;
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
  selectedFilter,
  onFilterChange,
  isValueSelected,
  onOptionClick,
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

  const optionIds = useMemo(
    () => new Set(options.map((option) => option.id)),
    [options]
  );

  const selectedOptions = useMemo(
    () =>
      Array.isArray(selectedFilter)
        ? options.filter((option) => selectedFilter.includes(option.id))
        : [],
    [options, selectedFilter]
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
      // Values that aren't part of this list (e.g. the pinned "Any"/"None"
      // rows rendered above it) stay selected.
      const preserved = Array.isArray(selectedFilter)
        ? selectedFilter.filter((value) => !optionIds.has(value))
        : [];
      const next = [...preserved, ...selected.map((option) => option.id)];
      onFilterChange(next.length > 0 ? next : null);
    },
    [onFilterChange, optionIds, selectedFilter]
  );

  if (options.length <= SEARCHABLE_OPTION_THRESHOLD) {
    return (
      <>
        {options.map((option) => (
          <FilterRow
            key={option.id}
            selected={isValueSelected(option.id)}
            onClick={(e) => onOptionClick(option.id, e)}
            count={option.count ?? 0}
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
              {option.count ?? 0}
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
  selectedFilter,
  onFilterChange,
  isRunMode: _isRunMode,
  totalCount,
  viewOptions,
}: ViewSelectorProps) {
  const t = useTranslations("repository");
  const tCommon = useTranslations("common");
  const session = useSession();
  const hasAutoSelectedUser = useRef(false);

  useEffect(() => {
    // Check if we're in assignedTo view and have a session user
    if (
      selectedItem === "assignedTo" &&
      session.data?.user &&
      selectedFilter === null &&
      !hasAutoSelectedUser.current
    ) {
      // Find the assignedTo view item
      const assignedToView = viewItems.find((item) => item.id === "assignedTo");
      if (
        assignedToView &&
        "options" in assignedToView &&
        Array.isArray(assignedToView.options)
      ) {
        // Find the current user in the options, ensuring user.id exists
        const currentUserId = session.data?.user?.id;
        if (typeof currentUserId === "string") {
          const currentUserOption = assignedToView.options.find(
            (opt) => opt.id === currentUserId
          );

          if (currentUserOption && currentUserOption.id != null) {
            onFilterChange([currentUserOption.id]); // Select current user as array
            hasAutoSelectedUser.current = true; // Mark that we've auto-selected
          }
        }
      }
    }
  }, [selectedItem, session, viewItems, onFilterChange, selectedFilter]);

  // Helper function to check if a value is selected
  const isValueSelected = useCallback(
    (value: string | number | null) => {
      if (selectedFilter === null) return value === null;
      if (!Array.isArray(selectedFilter)) return false;
      if (value === null) return false;
      return selectedFilter.includes(value);
    },
    [selectedFilter]
  );

  // Helper function to handle multi-select with modifier keys
  const handleFilterClick = useCallback(
    (value: string | number | null, event?: React.MouseEvent) => {
      // Check for modifier key (Cmd on Mac, Ctrl on Windows/Linux)
      const isModifierPressed = event?.metaKey || event?.ctrlKey;

      if (!isModifierPressed || value === null) {
        // No modifier key or clicking "All" option - single select
        onFilterChange(value === null ? null : [value]);
      } else {
        // Modifier key pressed - toggle selection
        if (selectedFilter === null) {
          // Nothing selected, start new selection
          onFilterChange([value]);
        } else {
          const currentSelection = Array.isArray(selectedFilter)
            ? selectedFilter
            : [selectedFilter];
          const valueIndex = currentSelection.findIndex((v) => v === value);

          if (valueIndex >= 0) {
            // Value already selected, remove it
            const newSelection = currentSelection.filter((v) => v !== value);
            onFilterChange(newSelection.length > 0 ? newSelection : null);
          } else {
            // Value not selected, add it
            onFilterChange([...currentSelection, value]);
          }
        }
      }
    },
    [selectedFilter, onFilterChange]
  );

  const listProps = {
    selectedFilter,
    onFilterChange,
    isValueSelected,
    onOptionClick: handleFilterClick,
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
              selected={selectedFilter === null}
              onClick={(e) => handleFilterClick(null, e)}
              count={templateOptions.reduce(
                (sum, template) => sum + (template.count || 0),
                0
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
              selected={selectedFilter === null}
              onClick={(e) => handleFilterClick(null, e)}
              count={stateOptions.reduce(
                (sum, state) => sum + (state.count || 0),
                0
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
              selected={selectedFilter === null}
              onClick={(e) => handleFilterClick(null, e)}
              count={creatorOptions.reduce(
                (sum, creator) => sum + (creator.count || 0),
                0
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
              selected={selectedFilter === null}
              onClick={(e) => handleFilterClick(null, e)}
              count={totalCount}
            >
              <span className="truncate">{t("views.allCases")}</span>
            </FilterRow>
            {viewOptions?.automated.map(
              (item: { value: boolean; count: number }) => (
                <FilterRow
                  key={item.value.toString()}
                  selected={isValueSelected(item.value ? 1 : 0)}
                  onClick={(e) => handleFilterClick(item.value ? 1 : 0, e)}
                  count={item.count}
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
              selected={selectedFilter === null}
              onClick={(e) => handleFilterClick(null, e)}
              count={totalCount}
            >
              <span className="truncate">{t("views.allCases")}</span>
            </FilterRow>
            {viewOptions?.parameterized?.map(
              (item: { value: boolean; count: number }) => (
                <FilterRow
                  key={item.value.toString()}
                  selected={isValueSelected(item.value ? 1 : 0)}
                  onClick={(e) => handleFilterClick(item.value ? 1 : 0, e)}
                  count={item.count}
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
              selected={selectedFilter === null}
              onClick={(e) => handleFilterClick(null, e)}
              count={totalCount}
            >
              <span className="truncate">{t("views.allCases")}</span>
            </FilterRow>
            {viewOptions?.attachments?.map(
              (item: { value: boolean; count: number }) => (
                <FilterRow
                  key={item.value.toString()}
                  selected={isValueSelected(item.value ? 1 : 0)}
                  onClick={(e) => handleFilterClick(item.value ? 1 : 0, e)}
                  count={item.count}
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
              selected={selectedFilter === null}
              onClick={(e) => handleFilterClick(null, e)}
              count={
                (viewOptions as any)?.testRunOptions?.totalCount || totalCount
              }
            >
              <CircleCheckBig className="w-4 h-4 shrink-0" />
              <span className="truncate">{tCommon("filters.allStatuses")}</span>
            </FilterRow>
            <FilterRow
              selected={isValueSelected("untested")}
              onClick={(e) => handleFilterClick("untested", e)}
              count={(viewOptions as any)?.testRunOptions?.untestedCount || 0}
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
              selected={selectedFilter === null}
              onClick={(e) => handleFilterClick(null, e)}
              count={
                (viewOptions as any)?.testRunOptions?.totalCount || totalCount
              }
            >
              <Users className="w-4 h-4 shrink-0" />
              <span className="truncate">{t("views.allAssignees")}</span>
            </FilterRow>
            <FilterRow
              selected={isValueSelected("unassigned")}
              onClick={(e) => handleFilterClick("unassigned", e)}
              count={(viewOptions as any)?.testRunOptions?.unassignedCount || 0}
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
                onClick={(e) => handleFilterClick(option.id, e)}
                count={option.count}
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
                onClick={(e) => handleFilterClick(option.id, e)}
                count={option.count}
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
              selected={selectedFilter === null}
              onClick={(e) => handleFilterClick(null, e)}
              count={totalCount}
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
                      onClick={(e) => handleFilterClick(1, e)}
                      count={checkedCount}
                    >
                      <span className="truncate">
                        {tCommon("fields.checked")}
                      </span>
                    </FilterRow>
                    <FilterRow
                      selected={isValueSelected(2)}
                      onClick={(e) => handleFilterClick(2, e)}
                      count={uncheckedCount}
                    >
                      <span className="truncate">{t("fields.unchecked")}</span>
                    </FilterRow>
                  </>
                );
              }

              // Handle Integer, Number fields with operator-based filtering
              if (field?.type === "Integer" || field?.type === "Number") {
                const noValueCount = (field as any).counts?.noValue || 0;
                const hasValueCount = (field as any).counts?.hasValue || 0;

                return (
                  <>
                    <FilterRow
                      selected={isValueSelected("none")}
                      onClick={(e) => handleFilterClick("none", e)}
                      count={noValueCount}
                    >
                      <span className="truncate opacity-40">
                        {t("fields.noValue")}
                      </span>
                    </FilterRow>
                    <FilterRow
                      selected={isValueSelected("hasValue")}
                      onClick={(e) => handleFilterClick("hasValue", e)}
                      count={hasValueCount}
                    >
                      <span className="truncate">{t("fields.hasValue")}</span>
                    </FilterRow>
                    <div className="h-px bg-border my-1" />
                    <NumericFilterInput
                      fieldId={field.fieldId}
                      fieldType={field.type}
                      onFilterApply={(operator, value1, value2) => {
                        const filterValue =
                          value2 !== undefined
                            ? `${operator}:${value1}:${value2}`
                            : `${operator}:${value1}`;
                        handleFilterClick(filterValue, undefined);
                      }}
                      onClearFilter={() => handleFilterClick(null, undefined)}
                      currentFilter={
                        selectedFilter &&
                        Array.isArray(selectedFilter) &&
                        selectedFilter.length > 0
                          ? String(selectedFilter[0])
                          : null
                      }
                    />
                  </>
                );
              }

              // Handle Date fields with operator-based filtering
              if (field?.type === "Date") {
                const noValueCount = (field as any).counts?.noValue || 0;
                const hasValueCount = (field as any).counts?.hasValue || 0;

                return (
                  <>
                    <FilterRow
                      selected={isValueSelected("none")}
                      onClick={(e) => handleFilterClick("none", e)}
                      count={noValueCount}
                    >
                      <span className="truncate opacity-40">
                        {t("fields.noDate")}
                      </span>
                    </FilterRow>
                    <FilterRow
                      selected={isValueSelected("hasValue")}
                      onClick={(e) => handleFilterClick("hasValue", e)}
                      count={hasValueCount}
                    >
                      <span className="truncate">{t("fields.hasDate")}</span>
                    </FilterRow>
                    <div className="h-px bg-border my-1" />
                    <DateFilterInput
                      fieldId={field.fieldId}
                      onFilterApply={(operator, value1, value2) => {
                        let filterValue: string;
                        if (value1 && value2) {
                          // Between operator with two dates - use pipe separator
                          filterValue = `${operator}|${value1.toISOString()}|${value2.toISOString()}`;
                        } else if (value1) {
                          // Single date operator (on, before, after) - use pipe separator
                          filterValue = `${operator}|${value1.toISOString()}`;
                        } else {
                          // Relative date operators (last7, last30, last90, thisYear)
                          filterValue = operator;
                        }
                        handleFilterClick(filterValue, undefined);
                      }}
                      onClearFilter={() => handleFilterClick(null, undefined)}
                      currentFilter={
                        selectedFilter &&
                        Array.isArray(selectedFilter) &&
                        selectedFilter.length > 0
                          ? (() => {
                              const filter = String(selectedFilter[0]);
                              // Only pass date operator filters, not hasValue/none
                              return filter === "hasValue" || filter === "none"
                                ? null
                                : filter;
                            })()
                          : null
                      }
                    />
                  </>
                );
              }

              // Handle Text Long, Text String fields with operator-based filtering
              if (
                field?.type === "Text Long" ||
                field?.type === "Text String"
              ) {
                const hasValueCount = (field as any).counts?.hasValue || 0;
                const noValueCount = (field as any).counts?.noValue || 0;

                return (
                  <>
                    <FilterRow
                      selected={isValueSelected("hasValue")}
                      onClick={(e) => handleFilterClick("hasValue", e)}
                      count={hasValueCount}
                    >
                      <span className="truncate">{t("fields.hasText")}</span>
                    </FilterRow>
                    <FilterRow
                      selected={isValueSelected("none")}
                      onClick={(e) => handleFilterClick("none", e)}
                      count={noValueCount}
                    >
                      <span className="truncate opacity-40">
                        {t("fields.noText")}
                      </span>
                    </FilterRow>
                    <div className="h-px bg-border my-1" />
                    <TextFilterInput
                      fieldId={field.fieldId}
                      onFilterApply={(operator, value) => {
                        const filterValue = `${operator}|${value}`;
                        handleFilterClick(filterValue, undefined);
                      }}
                      onClearFilter={() => handleFilterClick(null, undefined)}
                      currentFilter={
                        selectedFilter &&
                        Array.isArray(selectedFilter) &&
                        selectedFilter.length > 0
                          ? (() => {
                              const filter = String(selectedFilter[0]);
                              // Only pass text operator filters, not hasValue/none
                              return filter === "hasValue" || filter === "none"
                                ? null
                                : filter;
                            })()
                          : null
                      }
                    />
                  </>
                );
              }

              // Handle Link fields with operator-based filtering
              if (field?.type === "Link") {
                const hasValueCount = (field as any).counts?.hasValue || 0;
                const noValueCount = (field as any).counts?.noValue || 0;

                return (
                  <>
                    <FilterRow
                      selected={isValueSelected("hasValue")}
                      onClick={(e) => handleFilterClick("hasValue", e)}
                      count={hasValueCount}
                    >
                      <span className="truncate">{t("fields.hasLink")}</span>
                    </FilterRow>
                    <FilterRow
                      selected={isValueSelected("none")}
                      onClick={(e) => handleFilterClick("none", e)}
                      count={noValueCount}
                    >
                      <span className="truncate opacity-40">
                        {t("fields.noLink")}
                      </span>
                    </FilterRow>
                    <div className="h-px bg-border my-1" />
                    <LinkFilterInput
                      fieldId={field.fieldId}
                      onFilterApply={(operator, value) => {
                        const filterValue = `${operator}|${value}`;
                        handleFilterClick(filterValue, undefined);
                      }}
                      onClearFilter={() => handleFilterClick(null, undefined)}
                      currentFilter={
                        selectedFilter &&
                        Array.isArray(selectedFilter) &&
                        selectedFilter.length > 0
                          ? (() => {
                              const filter = String(selectedFilter[0]);
                              // Only pass link operator filters, not hasValue/none
                              return filter === "hasValue" || filter === "none"
                                ? null
                                : filter;
                            })()
                          : null
                      }
                    />
                  </>
                );
              }

              // Handle Steps fields with operator-based filtering
              if (field?.type === "Steps") {
                const hasValueCount = (field as any).counts?.hasValue || 0;
                const noValueCount = (field as any).counts?.noValue || 0;

                return (
                  <>
                    <FilterRow
                      selected={isValueSelected("hasValue")}
                      onClick={(e) => handleFilterClick("hasValue", e)}
                      count={hasValueCount}
                    >
                      <span className="truncate">{t("fields.hasSteps")}</span>
                    </FilterRow>
                    <FilterRow
                      selected={isValueSelected("none")}
                      onClick={(e) => handleFilterClick("none", e)}
                      count={noValueCount}
                    >
                      <span className="truncate opacity-40">
                        {t("fields.noSteps")}
                      </span>
                    </FilterRow>
                    <div className="h-px bg-border my-1" />
                    <StepsFilterInput
                      fieldId={field.fieldId}
                      onFilterApply={(operator, value1, value2) => {
                        let filterValue: string;
                        if (value2 !== undefined) {
                          // Between operator with two values
                          filterValue = `${operator}|${value1}|${value2}`;
                        } else {
                          // Single value operator
                          filterValue = `${operator}|${value1}`;
                        }
                        handleFilterClick(filterValue, undefined);
                      }}
                      onClearFilter={() => handleFilterClick(null, undefined)}
                      currentFilter={
                        selectedFilter &&
                        Array.isArray(selectedFilter) &&
                        selectedFilter.length > 0
                          ? (() => {
                              const filter = String(selectedFilter[0]);
                              // Only pass steps operator filters, not hasValue/none
                              return filter === "hasValue" || filter === "none"
                                ? null
                                : filter;
                            })()
                          : null
                      }
                    />
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
                        onClick={(e) => handleFilterClick("none", e)}
                        count={noneCount}
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
