"use client";

import { useFindFirstStatus } from "~/lib/hooks";
import { useTranslations, useLocale } from "next-intl";
import { useSession } from "next-auth/react";
import { useParams } from "next/navigation";
import { Link } from "~/lib/navigation";
import { ElapsedTime } from "./ElapsedTime";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "~/utils";
import { DateFormatter } from "@/components/DateFormatter";
import { Clock, Timer, MessageCircle } from "lucide-react";
import { toHumanReadable } from "~/utils/duration";
import { Skeleton } from "@/components/ui/skeleton";
import { IssuesListDisplay } from "@/components/tables/IssuesListDisplay";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SessionSummaryData } from "~/app/api/sessions/[sessionId]/summary/route";

interface SessionResultsSummaryProps {
  sessionId: number;
  className?: string;
  textSize?: "xs" | "sm" | "md";
}

export function SessionResultsSummary({
  sessionId,
  className,
  textSize = "xs",
}: SessionResultsSummaryProps) {
  const t = useTranslations();
  const locale = useLocale();
  const { data: session } = useSession();
  const params = useParams();
  const projectId = params.projectId as string;

  // Get user date and time format preferences
  const dateTimeFormat =
    session?.user.preferences?.dateFormat &&
    session?.user.preferences?.timeFormat
      ? `${session.user.preferences.dateFormat} ${session.user.preferences.timeFormat}`
      : undefined;

  // Fetch session summary data from API
  const { data: summaryData, isLoading } = useQuery<SessionSummaryData>({
    queryKey: ["sessionSummary", sessionId],
    queryFn: async () => {
      const response = await fetch(`/api/sessions/${sessionId}/summary`);
      if (!response.ok) {
        throw new Error("Failed to fetch session summary");
      }
      return response.json();
    },
    enabled: !!sessionId,
    staleTime: 30000, // Cache for 30 seconds
  });

  // Aggregate all unique issues from the results AND the session
  const allIssues = useMemo(() => {
    if (!summaryData) return [];

    const combinedIssues: Array<{
      id: number;
      name: string;
      title: string;
      externalKey: string | null;
      integrationId: number | null;
      projectIds: number[];
    }> = [];
    const issueIds = new Set<number>();

    // Add session-level issues first
    summaryData.sessionIssues?.forEach((issue) => {
      if (!issueIds.has(issue.id)) {
        combinedIssues.push({
          ...issue,
          projectIds: projectId ? [Number(projectId)] : [],
        });
        issueIds.add(issue.id);
      }
    });

    // Add result-level issues
    summaryData.resultIssues?.forEach((issue) => {
      if (!issueIds.has(issue.id)) {
        combinedIssues.push({
          ...issue,
          projectIds: projectId ? [Number(projectId)] : [],
        });
        issueIds.add(issue.id);
      }
    });

    return combinedIssues;
  }, [summaryData, projectId]);

  // Fetch the first status (typically "Untested" or similar) for the default bar
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
        <Skeleton className="h-5 w-20 mt-1" />
      </div>
    );
  }

  // If there are no results, show default "No elapsed time" and a default status bar
  if (!summaryData || summaryData.results.length === 0) {
    return (
      <div className={cn("flex flex-col space-y-1 w-full", className)}>
        {/* Show a default status bar at the top */}
        <TooltipProvider>
          <div className="h-2.5 w-full rounded-full overflow-hidden">
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  href={`/projects/sessions/${projectId}/${sessionId}`}
                  className="h-full w-full transition-all hover:opacity-80 cursor-pointer border-x-[0.5px] rounded-sm"
                  style={{
                    backgroundColor: firstStatus?.color?.value || "#B1B2B3",
                    display: "block",
                  }}
                  aria-label={t("sessions.actions.viewSessionDetails")}
                />
              </TooltipTrigger>
              <TooltipContent
                side="top"
                className="border-0 text-white px-3 py-2"
                style={{
                  backgroundColor: firstStatus?.color?.value || "#B1B2B3",
                }}
              >
                <div className="font-semibold text-sm">
                  {firstStatus?.name || t("common.labels.untested")}
                </div>
                <div className="text-xs opacity-90">
                  {t("common.labels.noResults")}
                </div>
              </TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>

        {/* Show "No results recorded" message below */}
        <div
          className={cn("flex items-center gap-1 text-muted-foreground", {
            "text-xs": textSize === "xs",
            "text-sm": textSize === "sm",
            "text-md": textSize === "md",
          })}
        >
          <Timer className="w-4 h-4" />
          <span>{t("common.labels.noResults")}</span>
        </div>
      </div>
    );
  }

  // Check if there are results but no elapsed time recorded
  const totalElapsed = summaryData.totalElapsed;
  const hasElapsed = totalElapsed > 0;

  return (
    <div className={cn("flex flex-col space-y-1 w-full", className)}>
      {/* Color bar for results at the top */}
      <TooltipProvider>
        <div className="flex h-2.5 w-full rounded-full overflow-hidden">
          {summaryData.results.map((result, index) => {
            const color = result.statusColorValue || "#B1B2B3";
            // Calculate width: equal distribution if no duration, or proportional if durations exist

            // Ensure each segment is visible with a minimum width
            let width;
            if (hasElapsed) {
              // If this result has elapsed time, make it proportional
              if (result.elapsed && result.elapsed > 0) {
                width = `${Math.max(5, (result.elapsed / totalElapsed) * 100)}%`;
              } else {
                // If no elapsed time but others have it, give it a minimum width
                width = "5%";
              }
            } else {
              // Equal distribution if no elapsed times
              width = `${100 / summaryData.results.length}%`;
            }

            // Get issues for this result
            const resultIssues = summaryData.resultIssues.filter((issue) =>
              result.issueIds.includes(issue.id)
            );

            return (
              <Tooltip key={result.id}>
                <TooltipTrigger asChild>
                  <Link
                    href={`/projects/sessions/${projectId}/${sessionId}#result-${result.id}`}
                    className="border-x border-primary-foreground rounded-sm h-full transition-all hover:opacity-80 cursor-pointer"
                    style={{
                      backgroundColor: color,
                      width: width,
                      minWidth: "4px",
                      display: "block",
                    }}
                    aria-label={`View ${result.statusName} result details`}
                  />
                </TooltipTrigger>
                <TooltipContent
                  className="border-0 text-muted px-3 py-2"
                  style={{ backgroundColor: color }}
                >
                  <div className="flex items-center gap-1 font-semibold text-sm">
                    <div className="rounded-full bg-muted w-2 h-2" />
                    {result.statusName || t("common.labels.untested")}
                  </div>

                  <div className="text-xs opacity-90 mt-1">
                    <div className="flex items-center gap-1">
                      <DateFormatter
                        date={result.createdAt}
                        formatString={dateTimeFormat}
                        timezone={session?.user.preferences?.timezone}
                      />
                    </div>
                    {result.elapsed && result.elapsed > 0 && (
                      <div className="flex items-center gap-1 mt-0.5">
                        <Clock className="h-3 w-3" />
                        {toHumanReadable(result.elapsed, {
                          isSeconds: true,
                          locale,
                        })}
                      </div>
                    )}
                    {/* Display issues for this specific result in the tooltip */}
                    {resultIssues && resultIssues.length > 0 && (
                      <div className="mt-1">
                        <IssuesListDisplay
                          // Map issues to add projectIds
                          issues={resultIssues.map((issue) => ({
                            ...issue,
                            projectIds: projectId ? [Number(projectId)] : [],
                          }))}
                        />
                      </div>
                    )}
                  </div>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </TooltipProvider>

      {/* Show different message based on whether there's elapsed time */}
      <div className="flex justify-between items-center">
        {hasElapsed ? (
          <ElapsedTime
            sessionId={sessionId}
            className={cn("text-muted-foreground -space-y-1")}
            estimate={summaryData.estimate}
            textSize={textSize}
          />
        ) : (
          <div
            className={cn("flex items-center gap-1 text-muted-foreground", {
              "text-xs": textSize === "xs",
              "text-sm": textSize === "sm",
              "text-md": textSize === "md",
            })}
          >
            <Timer className="w-4 h-4" />
            <span>{t("common.labels.resultsWithNoElapsedTime")}</span>
          </div>
        )}
        <div className="flex items-center gap-2 shrink-0">
          {/* Display comments count if any exist */}
          {summaryData.commentsCount > 0 && (
            <Link
              href={`/projects/sessions/${projectId}/${sessionId}#comments`}
              className={cn("flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors", {
                "text-xs": textSize === "xs",
                "text-sm": textSize === "sm",
                "text-md": textSize === "md",
              })}
            >
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex items-center gap-1">
                      <MessageCircle className="h-3 w-3" />
                      {summaryData.commentsCount}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t("common.plural.comment", {
                      count: summaryData.commentsCount,
                    })}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </Link>
          )}
          {/* Display aggregated issues list */}
          {allIssues && allIssues.length > 0 && (
            <div>
              {" "}
              {/* Prevent issues badge from stretching */}
              <IssuesListDisplay issues={allIssues} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default SessionResultsSummary;
