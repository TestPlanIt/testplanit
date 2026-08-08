import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { DateFormatter } from "@/components/DateFormatter";
import { IssuesListDisplay } from "@/components/tables/IssuesListDisplay";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpDown,
  Calendar,
  CalendarClock,
  CheckCircle2,
  Clock,
  Combine,
  HelpCircle,
  ListChecks,
  Loader2,
  MessageSquare,
  User,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import type { TestRunSummaryData } from "~/app/api/test-runs/[testRunId]/summary/route";
import { Link } from "~/lib/navigation";
import { aggregateRunCounts } from "~/lib/services/testRunSummary-shared";
import { cn } from "~/utils";
import { statusSurfaceVars } from "~/utils/contrastingTextColor";
import { toHumanReadable } from "~/utils/duration";
import { isAutomatedTestRunType } from "~/utils/testResultTypes";
import { sortSummaryItems } from "~/utils/summarySort";

interface TestRunCasesSummaryProps {
  testRunId: number;
  testRunIds?: number[]; // For multi-config support
  projectId?: string | number;
  className?: string;
  testRunType?: string;
  // Support for pre-fetched data (batch mode)
  summaryData?: TestRunSummaryData;
  /**
   * True while the parent's BATCH summary fetch is still in flight. Suppresses
   * this component's own per-run fallback fetch — without it, a list of N rows
   * fans out N `/summary` requests during the window before the batch lands
   * (a network storm on big milestones), all of which the batch then obsoletes.
   */
  summaryLoading?: boolean;
}

