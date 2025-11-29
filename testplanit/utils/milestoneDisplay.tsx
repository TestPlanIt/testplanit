import React from "react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { Badge } from "@/components/ui/badge";
import { MilestoneIconAndName } from "@/components/MilestoneIconAndName";
import { DateTextDisplay } from "@/components/DateTextDisplay";
import {
  MilestonesWithTypes,
  sortMilestones,
  getStatus,
  getStatusStyle,
  ColorMap,
} from "./milestoneUtils";
import DynamicIcon from "@/components/DynamicIcon";
import { CirclePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AddSessionModal } from "~/app/[locale]/projects/sessions/[projectId]/AddSessionModal";

interface HasMilestone {
  id: number;
  milestone?: {
    id: number;
  } | null;
  milestoneId?: number | null;
}

interface RenderItemProps<T> {
  item: T;
  isNew: boolean;
  newItemId: number | null;
  projectId: number;
}

export type GroupedItems<T extends HasMilestone> = {
  unscheduled: T[];
  milestones: {
    [milestoneId: number]: {
      milestone: MilestonesWithTypes;
      items: T[];
    };
  };
};

export interface AddItemButtonProps {
  milestoneId?: number;
  projectId: number;
}

export function buildMilestoneTree(
  milestones: MilestonesWithTypes[]
): MilestonesWithTypes[] {
  const milestoneMap: { [key: number]: MilestonesWithTypes } = {};
  const rootMilestones: MilestonesWithTypes[] = [];

  // First, create map entries for all milestones with empty children arrays
  milestones.forEach((milestone) => {
    milestoneMap[milestone.id] = { ...milestone, children: [] };
  });

  // Now build the tree structure by adding children to their parents
  milestones.forEach((milestone) => {
    if (milestone.parentId) {
      if (milestoneMap[milestone.parentId]) {
        // Add this milestone as a child of its parent
        milestoneMap[milestone.parentId].children.push(
          milestoneMap[milestone.id]
        );
      }
    } else {
      // This is a root milestone
      rootMilestones.push(milestoneMap[milestone.id]);
    }
  });

  return rootMilestones;
}

