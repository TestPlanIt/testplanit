"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "~/lib/navigation";
import { Badge } from "@/components/ui/badge";
import { MilestoneIconAndName } from "@/components/MilestoneIconAndName";
import { DateTextDisplay } from "@/components/DateTextDisplay";
import { getStatus, getStatusStyle, ColorMap } from "~/utils/milestoneUtils";
import { useTranslations } from "next-intl";
import LoadingSpinner from "~/components/LoadingSpinner";
import type { MilestonesWithTypes } from "~/utils/milestoneUtils"; // Assuming this type exists and is relevant
import { ForecastDisplay } from "@/components/ForecastDisplay";

interface MilestoneForecastData {
  manualEstimate: number;
  mixedEstimate: number;
  automatedEstimate: number;
  areAllCasesAutomated: boolean;
}

interface ChildMilestoneItemProps {
  milestone: MilestonesWithTypes; // Or a more specific type for child milestones
  projectId: string | number;
  theme: string | undefined;
  colorMap: ColorMap | null;
  level: number;
  onMilestoneClick: (milestoneId: number) => (e: React.MouseEvent) => void;
  renderChildNodes: (
    milestones: MilestonesWithTypes[],
    parentId: number,
    level: number
  ) => React.ReactNode[];
  allMilestones: MilestonesWithTypes[]; // All milestones to find children of this child
}

export default function ChildMilestoneItem({
  milestone,
  projectId,
  theme,
  colorMap,
  level,
  onMilestoneClick,
  renderChildNodes,
  allMilestones,
}: ChildMilestoneItemProps) {
  const t = useTranslations("milestones");
  const tRuns = useTranslations("runs");
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
          //   throw new Error(`API error: ${response.status}`);
          // Do not throw error, just set forecast to null and let UI handle it
          console.error(
            `API error fetching forecast for milestone ${milestone.id}: ${response.status}`
          );
          setMilestoneForecast(null);
          return;
        }
        const data: MilestoneForecastData = await response.json();
        setMilestoneForecast(data);
      } catch (error) {
        console.error(
          `Failed to fetch milestone forecast for ${milestone.id}:`,
          error
        );
        setMilestoneForecast(null);
        // No toast here to avoid flooding if many children fail
      } finally {
        setIsLoadingForecast(false);
      }
    };

    fetchMilestoneForecast();
  }, [milestone.id]);

  return (
    <React.Fragment>
      <div
        className="flex flex-col gap-1 hover:bg-accent/50 rounded-md p-2 cursor-pointer"
        style={{ marginLeft: `${level * 16}px` }}
        onClick={onMilestoneClick(milestone.id)}
      >
        <div className="grid grid-cols-[1fr,auto] w-full items-start gap-x-2">
          <div className="flex items-center gap-x-2">
            <MilestoneIconAndName
              milestone={milestone}
              projectId={Number(projectId)}
            />
            {isLoadingForecast ? (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <LoadingSpinner />
                <span>
                  {tCommon("loading")}
                  {"..."}
                </span>
              </div>
            ) : milestoneForecast ? (
              (() => {
                const {
                  manualEstimate,
                  automatedEstimate,
                  areAllCasesAutomated,
                } = milestoneForecast;
                const displays: React.ReactNode[] = [];

                if (areAllCasesAutomated) {
                  if (automatedEstimate > 0) {
                    displays.push(
                      <ForecastDisplay
                        key="auto"
                        seconds={automatedEstimate}
                        type="automated"
                        className="text-xs"
                      />
                    );
                  }
                } else {
                  if (manualEstimate > 0) {
                    displays.push(
                      <ForecastDisplay
                        key="manual"
                        seconds={manualEstimate}
                        type="manual"
                        className="text-xs"
                      />
                    );
                  }
                  if (automatedEstimate > 0) {
                    displays.push(
                      <ForecastDisplay
                        key="auto"
                        seconds={automatedEstimate}
                        type="automated"
                        className="text-xs"
                      />
                    );
                  }
                }

                if (displays.length > 0) {
                  return (
                    <div className="flex items-center gap-x-1.5 text-muted-foreground">
                      {displays}
                    </div>
                  );
                }
                return null;
              })()
            ) : null}
          </div>
          <div className="flex items-center gap-2 min-w-[200px] justify-end pt-0.5">
            {colorMap && (
              <Badge
                style={{
                  backgroundColor: getStatusStyle(
                    getStatus(milestone),
                    theme || "light",
                    colorMap
                  ).badge,
                }}
                className="text-secondary-background border-2 border-secondary-foreground text-sm min-w-[100px] text-center"
              >
                {t(`statusLabels.${getStatus(milestone)}` as any)}
              </Badge>
            )}
            <div className="min-w-[200px] text-right">
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
      </div>
      {renderChildNodes(allMilestones, milestone.id, level + 1)}
    </React.Fragment>
  );
}
