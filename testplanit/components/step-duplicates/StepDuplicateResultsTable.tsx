"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { DataTable } from "@/components/tables/DataTable";
import { Filter } from "@/components/tables/Filter";
import { useDebounce } from "@/components/Debounce";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";
import { RowSelectionState, Updater } from "@tanstack/react-table";
import { CopyX, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import React, { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { usePersistedFilter } from "~/hooks/usePersistedFilter";
import { extractTextFromNode } from "~/utils/extractTextFromJson";
import { type StepDuplicateRow, getColumns } from "./stepDuplicateColumns";
import { StepDuplicateConversionDialog } from "./StepDuplicateConversionDialog";
import type { RepositoryCaseSource } from "~/zenstack/models";

interface MatchMember {
  id: number;
  caseId: number;
  startStepId: number;
  endStepId: number;
  case: {
    id: number;
    name: string;
    source: RepositoryCaseSource;
    automated: boolean;
  };
}

interface MatchWithMembers {
  id: number;
  projectId: number;
  fingerprint: string;
  stepCount: number;
  status: string;
  members: MatchMember[];
}

const MIN_CASES_STORAGE_PREFIX = "step-duplicates-min-cases:";
const MIN_STEPS_STORAGE_PREFIX = "step-duplicates-min-steps:";

/** Matches fetched per scroll page. Bounds each response — including the
 * member cases' step text the row previews need — to a few MB. */
const PAGE_SIZE = 50;

/** Threshold value meaning "no minimum" — every match qualifies. */
const NO_MINIMUM = 0;

const parseThreshold = (stored: string | null): number => {
  if (!stored) return NO_MINIMUM;
  const parsed = Number(JSON.parse(stored));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : NO_MINIMUM;
};

const ascending = (a: number, b: number) => a - b;

const uniqueSorted = (values: number[]) =>
  Array.from(new Set(values)).sort(ascending);

/**
 * Snaps a threshold onto counts that are actually reachable: up to the next
 * real count, which selects the same rows while keeping the dropdown on a value
 * it offers, and never past the largest one — asking for more cases or steps
 * than any reachable match has would otherwise empty the table with no option
 * left to climb back down to.
 */
const snapThreshold = (thresholds: number[], stored: number): number => {
  if (stored <= NO_MINIMUM || thresholds.length === 0) return NO_MINIMUM;
  return (
    thresholds.find((value) => value >= stored) ??
    thresholds[thresholds.length - 1]
  );
};

interface StepDuplicateResultsTableProps {
  projectId: string;
  onRowClick?: (row: StepDuplicateRow) => void;
}

export function StepDuplicateResultsTable({
  projectId,
  onRowClick,
}: StepDuplicateResultsTableProps) {
  const t = useTranslations("sharedSteps.stepDuplicates");
  const tCommon = useTranslations("common");
  // Reuses the audit log's loaded-of-total totals key rather than minting a
  // near-duplicate under this namespace.
  const tTotals = useTranslations("admin.auditLogs");
  const queryClient = useQueryClient();
  const [selectedMatch, setSelectedMatch] = useState<MatchWithMembers | null>(
    null
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >({});
  const [sortConfig, setSortConfig] = useState<{
    column: string;
    direction: "asc" | "desc";
  }>({ column: "stepCount", direction: "desc" });
  const [searchString, setSearchString] = useState("");
  const [minCases, setMinCases] = usePersistedFilter(
    `${MIN_CASES_STORAGE_PREFIX}${projectId}`,
    NO_MINIMUM,
    parseThreshold
  );
  const [minSteps, setMinSteps] = usePersistedFilter(
    `${MIN_STEPS_STORAGE_PREFIX}${projectId}`,
    NO_MINIMUM,
    parseThreshold
  );
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(
    null
  );
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);

  const updateMatch = useClientQueries(schema).stepSequenceMatch.useUpdate();

  const debouncedSearch = useDebounce(searchString, 400);

  // Server-expressible filters shared by both queries below. The case-name
  // search moves into the query so the facet feed and the windowed rows agree
  // on the same filtered set.
  const liteWhere = useMemo(
    () => ({
      projectId: Number(projectId),
      status: "PENDING" as const,
      isDeleted: false,
      ...(debouncedSearch
        ? {
            members: {
              some: {
                case: {
                  isDeleted: false,
                  name: {
                    contains: debouncedSearch,
                    mode: "insensitive" as const,
                  },
                },
              },
            },
          }
        : {}),
    }),
    [projectId, debouncedSearch]
  );

  // Facet feed: id plus the two numbers for EVERY match in the filtered set —
  // two ints per row stays cheap at any scale, so the threshold dropdowns keep
  // snapping against the whole result set while the heavy row data arrives in
  // scroll-sized pages below.
  const { data: liteRows, isLoading: liteLoading } = useClientQueries(
    schema
  ).stepSequenceMatch.useFindMany({
    where: liteWhere,
    select: {
      id: true,
      stepCount: true,
      _count: {
        select: { members: { where: { case: { isDeleted: false } } } },
      },
    },
  });

  const liteMapped = useMemo(
    () =>
      ((liteRows ?? []) as any[]).map((row) => ({
        id: row.id as number,
        stepCount: row.stepCount as number,
        casesCount: (row._count?.members ?? 0) as number,
      })),
    [liteRows]
  );

  const {
    stepThresholds,
    caseThresholds,
    effectiveMinCases,
    effectiveMinSteps,
  } = useMemo(() => {
    const stepsApplied = snapThreshold(
      uniqueSorted(liteMapped.map((row) => row.stepCount)),
      minSteps
    );
    const rowsAfterSteps = liteMapped.filter(
      (row) => row.stepCount >= stepsApplied
    );
    const casesApplied = snapThreshold(
      uniqueSorted(rowsAfterSteps.map((row) => row.casesCount)),
      minCases
    );

    // The applied value is folded back into its own list: resolving steps
    // before cases can leave a step minimum that no longer names a count under
    // the case minimum, and a dropdown must always be able to show its own
    // selection.
    const withApplied = (values: number[], applied: number) =>
      uniqueSorted(applied > NO_MINIMUM ? [...values, applied] : values);

    return {
      stepThresholds: withApplied(
        liteMapped
          .filter((row) => row.casesCount >= casesApplied)
          .map((row) => row.stepCount),
        stepsApplied
      ),
      caseThresholds: withApplied(
        rowsAfterSteps.map((row) => row.casesCount),
        casesApplied
      ),
      effectiveMinCases: casesApplied,
      effectiveMinSteps: stepsApplied,
    };
  }, [liteMapped, minCases, minSteps]);

  // The full result set, filtered and sorted CLIENT-side over the lite
  // numbers — this ordered id list is the single source of truth the detail
  // pages below follow. (Identical semantics to the original in-memory table.)
  const displayIds = useMemo(() => {
    const filtered = liteMapped.filter(
      (row) =>
        row.casesCount >= effectiveMinCases &&
        row.stepCount >= effectiveMinSteps
    );
    const dir = sortConfig.direction === "asc" ? 1 : -1;
    const key =
      sortConfig.column === "casesCount"
        ? (r: (typeof filtered)[number]) => r.casesCount
        : (r: (typeof filtered)[number]) => r.stepCount;
    return [...filtered]
      .sort((a, b) =>
        key(a) - key(b) === 0 ? a.id - b.id : (key(a) - key(b)) * dir
      )
      .map((row) => row.id);
  }, [liteMapped, effectiveMinCases, effectiveMinSteps, sortConfig]);

  // Detail pages fetch by EXPLICIT id slices, never by skip/take over the
  // filter: the v3 policy layer prices a paginated findMany by the full
  // matching set, so a 50-id page is the only shape that stays O(page) — the
  // same reason lib/paginatedFindMany.ts exists server-side. Each page carries
  // its member cases' steps for the row previews; ~50 matches ≈ a few MB.
  const detailInclude = useMemo(
    () => ({
      members: {
        where: { case: { isDeleted: false } },
        include: {
          case: {
            select: {
              id: true,
              name: true,
              source: true,
              automated: true,
              steps: {
                where: { isDeleted: false },
                orderBy: { order: "asc" as const },
                select: {
                  id: true,
                  step: true,
                  expectedResult: true,
                  order: true,
                },
              },
            },
          },
        },
      },
    }),
    []
  );

  const firstSlice = useMemo(
    () => displayIds.slice(0, PAGE_SIZE),
    [displayIds]
  );

  const {
    data: matchPages,
    fetchNextPage,
    isFetchingNextPage,
    isLoading: matchesLoading,
  } = useClientQueries(schema).stepSequenceMatch.useInfiniteFindMany(
    {
      where: { id: { in: firstSlice } },
      include: detailInclude,
    } as any,
    {
      getNextPageParam: (_lastPage: unknown[], allPages: unknown[][]) => {
        const next = displayIds.slice(
          allPages.length * PAGE_SIZE,
          (allPages.length + 1) * PAGE_SIZE
        );
        if (next.length === 0) return undefined;
        return { where: { id: { in: next } }, include: detailInclude };
      },
      enabled: firstSlice.length > 0,
      refetchOnWindowFocus: false,
    }
  );

  const loadedMatches = useMemo(
    () => (matchPages?.pages.flat() ?? []) as any[],
    [matchPages]
  );

  const isLoading = liteLoading || (matchesLoading && firstSlice.length > 0);

  const handleSortChange = (column: string) => {
    setSortConfig((prev) => ({
      column,
      direction:
        prev.column === column && prev.direction === "asc" ? "desc" : "asc",
    }));
  };

  // Explicit-direction sort from the header column menu; `null` (Remove sort)
  // restores the default order.
  const handleSortColumn = (
    column: string,
    direction: "asc" | "desc" | null
  ) => {
    if (direction === null) {
      setSortConfig({ column: "stepCount", direction: "desc" });
    } else {
      setSortConfig({ column, direction });
    }
  };

  // Selection is keyed by match id, but a filter change swaps out the visible
  // set — drop the selection so nothing hidden stays armed for a bulk dismiss.
  const resetPageAndSelection = useCallback(() => {
    setRowSelection({});
    setLastSelectedIndex(null);
  }, []);

  const handleFilterChange = useCallback(
    (value: string) => {
      setSearchString(value);
      resetPageAndSelection();
    },
    [resetPageAndSelection]
  );

  const handleMinCasesChange = useCallback(
    (value: string) => {
      setMinCases(Number(value));
      resetPageAndSelection();
    },
    [setMinCases, resetPageAndSelection]
  );

  const handleMinStepsChange = useCallback(
    (value: string) => {
      setMinSteps(Number(value));
      resetPageAndSelection();
    },
    [setMinSteps, resetPageAndSelection]
  );

  const handleRowSelectionChange = useCallback(
    (updater: Updater<RowSelectionState>) => {
      setRowSelection((prev) =>
        typeof updater === "function" ? updater(prev) : updater
      );
    },
    []
  );

  const mappedById = useMemo(() => {
    const rows = loadedMatches.map((match) => {
      const members = (match as any).members ?? [];
      const caseNames: string[] = members
        .map((m: any) => m.case?.name ?? "")
        .filter(Boolean);

      // Build the step preview from the first member's matched range.
      let matchedStepsPreview = "";
      const firstMember = members[0];
      if (firstMember?.case?.steps) {
        const steps = firstMember.case.steps as Array<{
          id: number;
          step: unknown;
          order: number;
        }>;
        const startIdx = steps.findIndex(
          (s: any) => s.id === firstMember.startStepId
        );
        const endIdx = steps.findIndex(
          (s: any) => s.id === firstMember.endStepId
        );
        if (startIdx >= 0 && endIdx >= 0) {
          matchedStepsPreview = steps
            .slice(startIdx, endIdx + 1)
            .map((s: any) => extractTextFromNode(s.step))
            .filter(Boolean)
            .join(" → ");
        }
      }

      return {
        id: match.id,
        name: caseNames.join(" / "),
        stepCount: match.stepCount,
        fingerprint: match.fingerprint,
        matchedStepsPreview:
          matchedStepsPreview ||
          t("matchedStepsCount", { count: match.stepCount }),
        casesCount: members.length,
        caseNames,
        status: match.status,
      };
    });
    return new Map(rows.map((row) => [row.id, row]));
  }, [loadedMatches, t]);

  // Rows render as the contiguous loaded PREFIX of the ordered id list — an
  // id-in page returns rows in DB order, so ordering is re-imposed here, and
  // stopping at the first unloaded id keeps the list gap-free while pages
  // stream in.
  const { displayRows, hasMore } = useMemo(() => {
    const rows: StepDuplicateRow[] = [];
    for (const id of displayIds) {
      const row = mappedById.get(id);
      if (!row) break;
      rows.push(row);
    }
    return { displayRows: rows, hasMore: rows.length < displayIds.length };
  }, [displayIds, mappedById]);

  // Each dropdown is faceted against the other: it offers the counts still
  // reachable once the other minimum (and the search) has been applied, so no
  // selection available in either one can empty the table. The pair is resolved
  // steps-first — matching their order on screen — to keep it acyclic.
  const filtersActive =
    searchString.length > 0 ||
    effectiveMinCases > NO_MINIMUM ||
    effectiveMinSteps > NO_MINIMUM;

  // Selection keys are match ids (via the table's getRowId), so a background
  // refetch or appended page never re-targets what is selected. Shift-range
  // still walks display indexes, then records the ids at those positions.
  const handleCheckboxClick = useCallback(
    (rowIndex: number, event: React.MouseEvent) => {
      const idAt = (i: number) => String(displayRows[i]?.id ?? i);
      if (
        event.shiftKey &&
        lastSelectedIndex !== null &&
        lastSelectedIndex !== rowIndex
      ) {
        const start = Math.min(lastSelectedIndex, rowIndex);
        const end = Math.max(lastSelectedIndex, rowIndex);
        const rangeSelection: RowSelectionState = { ...rowSelection };
        for (let i = start; i <= end; i++) {
          rangeSelection[idAt(i)] = true;
        }
        setRowSelection(rangeSelection);
      } else {
        const newSelection = { ...rowSelection };
        newSelection[idAt(rowIndex)] = !newSelection[idAt(rowIndex)];
        setRowSelection(newSelection);
        if (!rowSelection[idAt(rowIndex)]) {
          setLastSelectedIndex(rowIndex);
        }
      }
    },
    [lastSelectedIndex, rowSelection, displayRows]
  );

  const handleSelectAllClick = useCallback(() => {
    const allSelected =
      displayRows.length > 0 &&
      displayRows.every((row) => rowSelection[String(row.id)]);
    if (allSelected) {
      setRowSelection({});
    } else {
      const allSelection: RowSelectionState = {};
      for (const row of displayRows) {
        allSelection[String(row.id)] = true;
      }
      setRowSelection(allSelection);
    }
  }, [displayRows, rowSelection]);

  const columns = useMemo(
    () => getColumns(t, tCommon, handleCheckboxClick, handleSelectAllClick),
    [t, tCommon, handleCheckboxClick, handleSelectAllClick]
  );

  const handleTableRowClick = useCallback(
    (id: number | string) => {
      const row = displayRows.find((item) => item.id === id);
      if (row && onRowClick) {
        onRowClick(row);
      }
      // Open the conversion dialog for the clicked row
      const match = loadedMatches.find((m) => m.id === Number(id));
      if (match) {
        setSelectedMatch(match as unknown as MatchWithMembers);
        setDialogOpen(true);
      }
    },
    [displayRows, onRowClick, loadedMatches]
  );

  const handleResolved = useCallback(() => {
    void queryClient.invalidateQueries({
      predicate: (q) => {
        const key = q.queryKey as string[];
        return (
          key.some?.(
            (k: unknown) =>
              typeof k === "string" && k.includes("StepSequenceMatch")
          ) ?? false
        );
      },
    });
    setRowSelection({});
  }, [queryClient]);

  const getSelectedItems = useCallback(() => {
    return displayRows.filter((row) => rowSelection[String(row.id)]);
  }, [rowSelection, displayRows]);

  const handleBulkAction = useCallback(
    async (_action: "dismiss") => {
      const items = getSelectedItems();
      if (items.length === 0) return;
      setIsBulkProcessing(true);

      let successCount = 0;
      let failCount = 0;

      for (const item of items) {
        try {
          await updateMatch.mutateAsync({
            where: { id: item.id },
            data: { status: "DISMISSED" },
          });
          successCount++;
        } catch {
          failCount++;
        }
      }

      if (successCount > 0) {
        toast.success(t("bulkDismissSuccess", { count: successCount }));
      }
      if (failCount > 0) {
        toast.error(t("bulkError"));
      }

      setRowSelection({});
      setIsBulkProcessing(false);
      void queryClient.invalidateQueries({
        predicate: (q) => {
          const key = q.queryKey as string[];
          return (
            key.some?.(
              (k: unknown) =>
                typeof k === "string" && k.includes("StepSequenceMatch")
            ) ?? false
          );
        },
      });
    },
    [getSelectedItems, t, updateMatch, queryClient]
  );

  const selectedCount = Object.values(rowSelection).filter(Boolean).length;

  if (!isLoading && liteMapped.length === 0 && !debouncedSearch) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="text-lg font-medium">{t("noResultsFound")}</p>
        <p className="text-sm">{t("noResultsDescription")}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-row items-start gap-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 grow min-w-[250px] text-muted-foreground">
          <Filter
            className="w-56 max-w-full"
            placeholder={t("filterPlaceholder")}
            initialSearchString={searchString}
            onSearchChange={handleFilterChange}
          />
          <div className="flex items-center gap-2">
            <Label htmlFor="min-steps-filter" className="text-nowrap">
              {t("minStepsLabel")}
            </Label>
            <Select
              value={String(effectiveMinSteps)}
              onValueChange={handleMinStepsChange}
            >
              <SelectTrigger
                id="min-steps-filter"
                className="w-20"
                data-testid="min-steps-filter"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={String(NO_MINIMUM)}>
                  {tCommon("filters.all")}
                </SelectItem>
                {stepThresholds.map((value) => (
                  <SelectItem key={value} value={String(value)}>
                    {t("minThresholdOption", { count: value })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="min-cases-filter" className="text-nowrap">
              {t("minCasesLabel")}
            </Label>
            <Select
              value={String(effectiveMinCases)}
              onValueChange={handleMinCasesChange}
            >
              <SelectTrigger
                id="min-cases-filter"
                className="w-20"
                data-testid="min-cases-filter"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={String(NO_MINIMUM)}>
                  {tCommon("filters.all")}
                </SelectItem>
                {caseThresholds.map((value) => (
                  <SelectItem key={value} value={String(value)}>
                    {t("minThresholdOption", { count: value })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {displayIds.length > 0 && (
          <div className="ms-auto self-center text-sm text-muted-foreground text-nowrap">
            {tTotals("showing", {
              loaded: displayRows.length,
              total: displayIds.length,
            })}
          </div>
        )}
      </div>

      {/* Bulk action bar */}
      {selectedCount > 0 && (
        <div className="flex items-center gap-2 mt-4 mb-2 p-2 bg-muted/50 rounded-lg border h-12">
          <span className="text-sm text-muted-foreground me-2">
            {t("selected", { count: selectedCount })}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleBulkAction("dismiss")}
            disabled={isBulkProcessing}
          >
            {isBulkProcessing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CopyX className="h-4 w-4" />
            )}
            {t("bulkDismiss", { count: selectedCount })}
          </Button>
        </div>
      )}

      {selectedCount === 0 && (
        <div className="flex items-center gap-2 mt-4 mb-2 p-2 bg-muted/50 rounded-lg border h-12 text-sm">
          {t("tableHint")}
        </div>
      )}

      <div className="h-[calc(100vh-22rem)] min-h-[400px] w-full">
        <DataTable
          virtualized
          columns={columns}
          data={displayRows}
          onSortChange={handleSortChange}
          onSortColumn={handleSortColumn}
          sortConfig={sortConfig}
          columnVisibility={columnVisibility}
          onColumnVisibilityChange={setColumnVisibility}
          isLoading={isLoading || isFetchingNextPage}
          emptyMessage={filtersActive ? t("noMatchesForFilters") : undefined}
          onRowClick={handleTableRowClick}
          rowSelection={rowSelection}
          onRowSelectionChange={handleRowSelectionChange}
          getRowId={(row) => String((row as StepDuplicateRow).id)}
          columnSizingStorageKey="step-duplicates"
          hasMore={hasMore}
          onLoadMore={fetchNextPage}
          loadedCount={loadedMatches.length}
          resetKey={`${debouncedSearch}|${effectiveMinSteps}|${effectiveMinCases}|${sortConfig.column}|${sortConfig.direction}`}
          testIdPrefix="step-duplicates-table"
          rowTestIdPrefix="step-duplicate-row"
        />
      </div>

      <StepDuplicateConversionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        match={selectedMatch}
        onResolved={handleResolved}
      />
    </div>
  );
}