export function groupItemsByMilestone<T extends HasMilestone>(
  items: T[],
  milestones: MilestonesWithTypes[]
): GroupedItems<T> {
  const grouped: GroupedItems<T> = {
    unscheduled: [],
    milestones: {},
  };

  const milestoneTree = buildMilestoneTree(milestones);

  const addItemsToMilestone = (milestone: MilestonesWithTypes, items: T[]) => {
    if (!grouped.milestones[milestone.id]) {
      grouped.milestones[milestone.id] = {
        milestone,
        items: [],
      };
    }

    items.forEach((item) => {
      const milestoneId = item.milestoneId ?? item.milestone?.id;
      if (milestoneId === milestone.id) {
        grouped.milestones[milestone.id].items.push(item);
      }
    });

    milestone.children.forEach((child) => {
      addItemsToMilestone(child, items);
    });
  };

  items.forEach((item) => {
    const milestoneId = item.milestoneId ?? item.milestone?.id;
    if (!milestoneId) {
      grouped.unscheduled.push(item);
    }
  });

  milestoneTree.forEach((milestone) => {
    addItemsToMilestone(milestone, items);
  });

  // Remove milestone groups that have no items
  Object.keys(grouped.milestones).forEach((milestoneId) => {
    const milestoneGroup = grouped.milestones[Number(milestoneId)];
    if (milestoneGroup.items.length === 0) {
      delete grouped.milestones[Number(milestoneId)];
    }
  });

  // Sort unscheduled items by createdAt date
  if (grouped.unscheduled.length > 0 && "createdAt" in grouped.unscheduled[0]) {
    grouped.unscheduled.sort(
      (a: any, b: any) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
  }

  return grouped;
}

interface MilestoneDisplayProps {
  milestones: MilestonesWithTypes[];
  grouped: {
    unscheduled: any[];
    milestones: {
      [key: number]: {
        milestone: MilestonesWithTypes;
        items: any[];
      };
    };
  };
  theme: "light" | "dark";
  colorMap: any;
  projectId: number;
  isAdmin: boolean;
  itemIdPrefix: string;
  newItemId: number | null;
  RenderItem: React.ComponentType<{
    item: any;
    isNew: boolean;
    newItemId: number | null;
    projectId: number;
  }>;
  translationFunction: (key: string) => string;
}

export const MilestoneDisplay: React.FC<MilestoneDisplayProps> = ({
  milestones,
  grouped,
  theme,
  colorMap,
  projectId,
  isAdmin,
  itemIdPrefix,
  newItemId,
  RenderItem,
  translationFunction,
}) => {
  const result: React.ReactNode[] = [];

  // Helper function to check if a milestone has any items
  const hasItems = (milestone: MilestonesWithTypes): boolean => {
    if (grouped.milestones[milestone.id]?.items.length > 0) {
      return true;
    }

    return milestone.children?.some(hasItems) ?? false;
  };

  // Render a milestone and its items
  const renderMilestoneWithItems = (
    milestone: MilestonesWithTypes,
    depth: number = 0
  ) => {
    if (!hasItems(milestone)) return null;

    const status = getStatus(milestone);
    const { bg, border, badge } = getStatusStyle(status, theme, colorMap);
    const itemGroup = grouped.milestones[milestone.id];

    // Check if there are items under this milestone
    const hasItemsUnderMilestone = itemGroup && itemGroup.items.length > 0;

    const milestoneElement = (
      <div
        key={`milestone-${milestone.id}`}
        className={
          depth > 0
            ? "w-full pl-4 bg-muted rounded-lg mb-4"
            : "w-full rounded-lg bg-muted mb-4"
        }
      >
        <div
          className={`milestone-grid bg-primary/10 p-2 pr-4 ${depth === 0 ? "rounded-t-lg" : ""}`}
          style={{ borderColor: border, backgroundColor: bg }}
        >
          {/* Milestone Name */}
          <div className="flex items-center gap-1 justify-start min-w-0">
            <div className="flex items-center gap-1 justify-start min-w-0">
              {depth > 0 && (
                <DynamicIcon
                  name="corner-down-right"
                  className="w-6 h-6 text-primary/50 shrink-0 bg-transparent"
                />
              )}
              <div className="truncate">
                <MilestoneIconAndName
                  milestone={milestone}
                  projectId={projectId}
                />
              </div>
            </div>
          </div>

          {/* Status */}
          <div className="milestone-status flex gap-2 justify-center">
            <Badge
              style={{ backgroundColor: badge }}
              className="text-secondary-background border-2 border-secondary-foreground text-sm"
            >
              {translationFunction(`milestones.statusLabels.${status}`)}
            </Badge>
          </div>

          {/* Dates */}
          <div className="milestone-dates flex justify-end">
            <div className="grow text-sm text-muted-foreground">
              {isAdmin && (
                <AddSessionModal
                  defaultMilestoneId={milestone.id}
                  trigger={
                    <Button variant="link" className="p-0">
                      <CirclePlus className="h-4 w-4" />
                      <span className="hidden md:inline">
                        {translationFunction("sessions.actions.add")}
                      </span>
                    </Button>
                  }
                />
              )}
              <DateTextDisplay
                startDate={
                  milestone.startedAt ? new Date(milestone.startedAt) : null
                }
                endDate={
                  milestone.completedAt ? new Date(milestone.completedAt) : null
                }
                isCompleted={milestone.isCompleted}
              />
            </div>
          </div>
        </div>

        {/* Render items under this milestone FIRST */}
        {hasItemsUnderMilestone && (
          <div className="sessions-container bg-muted pr-4 pb-2 mb-2">
            {itemGroup.items.map((item) => (
              <div
                key={item.id}
                id={`${itemIdPrefix}-${item.id}`}
                className={`transition-all duration-500 ${
                  newItemId === item.id
                    ? "ring-2 ring-primary ring-offset-2"
                    : ""
                }`}
                style={{ paddingLeft: "1.5rem" }}
              >
                <RenderItem
                  item={item}
                  isNew={newItemId === item.id}
                  newItemId={newItemId}
                  projectId={projectId}
                />
              </div>
            ))}
          </div>
        )}

        {/* THEN render child milestones */}
        {milestone.children?.map((childMilestone) =>
          renderMilestoneContent(childMilestone, depth + 1)
        )}
      </div>
    );

    result.push(milestoneElement);
  };

  // Helper function to render milestone content without adding to result
  const renderMilestoneContent = (
    milestone: MilestonesWithTypes,
    depth: number = 0
  ) => {
    if (!hasItems(milestone)) return null;

    const status = getStatus(milestone);
    const { bg, border, badge } = getStatusStyle(status, theme, colorMap);
    const itemGroup = grouped.milestones[milestone.id];

    // Check if there are items under this milestone
    const hasItemsUnderMilestone = itemGroup && itemGroup.items.length > 0;

    return (
      <div key={`milestone-${milestone.id}`} className="w-full rounded-lg mb-4">
        <div
          className={`milestone-grid bg-primary/10 p-2 pr-4 ${depth === 0 ? "rounded-t-lg" : ""}`}
          style={{ borderColor: border, backgroundColor: bg }}
        >
          {/* Milestone Name */}
          <div className="flex items-center gap-1 justify-start min-w-0">
            <div className="flex items-center gap-1 justify-start min-w-0">
              {depth > 0 && (
                <DynamicIcon
                  name="corner-down-right"
                  className="w-6 h-6 text-primary/50 shrink-0 bg-transparent"
                />
              )}
              <div className="truncate">
                <MilestoneIconAndName
                  milestone={milestone}
                  projectId={projectId}
                />
              </div>
            </div>
          </div>

          {/* Status */}
          <div className="milestone-status flex gap-2 justify-center">
            <Badge
              style={{ backgroundColor: badge }}
              className="text-secondary-background border-2 border-secondary-foreground text-sm"
            >
              {translationFunction(`milestones.statusLabels.${status}`)}
            </Badge>
          </div>

          {/* Dates */}
          <div className="milestone-dates flex justify-end">
            <div className="grow text-sm text-muted-foreground">
              {isAdmin && (
                <AddSessionModal
                  defaultMilestoneId={milestone.id}
                  trigger={
                    <Button variant="link" className="p-0">
                      <CirclePlus className="h-4 w-4" />
                      <span className="hidden md:inline">
                        {translationFunction("sessions.actions.add")}
                      </span>
                    </Button>
                  }
                />
              )}
              <DateTextDisplay
                startDate={
                  milestone.startedAt ? new Date(milestone.startedAt) : null
                }
                endDate={
                  milestone.completedAt ? new Date(milestone.completedAt) : null
                }
                isCompleted={milestone.isCompleted}
              />
            </div>
          </div>
        </div>

        {/* Render items under this milestone FIRST */}
        {hasItemsUnderMilestone && (
          <div className="sessions-container bg-muted pr-4 pb-2 mb-2">
            {itemGroup.items.map((item) => (
              <div
                key={item.id}
                id={`${itemIdPrefix}-${item.id}`}
                className={`transition-all duration-500 ${
                  newItemId === item.id
                    ? "ring-2 ring-primary ring-offset-2"
                    : ""
                }`}
                style={{ paddingLeft: "1.5rem" }}
              >
                <RenderItem
                  item={item}
                  isNew={newItemId === item.id}
                  newItemId={newItemId}
                  projectId={projectId}
                />
              </div>
            ))}
          </div>
        )}

        {/* THEN render child milestones */}
        {milestone.children?.map((childMilestone) =>
          renderMilestoneContent(childMilestone, depth + 1)
        )}
      </div>
    );
  };

  // Render unscheduled items
  if (grouped.unscheduled.length > 0) {
    result.push(
      <div
        className="items-center w-full bg-muted rounded-lg p-0 pb-2"
        key="unscheduled"
      >
        <div className="flex justify-between w-full items-center mb-4 milestone-grid bg-primary/10 rounded-t-lg p-4">
          <div className="milestone-name flex items-center gap-1">
            <DynamicIcon name="calendar-off" className="w-6 h-6 shrink-0" />
            <div className="truncate">
              {translationFunction("milestones.noMilestone")}
            </div>
          </div>
          <div className="milestone-dates flex justify-end">
            {isAdmin && (
              <AddSessionModal
                trigger={
                  <Button variant="default" size="sm">
                    <CirclePlus className="h-4 w-4" />
                    <span className="hidden md:inline">
                      {translationFunction("sessions.actions.add")}
                    </span>
                  </Button>
                }
              />
            )}
          </div>
        </div>
        {grouped.unscheduled.map((item) => (
          <div key={item.id} className="pl-4 pr-4">
            <div
              id={`${itemIdPrefix}-${item.id}`}
              className={`transition-all duration-500 ${
                newItemId === item.id ? "ring-2 ring-primary ring-offset-2" : ""
              }`}
            >
              <RenderItem
                item={item}
                isNew={newItemId === item.id}
                newItemId={newItemId}
                projectId={projectId}
              />
            </div>
          </div>
        ))}
        <div className="flex justify-end pr-4 pb-2"></div>
      </div>
    );
  }

  result.push(<div className="rounded-b-lg mb-4" key="spacer"></div>);

  // Render milestones with their items
  const sortedMilestones = sortMilestones(milestones);

  sortedMilestones.forEach((milestone) => {
    // Only render root milestones that have items or descendants with items
    if (!milestone.parentId && hasItems(milestone)) {
      renderMilestoneWithItems(milestone);
    }
  });

  return <>{result}</>;
};
