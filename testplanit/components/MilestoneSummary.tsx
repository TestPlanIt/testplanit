"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { Badge } from "@/components/ui/badge";
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
}

export function MilestoneSummary({
  milestoneId,
  projectId,
  className,
  onScopeChipClick,
  onFoundInTestingChipClick,
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
      <div
        className="flex h-2.5 w-full rounded-full overflow-hidden bg-muted"
        data-testid="milestone-summary-bar"
      >
        {sortedSegments.map((segment, _index) => {
          const color =
            segment.statusId !== null
              ? segment.colorValue
              : (firstStatus?.color?.value ?? segment.colorValue);

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

      {/* Container for Summary Text and Issues */}
      <div className="flex flex-wrap justify-between items-center gap-y-1">
        {/* Summary text below the bar */}
        <div
          className="text-muted-foreground text-xs truncate grow me-2"
          title={`${testRunCount} ${tCommon("plural.run", { count: testRunCount })}, ${sessionCount} ${tGlobal("sessions.title", { count: sessionCount })}${totalElapsedText ? ` • ${tCommon("fields.totalElapsed")}: ${totalElapsedText}` : ""}${totalEstimateText ? ` • ${tCommon("fields.totalEstimate")}: ${totalEstimateText}` : ""}`}
        >
          {`${testRunCount} ${tCommon("plural.run", { count: testRunCount })}, ${sessionCount} ${tGlobal("sessions.title", { count: sessionCount })}`}
          {totalElapsedText ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="inline-flex items-center ms-1 cursor-default"
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
                  className="inline-flex items-center ms-1 cursor-default"
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
                    className="inline-flex items-center hover:text-foreground transition-colors"
                    title={tMilestones("summary.inScope", {
                      count: summaryData.scopeCount,
                    })}
                    aria-label={tMilestones("summary.inScope", {
                      count: summaryData.scopeCount,
                    })}
                    data-testid="milestone-summary-scope-chip"
                  >
                    <Badge className="cursor-pointer text-xs px-1.5 py-0">
                      <Target className="w-3 h-3 me-0.5 shrink-0" />
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
                        <Badge className="cursor-pointer text-xs px-1.5 py-0">
                          <Target className="w-3 h-3 me-0.5 shrink-0" />
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
                          <div className="flex flex-wrap gap-1 max-w-full">
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
                    className="inline-flex items-center hover:text-foreground transition-colors"
                    title={tMilestones("summary.foundInTesting", {
                      count: summaryData.issues.length,
                    })}
                    aria-label={tMilestones("summary.foundInTesting", {
                      count: summaryData.issues.length,
                    })}
                    data-testid="milestone-summary-found-chip"
                  >
                    <Badge className="cursor-pointer text-xs px-1.5 py-0">
                      <Bug className="w-3 h-3 me-0.5 shrink-0" />
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
