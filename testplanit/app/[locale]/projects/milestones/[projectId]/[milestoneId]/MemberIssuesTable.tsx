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
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { VisibilityState } from "@tanstack/react-table";
import { Loader2, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MemberIssueRowActions, MilestoneIssueManager } from "@/components/issues/MilestoneIssueManager";
import type { CoverageBreakdown } from "./CoverageChip";
import type { ExtendedMemberIssue } from "./MemberIssuesColumns";
import { useMemberIssueColumns } from "./MemberIssuesColumns";
import type { MemberCoverageResponse } from "~/app/api/milestones/[milestoneId]/members/coverage/route";

interface MemberIssuesTableProps {
  milestoneId: number;
  projectId: number;
}

type CoverageStateFilter = "" | "UNCOVERED" | "PASSED" | "FAILED" | "IN_PROGRESS" | "NOT_RUN";
type SourceFilter = "" | "SYNCED" | "MANUAL";

function matchesCoverageState(
  filter: CoverageStateFilter,
  breakdown: CoverageBreakdown | undefined
): boolean {
  if (!filter) return true;
  if (!breakdown) return filter === "UNCOVERED";
  switch (filter) {
    case "UNCOVERED":
      return breakdown.uncovered;
    case "PASSED":
      return breakdown.passed > 0;
    case "FAILED":
      return breakdown.failed > 0;
    case "IN_PROGRESS":
      return breakdown.inProgress > 0;
    case "NOT_RUN":
      return breakdown.notRun > 0;
    default:
      return true;
  }
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
    include: { issue: true },
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

  const handleRefresh = () => {
    void refetchMembers();
    void refetchCoverage();
  };

  const rows: ExtendedMemberIssue[] = useMemo(() => {
    if (!memberRows) return [];
    return memberRows.map((row) => ({
      ...(row as unknown as ExtendedMemberIssue),
      coverage: coverageData?.[row.issueId],
    }));
  }, [memberRows, coverageData]);

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
          const av = a.coverage?.uncovered ? -1 : (a.coverage?.linkedCaseCount ?? 0);
          const bv = b.coverage?.uncovered ? -1 : (b.coverage?.linkedCaseCount ?? 0);
          return dir * (av - bv);
        }
        default:
          return 0;
      }
    });
    return sorted;
  }, [filteredRows, sortConfig]);

  const columns = useMemberIssueColumns({
    translations: {
      key: t("columnKey"),
      title: t("columnTitle"),
      status: t("columnStatus"),
      coverage: t("columnCoverage"),
      source: t("columnSource"),
      sourceSynced: t("sourceSynced"),
      sourceManual: t("sourceManual"),
    },
    projectId,
    renderRowActions: (row) => (
      <MemberIssueRowActions
        milestoneId={milestoneId}
        issueId={row.issueId}
        source={row.source}
        onUnlinked={handleRefresh}
      />
    ),
  });

  const handleSortChange = (column: string) => {
    setSortConfig((prev) => ({
      column,
      direction: prev.column === column && prev.direction === "asc" ? "desc" : "asc",
    }));
  };

  const isLoading = isLoadingMembers || isLoadingCoverage;

  return (
    <Card data-testid="member-issues-section">
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="flex items-center gap-2">
            {t("sectionTitle")}
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
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2 text-muted-foreground w-full flex-wrap mb-4">
          <Filter
            key="member-issues-filter"
            placeholder={t("filterPlaceholder")}
            initialSearchString={searchString}
            onSearchChange={setSearchString}
            dataTestId="member-issues-search"
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
              <SelectItem value="FAILED">{t("coverageFailed")}</SelectItem>
              <SelectItem value="PASSED">{t("coveragePassed")}</SelectItem>
              <SelectItem value="IN_PROGRESS">{t("coverageInProgress")}</SelectItem>
              <SelectItem value="NOT_RUN">{t("coverageNotRun")}</SelectItem>
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
            {rows.length === 0 ? t("empty") : t("emptyFiltered")}
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
      </CardContent>
    </Card>
  );
}
