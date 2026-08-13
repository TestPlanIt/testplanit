"use client";

import { DateTextDisplay } from "@/components/DateTextDisplay";
import { RecordKeyMenuItem } from "@/components/RecordKeyMenuItem";
import { MilestoneForecastChips } from "@/components/MilestoneForecastChips";
import { MilestoneSummary } from "@/components/MilestoneSummary";
import { CalendarDisplay } from "@/components/DateCalendarDisplay";
import DynamicIcon from "@/components/DynamicIcon";
import { ItemRow } from "@/components/ItemRow";
import TextFromJson from "@/components/TextFromJson";
import { Badge } from "@/components/ui/badge";
import {
  MilestoneSourceBadge,
  type MilestoneIntegrationProject,
} from "@/components/MilestoneSourceBadge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { parseISO } from "date-fns";
import {
  CheckCircle,
  MoreVertical,
  RotateCcw,
  SquarePen,
  SquarePlay,
  StopCircle,
  Trash2,
} from "lucide-react";
import type { Session } from "next-auth";
import { useTranslations } from "next-intl";
import React from "react";
import {
  ColorMap,
  getStatus,
  getStatusStyle,
  MilestonesWithTypes,
} from "~/utils/milestoneUtils";
import type { IconName } from "~/types/globals";

interface MilestoneItemCardProps {
  milestone: MilestonesWithTypes;
  projectId?: number;
  /** Active IntegrationProject mappings, forwarded to the source badge to
   * render the Jira project ("space") segment. */
  integrationProjects?: MilestoneIntegrationProject[] | null;
  theme: string | undefined;
  colorMap: ColorMap | null;
  session: Session | null;
  isParentCompleted: (parentId: number | null) => boolean;
  onOpenCompleteDialog: (milestone: MilestonesWithTypes) => void;
  onStartMilestone: (milestone: MilestonesWithTypes) => Promise<void>;
  onStopMilestone: (milestone: MilestonesWithTypes) => Promise<void>;
  onReopenMilestone: (milestone: MilestonesWithTypes) => Promise<void>;
  onOpenEditModal: (milestone: MilestonesWithTypes) => void;
  onOpenDeleteModal: (milestone: MilestonesWithTypes) => void;
  level?: number;
}

