"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { useDebounce } from "@/components/Debounce";
import { Filter } from "@/components/tables/Filter";
import { VirtualizedDataTable } from "@/components/tables/VirtualizedDataTable";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { VisibilityState } from "@tanstack/react-table";
import { ChevronDown, Loader2, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MemberIssueRowActions, MilestoneIssueManager } from "@/components/issues/MilestoneIssueManager";
import { IterationStatusLegendPopover } from "@/components/iterations/IterationStatusLegendPopover";
import type { CoverageBreakdown } from "./CoverageChip";
import { coverageSortValue, hasCompletedCoverage } from "./CoverageChip";
import {
  IterationStatusPip,
  resolvePipColor,
} from "@/components/iterations/IterationStatusPip";
import type { ExtendedMemberIssue } from "./MemberIssuesColumns";
import { useMemberIssueColumns } from "./MemberIssuesColumns";
import { MemberIssuesOverflowPanel } from "./MemberIssuesOverflowPanel";
import type { MemberCoverageResponse } from "~/app/api/milestones/[milestoneId]/members/coverage/route";

const MEMBER_ISSUES_COLLAPSED_KEY = "tpi.milestone.memberIssues.collapsed";

interface MemberIssuesTableProps {
  milestoneId: number;
  projectId: number;
}

/**
 * "" = all · UNCOVERED = no completed outcome · UNTESTED = has untested
 * linked cases · `status:<id>` = has a completed outcome with that status.
 * Mirrors exactly what the Coverage column can display.
 */
type CoverageStateFilter = "" | "UNCOVERED" | "UNTESTED" | `status:${number}`;
type SourceFilter = "" | "SYNCED" | "MANUAL";

function matchesCoverageState(
  filter: CoverageStateFilter,
  breakdown: CoverageBreakdown | undefined
): boolean {
  if (!filter) return true;
  if (!breakdown) return filter === "UNCOVERED";
  if (filter === "UNCOVERED") {
    // Matches the chip: uncovered = no completed outcome in scope, not
    // just "no linked cases".
    return !hasCompletedCoverage(breakdown);
  }
  if (filter === "UNTESTED") {
    return (breakdown.untested ?? 0) > 0;
  }
  if (filter.startsWith("status:")) {
    const statusId = Number(filter.slice("status:".length));
    return (breakdown.statuses ?? []).some(
      (entry) => entry.statusId === statusId && entry.count > 0
    );
  }
  return true;
}

/**
 * Member Issues section for the milestone detail page (MLINK-04, D-07/D-08).
 * A VirtualizedDataTable of this milestone's `MilestoneIssue` rows (D-15:
 * this milestone's members only, never descendant-scoped) joined with the
 * per-issue coverage breakdown from the 18-05 coverage route. Mirrors the
 * project Issues page's VirtualizedDataTable wiring and column patterns.
 */