export function TestRunCasesSummary({
  testRunId,
  testRunIds,
  projectId: propProjectId,
  className,
  testRunType: _testRunType,
  summaryData: preFetchedSummaryData,
  summaryLoading = false,
}: TestRunCasesSummaryProps) {
  const tCommon = useTranslations("common");
  const tGlobal = useTranslations();
  const locale = useLocale();
  const { data: session } = useSession();
  const params = useParams();

  // Use projectId from props if provided, otherwise from URL params
  const projectId = propProjectId || params.projectId;

  // Determine which test run IDs to fetch (use testRunIds if provided, otherwise just testRunId)
  const effectiveTestRunIds =
    testRunIds && testRunIds.length > 0 ? testRunIds : [testRunId];
  const isMultiConfig = effectiveTestRunIds.length > 1;

  // Fetch summary data from API - for multi-config, fetch all and aggregate.
  // If pre-fetched data is provided, skip the API call. Live updates are NOT
  // driven from inside this component — the parent page (run detail or runs
  // list) owns the SSE stream and invalidates this query's key on wake-up so
  // there's at most one EventSource per browser tab regardless of how many
  // summary widgets are rendered.
  const { data: fetchedSummaryData, isLoading } = useQuery<TestRunSummaryData>({
    queryKey: ["testRunSummary", ...effectiveTestRunIds],
    queryFn: async () => {
      if (!isMultiConfig) {
        // Single test run - use existing endpoint with case details for color bar
        const response = await fetch(
          `/api/test-runs/${testRunId}/summary?includeCaseDetails=true`
        );
        if (!response.ok) {
          throw new Error("Failed to fetch test run summary");
        }
        return response.json();
      }

      // Multi-config - fetch all and aggregate
      const summaries = await Promise.all(
        effectiveTestRunIds.map(async (id) => {
          const response = await fetch(
            `/api/test-runs/${id}/summary?includeCaseDetails=true`
          );
          if (!response.ok) {
            throw new Error(`Failed to fetch test run summary for ${id}`);
          }
          return response.json() as Promise<TestRunSummaryData>;
        })
      );

      // Aggregate the summaries
      return aggregateSummaries(summaries);
    },
    enabled:
      !preFetchedSummaryData &&
      !summaryLoading &&
      effectiveTestRunIds.length > 0 &&
      effectiveTestRunIds[0] > 0,
    // No refetchInterval — live updates come from the parent's SSE stream
    // invalidating the query above. The 30s stale window is kept so a manual
    // revisit after an idle minute still re-fetches even if no SSE wake-up
    // arrived (e.g. the tab was backgrounded long enough for the stream to
    // drop and reconnect).
    staleTime: 30000,
  });

  // Use pre-fetched data if available, otherwise use fetched data
  const summaryData = preFetchedSummaryData || fetchedSummaryData;

  // Helper function to aggregate multiple summaries
  function aggregateSummaries(
    summaries: TestRunSummaryData[]
  ): TestRunSummaryData {
    if (summaries.length === 0) {
      return {
        testRunType: "REGULAR",
        totalCases: 0,
        statusCounts: [],
        completionRate: 0,
        totalElapsed: 0,
        totalEstimate: 0,
        commentsCount: 0,
        issues: [],
        caseDetails: [],
      };
    }

    if (summaries.length === 1) {
      return summaries[0];
    }

    // Aggregate status counts
    const statusCountMap = new Map<
      string,
      {
        statusId: number | null;
        statusName: string;
        colorValue: string;
        count: number;
        isCompleted?: boolean;
      }
    >();

    let totalCases = 0;
    let totalElapsed = 0;
    let totalEstimate = 0;
    let commentsCount = 0;
    const allIssues: TestRunSummaryData["issues"] = [];
    const allCaseDetails: NonNullable<TestRunSummaryData["caseDetails"]> = [];

    summaries.forEach((summary) => {
      totalCases += summary.totalCases;
      totalElapsed += summary.totalElapsed;
      totalEstimate += summary.totalEstimate;
      commentsCount += summary.commentsCount;

      // Aggregate status counts
      summary.statusCounts.forEach((sc) => {
        const key = `${sc.statusId}-${sc.statusName}`;
        const existing = statusCountMap.get(key);
        if (existing) {
          existing.count += sc.count;
        } else {
          statusCountMap.set(key, { ...sc });
        }
      });

      // Collect all issues (dedupe by id)
      summary.issues.forEach((issue) => {
        if (!allIssues.some((i) => i.id === issue.id)) {
          allIssues.push(issue);
        }
      });

      // Collect all case details
      if (summary.caseDetails) {
        allCaseDetails.push(...summary.caseDetails);
      }
    });

    // Calculate aggregated completion rate via the shared helper so the
    // in-app summary and the test_run.completed Slack formatter use one
    // source of truth for "completed" semantics.
    const statusCounts = Array.from(statusCountMap.values());
    const { completionPct } = aggregateRunCounts({ totalCases, statusCounts });
    const completionRate = completionPct;

    return {
      testRunType: summaries[0].testRunType,
      totalCases,
      statusCounts,
      completionRate,
      totalElapsed,
      totalEstimate,
      commentsCount,
      issues: allIssues,
      caseDetails: allCaseDetails,
      junitSummary: summaries[0].junitSummary, // JUnit summary doesn't aggregate well
    };
  }

  const { data: firstStatus } = useClientQueries(schema).status.useFindFirst({
    where: { isDeleted: false },
    orderBy: { order: "asc" },
    include: { color: true },
  });

  const [sortMode, setSortMode] = useState<"date" | "status">("date");

  const sortedCaseDetails = useMemo(
    () =>
      sortSummaryItems(
        summaryData?.caseDetails ?? [],
        sortMode,
        firstStatus?.id,
        firstStatus?.order ?? 0
      ),
    [summaryData, sortMode, firstStatus?.id, firstStatus?.order]
  );

  // Get date format from user preferences
  const dateTimeFormat = session?.user.preferences?.dateFormat
    ? `${session.user.preferences.dateFormat} ${session.user.preferences.timeFormat || "HH:mm"}`
    : undefined;

  // Only show loading skeleton if we're actually loading (not using pre-fetched data)
  if ((isLoading || summaryLoading) && !preFetchedSummaryData) {
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

  const isJUnitRun = isAutomatedTestRunType(summaryData.testRunType);

  // If there are no cases, show a default message
  if (summaryData.totalCases === 0) {
    return (
      <div className={cn("flex flex-col space-y-1 w-full", className)}>
        <div
          className="flex h-2.5 w-full rounded-full overflow-x-auto overflow-y-hidden"
          data-status-bar
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href={`/projects/runs/${projectId}/${testRunId}`}
                className="h-full w-full transition-all hover:opacity-80 cursor-pointer"
                style={{
                  backgroundColor: firstStatus?.color?.value || "#B1B2B3",
                  display: "block",
                }}
                aria-label={tCommon("labels.viewTestRunDetails")}
              />
            </TooltipTrigger>
            <TooltipContent
              side="top"
              className="border-0 px-3 py-2"
              data-status-surface
              style={{
                ...statusSurfaceVars(firstStatus?.color?.value || "#B1B2B3"),
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

        <div className="flex items-center gap-1 text-muted-foreground text-xs">
          <HelpCircle className="w-4 h-4" />
          <span>{tCommon("labels.noResults")}</span>
        </div>
      </div>
    );
  }

  // Handle JUnit test run display
  if (isJUnitRun && summaryData.junitSummary) {
    const { resultSegments } = summaryData.junitSummary;
    const totalItems = summaryData.totalCases;
    const totalTestCount = resultSegments.reduce(
      (sum, result) => sum + result.count,
      0
    );

    // Generate summary text from status counts
    const summaryText = summaryData.statusCounts
      .map((status) => `${status.count} ${status.statusName}`)
      .join(", ");

    const totalElapsedDisplay =
      summaryData.totalElapsed > 0
        ? toHumanReadable(summaryData.totalElapsed, {
            isSeconds: true,
            locale,
          })
        : null;

    const summaryTitle = summaryText
      ? totalElapsedDisplay
        ? `${summaryText} • ${tCommon("fields.totalElapsed")}: ${totalElapsedDisplay}`
        : summaryText
      : totalElapsedDisplay
        ? `${tCommon("fields.totalElapsed")}: ${totalElapsedDisplay}`
        : undefined;

    return (
      <div className={cn("flex flex-col space-y-1 w-full", className)}>
        {/* Color bar for JUnit test results */}
        <div
          className="flex h-2.5 w-full rounded-full overflow-x-auto overflow-y-hidden bg-muted"
          data-status-bar
          data-testid="test-run-cases-status-bar"
        >
          {resultSegments.map((result, index) => {
            const testCount = result.count;
            const widthPercent =
              totalTestCount > 0
                ? (testCount / totalTestCount) * 100
                : 100 / Math.max(resultSegments.length, 1);
            const segmentStyle = {
              backgroundColor: result.statusColor,
              width: `${widthPercent}%`,
              minWidth: "4px",
            };
            const segmentClass = cn(
              "h-full transition-all border-x-[0.5px] border-primary-foreground rounded-sm cursor-default"
            );
            const testCountLabel = `${testCount} ${tCommon("plural.case", {
              count: testCount,
            })}`;

            return (
              <Tooltip key={`${result.id}-${index}`}>
                <TooltipTrigger asChild>
                  <div
                    className={segmentClass}
                    style={segmentStyle}
                    aria-label={testCountLabel}
                    tabIndex={0}
                  />
                </TooltipTrigger>
                <TooltipContent
                  className="border-0 text-muted px-3 py-2"
                  data-status-surface
                  style={{
                    ...statusSurfaceVars(result.statusColor),
                    backgroundColor: result.statusColor,
                  }}
                >
                  <div className="flex items-center gap-1 font-semibold text-sm">
                    <div className="rounded-full bg-muted w-2 h-2" />
                    {result.statusName}
                  </div>
                  <div className="text-xs opacity-90 mt-1 space-y-1">
                    <div className="flex items-center gap-1">
                      <ListChecks className="h-3 w-3" />
                      {testCountLabel}
                    </div>
                    <div className="flex items-center gap-1">
                      <HelpCircle className="h-3 w-3" />
                      {result.resultType}
                    </div>
                  </div>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
        {/* Summary text below the bar */}
        <div className="flex justify-between items-center">
          <div
            className="flex items-center min-w-0 grow me-2 text-muted-foreground text-xs"
            title={summaryTitle}
          >
            {`${tCommon("labels.total")}: ${totalItems} ${tCommon("plural.case", { count: totalItems })}`}
            {summaryText ? ` (${summaryText})` : ""}
            {totalElapsedDisplay ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center ms-1 cursor-default">
                    {" • "}
                    <Clock className="h-3 w-3 ms-1" />
                    {totalElapsedDisplay}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {`${tCommon("fields.totalElapsed")}: ${totalElapsedDisplay}`}
                </TooltipContent>
              </Tooltip>
            ) : null}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* Display loading spinner when automated test run is still adding cases, otherwise show completion percentage */}
            {summaryData.workflowType === "IN_PROGRESS" ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span className="font-medium">
                      {tCommon("status.importing")}
                    </span>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {tCommon("status.addingTestCases")}
                </TooltipContent>
              </Tooltip>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <CheckCircle2 className="h-3 w-3" />
                    <span className="font-medium">
                      {summaryData.completionRate.toFixed(0)}
                      {"%"}
                    </span>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {tCommon("fields.completionRate")}:{" "}
                  {summaryData.completionRate.toFixed(1)}
                  {"%"}
                </TooltipContent>
              </Tooltip>
            )}

            {/* Display comments count if any exist */}
            {summaryData.commentsCount > 0 && (
              <Link
                href={`/projects/runs/${projectId}/${testRunId}#comments`}
                className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors text-xs"
              >
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
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Handle regular test runs
  const totalItems = summaryData.totalCases;

  // Generate summary text from status counts
  const summaryText = summaryData.statusCounts
    .map((status) => `${status.count} ${status.statusName}`)
    .join(", ");

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

  return (
    <div className={cn("flex flex-col space-y-1 w-full", className)}>
      {/* Color bar for individual test results */}
      <div
        className="flex h-2.5 w-full rounded-full overflow-x-auto overflow-y-hidden bg-muted"
        data-status-bar
        data-testid="test-run-cases-status-bar"
      >
        {sortedCaseDetails.map((item, index) => {
          const color =
            item.statusId !== null
              ? item.colorValue
              : (firstStatus?.color?.value ?? item.colorValue);

          // Calculate segment width based on total elapsed time
          const minSegmentWidth = 3;
          let segmentWidth = 100 / totalItems;

          // If we have elapsed time data, make width proportional to elapsed time
          if (summaryData.totalElapsed > 0 && !item.isPending) {
            const proportionalWidth =
              ((item.elapsed || 0) / summaryData.totalElapsed) * 100;
            segmentWidth = Math.max(proportionalWidth, minSegmentWidth);
          } else if (summaryData.totalElapsed > 0 && item.isPending) {
            segmentWidth = minSegmentWidth;
          }

          // Use the item's testRunId if available (for multi-config), otherwise fall back to prop
          const itemTestRunId = item.testRunId || testRunId;

          return (
            <Tooltip key={`${item.id}-${index}`}>
              <TooltipTrigger asChild>
                <Link
                  href={`/projects/runs/${projectId}/${itemTestRunId}?selectedCase=${item.repositoryCaseId}`}
                  className="h-full transition-all hover:opacity-80 cursor-pointer border-x-[0.5px] border-primary-foreground rounded-sm"
                  style={{
                    backgroundColor: color,
                    width: `${segmentWidth}%`,
                    minWidth: "4px",
                  }}
                  aria-label={item.caseName || `Test case ${index + 1}`}
                />
              </TooltipTrigger>
              <TooltipContent
                className="border-0 text-muted px-3 py-2"
                data-status-surface
                style={{
                  ...statusSurfaceVars(color),
                  backgroundColor: color,
                }}
              >
                <div className="flex items-center gap-1 font-semibold text-sm">
                  <div className="rounded-full bg-muted w-2 h-2" />
                  {item.statusName || tCommon("labels.untested")}
                </div>
                <div className="text-xs opacity-90 mt-1">
                  <div className="flex items-center gap-1">
                    <ListChecks className="h-3 w-3" />
                    {item.caseName || `Test case ${index + 1}`}
                  </div>
                  {item.configurationName && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <Combine className="h-3 w-3" />
                      <span>{item.configurationName}</span>
                    </div>
                  )}
                </div>
                {!item.isPending ? (
                  <div className="text-xs opacity-90 mt-1">
                    {item.executedAt && (
                      <div className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        <DateFormatter
                          date={item.executedAt}
                          formatString={dateTimeFormat}
                          timezone={session?.user.preferences?.timezone}
                        />
                      </div>
                    )}

                    <div className="flex items-center gap-1 mt-0.5">
                      <User className="h-3 w-3" />
                      {item.executedByName || tCommon("labels.unknown")}
                    </div>

                    {item.elapsed && item.elapsed > 0 ? (
                      <div className="flex items-center gap-1 mt-0.5">
                        <Clock className="h-3 w-3" />
                        {toHumanReadable(item.elapsed, {
                          isSeconds: true,
                          locale,
                        })}
                        {item.resultCount && item.resultCount > 1 && (
                          <span className="ms-1">
                            {`(${item.resultCount} ${tGlobal("common.results")})`}
                          </span>
                        )}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="text-xs opacity-90 mt-1">
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {tCommon("status.pending")}
                    </div>
                    <div className="flex items-center gap-1 mt-1">
                      {item.estimate && item.estimate > 0 && (
                        <>
                          <CalendarClock className="h-3 w-3" />
                          <span>
                            {`${tCommon("fields.totalEstimate")}: ${toHumanReadable(
                              item.estimate,
                              {
                                isSeconds: true,
                                locale,
                              }
                            )}`}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      {/* Container for Summary Text and Issues */}
      <div className="flex justify-between items-center">
        {/* Summary text below the bar */}
        <div
          className="text-muted-foreground text-xs truncate grow me-2"
          title={`${summaryText}${totalElapsedText ? ` • ${tCommon("fields.totalElapsed")}: ${totalElapsedText}` : ""}${totalEstimateText ? ` • ${tCommon("fields.totalEstimate")}: ${totalEstimateText}` : ""}`}
        >
          <span className="truncate shrink">
            {`${tCommon("labels.total")}: ${totalItems} ${tCommon("plural.case", { count: totalItems })}`}
            {summaryText ? ` (${summaryText})` : ""}
          </span>
          {totalElapsedText ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="inline-flex items-center ms-1 cursor-default shrink-[999] min-w-0 overflow-hidden whitespace-nowrap"
                  data-testid="total-elapsed-display"
                >
                  {" • "}
                  <Clock className="h-3 w-3 ms-1" />
                  {`${totalElapsedText}`}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {`${tCommon("fields.totalElapsed")}: ${totalElapsedText}`}
              </TooltipContent>
            </Tooltip>
          ) : (
            ""
          )}
          {totalEstimateText ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="inline-flex items-center ms-1 cursor-default shrink-[9999] min-w-0 overflow-hidden whitespace-nowrap"
                  data-testid="total-estimate-display"
                >
                  {" • "}
                  <CalendarClock className="h-3 w-3 ms-1" />
                  {`${totalEstimateText}`}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {`${tCommon("fields.totalEstimate")}: ${totalEstimateText}`}
              </TooltipContent>
            </Tooltip>
          ) : (
            ""
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                role="button"
                tabIndex={0}
                onClick={() =>
                  setSortMode((m) => (m === "date" ? "status" : "date"))
                }
                onKeyDown={(e) =>
                  e.key === "Enter" &&
                  setSortMode((m) => (m === "date" ? "status" : "date"))
                }
                className="inline-flex cursor-pointer items-center text-muted-foreground hover:text-foreground transition-colors"
                aria-label={
                  sortMode === "date"
                    ? tCommon("labels.sortByStatus")
                    : tCommon("labels.sortByDate")
                }
                data-testid="sort-toggle"
              >
                <ArrowUpDown className="h-3 w-3" />
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {sortMode === "date"
                ? tCommon("labels.sortByStatus")
                : tCommon("labels.sortByDate")}
            </TooltipContent>
          </Tooltip>
          {/* Display completion percentage */}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <CheckCircle2 className="h-3 w-3" />
                <span className="font-medium">
                  {summaryData.completionRate.toFixed(0)}
                  {"%"}
                </span>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {tCommon("fields.completionRate")}:{" "}
              {summaryData.completionRate.toFixed(1)}
              {"%"}
            </TooltipContent>
          </Tooltip>

          {/* Display comments count if any exist */}
          {summaryData.commentsCount > 0 && (
            <Link
              href={`/projects/runs/${projectId}/${testRunId}#comments`}
              className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors text-xs"
            >
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
            </Link>
          )}

          {/* Display aggregated issues list if any exist */}
          {summaryData.issues && summaryData.issues.length > 0 && (
            <div className="mt-1">
              <IssuesListDisplay issues={summaryData.issues} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default TestRunCasesSummary;
