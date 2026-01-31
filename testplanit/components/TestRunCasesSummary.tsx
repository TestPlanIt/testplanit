import { useTranslations, useLocale } from "next-intl";
import { useSession } from "next-auth/react";
import { Link } from "~/lib/navigation";
import { useParams } from "next/navigation";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "~/utils";
import { Skeleton } from "@/components/ui/skeleton";
import {
  HelpCircle,
  Clock,
  User,
  Calendar,
  ListChecks,
  CalendarClock,
  MessageSquare,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { useFindFirstStatus } from "~/lib/hooks";
import { DateFormatter } from "@/components/DateFormatter";
import { isAutomatedTestRunType } from "~/utils/testResultTypes";
import { toHumanReadable } from "~/utils/duration";
import { IssuesListDisplay } from "@/components/tables/IssuesListDisplay";
import { useQuery } from "@tanstack/react-query";
import type { TestRunSummaryData } from "~/app/api/test-runs/[testRunId]/summary/route";

interface TestRunCasesSummaryProps {
  testRunId: number;
  testRunIds?: number[]; // For multi-config support
  projectId?: string | number;
  className?: string;
  testRunType?: string;
  // Support for pre-fetched data (batch mode)
  summaryData?: TestRunSummaryData;
}

export function TestRunCasesSummary({
  testRunId,
  testRunIds,
  projectId: propProjectId,
  className,
  testRunType,
  summaryData: preFetchedSummaryData,
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

  // Fetch summary data from API - for multi-config, fetch all and aggregate
  // If pre-fetched data is provided, skip the API call
  const { data: fetchedSummaryData, isLoading } = useQuery<TestRunSummaryData>({
    queryKey: ["testRunSummary", ...effectiveTestRunIds],
    queryFn: async () => {
      if (!isMultiConfig) {
        // Single test run - use existing endpoint
        const response = await fetch(`/api/test-runs/${testRunId}/summary`);
        if (!response.ok) {
          throw new Error("Failed to fetch test run summary");
        }
        return response.json();
      }

      // Multi-config - fetch all and aggregate
      const summaries = await Promise.all(
        effectiveTestRunIds.map(async (id) => {
          const response = await fetch(`/api/test-runs/${id}/summary`);
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
      effectiveTestRunIds.length > 0 &&
      effectiveTestRunIds[0] > 0,
    staleTime: 30000, // Cache for 30 seconds
    // Refetch every 30 seconds when workflow is IN_PROGRESS (for automated test runs still adding cases)
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.workflowType === "IN_PROGRESS") {
        return 30000; // 30 seconds
      }
      return false; // No automatic refetching
    },
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

    // Calculate aggregated completion rate
    const statusCounts = Array.from(statusCountMap.values());
    const completedCases = statusCounts
      .filter((item) => item.isCompleted === true)
      .reduce((sum, item) => sum + item.count, 0);
    const completionRate =
      totalCases > 0 ? Math.min((completedCases / totalCases) * 100, 100) : 0;

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

  // Get date format from user preferences
  const dateTimeFormat = session?.user.preferences?.dateFormat
    ? `${session.user.preferences.dateFormat} ${session.user.preferences.timeFormat || "HH:mm"}`
    : undefined;

  // Only show loading skeleton if we're actually loading (not using pre-fetched data)
  if (isLoading && !preFetchedSummaryData) {
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
        <TooltipProvider>
          <div className="flex h-2.5 w-full rounded-full overflow-hidden">
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
        <TooltipProvider>
          <div
            className="flex h-2.5 w-full rounded-full overflow-hidden bg-muted"
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
                    style={{ backgroundColor: result.statusColor }}
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
        </TooltipProvider>
        {/* Summary text below the bar */}
        <div className="flex justify-between items-center">
          <div
            className="text-muted-foreground text-xs truncate grow mr-2"
            title={summaryTitle}
          >
            {`${tCommon("labels.total")}: ${totalItems} ${tCommon("plural.case", { count: totalItems })}`}
            {summaryText ? ` (${summaryText})` : ""}
            {totalElapsedDisplay ? (
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex items-center ml-1 cursor-default">
                      {" • "}
                      <Clock className="h-3 w-3 ml-1" />
                      {totalElapsedDisplay}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {`${tCommon("fields.totalElapsed")}: ${totalElapsedDisplay}`}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : null}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* Display loading spinner when automated test run is still adding cases, otherwise show completion percentage */}
            {summaryData.workflowType === "IN_PROGRESS" ? (
              <TooltipProvider delayDuration={300}>
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
              </TooltipProvider>
            ) : (
              <TooltipProvider delayDuration={300}>
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
              </TooltipProvider>
            )}

            {/* Display comments count if any exist */}
            {summaryData.commentsCount > 0 && (
              <Link
                href={`/projects/runs/${projectId}/${testRunId}#comments`}
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
          </div>
        </div>
      </div>
    );
  }

  // Handle regular test runs
  const caseDetails = summaryData.caseDetails || [];
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
      <TooltipProvider>
        <div
          className="flex h-2.5 w-full rounded-full overflow-hidden bg-muted"
          data-testid="test-run-cases-status-bar"
        >
          {caseDetails.map((item, index) => {
            const color = item.colorValue || "#9ca3af";

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
                  style={{ backgroundColor: color }}
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
                      <div className="flex items-center gap-1 mt-0.5 text-muted-foreground">
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
                            <span className="ml-1">
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
      </TooltipProvider>

      {/* Container for Summary Text and Issues */}
      <div className="flex justify-between items-center">
        {/* Summary text below the bar */}
        <div
          className="text-muted-foreground text-xs truncate grow mr-2"
          title={`${summaryText}${totalElapsedText ? ` • ${tCommon("fields.totalElapsed")}: ${totalElapsedText}` : ""}${totalEstimateText ? ` • ${tCommon("fields.totalEstimate")}: ${totalEstimateText}` : ""}`}
        >
          {`${tCommon("labels.total")}: ${totalItems} ${tCommon("plural.case", { count: totalItems })}`}
          {summaryText ? ` (${summaryText})` : ""}
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
          </TooltipProvider>

          {/* Display comments count if any exist */}
          {summaryData.commentsCount > 0 && (
            <Link
              href={`/projects/runs/${projectId}/${testRunId}#comments`}
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
