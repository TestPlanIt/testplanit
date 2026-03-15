"use client";

import { CalendarDisplay } from "@/components/DateCalendarDisplay";
import { DateTextDisplay } from "@/components/DateTextDisplay";
import { ForecastDisplay } from "@/components/ForecastDisplay";
import { MilestoneIconAndName } from "@/components/MilestoneIconAndName";
import { MilestoneSummary } from "@/components/MilestoneSummary";
import TextFromJson from "@/components/TextFromJson";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { parseISO } from "date-fns";
import {
  CheckCircle, MoreVertical, RotateCcw,
  SquarePen, SquarePlay,
  StopCircle, Trash2
} from "lucide-react";
import type { Session } from "next-auth";
import { useTranslations } from "next-intl";
import React, { useEffect, useState } from "react";
import LoadingSpinner from "~/components/LoadingSpinner";
import {
  ColorMap, getStatus,
  getStatusStyle, MilestonesWithTypes
} from "~/utils/milestoneUtils";

interface MilestoneForecastData {
  manualEstimate: number;
  mixedEstimate: number;
  automatedEstimate: number;
  areAllCasesAutomated: boolean;
}

interface MilestoneItemCardProps {
  milestone: MilestonesWithTypes;
  projectId?: number;
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
  compact?: boolean;
}