const MilestoneItemCard: React.FC<MilestoneItemCardProps> = ({
  milestone,
  projectId,
  integrationProjects,
  theme,
  colorMap,
  session,
  isParentCompleted,
  onOpenCompleteDialog,
  onStartMilestone,
  onStopMilestone,
  onReopenMilestone,
  onOpenEditModal,
  onOpenDeleteModal,
  level = 0,
}) => {
  const t = useTranslations("milestones");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");

  if (!session || !colorMap) return null;

  const startDate = milestone.startedAt
    ? parseISO(milestone.startedAt.toISOString())
    : null;
  const endDate = milestone.completedAt
    ? parseISO(milestone.completedAt.toISOString())
    : null;
  const status = getStatus(milestone);
  const { bg, border, badge } = getStatusStyle(
    status,
    theme || "light",
    colorMap
  );
  // Start/Stop/Complete/Reopen write isStarted/isCompleted/startedAt/
  // completedAt, all locked by @deny('update', integrationId != null) for
  // synced milestones — hide those actions instead of offering ones that
  // always fail. The tracker owns a synced milestone's lifecycle.
  const isSynced = milestone.integrationId != null;

  const canManage =
    session.user.access === "ADMIN" || session.user.access === "PROJECTADMIN";

  return (
    // Nesting offset lives on a wrapper so the row itself stays a plain
    // full-width block — it is the query container, and its width has to be
    // the width the content actually gets.
    <div
      style={{
        marginInlineStart: `${level * 20}px`,
        width: `calc(100% - ${level * 20}px)`,
      }}
    >
      <ItemRow
        leading={
          startDate ? (
            <div className="flex shrink-0 overflow-hidden max-w-0 opacity-0 transition-all duration-200 ease-out motion-reduce:transition-none @2xl:max-w-20 @2xl:opacity-100 @2xl:me-3">
              <CalendarDisplay date={startDate} />
            </div>
          ) : null
        }
        trailing={
          endDate ? (
            <div className="flex shrink-0 overflow-hidden max-w-0 opacity-0 transition-all duration-200 ease-out motion-reduce:transition-none @2xl:max-w-20 @2xl:opacity-100 @2xl:ms-3">
              <CalendarDisplay
                date={endDate}
                showYear={milestone.isCompleted}
              />
            </div>
          ) : null
        }
        href={
          projectId
            ? `/projects/milestones/${projectId}/${milestone.id}`
            : `/milestone/${milestone.id}`
        }
        name={milestone.name}
        surface={{ background: bg, border }}
        icon={
          <DynamicIcon
            name={
              (milestone.milestoneType?.icon?.name as IconName) || "milestone"
            }
            className="h-5 w-5 shrink-0"
          />
        }
        adornments={[
          {
            key: "source",
            tier: "lg",
            // The badge measures itself and sheds segments down to its icon;
            // let it negotiate with the name directly rather than through a
            // wrapper of ours.
            bare: true,
            content: (
              <MilestoneSourceBadge
                milestone={milestone}
                projectId={projectId}
                integrationProjects={integrationProjects}
              />
            ),
          },
        ]}
        identityChips={[
          (startDate || endDate) && {
            key: "dates",
            // A clipped date range is unreadable, so it collapses whole once
            // the row is too narrow to seat it. Bounded above as well: from
            // @2xl the calendar blocks on the card edges carry the same dates,
            // and the two must never render together.
            tier: "md",
            maxTier: "2xl",
            pinned: true,
            content: (
              <span className="whitespace-nowrap text-sm truncate">
                <DateTextDisplay
                  responsive
                  dateOnly
                  startDate={startDate}
                  endDate={endDate}
                  isCompleted={milestone.isCompleted}
                />
              </span>
            ),
          },
        ]}
        state={
          <Badge
            style={{ backgroundColor: badge }}
            className="text-foreground border-2 border-secondary-foreground text-sm whitespace-nowrap"
          >
            {t(`statusLabels.${status}` as any)}
          </Badge>
        }
        actions={
          canManage && (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="secondary"
                  size="icon"
                  className="p-0 m-0 h-7 w-7"
                  aria-label={tCommon("actions.actionsLabel")}
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuGroup>
                  {!isSynced &&
                    !milestone.isStarted &&
                    !milestone.isCompleted && (
                      <DropdownMenuItem
                        onSelect={() => onStartMilestone(milestone)}
                      >
                        <SquarePlay className="w-5 h-5 me-2" />
                        {tGlobal("common.actions.start")}
                      </DropdownMenuItem>
                    )}
                  {!isSynced &&
                    milestone.isStarted &&
                    !milestone.isCompleted && (
                      <DropdownMenuItem
                        onSelect={() => onStopMilestone(milestone)}
                      >
                        <StopCircle className="w-5 h-5 me-2" />
                        {t("status.stop")}
                      </DropdownMenuItem>
                    )}
                  {!isSynced && milestone.isCompleted && (
                    <DropdownMenuItem
                      onSelect={() => onReopenMilestone(milestone)}
                      disabled={isParentCompleted(milestone.parentId)}
                    >
                      <RotateCcw className="w-5 h-5 me-2" />
                      {t("status.reopen")}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onSelect={() => onOpenEditModal(milestone)}>
                    <div className="flex items-center">
                      <SquarePen className="w-5 h-5 me-2" />
                      {tCommon("actions.edit")}
                    </div>
                  </DropdownMenuItem>
                  {!isSynced &&
                    milestone.isStarted &&
                    !milestone.isCompleted && (
                      <DropdownMenuItem
                        onSelect={() => onOpenCompleteDialog(milestone)}
                      >
                        <CheckCircle className="w-5 h-5 me-2" />
                        {tGlobal("common.actions.complete")}
                      </DropdownMenuItem>
                    )}
                  <RecordKeyMenuItem
                    type="MILESTONE"
                    id={milestone.id}
                    projectId={projectId}
                  />
                  <DropdownMenuItem
                    onSelect={() => onOpenDeleteModal(milestone)}
                    className="text-destructive hover:text-destructive-foreground"
                  >
                    <div className="flex items-center">
                      <Trash2 className="w-5 h-5 me-2" />
                      {tCommon("actions.delete")}
                    </div>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )
        }
        chips={[
          {
            key: "forecast",
            // Two short durations, and the only place the milestone's
            // outstanding effort appears in a list — it stays at every width.
            tier: "base",
            content: <MilestoneForecastChips milestoneId={milestone.id} />,
          },
        ]}
        progress={
          <MilestoneSummary milestoneId={milestone.id} projectId={projectId} />
        }
        noteBelowName
        noteTier="base"
        note={
          milestone.note ? (
            <span className="pl-6">
              <TextFromJson
                jsonString={milestone.note as string}
                format="text"
                room={`milestone-note-${milestone.id}`}
              />
            </span>
          ) : null
        }
      />
    </div>
  );
};

export default MilestoneItemCard;
