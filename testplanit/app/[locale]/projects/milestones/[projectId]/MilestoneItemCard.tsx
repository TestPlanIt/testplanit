"use client";

import React, { useEffect, useState } from "react";
import { parseISO } from "date-fns";
import {
  MilestonesWithTypes,
  getStatus,
  getStatusStyle,
  ColorMap,
} from "~/utils/milestoneUtils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  MoreVertical,
  SquarePlay,
  StopCircle,
  CheckCircle,
  RotateCcw,
  SquarePen,
  Trash2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MilestoneIconAndName } from "@/components/MilestoneIconAndName";
import { CalendarDisplay } from "@/components/DateCalendarDisplay";
import { DateTextDisplay } from "@/components/DateTextDisplay";
import TextFromJson from "@/components/TextFromJson";
import { useTranslations } from "next-intl";
import LoadingSpinner from "~/components/LoadingSpinner";
import { ForecastDisplay } from "@/components/ForecastDisplay";
import { MilestoneSummary } from "@/components/MilestoneSummary";
import type { Session } from "next-auth";

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
}) => {
  const t = useTranslations("milestones");
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
      className={`overflow-auto relative grid grid-cols-[1fr_auto_1fr] gap-4 items-center w-full my-2 p-2 border-4 rounded-lg shadow-xs`}
      style={{
        backgroundColor: bg,
        borderColor: border,
        marginLeft: `${level * 20}px`,
        width: `calc(100% - ${level * 20}px)`,
      }}
    >
      {/* Column 1: Details, Dates */}
      <div className="flex items-start">
        {milestone.isCompleted
          ? startDate && (
              <div className="mr-4 pt-1">
                <CalendarDisplay date={startDate} />
              </div>
            )
          : startDate &&
            !milestone.isCompleted && (
              <div className="mr-4 pt-1">
                <CalendarDisplay date={startDate} />
              </div>
            )}
        <div className="flex-1">
          <MilestoneIconAndName milestone={milestone} projectId={projectId} />
          <p className="text-md text-muted-foreground ml-7">
            <TextFromJson
              jsonString={milestone.note as string}
              format="text"
              room={`milestone-note-${milestone.id}`}
              expand={false}
            />
          </p>
          <div className="ml-7">
            <DateTextDisplay
              startDate={startDate}
              endDate={endDate}
              isCompleted={milestone.isCompleted}
            />
          </div>
        </div>
      </div>

      {/* Column 2: Status Badge */}
      <div className="flex w-24 justify-center">
        <Badge
          style={{ backgroundColor: badge }}
          className="text-secondary-background border-2 border-secondary-foreground text-sm"
        >
          {t(`statusLabels.${status}` as any)}
        </Badge>
      </div>

      {/* Column 3: End Date Calendar, Actions */}
      <div className="flex items-center justify-end space-x-2">
        {endDate && (
          <CalendarDisplay date={endDate} showYear={milestone.isCompleted} />
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
                    {t("status.start")}
                  </DropdownMenuItem>
                )}
                {milestone.isStarted && !milestone.isCompleted && (
                  <>
                    <DropdownMenuItem
                      onSelect={() => onOpenCompleteDialog(milestone)}
                    >
                      <CheckCircle className="w-5 h-5 mr-2" />
                      {t("status.complete")}
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
                <DropdownMenuItem onSelect={() => onOpenEditModal(milestone)}>
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

      {/* Milestone Summary - spans all columns */}
      <div className="col-span-3 border-t">
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
