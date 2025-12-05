"use client";

import { useTranslations, useLocale } from "next-intl";
import { useSession } from "next-auth/react";
import { Link } from "~/lib/navigation";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn, type ClassValue } from "~/utils";
import { Skeleton } from "@/components/ui/skeleton";
import {
  HelpCircle,
  Clock,
  ListChecks,
  CalendarClock,
  SquarePlay,
  FlaskConical,
  CheckCircle2,
  MessageSquare,
} from "lucide-react";
import { useFindFirstStatus } from "~/lib/hooks";
import { toHumanReadable } from "~/utils/duration";
import { IssuesListDisplay } from "@/components/tables/IssuesListDisplay";
import { useQuery } from "@tanstack/react-query";
import type { MilestoneSummaryData } from "~/app/api/milestones/[milestoneId]/summary/route";

interface MilestoneSummaryProps {
  milestoneId: number;
  projectId?: string | number;
  className?: ClassValue;
}

export function MilestoneSummary({
  milestoneId,
  projectId,
  className,
}: MilestoneSummaryProps) {
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const { data: session } = useSession();

  // Fetch summary data from API
  const { data: summaryData, isLoading } = useQuery<MilestoneSummaryData>({
    queryKey: ["milestoneSummary", milestoneId],
    queryFn: async () => {
      const response = await fetch(`/api/milestones/${milestoneId}/summary`);
      if (!response.ok) {
        throw new Error("Failed to fetch milestone summary");
      }
      return response.json();
    },
    enabled: !!milestoneId,
    staleTime: 30000, // Cache for 30 seconds
  });

  const { data: firstStatus } = useFindFirstStatus({
    where: {
      isDeleted: false,
    },
    orderBy: {
      order: "asc",
    },
    include: {
      color: true,
    },
  });

  if (isLoading) {
    return (
      <div className={cn("flex flex-col space-y-1 w-full", className)}>
        <Skeleton className="h-2.5 w-full rounded-full" />
        <Skeleton className="h-5 w-40" />
      </div>
    );
  }

  if (!summaryData) {
    return (
      <div className={cn("flex flex-col space-y-1 w-full", className)}>
        <div className="flex items-center gap-1 text-muted-foreground text-xs">
          <HelpCircle className="w-4 h-4" />
          <span>{tCommon("labels.noResults")}</span>
        </div>
      </div>
    );
  }

  // If there are no items, show a default message
  if (summaryData.totalItems === 0 || summaryData.segments.length === 0) {
    return (
      <div className={cn("flex flex-col space-y-1 w-full", className)}>
        <TooltipProvider>
          <div className="flex h-2.5 w-full rounded-full overflow-hidden">
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className="h-full w-full transition-all hover:opacity-80 cursor-default"
                  style={{
                    backgroundColor: firstStatus?.color?.value || "#B1B2B3",
                  }}
                  aria-label={tCommon("labels.noResults")}
                />
              </TooltipTrigger>
              <TooltipContent
                side="top"
                className="border-0 px-3 py-2"
                style={{
                  backgroundColor: firstStatus?.color?.value || "#B1B2B3",
                }}
              >
                <div className="font-semibold text-sm">
                  {firstStatus?.name || tCommon("labels.untested")}
                </div>
                <div className="text-xs opacity-90">
                  {tCommon("labels.noResults")}
                </div>
              </TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>

        <div className="flex items-center gap-1 text-muted-foreground text-xs">
          <HelpCircle className="w-4 h-4" />
          <span>{tCommon("labels.noResults")}</span>
        </div>
      </div>
    );
  }

  // Calculate total elapsed time text
  const totalElapsedText =
    summaryData.totalElapsed > 0
      ? toHumanReadable(summaryData.totalElapsed, {
          isSeconds: true,
          locale,
        })
      : "";

  // Calculate total estimate time text
  const totalEstimateText =
    summaryData.totalEstimate > 0
      ? toHumanReadable(summaryData.totalEstimate, {
          isSeconds: true,
          locale,
        })
      : "";

  // Count test runs and sessions
  const testRunCount = new Set(
    summaryData.segments
      .filter((s) => s.type === "test-run")
      .map((s) => s.sourceId)
  ).size;
  const sessionCount = new Set(
    summaryData.segments
      .filter((s) => s.type === "session")
      .map((s) => s.sourceId)
  ).size;

  return (
    <div className={cn("flex flex-col space-y-1 w-full", className)}>
      {/* Color bar for milestone items */}
      <TooltipProvider>
        <div
          className="flex h-2.5 w-full rounded-full overflow-hidden bg-muted"
          data-testid="milestone-summary-bar"
        >
          {summaryData.segments.map((segment, index) => {
            const color = segment.colorValue || "#9ca3af";

            // Calculate segment width based on elapsed time or item count
            const minSegmentWidth = 3;
            let segmentWidth = 100 / summaryData.totalItems;

            // If we have elapsed time data, make width proportional to elapsed time
            if (summaryData.totalElapsed > 0 && !segment.isPending) {
              const proportionalWidth =
                ((segment.elapsed || 0) / summaryData.totalElapsed) * 100;
              segmentWidth = Math.max(proportionalWidth, minSegmentWidth);
            } else if (summaryData.totalElapsed > 0 && segment.isPending) {
              segmentWidth = minSegmentWidth;
            }

            const targetUrl =
              segment.type === "test-run"
                ? `/projects/runs/${projectId}/${segment.sourceId}`
                : `/projects/sessions/${projectId}/${segment.sourceId}`;

            return (
              <Tooltip key={segment.id}>
                <TooltipTrigger asChild>
                  <Link
                    href={targetUrl}
                    className="h-full transition-all hover:opacity-80 cursor-pointer border-x-[0.5px] border-primary-foreground rounded-sm"
                    style={{
                      backgroundColor: color,
                      width: `${segmentWidth}%`,
                      minWidth: "4px",
                    }}
                    aria-label={segment.sourceName}
                  />
                </TooltipTrigger>
                <TooltipContent
                  className="border-0 text-muted px-3 py-2"
                  style={{ backgroundColor: color }}
                >
                  <div className="flex items-center gap-1 font-semibold text-sm">
                    <div className="rounded-full bg-muted w-2 h-2" />
                    {segment.statusName || tCommon("labels.untested")}
                  </div>
                  <div className="text-xs opacity-90 mt-1">
                    <div className="flex items-center gap-1">
                      {segment.type === "test-run" ? (
                        <SquarePlay className="h-3 w-3" />
                      ) : (
                        <FlaskConical className="h-3 w-3" />
                      )}
                      {segment.sourceName}
                    </div>
                    {segment.itemCount && segment.itemCount > 1 && (
                      <div className="flex items-center gap-1 mt-0.5">
                        <ListChecks className="h-3 w-3" />
                        {`${segment.itemCount} ${tCommon("plural.case", {
                          count: segment.itemCount,
                        })}`}
                      </div>
                    )}
                  </div>
                  {!segment.isPending &&
                  segment.elapsed &&
                  segment.elapsed > 0 ? (
                    <div className="text-xs opacity-90 mt-1">
                      <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {toHumanReadable(segment.elapsed, {
                          isSeconds: true,
                          locale,
                        })}
                      </div>
                    </div>
                  ) : segment.isPending &&
                    segment.estimate &&
                    segment.estimate > 0 ? (
                    <div className="text-xs opacity-90 mt-1">
                      <div className="flex items-center gap-1">
                        <CalendarClock className="h-3 w-3" />
                        {`${tCommon("fields.totalEstimate")}: ${toHumanReadable(
                          segment.estimate,
                          {
                            isSeconds: true,
                            locale,
                          }
                        )}`}
                      </div>
                    </div>
                  ) : null}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </TooltipProvider>

      {/* Container for Summary Text and Issues */}
      <div className="flex justify-between items-center">
        {/* Summary text below the bar */}
        <div
          className="text-muted-foreground text-xs truncate grow mr-2"
          title={`${testRunCount} ${tCommon("plural.run", { count: testRunCount })}, ${sessionCount} ${tCommon("plural.session", { count: sessionCount })}${totalElapsedText ? ` • ${tCommon("fields.totalElapsed")}: ${totalElapsedText}` : ""}${totalEstimateText ? ` • ${tCommon("fields.totalEstimate")}: ${totalEstimateText}` : ""}`}
        >
          {`${testRunCount} ${tCommon("plural.run", { count: testRunCount })}, ${sessionCount} ${tCommon("plural.session", { count: sessionCount })}`}
          {totalElapsedText ? (
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="inline-flex items-center ml-1 cursor-default"
                    data-testid="total-elapsed-display"
                  >
                    {" • "}
                    <Clock className="h-3 w-3 ml-1" />
                    {`${totalElapsedText}`}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {`${tCommon("fields.totalElapsed")}: ${totalElapsedText}`}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            ""
          )}
          {totalEstimateText ? (
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="inline-flex items-center ml-1 cursor-default"
                    data-testid="total-estimate-display"
                  >
                    {" • "}
                    <CalendarClock className="h-3 w-3 ml-1" />
                    {`${totalEstimateText}`}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {`${tCommon("fields.totalEstimate")}: ${totalEstimateText}`}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            ""
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Display completion percentage */}
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <CheckCircle2 className="h-3 w-3" />
                  <span className="font-medium">
                    {summaryData.completionRate.toFixed(2)}
                    {"%"}
                  </span>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {tCommon("fields.completionRate")}:{" "}
                {summaryData.completionRate.toFixed(2)}
                {"%"}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Display comments count if any exist */}
          {summaryData.commentsCount > 0 && (
            <Link
              href={`/projects/milestones/${projectId}/${milestoneId}#comments`}
              className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors text-xs"
            >
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex items-center gap-1">
                      <MessageSquare className="h-3 w-3" />
                      {summaryData.commentsCount}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {tCommon("plural.comment", {
                      count: summaryData.commentsCount,
                    })}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </Link>
          )}

          {/* Display aggregated issues list if any exist */}
          {summaryData.issues && summaryData.issues.length > 0 && (
            <div>
              <IssuesListDisplay issues={summaryData.issues} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default MilestoneSummary;
