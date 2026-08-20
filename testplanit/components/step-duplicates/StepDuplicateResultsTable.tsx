"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { DataTable } from "@/components/tables/DataTable";
import { Filter } from "@/components/tables/Filter";
import { PaginationComponent } from "@/components/tables/Pagination";
import { PaginationInfo } from "@/components/tables/PaginationControls";
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
import { usePageSizeOptions } from "~/hooks/usePageSizeOptions";
import { usePersistedFilter } from "~/hooks/usePersistedFilter";
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
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);
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

  const { data: allMatches, isLoading } = useClientQueries(
    schema
  ).stepSequenceMatch.useFindMany({
    where: {
      projectId: Number(projectId),
      status: "PENDING",
      isDeleted: false,
    },
    include: {
      members: {
        where: { case: { isDeleted: false } },
        include: {
          // Deliberately NO steps here: this query loads every pending match
          // with every member case, and dragging each case's full step text
          // along multiplies the payload into hundreds of MB on large
          // projects — enough to OOM the server process. The conversion
          // dialog fetches the matched steps for one case on open.
          case: {
            select: {
              id: true,
              name: true,
              source: true,
              automated: true,
            },
          },
        },
      },
    },
    orderBy: { stepCount: "desc" },
  });

  const handleSortChange = (column: string) => {
    setSortConfig((prev) => ({
      column,
      direction:
        prev.column === column && prev.direction === "asc" ? "desc" : "asc",
    }));
    setCurrentPage(1);
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
    setCurrentPage(1);
  };

  const handlePageSizeChange = (size: number | "All") => {
    setPageSize(typeof size === "number" ? size : 100);
    setCurrentPage(1);
  };

  // Row selection is keyed by index into the filtered list, so anything that
  // reshuffles that list has to drop the selection — otherwise a bulk dismiss
  // would land on whichever matches now sit at those indexes.
  const resetPageAndSelection = useCallback(() => {
    setCurrentPage(1);
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

  const mappedRows: StepDuplicateRow[] = useMemo(() => {
    const raw = allMatches ?? [];
    return raw.map((match) => {
      const members = (match as any).members ?? [];
      const caseNames: string[] = members
        .map((m: any) => m.case?.name ?? "")
        .filter(Boolean);

      return {
        id: match.id,
        name: caseNames.join(" / "),
        stepCount: match.stepCount,
        fingerprint: match.fingerprint,
        // Step text is not loaded in the list query (see the include above);
        // the matched steps themselves are shown by the conversion dialog.
        matchedStepsPreview: t("matchedStepsCount", { count: match.stepCount }),
        casesCount: members.length,
        caseNames,
        status: match.status,
      };
    });
  }, [allMatches, t]);

  // Each dropdown is faceted against the other: it offers the counts still
  // reachable once the other minimum (and the search) has been applied, so no
  // selection available in either one can empty the table. The pair is resolved
  // steps-first — matching their order on screen — to keep it acyclic.
  const {
    searchRows,
    stepThresholds,
    caseThresholds,
    effectiveMinCases,
    effectiveMinSteps,
  } = useMemo(() => {
    const lower = searchString.toLowerCase();
    const searchRows = searchString
      ? mappedRows.filter((item) =>
          item.caseNames.some((name) => name.toLowerCase().includes(lower))
        )
      : mappedRows;

    const stepsApplied = snapThreshold(
      uniqueSorted(searchRows.map((row) => row.stepCount)),
      minSteps
    );
    const rowsAfterSteps = searchRows.filter(
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
      searchRows,
      stepThresholds: withApplied(
        searchRows
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
  }, [mappedRows, searchString, minCases, minSteps]);

  const filtersActive =
    searchString.length > 0 ||
    effectiveMinCases > NO_MINIMUM ||
    effectiveMinSteps > NO_MINIMUM;

  const sortedItems: StepDuplicateRow[] = useMemo(() => {
    const filtered = searchRows.filter(
      (item) =>
        item.casesCount >= effectiveMinCases &&
        item.stepCount >= effectiveMinSteps
    );

    const { column, direction } = sortConfig;
    const dir = direction === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      let aVal: number;
      let bVal: number;
      switch (column) {
        case "stepCount":
          aVal = a.stepCount;
          bVal = b.stepCount;
          break;
        case "casesCount":
          aVal = a.casesCount;
          bVal = b.casesCount;
          break;
        default:
          return 0;
      }
      if (aVal < bVal) return -1 * dir;
      if (aVal > bVal) return 1 * dir;
      return 0;
    });
  }, [searchRows, sortConfig, effectiveMinCases, effectiveMinSteps]);

  const totalItems = sortedItems.length;
  const totalPages = Math.ceil(totalItems / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalItems);
  const pageItems = sortedItems.slice(startIndex, endIndex);
  const pageSizeOptions = usePageSizeOptions(totalItems);

  const handleCheckboxClick = useCallback(
    (rowIndex: number, event: React.MouseEvent) => {
      if (
        event.shiftKey &&
        lastSelectedIndex !== null &&
        lastSelectedIndex !== rowIndex
      ) {
        const start = Math.min(lastSelectedIndex, rowIndex);
        const end = Math.max(lastSelectedIndex, rowIndex);
        const rangeSelection: RowSelectionState = { ...rowSelection };
        for (let i = start; i <= end; i++) {
          rangeSelection[i.toString()] = true;
        }
        setRowSelection(rangeSelection);
      } else {
        const newSelection = { ...rowSelection };
        newSelection[rowIndex.toString()] = !newSelection[rowIndex.toString()];
        setRowSelection(newSelection);
        if (!rowSelection[rowIndex.toString()]) {
          setLastSelectedIndex(rowIndex);
        }
      }
    },
    [lastSelectedIndex, rowSelection]
  );

  const handleSelectAllClick = useCallback(
    (event: React.MouseEvent) => {
      if (event.shiftKey) {
        const allSelected = sortedItems.every(
          (_, i) => rowSelection[i.toString()]
        );
        if (allSelected) {
          setRowSelection({});
        } else {
          const allSelection: RowSelectionState = {};
          for (let i = 0; i < sortedItems.length; i++) {
            allSelection[i.toString()] = true;
          }
          setRowSelection(allSelection);
        }
      } else {
        const allPageSelected = pageItems.every(
          (_, i) => rowSelection[i.toString()]
        );
        if (allPageSelected) {
          const newSelection = { ...rowSelection };
          pageItems.forEach((_, i) => {
            delete newSelection[i.toString()];
          });
          setRowSelection(newSelection);
        } else {
          const newSelection = { ...rowSelection };
          pageItems.forEach((_, i) => {
            newSelection[i.toString()] = true;
          });
          setRowSelection(newSelection);
        }
      }
    },
    [sortedItems, pageItems, rowSelection]
  );

  const columns = useMemo(
    () => getColumns(t, tCommon, handleCheckboxClick, handleSelectAllClick),
    [t, tCommon, handleCheckboxClick, handleSelectAllClick]
  );

  const handleTableRowClick = useCallback(
    (id: number | string) => {
      const row = sortedItems.find((item) => item.id === id);
      if (row && onRowClick) {
        onRowClick(row);
      }
      // Open the conversion dialog for the clicked row
      const match = (allMatches ?? []).find((m) => m.id === Number(id));
      if (match) {
        setSelectedMatch(match as unknown as MatchWithMembers);
        setDialogOpen(true);
      }
    },
    [sortedItems, onRowClick, allMatches]
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
    return Object.keys(rowSelection)
      .filter((key) => rowSelection[key])
      .map((key) => sortedItems[parseInt(key)])
      .filter(Boolean);
  }, [rowSelection, sortedItems]);

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

  if (!isLoading && (allMatches ?? []).length === 0) {
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

        <div className="flex flex-col items-end">
          {totalItems > 0 && (
            <>
              <div className="justify-end">
                <PaginationInfo
                  startIndex={startIndex + 1}
                  endIndex={endIndex}
                  totalRows={totalItems}
                  searchString={searchString}
                  pageSize={pageSize}
                  pageSizeOptions={pageSizeOptions}
                  handlePageSizeChange={handlePageSizeChange}
                />
              </div>
              <div className="justify-end -mx-4">
                <PaginationComponent
                  currentPage={currentPage}
                  totalPages={totalPages}
                  onPageChange={setCurrentPage}
                />
              </div>
            </>
          )}
        </div>
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

      <div data-testid="step-duplicates-table" className="w-full">
        <DataTable
          columns={columns}
          data={pageItems}
          onSortChange={handleSortChange}
          onSortColumn={handleSortColumn}
          sortConfig={sortConfig}
          columnVisibility={columnVisibility}
          onColumnVisibilityChange={setColumnVisibility}
          isLoading={isLoading}
          emptyMessage={filtersActive ? t("noMatchesForFilters") : undefined}
          pageSize={pageSize}
          onTestCaseClick={handleTableRowClick}
          rowSelection={rowSelection}
          onRowSelectionChange={handleRowSelectionChange}
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