const MilestoneItemCard: React.FC<MilestoneItemCardProps> = ({
  milestone,
  projectId,
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
  compact = false,
}) => {
  const t = useTranslations("milestones");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");

  const [milestoneForecast, setMilestoneForecast] =
    useState<MilestoneForecastData | null>(null);
  const [isLoadingForecast, setIsLoadingForecast] = useState(false);

  useEffect(() => {
    const fetchMilestoneForecast = async () => {
      if (!milestone.id) return;
      setIsLoadingForecast(true);
      try {
        const response = await fetch(
          `/api/milestones/${milestone.id}/forecast`
        );
        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }
        const data: MilestoneForecastData = await response.json();
        setMilestoneForecast(data);
      } catch (error) {
        console.error(
          `Failed to fetch milestone forecast for ${milestone.id}:`,
          error
        );
        setMilestoneForecast(null);
      } finally {
        setIsLoadingForecast(false);
      }
    };

    fetchMilestoneForecast();
  }, [milestone.id]);

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

  return (
    <div
      className={`overflow-auto relative flex flex-col gap-1 ${compact ? "" : "sm:grid sm:grid-cols-[1fr_auto_1fr] sm:gap-4 sm:items-center sm:border-4"} w-full my-2 p-2 border-2 rounded-lg shadow-xs`}
      style={{
        backgroundColor: bg,
        borderColor: border,
        marginLeft: `${level * 20}px`,
        width: `calc(100% - ${level * 20}px)`,
      }}
    >
      {/* Mobile: flex row with name+badge+actions. Desktop: children become grid columns via sm:contents */}
      <div className={`flex items-center gap-2 ${compact ? "" : "sm:contents"}`}>
        {/* Column 1: Details, Dates */}
        <div className="flex items-start flex-1 min-w-0">
          {startDate && (
            <div className={`${compact ? "hidden" : "hidden sm:block"} mr-4 pt-1`}>
              <CalendarDisplay date={startDate} />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <MilestoneIconAndName
              milestone={milestone}
              projectId={projectId}
            />
            <p className={`${compact ? "hidden" : "hidden sm:block"} text-md text-muted-foreground ml-7`}>
              <TextFromJson
                jsonString={milestone.note as string}
                format="text"
                room={`milestone-note-${milestone.id}`}
                expand={false}
              />
            </p>
            <div className={`${compact ? "hidden" : "hidden sm:block"} ml-7`}>
              <DateTextDisplay
                startDate={startDate}
                endDate={endDate}
                isCompleted={milestone.isCompleted}
              />
            </div>
          </div>
        </div>

        {/* Column 2: Status Badge */}
        <div className={`flex shrink-0 ${compact ? "" : "sm:w-24"} justify-center`}>
          <Badge
            style={{ backgroundColor: badge }}
            className="text-foreground border-2 border-secondary-foreground text-sm"
          >
            {t(`statusLabels.${status}` as any)}
          </Badge>
        </div>

        {/* Column 3: End Date Calendar, Actions */}
        <div className={`flex items-center shrink-0 ${compact ? "" : "sm:justify-end sm:space-x-2"}`}>
          {endDate && (
            <div className={compact ? "hidden" : "hidden sm:block"}>
              <CalendarDisplay
                date={endDate}
                showYear={milestone.isCompleted}
              />
            </div>
          )}
          {(session.user.access === "ADMIN" ||
            session.user.access === "PROJECTADMIN") && (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="secondary"
                  size="icon"
                  className="p-0 m-0 h-7 w-7"
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuGroup>
                  {!milestone.isStarted && !milestone.isCompleted && (
                    <DropdownMenuItem
                      onSelect={() => onStartMilestone(milestone)}
                    >
                      <SquarePlay className="w-5 h-5 mr-2" />
                      {tGlobal("common.actions.start")}
                    </DropdownMenuItem>
                  )}
                  {milestone.isStarted && !milestone.isCompleted && (
                    <>
                      <DropdownMenuItem
                        onSelect={() => onOpenCompleteDialog(milestone)}
                      >
                        <CheckCircle className="w-5 h-5 mr-2" />
                        {tGlobal("common.actions.complete")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => onStopMilestone(milestone)}
                      >
                        <StopCircle className="w-5 h-5 mr-2" />
                        {t("status.stop")}
                      </DropdownMenuItem>
                    </>
                  )}
                  {milestone.isCompleted && (
                    <DropdownMenuItem
                      onSelect={() => onReopenMilestone(milestone)}
                      disabled={isParentCompleted(milestone.parentId)}
                    >
                      <RotateCcw className="w-5 h-5 mr-2" />
                      {t("status.reopen")}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    onSelect={() => onOpenEditModal(milestone)}
                  >
                    <div className="flex items-center">
                      <SquarePen className="w-5 h-5 mr-2" />
                      {tCommon("actions.edit")}
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => onOpenDeleteModal(milestone)}
                    className="text-destructive hover:text-destructive-foreground"
                  >
                    <div className="flex items-center">
                      <Trash2 className="w-5 h-5 mr-2" />
                      {tCommon("actions.delete")}
                    </div>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Mobile-only: date text as its own row */}
      <div className={`${compact ? "" : "sm:hidden"} ml-7`}>
        <DateTextDisplay
          startDate={startDate}
          endDate={endDate}
          isCompleted={milestone.isCompleted}
        />
      </div>

      {/* Milestone Summary - spans all columns on desktop */}
      <div className={`${compact ? "" : "sm:col-span-3"} border-t`}>
        <MilestoneSummary milestoneId={milestone.id} projectId={projectId} />

        {/* Forecast Section - below summary */}
        <div className="text-xs text-muted-foreground">
          {isLoadingForecast ? (
            <div className="flex items-center gap-1">
              <LoadingSpinner className="w-3 h-3" />
            </div>
          ) : milestoneForecast ? (
            <div className="flex flex-col gap-0.5 items-start">
              {milestoneForecast.manualEstimate > 0 && (
                <ForecastDisplay
                  seconds={milestoneForecast.manualEstimate}
                  type="manual"
                  className="text-xs text-start"
                />
              )}
              {milestoneForecast.automatedEstimate > 0 && (
                <ForecastDisplay
                  seconds={milestoneForecast.automatedEstimate}
                  type="automated"
                  className="text-xs text-start"
                  round={false}
                />
              )}
              {milestoneForecast.mixedEstimate > 0 &&
                milestoneForecast.mixedEstimate !==
                  milestoneForecast.manualEstimate &&
                milestoneForecast.mixedEstimate !==
                  milestoneForecast.automatedEstimate && (
                  <ForecastDisplay
                    seconds={milestoneForecast.mixedEstimate}
                    type="mixed"
                    className="text-xs text-start"
                    round={false}
                  />
                )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default MilestoneItemCard;