export function MemberIssuesTable({ milestoneId, projectId }: MemberIssuesTableProps) {
  const t = useTranslations("milestones.members");
  const tCommon = useTranslations("common");

  const [searchString, setSearchString] = useState("");
  const debouncedSearchString = useDebounce(searchString, 300);
  const [coverageFilter, setCoverageFilter] = useState<CoverageStateFilter>("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("");
  const [issueTypeFilter, setIssueTypeFilter] = useState<string>("");
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [sortConfig, setSortConfig] = useState<{
    column: string;
    direction: "asc" | "desc";
  }>({ column: "key", direction: "asc" });

  // Member rows scoped to THIS milestone only (D-15) — never
  // `milestoneId: { in: allMilestoneIds }`, unlike the descendant-inclusive
  // rollups elsewhere on this page.
  const {
    data: memberRows,
    isLoading: isLoadingMembers,
    isFetching: isFetchingMembers,
    refetch: refetchMembers,
  } = useClientQueries(schema).milestoneIssue.useFindMany({
    where: { milestoneId },
    include: { issue: { include: { integration: true } } },
  });

  // Needed so MilestoneIssueManager can resolve a search-selected external
  // issue via issue.useUpsert() keyed on externalId_integrationId (D-09).
  const { data: milestoneRow } = useClientQueries(schema).milestones.useFindFirst({
    where: { id: milestoneId },
    select: { integrationId: true },
  });

  // Milestone-level "syncing…" indicator (D-03): client-side refresh-in-flight
  // state derived from whether a refresh triggered by this section is
  // currently pending — no `Milestones.syncStatus` column exists.
  const {
    data: coverageData,
    isLoading: isLoadingCoverage,
    isFetching: isFetchingCoverage,
    refetch: refetchCoverage,
  } = useQuery<MemberCoverageResponse>({
    queryKey: ["milestoneMemberCoverage", milestoneId],
    queryFn: async () => {
      const response = await fetch(`/api/milestones/${milestoneId}/members/coverage`);
      if (!response.ok) {
        throw new Error("Failed to fetch member coverage");
      }
      return response.json();
    },
    staleTime: 30000,
  });


  const isSyncing = isFetchingMembers || isFetchingCoverage;

  const handleRefresh = useCallback(() => {
    void refetchMembers();
    void refetchCoverage();
  }, [refetchMembers, refetchCoverage]);

  const rows: ExtendedMemberIssue[] = useMemo(() => {
    if (!memberRows) return [];
    return memberRows.map((row) => ({
      ...(row as unknown as ExtendedMemberIssue),
      coverage: coverageData?.[row.issueId],
    }));
  }, [memberRows, coverageData]);

  // Milestone-total coverage: aggregate every member issue's per-status
  // counts (matrix pips) + one Untested total + how many issues are
  // Uncovered (no completed outcome). Totals cover ALL members, not the
  // filtered view — it's the milestone's coverage, not the table's.
  const coverageTotals = useMemo(() => {
    const byStatus = new Map<
      number,
      { statusId: number; name: string; color: string | null; count: number }
    >();
    let untested = 0;
    let uncoveredIssues = 0;
    for (const row of rows) {
      const breakdown = row.coverage;
      if (!hasCompletedCoverage(breakdown)) {
        uncoveredIssues += 1;
      }
      if (!breakdown) continue;
      untested += breakdown.untested ?? 0;
      for (const entry of breakdown.statuses ?? []) {
        const existing = byStatus.get(entry.statusId);
        if (existing) {
          existing.count += entry.count;
        } else {
          byStatus.set(entry.statusId, { ...entry });
        }
      }
    }
    return {
      statuses: Array.from(byStatus.values()).sort((a, b) => b.count - a.count),
      untested,
      uncoveredIssues,
    };
  }, [rows]);

  const issueTypes = useMemo(() => {
    const seen = new Map<string, string>();
    rows.forEach((row) => {
      const name = row.issue?.issueTypeName;
      if (name && name.trim() !== "") {
        const lower = name.toLowerCase();
        if (!seen.has(lower)) seen.set(lower, name);
      }
    });
    return Array.from(seen.values()).sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase())
    );
  }, [rows]);

  const filteredRows = useMemo(() => {
    const search = debouncedSearchString.trim().toLowerCase();
    return rows.filter((row) => {
      if (search) {
        const key = row.issue?.name?.toLowerCase() ?? "";
        const title = row.issue?.title?.toLowerCase() ?? "";
        if (!key.includes(search) && !title.includes(search)) return false;
      }
      if (sourceFilter && row.source !== sourceFilter) return false;
      if (issueTypeFilter && row.issue?.issueTypeName !== issueTypeFilter) return false;
      if (!matchesCoverageState(coverageFilter, row.coverage)) return false;
      return true;
    });
  }, [rows, debouncedSearchString, sourceFilter, issueTypeFilter, coverageFilter]);

  const sortedRows = useMemo(() => {
    const { column, direction } = sortConfig;
    const dir = direction === "asc" ? 1 : -1;
    const sorted = [...filteredRows].sort((a, b) => {
      switch (column) {
        case "key":
          return dir * (a.issue?.name ?? "").localeCompare(b.issue?.name ?? "");
        case "title":
          return dir * (a.issue?.title ?? "").localeCompare(b.issue?.title ?? "");
        case "status":
          return (
            dir *
            (a.issue?.externalStatus ?? a.issue?.status ?? "").localeCompare(
              b.issue?.externalStatus ?? b.issue?.status ?? ""
            )
          );
        case "source":
          return dir * (a.source ?? "").localeCompare(b.source ?? "");
        case "coverage": {
          // Shared sort value (CoverageChip) — displayed-Uncovered rows
          // group together instead of interleaving by linked-case count.
          return dir * (coverageSortValue(a.coverage) - coverageSortValue(b.coverage));
        }
        default:
          return 0;
      }
    });
    return sorted;
  }, [filteredRows, sortConfig]);

  // Stable identity — this feeds useMemberIssueColumns' useMemo deps; an
  // inline arrow here regenerated the column defs on EVERY table render,
  // which remounted every cell (flexRender treats a new cell function as a
  // new component type). Remounting the issue badge under a stationary
  // cursor re-fired mouseover -> hover-sync -> refetch -> render -> remount
  // — an endless popover-flicker loop.
  const renderRowActions = useCallback(
    (row: ExtendedMemberIssue) => (
      <MemberIssueRowActions
        milestoneId={milestoneId}
        issueId={row.issueId}
        source={row.source}
        onUnlinked={handleRefresh}
      />
    ),
    [milestoneId, handleRefresh]
  );

  const columns = useMemberIssueColumns({
    translations: {
      key: t("columnKey"),
      description: t("columnDescription"),
      status: t("columnStatus"),
      coverage: t("columnCoverage"),
      source: t("columnSource"),
      sourceSynced: t("sourceSynced"),
      sourceManual: t("sourceManual"),
    },
    projectId,
    renderRowActions,
  });

  const handleSortChange = (column: string) => {
    setSortConfig((prev) => ({
      column,
      direction: prev.column === column && prev.direction === "asc" ? "desc" : "asc",
    }));
  };

  const isLoading = isLoadingMembers || isLoadingCoverage;

  // Collapsed preference persists across refreshes. Seeded in an effect
  // (not the useState initializer) so the SSR pass and first client render
  // agree; localStorage is client-only.
  const [isCollapsed, setIsCollapsed] = useState(false);
  useEffect(() => {
    try {
      setIsCollapsed(
        window.localStorage.getItem(MEMBER_ISSUES_COLLAPSED_KEY) === "true"
      );
    } catch {
      // localStorage unavailable (private mode etc.) — stay expanded.
    }
  }, []);
  const handleCollapsedChange = (open: boolean) => {
    setIsCollapsed(!open);
    try {
      window.localStorage.setItem(
        MEMBER_ISSUES_COLLAPSED_KEY,
        String(!open)
      );
    } catch {
      // Persistence is best-effort.
    }
  };

  return (
    <Card data-testid="member-issues-section">
      <Collapsible open={!isCollapsed} onOpenChange={handleCollapsedChange}>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="flex items-center gap-2">
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 text-muted-foreground"
                aria-expanded={!isCollapsed}
                aria-label={t("sectionTitle")}
                data-testid="member-issues-collapse-toggle"
              >
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${
                    isCollapsed ? "-rotate-90" : ""
                  }`}
                />
              </Button>
            </CollapsibleTrigger>
            {t("sectionTitle")}
            {!isLoadingMembers && (
              <Badge
                variant="secondary"
                data-testid="member-issues-count"
              >
                {rows.length}
              </Badge>
            )}
            {isSyncing && (
              <Badge
                variant="outline"
                className="flex items-center gap-1 text-muted-foreground"
                data-testid="member-issues-syncing-badge"
              >
                <Loader2 className="h-3 w-3 animate-spin" />
                {t("syncing")}
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            <MilestoneIssueManager
              milestoneId={milestoneId}
              projectId={projectId}
              integrationId={milestoneRow?.integrationId ?? undefined}
              linkedIssueIds={rows.map((row) => row.issueId)}
              onLinked={handleRefresh}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              disabled={isSyncing}
              className="text-muted-foreground"
              data-testid="member-issues-refresh"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? "animate-spin" : ""}`} />
              {t("refresh")}
            </Button>
          </div>
        </div>
        <CardDescription>{t("sectionDescription")}</CardDescription>
        {rows.length > 0 &&
          !isLoadingCoverage &&
          (coverageTotals.statuses.length > 0 ||
            coverageTotals.untested > 0 ||
            coverageTotals.uncoveredIssues > 0) && (
            <div
              className="flex items-center gap-3 flex-wrap text-xs font-medium pt-1"
              data-testid="member-issues-coverage-totals"
            >
              {coverageTotals.statuses.map((entry) => (
                <span
                  key={`total-${entry.statusId}`}
                  className="flex items-center gap-1 whitespace-nowrap"
                  aria-label={`${entry.name}: ${entry.count}`}
                  title={entry.name}
                >
                  <IterationStatusPip
                    glyph="passed"
                    statusColor={entry.color ?? undefined}
                  />
                  {entry.count}
                </span>
              ))}
              {coverageTotals.untested > 0 && (
                <span
                  className="flex items-center gap-1 whitespace-nowrap"
                  aria-label={`${tCommon("labels.untested")}: ${coverageTotals.untested}`}
                  title={tCommon("labels.untested")}
                >
                  <IterationStatusPip
                    glyph="notStarted"
                    statusColor={resolvePipColor("notStarted")}
                  />
                  {coverageTotals.untested}
                </span>
              )}
              {coverageTotals.uncoveredIssues > 0 && (
                <Badge
                  variant="outline"
                  className="border-dashed border-warning bg-warning/15 text-foreground"
                  data-testid="member-issues-totals-uncovered"
                >
                  {t("totalsUncovered", {
                    count: coverageTotals.uncoveredIssues,
                  })}
                </Badge>
              )}
              <IterationStatusLegendPopover projectId={projectId} />
            </div>
          )}
      </CardHeader>
      <CollapsibleContent>
      <CardContent>
        <div className="flex items-center gap-2 text-muted-foreground w-full flex-wrap mb-4">
          <Filter
            key="member-issues-filter"
            placeholder={t("filterPlaceholder")}
            initialSearchString={searchString}
            onSearchChange={setSearchString}
            dataTestId="member-issues-search"
            className="grow max-w-lg"
          />
          <Select
            value={coverageFilter || "all"}
            onValueChange={(value) =>
              setCoverageFilter(value === "all" ? "" : (value as CoverageStateFilter))
            }
          >
            <SelectTrigger className="w-[160px]" data-testid="member-issues-coverage-filter">
              <SelectValue placeholder={t("filterAllCoverage")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("filterAllCoverage")}</SelectItem>
              <SelectItem value="UNCOVERED">{t("coverageUncovered")}</SelectItem>
              <SelectItem value="UNTESTED">
                {tCommon("labels.untested")}
              </SelectItem>
              {coverageTotals.statuses.map((entry) => (
                <SelectItem
                  key={`filter-status-${entry.statusId}`}
                  value={`status:${entry.statusId}`}
                >
                  {entry.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={sourceFilter || "all"}
            onValueChange={(value) => setSourceFilter(value === "all" ? "" : (value as SourceFilter))}
          >
            <SelectTrigger className="w-[140px]" data-testid="member-issues-source-filter">
              <SelectValue placeholder={t("filterAllSources")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("filterAllSources")}</SelectItem>
              <SelectItem value="SYNCED">{t("sourceSynced")}</SelectItem>
              <SelectItem value="MANUAL">{t("sourceManual")}</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={issueTypeFilter || "all"}
            onValueChange={(value) => setIssueTypeFilter(value === "all" ? "" : value)}
          >
            <SelectTrigger className="w-[140px]" data-testid="member-issues-type-filter">
              <SelectValue placeholder={t("filterAllTypes")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("filterAllTypes")}</SelectItem>
              {issueTypes.map((typeName) => (
                <SelectItem key={typeName} value={typeName}>
                  {typeName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {!isLoading && sortedRows.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center" data-testid="member-issues-empty">
            {rows.length === 0 ? (
              <div className="flex flex-col items-center gap-3">
                <span>{t("empty")}</span>
                <MilestoneIssueManager
                  milestoneId={milestoneId}
                  projectId={projectId}
                  integrationId={milestoneRow?.integrationId ?? undefined}
                  linkedIssueIds={[]}
                  onLinked={handleRefresh}
                />
              </div>
            ) : (
              t("emptyFiltered")
            )}
          </div>
        ) : (
          <VirtualizedDataTable
            columns={columns as any}
            data={sortedRows as any}
            onSortChange={handleSortChange}
            sortConfig={sortConfig}
            isLoading={isLoading}
            columnVisibility={columnVisibility}
            onColumnVisibilityChange={setColumnVisibility}
            hasMore={false}
            estimateSize={56}
            resetKey={`${debouncedSearchString}|${coverageFilter}|${sourceFilter}|${issueTypeFilter}|${sortConfig.column}|${sortConfig.direction}`}
            testIdPrefix="member-issues-table"
            rowTestIdPrefix="member-issue-row"
          />
        )}

        {!isLoading && (
          <div className="mt-4">
            <MemberIssuesOverflowPanel
              milestoneId={milestoneId}
              onImported={handleRefresh}
            />
          </div>
        )}
      </CardContent>
      </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
