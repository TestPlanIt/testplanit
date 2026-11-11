"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { Badge } from "@/components/ui/badge";
import {
  contrastingTextColor,
  statusSurfaceVars,
} from "~/utils/contrastingTextColor";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { IssuesDisplay } from "@/components/tables/IssuesDisplay";
import { IssuesListDisplay } from "@/components/tables/IssuesListDisplay";
import {
  ArrowUpDown,
  Bug,
  CalendarClock,
  CheckCircle2,
  Clock,
  FlaskConical,
  HelpCircle,
  ListChecks,
  Loader2,
  MessageSquare,
  SquarePlay,
  Target,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { useMilestoneSummary } from "~/hooks/useMilestoneSummary";
import { Link } from "~/lib/navigation";
import { cn, type ClassValue } from "~/utils";
import { toHumanReadable } from "~/utils/duration";
import { sortSummaryItems } from "~/utils/summarySort";
import { computeStatusBarSegmentWidths } from "~/utils/statusBarSegmentWidths";

interface MilestoneSummaryProps {
  milestoneId: number;
  projectId?: string | number;
  className?: ClassValue;
  // Detail page only: makes the count chips clickable, scrolling to and
  // expanding the corresponding Issues card section. Omitted on the
  // milestones LIST page (MilestoneItemCard), where each chip instead opens
  // a popover revealing its issue list (the pre-consolidation behavior) —
  // clicks stopPropagation so the clickable card row underneath never
  // navigates.
  onScopeChipClick?: () => void;
  onFoundInTestingChipClick?: () => void;
  // Appended to the counts line under the bar, after the elapsed and
  // estimate figures. The list card puts the remaining-effort forecast here
  // so the bar keeps the full width of its row; a slot that renders nothing
  // leaves no separator behind.
  meta?: React.ReactNode;
}

export function MilestoneSummary({
  milestoneId,
  projectId,
  className,
  onScopeChipClick,
  onFoundInTestingChipClick,
  meta,
}: MilestoneSummaryProps) {
  const tCommon = useTranslations("common");
  const tMilestones = useTranslations("milestones");
  const tGlobal = useTranslations();
  const locale = useLocale();
  const { data: _session } = useSession();

  const { data: summaryData, isLoading } = useMilestoneSummary(milestoneId);

  const { data: firstStatus } = useClientQueries(schema).status.useFindFirst({
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

  const [sortMode, setSortMode] = useState<"date" | "status">("date");

  // List-page scope chip popover (no click handler wired): lazily fetch the
  // member issues only when the popover actually opens — the summary payload
  // carries just the count.
  const [scopeListOpen, setScopeListOpen] = useState(false);
  const { data: scopeLinks, isLoading: isLoadingScopeLinks } = useClientQueries(
    schema
  ).milestoneIssue.useFindMany(
    {
      where: { milestoneId },
      include: { issue: { include: { integration: true } } },
    },
    { enabled: scopeListOpen && !onScopeChipClick }
  );

  const sortedSegments = useMemo(
    () =>
      sortSummaryItems(
        summaryData?.segments ?? [],
        sortMode,
        firstStatus?.id,
        firstStatus?.order ?? 0
      ),
    [summaryData, sortMode, firstStatus?.id, firstStatus?.order]
  );

  if (isLoading) {
    return (
      <div className={cn("flex w-full flex-col space-y-1", className)}>
        <Skeleton className="h-2.5 w-full rounded-full" />
        <Skeleton className="h-5 w-40" />
      </div>
    );
  }

  if (!summaryData) {
    return (
      <div className={cn("flex w-full flex-col space-y-1", className)}>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <HelpCircle className="h-4 w-4" />
          <span>{tCommon("labels.noResults")}</span>
        </div>
      </div>
    );
  }

  // If there are no items, show a default message
  if (summaryData.totalItems === 0 || summaryData.segments.length === 0) {
    const emptyColor = firstStatus?.color?.value || "#B1B2B3";
    return (
      <div className={cn("flex w-full flex-col space-y-1", className)}>
        <div className="flex h-2.5 w-full overflow-hidden rounded-full">
          <Tooltip>
            <TooltipTrigger asChild>
              <div
                className="h-full w-full cursor-default transition-all hover:opacity-80"
                style={{ backgroundColor: emptyColor }}
                aria-label={tCommon("labels.noResults")}
              />
            </TooltipTrigger>
            <TooltipContent
              side="top"
              data-status-surface
              className="border-0 px-3 py-2"
              style={{
                ...statusSurfaceVars(emptyColor),
                backgroundColor: emptyColor,
                color: contrastingTextColor(emptyColor),
              }}
            >
              <div className="text-sm font-semibold">
                {firstStatus?.name || tCommon("labels.untested")}
              </div>
              <div className="text-xs opacity-90">
                {tCommon("labels.noResults")}
              </div>
            </TooltipContent>
          </Tooltip>
        </div>

        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <HelpCircle className="h-4 w-4" />
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

  const segmentWidths = computeStatusBarSegmentWidths(
    sortedSegments,
    summaryData.totalElapsed > 0
  );

  return (
    <div className={cn("flex w-full flex-col space-y-1", className)}>
      {/* Color bar for milestone items */}
      <div
        className="flex h-2.5 w-full overflow-x-auto overflow-y-hidden rounded-full bg-muted"
        data-status-bar
        data-testid="milestone-summary-bar"
      >
        {sortedSegments.map((segment, index) => {
          const color =
            segment.statusId !== null
              ? segment.colorValue
              : (firstStatus?.color?.value ?? segment.colorValue);
          const segmentWidth = segmentWidths[index];

          const targetUrl =
            segment.type === "test-run"
              ? `/projects/runs/${projectId}/${segment.sourceId}`
              : `/projects/sessions/${projectId}/${segment.sourceId}`;

          return (
            <Tooltip key={segment.id}>
              <TooltipTrigger asChild>
                <Link
                  href={targetUrl}
                  className="h-full cursor-pointer rounded-sm border-x-[0.5px] border-primary-foreground transition-all hover:opacity-80"
                  style={{
                    backgroundColor: color,
                    width: `${segmentWidth}%`,
                    minWidth: "4px",
                  }}
                  aria-label={segment.sourceName}
                />
              </TooltipTrigger>
              <TooltipContent
                data-status-surface
                className="border-0 px-3 py-2"
                style={{
                  ...statusSurfaceVars(color),
                  backgroundColor: color,
                  color: contrastingTextColor(color),
                }}
              >
                <div className="flex items-center gap-1 text-sm font-semibold">
                  <div className="h-2 w-2 rounded-full bg-muted" />
                  {segment.statusName || tCommon("labels.untested")}
                </div>
                <div className="mt-1 text-xs opacity-90">
                  <div className="flex items-center gap-1">
                    {segment.type === "test-run" ? (
                      <SquarePlay className="h-3 w-3" />
                    ) : (
                      <FlaskConical className="h-3 w-3" />
                    )}
                    {segment.sourceName}
                  </div>
                  {segment.itemCount && segment.itemCount > 1 && (
                    <div className="mt-0.5 flex items-center gap-1">
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
                  <div className="mt-1 text-xs opacity-90">
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
                  <div className="mt-1 text-xs opacity-90">
                    <div className="flex items-center gap-1">
                      <CalendarClock className="h-3 w-3" />
                      {tCommon("labels.estimateFromCases", {
                        value: toHumanReadable(segment.estimate, {
                          isSeconds: true,
                          locale,
                        }),
                      })}
                    </div>
                  </div>
                ) : null}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      {/* Container for Summary Text and Issues */}
      <div className="flex flex-nowrap items-center justify-between gap-2">
        {/* Summary text below the bar */}
        <div
          className="flex min-w-0 grow items-center text-xs text-foreground"
          title={`${testRunCount} ${tCommon("plural.run", { count: testRunCount })}, ${sessionCount} ${tGlobal("sessions.title", { count: sessionCount })}${totalElapsedText ? ` • ${tCommon("fields.totalElapsed")}: ${totalElapsedText}` : ""}${totalEstimateText ? ` • ${tCommon("fields.totalEstimate")}: ${totalEstimateText}` : ""}`}
        >
          <span className="shrink truncate">{`${testRunCount} ${tCommon("plural.run", { count: testRunCount })}, ${sessionCount} ${tGlobal("sessions.title", { count: sessionCount })}`}</span>
          {totalElapsedText ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="ms-1 inline-flex min-w-0 shrink-[999] cursor-default items-center overflow-hidden whitespace-nowrap"
                  data-testid="total-elapsed-display"
                >
                  {" • "}
                  <Clock className="ms-1 h-3 w-3" />
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
                  className="ms-1 inline-flex min-w-0 shrink-[9999] cursor-default items-center overflow-hidden whitespace-nowrap"
                  data-testid="total-estimate-display"
                >
                  {" • "}
                  <CalendarClock className="ms-1 h-3 w-3" />
                  {`${totalEstimateText}`}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {tCommon("labels.estimateFromCases", {
                  value: totalEstimateText,
                })}
              </TooltipContent>
            </Tooltip>
          ) : (
            ""
          )}
          {meta && (
            <span
              className="ms-1 inline-flex min-w-0 shrink-[99999] items-center overflow-hidden whitespace-nowrap before:me-1 before:content-['•'] empty:hidden"
              data-testid="milestone-summary-meta"
            >
              {meta}
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
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
                className="inline-flex cursor-pointer items-center text-muted-foreground transition-colors hover:text-foreground"
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
              <span className="inline-flex items-center gap-1 text-xs text-foreground">
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

          {/* Display comments count if any exist */}
          {summaryData.commentsCount > 0 && (
            <Link
              href={`/projects/milestones/${projectId}/${milestoneId}#comments`}
              className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
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

          {/* Paired issue-count chips: this milestone's scope (MilestoneIssue
              links, D-15 — this milestone only) vs. what testing turned up
              (test-run/session-linked defects, rolled up through
              descendants). Two unrelated counts that both used to render as
              one "issues" chip, which confused users when they diverged.
              Icon + count only — the full label lives in the tooltip and
              aria-label, and the same icons head the matching accordion
              sections (Target = in scope, Bug = found in testing). */}
          {(summaryData.scopeCount > 0 ||
            (summaryData.issues && summaryData.issues.length > 0)) && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {summaryData.scopeCount > 0 &&
                (onScopeChipClick ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onScopeChipClick();
                    }}
                    className="inline-flex items-center transition-colors hover:text-foreground"
                    title={tMilestones("summary.inScope", {
                      count: summaryData.scopeCount,
                    })}
                    aria-label={tMilestones("summary.inScope", {
                      count: summaryData.scopeCount,
                    })}
                    data-testid="milestone-summary-scope-chip"
                  >
                    <Badge className="cursor-pointer px-1.5 py-0 text-xs">
                      <Target className="me-0.5 h-3 w-3 shrink-0" />
                      {summaryData.scopeCount}
                    </Badge>
                  </button>
                ) : (
                  <span
                    className="inline-flex items-center"
                    title={tMilestones("summary.inScope", {
                      count: summaryData.scopeCount,
                    })}
                    aria-label={tMilestones("summary.inScope", {
                      count: summaryData.scopeCount,
                    })}
                    data-testid="milestone-summary-scope-chip"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Popover
                      modal={false}
                      open={scopeListOpen}
                      onOpenChange={setScopeListOpen}
                    >
                      <PopoverTrigger asChild>
                        <Badge className="cursor-pointer px-1.5 py-0 text-xs">
                          <Target className="me-0.5 h-3 w-3 shrink-0" />
                          {summaryData.scopeCount}
                        </Badge>
                      </PopoverTrigger>
                      <PopoverContent
                        className="w-auto max-w-md p-2"
                        onOpenAutoFocus={(e) => e.preventDefault()}
                      >
                        {isLoadingScopeLinks ? (
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        ) : (
                          <div className="flex max-w-full flex-wrap gap-1">
                            {(scopeLinks ?? []).map((link) => (
                              <IssuesDisplay
                                key={link.issue.id}
                                id={link.issue.id}
                                name={link.issue.name}
                                externalId={link.issue.externalId}
                                externalUrl={link.issue.externalUrl}
                                title={link.issue.title}
                                description={link.issue.description}
                                status={link.issue.externalStatus}
                                priority={link.issue.priority}
                                lastSyncedAt={link.issue.lastSyncedAt}
                                projectIds={
                                  projectId != null ? [Number(projectId)] : []
                                }
                                size="small"
                                data={link.issue.data}
                                integrationProvider={
                                  link.issue.integration?.provider
                                }
                                integrationId={link.issue.integration?.id}
                                issueTypeName={link.issue.issueTypeName}
                                issueTypeIconUrl={link.issue.issueTypeIconUrl}
                              />
                            ))}
                          </div>
                        )}
                      </PopoverContent>
                    </Popover>
                  </span>
                ))}
              {summaryData.issues &&
                summaryData.issues.length > 0 &&
                (onFoundInTestingChipClick ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onFoundInTestingChipClick();
                    }}
                    className="inline-flex items-center transition-colors hover:text-foreground"
                    title={tMilestones("summary.foundInTesting", {
                      count: summaryData.issues.length,
                    })}
                    aria-label={tMilestones("summary.foundInTesting", {
                      count: summaryData.issues.length,
                    })}
                    data-testid="milestone-summary-found-chip"
                  >
                    <Badge className="cursor-pointer px-1.5 py-0 text-xs">
                      <Bug className="me-0.5 h-3 w-3 shrink-0" />
                      {summaryData.issues.length}
                    </Badge>
                  </button>
                ) : (
                  <span
                    className="inline-flex items-center"
                    title={tMilestones("summary.foundInTesting", {
                      count: summaryData.issues.length,
                    })}
                    aria-label={tMilestones("summary.foundInTesting", {
                      count: summaryData.issues.length,
                    })}
                    data-testid="milestone-summary-found-chip"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <IssuesListDisplay
                      issues={summaryData.issues}
                      size="small"
                    />
                  </span>
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default MilestoneSummary;
