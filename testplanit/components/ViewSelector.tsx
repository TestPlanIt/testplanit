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
  Link2 as LinkIcon,
  Link2Off,
  ListOrdered,
  Users,
  UserX,
  Bot,
  User,
  CircleDashed,
  CircleCheckBig,
} from "lucide-react";
import { cn } from "~/utils";
import DynamicIcon from "@/components/DynamicIcon";
import { useTranslations } from "next-intl";
import { UserNameCell } from "@/components/tables/UserNameCell";
import { useEffect, useRef, useCallback } from "react";
import { useSession } from "next-auth/react";

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

const ALL_VALUES_FILTER = "__ALL__";

export function ViewSelector({
  selectedItem,
  onValueChange,
  viewItems,
  selectedFilter,
  onFilterChange,
  isRunMode,
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

  return (
    <div className="flex flex-col pt-0.5     w-full">
      <Select value={selectedItem} onValueChange={onValueChange}>
        <SelectTrigger className="mr-6 ml-1 text-primary text-lg md:text-xl font-extrabold">
          <SelectValue placeholder="Select an option" />
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

      <div className="px-4 space-y-1">
        {selectedItem === "templates" && (
          <>
            <div
              role="button"
              tabIndex={0}
              className={cn(
                "w-full flex items-center justify-between text-left font-normal cursor-pointer hover:bg-accent hover:text-accent-foreground p-2 rounded-md",
                selectedFilter === null && "bg-primary/20 hover:bg-primary/30"
              )}
              onClick={(e) => handleFilterClick(null, e)}
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="truncate">{t("views.allTemplates")}</span>
              </div>
              <span className="text-sm text-muted-foreground shrink-0 ml-2 whitespace-nowrap">
                {viewOptions?.templates.reduce(
                  (sum, template) => sum + (template.count || 0),
                  0
                )}
              </span>
            </div>
            {viewOptions?.templates.map((template) => (
              <div
                role="button"
                tabIndex={0}
                key={template.id}
                className={cn(
                  "w-full flex items-center justify-between text-left font-normal cursor-pointer hover:bg-accent hover:text-accent-foreground p-2 rounded-md",
                  isValueSelected(template.id) &&
                    "bg-primary/20 hover:bg-primary/30"
                )}
                onClick={(e) => handleFilterClick(template.id, e)}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <LayoutTemplate className="w-4 h-4 shrink-0" />
                  <span className="truncate">{template.name}</span>
                </div>
                <span className="text-sm text-muted-foreground shrink-0 ml-2 whitespace-nowrap">
                  {template.count || 0}
                </span>
              </div>
            ))}
          </>
        )}

        {selectedItem === "states" && (
          <>
            <div
              role="button"
              tabIndex={0}
              className={cn(
                "w-full flex items-center justify-between text-left font-normal cursor-pointer hover:bg-accent hover:text-accent-foreground p-2 rounded-md",
                selectedFilter === null && "bg-primary/20 hover:bg-primary/30"
              )}
              onClick={(e) => handleFilterClick(null, e)}
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="truncate">{t("views.allStates")}</span>
              </div>
              <span className="text-sm text-muted-foreground shrink-0 ml-2 whitespace-nowrap">
                {viewOptions?.states.reduce(
                  (sum, state) => sum + (state.count || 0),
                  0
                )}
              </span>
            </div>
            {viewOptions?.states.map((state) => (
              <div
                role="button"
                tabIndex={0}
                key={state.id}
                className={cn(
                  "w-full flex items-center justify-between text-left font-normal cursor-pointer hover:bg-accent hover:text-accent-foreground p-2 rounded-md",
                  isValueSelected(state.id) &&
                    "bg-primary/20 hover:bg-primary/30"
                )}
                onClick={(e) => handleFilterClick(state.id, e)}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <DynamicIcon
                    name={state.icon?.name as IconName}
                    className="w-4 h-4 shrink-0"
                    color={state.iconColor?.value}
                  />
                  <span className="truncate">{state.name}</span>
                </div>
                <span className="text-sm text-muted-foreground shrink-0 ml-2 whitespace-nowrap">
                  {state.count || 0}
                </span>
              </div>
            ))}
          </>
        )}

        {selectedItem === "creators" && (
          <>
            <div
              role="button"
              tabIndex={0}
              className={cn(
                "w-full flex items-center justify-between text-left font-normal cursor-pointer hover:bg-accent hover:text-accent-foreground p-2 rounded-md",
                selectedFilter === null && "bg-primary/20 hover:bg-primary/30"
              )}
              onClick={(e) => handleFilterClick(null, e)}
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <Users className="w-4 h-4 shrink-0" />
                <span className="truncate">{t("views.allCreators")}</span>
              </div>
              <span className="text-sm text-muted-foreground shrink-0 ml-2 whitespace-nowrap">
                {viewOptions?.creators.reduce(
                  (sum, creator) => sum + (creator.count || 0),
                  0
                )}
              </span>
            </div>
            {viewOptions?.creators.map((creator) => (
              <div
                role="button"
                tabIndex={0}
                key={creator.id}
                className={cn(
                  "w-full flex items-center justify-between text-left font-normal cursor-pointer hover:bg-accent hover:text-accent-foreground p-2 rounded-md",
                  isValueSelected(creator.id) &&
                    "bg-primary/20 hover:bg-primary/30"
                )}
                onClick={(e) => handleFilterClick(creator.id, e)}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <UserNameCell userId={creator.id} hideLink={true} />
                </div>
                <span className="text-sm text-muted-foreground shrink-0 ml-2 whitespace-nowrap">
                  {creator.count || 0}
                </span>
              </div>
            ))}
          </>
        )}

        {selectedItem === "automated" && (
          <>
            <div
              role="button"
              tabIndex={0}
              className={cn(
                "w-full flex items-center justify-between text-left font-normal cursor-pointer hover:bg-accent hover:text-accent-foreground p-2 rounded-md",
                selectedFilter === null && "bg-primary/20 hover:bg-primary/30"
              )}
              onClick={(e) => handleFilterClick(null, e)}
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="truncate">{t("views.allCases")}</span>
              </div>
              <span className="text-sm text-muted-foreground shrink-0 ml-2 whitespace-nowrap">
                {totalCount}
              </span>
            </div>
            {viewOptions?.automated.map(
              (item: { value: boolean; count: number }) => {
                return (
                  <div
                    role="button"
                    tabIndex={0}
                    key={item.value.toString()}
                    className={cn(
                      "w-full flex items-center justify-between text-left font-normal cursor-pointer hover:bg-accent hover:text-accent-foreground p-2 rounded-md",
                      isValueSelected(item.value ? 1 : 0) &&
                        "bg-primary/20 hover:bg-primary/30"
                    )}
                    onClick={(e) => handleFilterClick(item.value ? 1 : 0, e)}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
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
                    </div>
                    <span className="text-sm text-muted-foreground shrink-0 ml-2 whitespace-nowrap">
                      {item.count}
                    </span>
                  </div>
                );
              }
            )}
          </>
        )}

        {selectedItem === "status" &&
          (() => {
            const statusView = viewItems.find((item) => item.id === "status");
            const untestedCount =
              (viewOptions as any)?.testRunOptions?.untestedCount || 0;
            const statusOptions = statusView?.options || [];

            return (
              <>
                <div
                  role="button"
                  tabIndex={0}
                  className={cn(
                    "w-full flex items-center justify-between text-left font-normal cursor-pointer hover:bg-accent hover:text-accent-foreground p-2 rounded-md",
                    selectedFilter === null &&
                      "bg-primary/20 hover:bg-primary/30"
                  )}
                  onClick={(e) => handleFilterClick(null, e)}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <CircleCheckBig className="w-4 h-4 shrink-0" />
                    <span className="truncate">
                      {tCommon("filters.allStatuses")}
                    </span>
                  </div>
                  <span className="text-sm text-muted-foreground shrink-0 ml-2 whitespace-nowrap">
                    {(viewOptions as any)?.testRunOptions?.totalCount ||
                      totalCount}
                  </span>
                </div>
                <div
                  role="button"
                  tabIndex={0}
                  className={cn(
                    "w-full flex items-center justify-between text-left font-normal cursor-pointer hover:bg-accent hover:text-accent-foreground p-2 rounded-md",
                    isValueSelected("untested") &&
                      "bg-primary/20 hover:bg-primary/30"
                  )}
                  onClick={(e) => handleFilterClick("untested", e)}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <div
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: "#B1B2B3" }}
                    />
                    <span className="truncate">
                      {tCommon("labels.untested")}
                    </span>
                  </div>
                  <span className="text-sm text-muted-foreground shrink-0 ml-2 whitespace-nowrap">
                    {untestedCount}
                  </span>
                </div>
                {statusOptions
                  .filter((opt: any) => opt.id !== "untested")
                  .map((status: any) => (
                    <div
                      role="button"
                      tabIndex={0}
                      key={status.id}
                      className={cn(
                        "w-full flex items-center justify-between text-left font-normal cursor-pointer hover:bg-accent hover:text-accent-foreground p-2 rounded-md",
                        isValueSelected(status.id) &&
                          "bg-primary/20 hover:bg-primary/30"
                      )}
                      onClick={(e) => handleFilterClick(status.id, e)}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <div
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{
                            backgroundColor: status.color?.value || "#B1B2B3",
                          }}
                        />
                        <span className="truncate">{status.name}</span>
                      </div>
                      <span className="text-sm text-muted-foreground shrink-0 ml-2 whitespace-nowrap">
                        {status.count || 0}
                      </span>
                    </div>
                  ))}
              </>
            );
          })()}

        {selectedItem === "assignedTo" &&
          (() => {
            const assignedToView = viewItems.find(
              (item) => item.id === "assignedTo"
            );
            const unassignedCount =
              (viewOptions as any)?.testRunOptions?.unassignedCount || 0;
            const assignedOptions = assignedToView?.options || [];

            return (
              <>
                <div
                  role="button"
                  tabIndex={0}
                  className={cn(
                    "w-full flex items-center justify-between text-left font-normal cursor-pointer hover:bg-accent hover:text-accent-foreground p-2 rounded-md",
                    selectedFilter === null &&
                      "bg-primary/20 hover:bg-primary/30"
                  )}
                  onClick={(e) => handleFilterClick(null, e)}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <Users className="w-4 h-4 shrink-0" />
                    <span className="truncate">{t("views.allAssignees")}</span>
                  </div>
                  <span className="text-sm text-muted-foreground shrink-0 ml-2 whitespace-nowrap">
                    {(viewOptions as any)?.testRunOptions?.totalCount ||
                      totalCount}
                  </span>
                </div>
                <div
                  role="button"
                  tabIndex={0}
                  className={cn(
                    "w-full flex items-center justify-between text-left font-normal cursor-pointer hover:bg-accent hover:text-accent-foreground p-2 rounded-md",
                    isValueSelected("unassigned") &&
                      "bg-primary/20 hover:bg-primary/30"
                  )}
                  onClick={(e) => handleFilterClick("unassigned", e)}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <UserX className="w-4 h-4 shrink-0" />
                    <span className="truncate">
                      {tCommon("labels.unassigned")}
                    </span>
                  </div>
                  <span className="text-sm text-muted-foreground shrink-0 ml-2 whitespace-nowrap">
                    {unassignedCount}
                  </span>
                </div>
                {assignedOptions
                  .filter(
                    (opt: any) =>
                      opt.id !== "unassigned" && typeof opt.id === "string"
                  )
                  .map((user: any) => (
                    <div
                      role="button"
                      tabIndex={0}
                      key={user.id}
                      className={cn(
                        "w-full flex items-center justify-between text-left font-normal cursor-pointer hover:bg-accent hover:text-accent-foreground p-2 rounded-md",
                        isValueSelected(user.id) &&
                          "bg-primary/20 hover:bg-primary/30"
                      )}
                      onClick={(e) => handleFilterClick(user.id, e)}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <UserNameCell
                          userId={user.id as string}
                          hideLink={true}
                        />
                      </div>
                      <span className="text-sm text-muted-foreground shrink-0 ml-2 whitespace-nowrap">
                        {user.count || 0}
                      </span>
                    </div>
                  ))}
              </>
            );
          })()}

        {selectedItem === "tags" && (
          <>
            {viewItems
              .find((item) => item.id === "tags")
              ?.options?.map((tagOption) => (
                <div
                  key={tagOption.id}
                  role="button"
                  tabIndex={0}
                  className={cn(
                    "w-full flex items-center justify-between text-left font-normal cursor-pointer hover:bg-accent hover:text-accent-foreground p-2 rounded-md",
                    isValueSelected(tagOption.id) &&
                      "bg-primary/20 hover:bg-primary/30"
                  )}
                  onClick={(e) => handleFilterClick(tagOption.id, e)}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="truncate">{tagOption.name}</span>
                  </div>
                  {tagOption.count !== undefined && (
                    <span className="text-sm text-muted-foreground shrink-0 ml-2 whitespace-nowrap">
                      {tagOption.count}
                    </span>
                  )}
                </div>
              ))}
          </>
        )}

        {selectedItem === "issues" && (
          <>
            {viewItems
              .find((item) => item.id === "issues")
              ?.options?.map((issueOption) => (
                <div
                  key={issueOption.id}
                  role="button"
                  tabIndex={0}
                  className={cn(
                    "w-full flex items-center justify-between text-left font-normal cursor-pointer hover:bg-accent hover:text-accent-foreground p-2 rounded-md",
                    isValueSelected(issueOption.id) &&
                      "bg-primary/20 hover:bg-primary/30"
                  )}
                  onClick={(e) => handleFilterClick(issueOption.id, e)}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="truncate">{issueOption.name}</span>
                  </div>
                  {issueOption.count !== undefined && (
                    <span className="text-sm text-muted-foreground shrink-0 ml-2 whitespace-nowrap">
                      {issueOption.count}
                    </span>
                  )}
                </div>
              ))}
          </>
        )}

        {selectedItem.startsWith("dynamic_") && (
          <>
            <div
              role="button"
              tabIndex={0}
              className={cn(
                "w-full flex items-center justify-between text-left font-normal cursor-pointer hover:bg-accent hover:text-accent-foreground p-2 rounded-md",
                selectedFilter === null && "bg-primary/20 hover:bg-primary/30"
              )}
              onClick={(e) => handleFilterClick(null, e)}
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="truncate">{tCommon("fields.mixed")}</span>
              </div>
              <span className="text-sm text-muted-foreground shrink-0 ml-2 whitespace-nowrap">
                {totalCount}
              </span>
            </div>
            {(() => {
              const [_, fieldKey] = selectedItem.split("_");
              const [fieldId, fieldType] = fieldKey.split("_");
              const numericFieldId = parseInt(fieldId);
              const field = Object.values(
                viewOptions?.dynamicFields || {}
              ).find((f) => f.fieldId === numericFieldId);

              if (field?.type === "Link") {
                const hasLinkCount = (field as any).counts?.hasValue || 0;
                const noLinkCount = (field as any).counts?.noValue || 0;
                return [
                  <div
                    role="button"
                    tabIndex={0}
                    key="has-link"
                    className={cn(
                      "w-full flex items-center justify-between text-left font-normal cursor-pointer hover:bg-accent hover:text-accent-foreground p-2 rounded-md",
                      isValueSelected(1) && "bg-primary/20 hover:bg-primary/30"
                    )}
                    onClick={(e) => handleFilterClick(1, e)}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <LinkIcon className="w-4 h-4 shrink-0" />
                      <span className="truncate">{t("fields.hasLink")}</span>
                    </div>
                    <span className="text-sm text-muted-foreground shrink-0 ml-2 whitespace-nowrap">
                      {hasLinkCount}
                    </span>
                  </div>,
                  <div
                    role="button"
                    tabIndex={0}
                    key="no-link"
                    className={cn(
                      "w-full flex items-center justify-between text-left font-normal cursor-pointer hover:bg-accent hover:text-accent-foreground p-2 rounded-md",
                      isValueSelected(2) && "bg-primary/20 hover:bg-primary/30"
                    )}
                    onClick={(e) => handleFilterClick(2, e)}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <Link2Off className="w-4 h-4 shrink-0" />
                      <span className="truncate">{t("fields.noLink")}</span>
                    </div>
                    <span className="text-sm text-muted-foreground shrink-0 ml-2 whitespace-nowrap">
                      {noLinkCount}
                    </span>
                  </div>,
                ];
              }

              if (field?.type === "Steps") {
                const hasStepsCount = (field as any).counts?.hasValue || 0;
                const noStepsCount = (field as any).counts?.noValue || 0;

                return [
                  <div
                    role="button"
                    tabIndex={0}
                    key="has-steps"
                    className={cn(
                      "w-full flex items-center justify-between text-left font-normal cursor-pointer hover:bg-accent hover:text-accent-foreground p-2 rounded-md",
                      isValueSelected(1) && "bg-primary/20 hover:bg-primary/30"
                    )}
                    onClick={(e) => handleFilterClick(1, e)}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <ListOrdered className="w-4 h-4 shrink-0" />
                      <span className="truncate">{t("fields.hasSteps")}</span>
                    </div>
                    <span className="text-sm text-muted-foreground shrink-0 ml-2 whitespace-nowrap">
                      {hasStepsCount}
                    </span>
                  </div>,
                  <div
                    role="button"
                    tabIndex={0}
                    key="no-steps"
                    className={cn(
                      "w-full flex items-center justify-between text-left font-normal cursor-pointer hover:bg-accent hover:text-accent-foreground p-2 rounded-md",
                      isValueSelected(2) && "bg-primary/20 hover:bg-primary/30"
                    )}
                    onClick={(e) => handleFilterClick(2, e)}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <ListOrdered className="w-4 h-4 shrink-0 opacity-40" />
                      <span className="truncate">{t("fields.noSteps")}</span>
                    </div>
                    <span className="text-sm text-muted-foreground shrink-0 ml-2 whitespace-nowrap">
                      {noStepsCount}
                    </span>
                  </div>,
                ];
              }

              if (field?.type === "Checkbox") {
                const checkedCount = (field as any).counts?.hasValue || 0;
                const uncheckedCount = (field as any).counts?.noValue || 0;
                return [
                  <div
                    role="button"
                    tabIndex={0}
                    key="checked"
                    className={cn(
                      "w-full flex items-center justify-between text-left font-normal cursor-pointer hover:bg-accent hover:text-accent-foreground p-2 rounded-md",
                      isValueSelected(1) && "bg-primary/20 hover:bg-primary/30"
                    )}
                    onClick={(e) => handleFilterClick(1, e)}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="truncate">
                        {tCommon("fields.checked")}
                      </span>
                    </div>
                    <span className="text-sm text-muted-foreground shrink-0 ml-2 whitespace-nowrap">
                      {checkedCount}
                    </span>
                  </div>,
                  <div
                    role="button"
                    tabIndex={0}
                    key="unchecked"
                    className={cn(
                      "w-full flex items-center justify-between text-left font-normal cursor-pointer hover:bg-accent hover:text-accent-foreground p-2 rounded-md",
                      isValueSelected(2) && "bg-primary/20 hover:bg-primary/30"
                    )}
                    onClick={(e) => handleFilterClick(2, e)}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="truncate">{t("fields.unchecked")}</span>
                    </div>
                    <span className="text-sm text-muted-foreground shrink-0 ml-2 whitespace-nowrap">
                      {uncheckedCount}
                    </span>
                  </div>,
                ];
              }

              if (field?.options) {
                const options = field.options;
                // Counts are already provided by the API
                const totalWithValues = options.reduce(
                  (sum: number, opt: any) => sum + (opt.count || 0),
                  0
                );
                const noneCount = totalCount - totalWithValues;

                return [
                  // Add None option if the field is not required
                  !field.required && (
                    <div
                      role="button"
                      tabIndex={0}
                      key="none-option"
                      className={cn(
                        "w-full flex items-center justify-between text-left font-normal cursor-pointer hover:bg-accent hover:text-accent-foreground p-2 rounded-md",
                        isValueSelected("none") &&
                          "bg-primary/20 hover:bg-primary/30"
                      )}
                      onClick={(e) => handleFilterClick("none", e)}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <CircleDashed className="w-4 h-4 shrink-0 opacity-40" />
                        <span className="truncate">
                          {tCommon("access.none")}
                        </span>
                      </div>
                      <span className="text-sm text-muted-foreground shrink-0 ml-2 whitespace-nowrap">
                        {noneCount}
                      </span>
                    </div>
                  ),
                  // Map through the options
                  ...options.map(
                    (option: {
                      id: number;
                      name: string;
                      icon?: { name: string } | null;
                      iconColor?: { value: string } | null;
                      count?: number;
                    }) => (
                      <div
                        role="button"
                        tabIndex={0}
                        key={`option-${option.id}`}
                        className={cn(
                          "w-full flex items-center justify-between text-left font-normal cursor-pointer hover:bg-accent hover:text-accent-foreground p-2 rounded-md",
                          isValueSelected(option.id) &&
                            "bg-primary/20 hover:bg-primary/30"
                        )}
                        onClick={(e) => handleFilterClick(option.id, e)}
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
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
                    )
                  ),
                ].filter(Boolean);
              }
              return null;
            })()}
          </>
        )}
      </div>
    </div>
  );
}
