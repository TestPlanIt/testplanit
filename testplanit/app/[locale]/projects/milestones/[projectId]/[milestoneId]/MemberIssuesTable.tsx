"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { ApplicationArea } from "~/zenstack/models";
import { useDebounce } from "@/components/Debounce";
import { Filter } from "@/components/tables/Filter";
import { VirtualizedDataTable } from "@/components/tables/VirtualizedDataTable";
import { Badge } from "@/components/ui/badge";
import { CardContent } from "@/components/ui/card";
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
import type { RowSelectionState, VisibilityState } from "@tanstack/react-table";
import {
  ChevronDown,
  Loader2,
  PlayCircle,
  RefreshCw,
  Target,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import AddTestRunModal from "@/[locale]/projects/runs/[projectId]/AddTestRunModal";
import {
  MemberIssueRowActions,
  MilestoneIssueManager,
} from "@/components/issues/MilestoneIssueManager";
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
import { useProjectPermissions } from "~/hooks/useProjectPermissions";

const MEMBER_ISSUES_COLLAPSED_KEY = "tpi.milestone.memberIssues.collapsed";

interface MemberIssuesTableProps {
  milestoneId: number;
  projectId: number;
  // Reports this milestone's member issueIds up to the enclosing IssuesCard
  // so the sibling "Found in testing" section can compute its "In scope"
  // cross-badge (an issue appearing in both sections).
  onMemberIssueIdsChange?: (issueIds: number[]) => void;
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
 * "In scope" accordion section of the Issues card on the milestone detail
 * page (MLINK-04, D-07/D-08). A VirtualizedDataTable of this milestone's
 * `MilestoneIssue` rows (D-15: this milestone's members only, never
 * descendant-scoped) joined with the per-issue coverage breakdown from the
 * 18-05 coverage route. Mirrors the project Issues page's
 * VirtualizedDataTable wiring and column patterns. Rendered as a bare
 * section (no owning Card) — the parent `IssuesCard` supplies the outer
 * card and pairs this with the sibling "Found in testing" section.
 */
export function MemberIssuesTable({
  milestoneId,
  projectId,
  onMemberIssueIdsChange,
}: MemberIssuesTableProps) {
  const t = useTranslations("milestones.members");
  const tCommon = useTranslations("common");
  // Unscoped: reused keys from other namespaces (projects.settings skipped
  // toast, repository.cases button label) — shared with the repository
  // create-run flow rather than duplicated here.
  const tGlobal = useTranslations();

  const { permissions: milestonePermissions } = useProjectPermissions(
    projectId,
    ApplicationArea.Milestones
  );
  const canAddEdit = milestonePermissions?.canAddEdit ?? false;

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
    refetch: refetchMembers,
  } = useClientQueries(schema).milestoneIssue.useFindMany({
    where: { milestoneId },
    include: { issue: { include: { integration: true } } },
  });

  // Needed so MilestoneIssueManager can resolve a search-selected external
  // issue via issue.useUpsert() keyed on externalId_integrationId (D-09).
  const { data: milestoneRow } = useClientQueries(
    schema
  ).milestones.useFindFirst({
    where: { id: milestoneId },
    select: { integrationId: true },
  });

  const {
    data: coverageData,
    isLoading: isLoadingCoverage,
    refetch: refetchCoverage,
  } = useQuery<MemberCoverageResponse>({
    queryKey: ["milestoneMemberCoverage", milestoneId],
    queryFn: async () => {
      const response = await fetch(
        `/api/milestones/${milestoneId}/members/coverage`
      );
      if (!response.ok) {
        throw new Error("Failed to fetch member coverage");
      }
      return response.json();
    },
    staleTime: 30000,
  });

  // Spin/disable the Refresh button only for a USER-initiated refresh —
  // deriving it from isFetching made it strobe on every background
  // SSE-wake-up refetch.
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);

  const handleRefresh = useCallback(() => {
    setIsManualRefreshing(true);
    void Promise.allSettled([refetchMembers(), refetchCoverage()]).finally(() =>
      setIsManualRefreshing(false)
    );
  }, [refetchMembers, refetchCoverage]);

  const rows: ExtendedMemberIssue[] = useMemo(() => {
    if (!memberRows) return [];
    return memberRows.map((row) => ({
      ...(row as unknown as ExtendedMemberIssue),
      coverage: coverageData?.[row.issueId],
    }));
  }, [memberRows, coverageData]);

  // Report member issueIds up for the sibling "Found in testing" section's
  // cross-badge — content-keyed so this only fires when the actual id set
  // changes, not on every unrelated re-render.
  const memberIssueIdsKey = useMemo(
    () =>
      rows
        .map((row) => row.issueId)
        .sort((a, b) => a - b)
        .join(","),
    [rows]
  );
  useEffect(() => {
    if (!onMemberIssueIdsChange) return;
    const ids = memberIssueIdsKey
      ? memberIssueIdsKey.split(",").map(Number)
      : [];
    onMemberIssueIdsChange(ids);
  }, [memberIssueIdsKey, onMemberIssueIdsChange]);

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
      if (issueTypeFilter && row.issue?.issueTypeName !== issueTypeFilter)
        return false;
      if (!matchesCoverageState(coverageFilter, row.coverage)) return false;
      return true;
    });
  }, [
    rows,
    debouncedSearchString,
    sourceFilter,
    issueTypeFilter,
    coverageFilter,
  ]);

  const sortedRows = useMemo(() => {
    const { column, direction } = sortConfig;
    const dir = direction === "asc" ? 1 : -1;
    const sorted = [...filteredRows].sort((a, b) => {
      switch (column) {
        case "key":
          return dir * (a.issue?.name ?? "").localeCompare(b.issue?.name ?? "");
        case "title":
          return (
            dir * (a.issue?.title ?? "").localeCompare(b.issue?.title ?? "")
          );
        case "status":
          return (
            dir *
            (a.issue?.externalStatus ?? a.issue?.status ?? "").localeCompare(
              b.issue?.externalStatus ?? b.issue?.status ?? ""
            )
          );
        case "source":
          return dir * (a.source ?? "").localeCompare(b.source ?? "");
        case "cases":
          return (
            dir *
            ((a.coverage?.linkedCaseCount ?? 0) -
              (b.coverage?.linkedCaseCount ?? 0))
          );
        case "coverage": {
          // Shared sort value (CoverageChip) — displayed-Uncovered rows
          // group together instead of interleaving by linked-case count.
          return (
            dir *
            (coverageSortValue(a.coverage) - coverageSortValue(b.coverage))
          );
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
  const rowActionsRenderer = canAddEdit ? renderRowActions : undefined;

  // Row selection (issueId-keyed via getRowId, so filter/sort can't
  // re-target selections) drives "Create test run from selected issues":
  // resolve every non-deleted case linked to the selected issues, then open
  // the Add Test Run wizard RIGHT HERE — no navigation to the runs page, so
  // cancelling doesn't strand the user; success/errors surface via the
  // wizard's own toasts.
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [isResolvingRun, setIsResolvingRun] = useState(false);
  const [runSeed, setRunSeed] = useState<{
    caseIds: number[];
    issueIds: number[];
  } | null>(null);
  const selectedIssueIds = Object.keys(rowSelection)
    .filter((id) => rowSelection[id])
    .map(Number)
    .filter((id) => Number.isInteger(id));
  // Key on content, not array identity — selectedIssueIds is rebuilt
  // every render.
  const selectedIssueIdsKey = selectedIssueIds.join(",");
  const sortedSelectedIds = useMemo(
    () =>
      selectedIssueIdsKey
        .split(",")
        .filter(Boolean)
        .map(Number)
        .sort((a, b) => a - b),
    [selectedIssueIdsKey]
  );

  // Distinct linked-case count for the current selection, so the button can
  // say how many cases the run will seed. A count query (not a sum of the
  // per-issue column) because a case linked to several selected issues must
  // count once.
  const { data: selectedCaseCount } = useQuery<number>({
    queryKey: ["memberIssuesRunCaseCount", sortedSelectedIds],
    enabled: sortedSelectedIds.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      const q = {
        where: {
          isDeleted: false,
          caseIssues: { some: { issueId: { in: sortedSelectedIds } } },
        },
      };
      const resp = await fetch(
        `/api/model/repositoryCases/count?q=${encodeURIComponent(JSON.stringify(q))}`,
        { credentials: "include" }
      );
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const body = await resp.json();
      return Number(body?.data ?? 0);
    },
  });

  const handleCreateTestRun = async () => {
    if (selectedIssueIds.length === 0 || isResolvingRun) return;
    setIsResolvingRun(true);
    try {
      const fetchCases = async (
        where: Record<string, unknown>,
        select: Record<string, unknown>
      ) => {
        const params = new URLSearchParams({
          q: JSON.stringify({ where, select }),
        });
        const resp = await fetch(
          `/api/model/repositoryCases/findMany?${params.toString()}`,
          { credentials: "include" }
        );
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const body = await resp.json();
        return (body?.data ?? []) as Array<{
          id: number;
          caseIssues?: Array<{ issueId: number }>;
        }>;
      };

      // Cases come back WITH their issue links so the handoff can pre-link
      // exactly the selected issues that contributed at least one seeded
      // case (case-less selections must not be linked to the new run).
      const linkedCases = await fetchCases(
        {
          isDeleted: false,
          caseIssues: { some: { issueId: { in: selectedIssueIds } } },
        },
        { id: true, caseIssues: { select: { issueId: true } } }
      );
      const linkedCaseIds = linkedCases.map((c) => c.id);
      if (linkedCaseIds.length === 0) {
        toast.info(t("createRunNoCases"));
        return;
      }

      // Parity with the repository flow: honor the project's
      // exclude-not-started-from-runs setting, with the same skipped toast.
      let idsToSeed = linkedCaseIds;
      const settingsParams = new URLSearchParams({
        q: JSON.stringify({
          where: { id: projectId },
          select: { excludeNotStartedFromRuns: true },
        }),
      });
      const settingsResp = await fetch(
        `/api/model/projects/findFirst?${settingsParams.toString()}`,
        { credentials: "include" }
      );
      const settingsBody = settingsResp.ok ? await settingsResp.json() : null;
      if (settingsBody?.data?.excludeNotStartedFromRuns) {
        const eligibleIds = (
          await fetchCases(
            {
              id: { in: linkedCaseIds },
              state: { workflowType: { not: "NOT_STARTED" } },
            },
            { id: true }
          )
        ).map((c) => c.id);
        const skippedCount = linkedCaseIds.length - eligibleIds.length;
        if (skippedCount > 0) {
          toast.info(
            tGlobal(
              "projects.settings.advanced.excludeNotStarted.skippedToast",
              { count: skippedCount }
            )
          );
        }
        if (eligibleIds.length === 0) return;
        idsToSeed = eligibleIds;
      }

      // Selected issues that own >=1 seeded case — these get pre-linked on
      // the Add Run form, along with this milestone.
      const seededIdSet = new Set(idsToSeed);
      const selectedIdSet = new Set(selectedIssueIds);
      const contributingIssueIds = Array.from(
        new Set(
          linkedCases
            .filter((c) => seededIdSet.has(c.id))
            .flatMap((c) => c.caseIssues ?? [])
            .map((link) => link.issueId)
            .filter((issueId) => selectedIdSet.has(issueId))
        )
      );

      setRunSeed({ caseIds: idsToSeed, issueIds: contributingIssueIds });
    } catch (err) {
      console.error("Failed to resolve cases for selected issues:", err);
      toast.error(tCommon("errors.somethingWentWrong"));
    } finally {
      setIsResolvingRun(false);
    }
  };

  // Shift-click range selection over the CURRENT sorted/filtered view,
  // mirroring the repository table (Cases.tsx handleCheckboxClick). Ref
  // indirection keeps the handler's identity stable — it feeds the columns
  // useMemo, and regenerating column defs remounts every cell (the
  // popover-flicker loop above).
  const rangeStateRef = useRef({ sortedRows, rowSelection });
  useEffect(() => {
    rangeStateRef.current = { sortedRows, rowSelection };
  });
  const lastToggledIssueIdRef = useRef<number | null>(null);
  const handleRowCheckboxClick = useCallback(
    (issueId: number, event: React.MouseEvent<HTMLButtonElement>) => {
      const { sortedRows: view, rowSelection: current } = rangeStateRef.current;
      const last = lastToggledIssueIdRef.current;
      if (event.shiftKey && last != null && last !== issueId) {
        const ids = view.map((row) => row.issueId);
        const from = ids.indexOf(last);
        const to = ids.indexOf(issueId);
        if (from !== -1 && to !== -1) {
          const [start, end] = from < to ? [from, to] : [to, from];
          const next = { ...current };
          for (let i = start; i <= end; i++) next[String(ids[i])] = true;
          setRowSelection(next);
          return;
        }
      }
      const key = String(issueId);
      const willSelect = !current[key];
      setRowSelection({ ...current, [key]: willSelect });
      if (willSelect) lastToggledIssueIdRef.current = issueId;
    },
    []
  );

  const columns = useMemberIssueColumns({
    translations: {
      selectRow: tCommon("aria.selectRow"),
      key: t("columnKey"),
      description: t("columnDescription"),
      status: t("columnStatus"),
      cases: tCommon("fields.testCases"),
      coverage: t("columnCoverage"),
      source: t("columnSource"),
      sourceSynced: t("sourceSynced"),
      sourceManual: t("sourceManual"),
    },
    projectId,
    renderRowActions: rowActionsRenderer,
    onRowCheckboxClick: handleRowCheckboxClick,
  });

  const handleSortChange = (column: string) => {
    setSortConfig((prev) => ({
      column,
      direction:
        prev.column === column && prev.direction === "asc" ? "desc" : "asc",
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
      window.localStorage.setItem(MEMBER_ISSUES_COLLAPSED_KEY, String(!open));
    } catch {
      // Persistence is best-effort.
    }
  };

  return (
    <div data-testid="member-issues-section">
      <Collapsible open={!isCollapsed} onOpenChange={handleCollapsedChange}>
        <div className="flex flex-col space-y-1.5 px-6 py-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 font-semibold leading-none tracking-tight">
              <CollapsibleTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-muted-foreground"
                  aria-expanded={!isCollapsed}
                  aria-label={t("inScope")}
                  data-testid="member-issues-collapse-toggle"
                >
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${
                      isCollapsed ? "-rotate-90" : ""
                    }`}
                  />
                </Button>
              </CollapsibleTrigger>
              <Target className="h-4 w-4 text-muted-foreground shrink-0" />
              {t("inScope")}
              {!isLoadingMembers && (
                <Badge variant="secondary" data-testid="member-issues-count">
                  {rows.length}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              {selectedIssueIds.length > 0 && (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleCreateTestRun()}
                  disabled={isResolvingRun}
                  data-testid="member-issues-create-run"
                >
                  {isResolvingRun ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <PlayCircle className="h-3.5 w-3.5" />
                  )}
                  {selectedCaseCount != null
                    ? t("createTestRunDetailed", {
                        issues: selectedIssueIds.length,
                        cases: selectedCaseCount,
                      })
                    : tGlobal("repository.cases.createTestRun")}
                </Button>
              )}
              {canAddEdit && (
                <MilestoneIssueManager
                  milestoneId={milestoneId}
                  projectId={projectId}
                  integrationId={milestoneRow?.integrationId ?? undefined}
                  linkedIssueIds={rows.map((row) => row.issueId)}
                  onLinked={handleRefresh}
                />
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleRefresh}
                disabled={isManualRefreshing}
                className="text-muted-foreground"
                data-testid="member-issues-refresh"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${isManualRefreshing ? "animate-spin" : ""}`}
                />
                {t("refresh")}
              </Button>
            </div>
          </div>
          {rows.length > 0 &&
            !isLoadingCoverage &&
            (coverageTotals.statuses.length > 0 ||
              coverageTotals.untested > 0 ||
              coverageTotals.uncoveredIssues > 0) && (
              <div
                className="flex items-center justify-end gap-3 flex-wrap text-xs font-medium pt-1"
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
        </div>
        <CollapsibleContent className="overflow-hidden data-[state=open]:animate-slide-down data-[state=closed]:animate-slide-up">
          <CardContent>
            {rows.length > 0 && (
              <div className="flex items-center gap-2 text-muted-foreground w-full flex-wrap mb-4">
                <Filter
                  key="member-issues-filter"
                  placeholder={tGlobal("admin.issues.filterPlaceholder")}
                  initialSearchString={searchString}
                  onSearchChange={setSearchString}
                  dataTestId="member-issues-search"
                  className="grow shrink basis-[120px] min-w-[120px] max-w-lg"
                />
                <Select
                  value={coverageFilter || "all"}
                  onValueChange={(value) =>
                    setCoverageFilter(
                      value === "all" ? "" : (value as CoverageStateFilter)
                    )
                  }
                >
                  <SelectTrigger
                    className="w-[160px] shrink-0"
                    data-testid="member-issues-coverage-filter"
                  >
                    <SelectValue placeholder={t("filterAllCoverage")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      {t("filterAllCoverage")}
                    </SelectItem>
                    <SelectItem value="UNCOVERED">
                      {t("coverageUncovered")}
                    </SelectItem>
                    <SelectItem value="UNTESTED">
                      {t("filterHasUntested")}
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
                  onValueChange={(value) =>
                    setSourceFilter(
                      value === "all" ? "" : (value as SourceFilter)
                    )
                  }
                >
                  <SelectTrigger
                    className="w-[140px] shrink-0"
                    data-testid="member-issues-source-filter"
                  >
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
                  onValueChange={(value) =>
                    setIssueTypeFilter(value === "all" ? "" : value)
                  }
                >
                  <SelectTrigger
                    className="w-[140px] shrink-0"
                    data-testid="member-issues-type-filter"
                  >
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
            )}

            {!isLoading && sortedRows.length === 0 ? (
              <div
                className="text-sm text-muted-foreground py-8 text-center"
                data-testid="member-issues-empty"
              >
                {rows.length === 0 ? (
                  <div className="flex flex-col items-center gap-3">
                    <span>{t("empty")}</span>
                    {canAddEdit && (
                      <MilestoneIssueManager
                        milestoneId={milestoneId}
                        projectId={projectId}
                        integrationId={milestoneRow?.integrationId ?? undefined}
                        linkedIssueIds={[]}
                        onLinked={handleRefresh}
                      />
                    )}
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
                rowSelection={rowSelection}
                onRowSelectionChange={setRowSelection}
                getRowId={(row: ExtendedMemberIssue) => String(row.issueId)}
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
                  projectId={projectId}
                  onImported={handleRefresh}
                />
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>

      {runSeed && (
        <AddTestRunModal
          open
          onClose={() => setRunSeed(null)}
          initialSelectedCaseIds={runSeed.caseIds}
          onSelectedCasesChange={(cases) =>
            setRunSeed((prev) => (prev ? { ...prev, caseIds: cases } : prev))
          }
          initialLinkedIssueIds={runSeed.issueIds}
          defaultMilestoneId={milestoneId}
        />
      )}
    </div>
  );
}
