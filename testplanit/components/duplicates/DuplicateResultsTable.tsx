"use client";

import { DataTable } from "@/components/tables/DataTable";
import { Filter } from "@/components/tables/Filter";
import { PaginationComponent } from "@/components/tables/Pagination";
import { PaginationInfo } from "@/components/tables/PaginationControls";
import { Button } from "@/components/ui/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RowSelectionState, Updater } from "@tanstack/react-table";
import { CopyX, Link2, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import React, { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { type DuplicateCandidateRow, getColumns } from "./duplicateColumns";
import { DuplicateComparisonDialog } from "./DuplicateComparisonDialog";

interface DuplicateCandidate {
  id: number;
  projectId: number;
  caseAId: number;
  caseA: { id: number; name: string; source: string; automated: boolean };
  caseBId: number;
  caseB: { id: number; name: string; source: string; automated: boolean };
  score: number;
  matchedFields: string[];
  status: string;
  scanJobId: number;
  createdAt: string;
}

interface DuplicateResultsTableProps {
  projectId: string;
}

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

export function DuplicateResultsTable({
  projectId,
}: DuplicateResultsTableProps) {
  const t = useTranslations("repository.duplicates");
  const tPriority = useTranslations("common.priority");
  const queryClient = useQueryClient();
  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >({});
  const [sortConfig, setSortConfig] = useState<{
    column: string;
    direction: "asc" | "desc";
  }>({ column: "score", direction: "desc" });
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);
  const [searchString, setSearchString] = useState("");
  const [selectedPair, setSelectedPair] =
    useState<DuplicateCandidateRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(
    null
  );
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);

  const handleResolved = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: ["duplicate-scan-candidates", projectId],
    });
    setRowSelection({});
  }, [queryClient, projectId]);

  const handleSortChange = (column: string) => {
    setSortConfig((prev) => ({
      column,
      direction:
        prev.column === column && prev.direction === "asc" ? "desc" : "asc",
    }));
    setCurrentPage(1);
  };

  const handlePageSizeChange = (size: number | "All") => {
    setPageSize(typeof size === "number" ? size : 100);
    setCurrentPage(1);
  };

  const handleFilterChange = useCallback((value: string) => {
    setSearchString(value);
    setCurrentPage(1);
  }, []);

  const handleRowSelectionChange = useCallback(
    (updater: Updater<RowSelectionState>) => {
      setRowSelection((prev) =>
        typeof updater === "function" ? updater(prev) : updater
      );
    },
    []
  );

  const { data: allItems, isLoading } = useQuery<DuplicateCandidate[]>({
    queryKey: ["duplicate-scan-candidates", projectId],
    queryFn: async () => {
      const res = await fetch(
        `/api/duplicate-scan/candidates?projectId=${projectId}&limit=10000`
      );
      if (!res.ok) return [];
      const data = await res.json();
      return data.items;
    },
  });

  const sortedItems: DuplicateCandidateRow[] = useMemo(() => {
    const raw = allItems ?? [];
    let mapped = raw.map((item) => ({
      id: item.id,
      name: `${item.caseA.name} / ${item.caseB.name}`,
      projectId: item.projectId,
      caseAId: item.caseAId,
      caseAName: item.caseA.name,
      caseASource: item.caseA.source,
      caseAAutomated: item.caseA.automated,
      caseBId: item.caseBId,
      caseBName: item.caseB.name,
      caseBSource: item.caseB.source,
      caseBAutomated: item.caseB.automated,
      score: item.score,
      matchedFields: item.matchedFields,
      status: item.status,
    }));

    if (searchString) {
      const lower = searchString.toLowerCase();
      mapped = mapped.filter(
        (item) =>
          item.caseAName.toLowerCase().includes(lower) ||
          item.caseBName.toLowerCase().includes(lower) ||
          item.matchedFields.some((f) => f.toLowerCase().includes(lower))
      );
    }

    if (sortConfig) {
      const { column, direction } = sortConfig;
      const dir = direction === "asc" ? 1 : -1;
      mapped.sort((a, b) => {
        let aVal: string | number;
        let bVal: string | number;
        switch (column) {
          case "confidence":
          case "score":
            aVal = a.score;
            bVal = b.score;
            break;
          case "caseA":
            aVal = a.caseAName.toLowerCase();
            bVal = b.caseAName.toLowerCase();
            break;
          case "caseB":
            aVal = a.caseBName.toLowerCase();
            bVal = b.caseBName.toLowerCase();
            break;
          case "matchedFields":
            aVal = a.matchedFields.join(", ").toLowerCase();
            bVal = b.matchedFields.join(", ").toLowerCase();
            break;
          default:
            return 0;
        }
        if (aVal < bVal) return -1 * dir;
        if (aVal > bVal) return 1 * dir;
        return 0;
      });
    }

    return mapped;
  }, [allItems, sortConfig, searchString]);

  const totalItems = sortedItems.length;
  const totalPages = Math.ceil(totalItems / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalItems);
  const pageItems = sortedItems.slice(startIndex, endIndex);

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
    () => getColumns(t, tPriority, handleCheckboxClick, handleSelectAllClick),
    [t, tPriority, handleCheckboxClick, handleSelectAllClick]
  );

  const handleRowClick = useCallback(
    (id: number | string) => {
      const row = sortedItems.find((item) => item.id === id);
      if (row) {
        setSelectedPair(row);
        setDialogOpen(true);
      }
    },
    [sortedItems]
  );

  const getSelectedItems = useCallback(() => {
    return Object.keys(rowSelection)
      .filter((key) => rowSelection[key])
      .map((key) => sortedItems[parseInt(key)])
      .filter(Boolean);
  }, [rowSelection, sortedItems]);

  const handleBulkAction = useCallback(
    async (action: "dismiss" | "link") => {
      const items = getSelectedItems();
      if (items.length === 0) return;
      setIsBulkProcessing(true);

      let successCount = 0;
      let failCount = 0;

      for (const item of items) {
        try {
          const body =
            action === "dismiss"
              ? {
                  action: "dismiss",
                  caseAId: item.caseAId,
                  caseBId: item.caseBId,
                  projectId: Number(projectId),
                }
              : {
                  action: "link",
                  caseAId: item.caseAId,
                  caseBId: item.caseBId,
                  projectId: Number(projectId),
                };

          const res = await fetch("/api/duplicate-scan/resolve", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

          if (res.ok) {
            successCount++;
          } else {
            failCount++;
          }
        } catch {
          failCount++;
        }
      }

      if (successCount > 0) {
        if (action === "dismiss") {
          toast.success(t("bulkDismissSuccess", { count: successCount }));
        } else {
          toast.success(t("bulkLinkSuccess", { count: successCount }));
        }
      }
      if (failCount > 0) {
        toast.error(t("bulkError"));
      }

      setRowSelection({});
      setIsBulkProcessing(false);
      handleResolved();
    },
    [getSelectedItems, projectId, t, handleResolved]
  );

  const selectedCount = Object.values(rowSelection).filter(Boolean).length;

  if (isLoading) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="text-sm">{t("loading")}</p>
      </div>
    );
  }

  if ((allItems ?? []).length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="text-lg font-medium">{t("noDuplicatesFound")}</p>
        <p className="text-sm">{t("noDuplicatesDescription")}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-row items-start">
        <div className="flex flex-col grow w-full sm:w-1/2 min-w-[250px]">
          <div className="text-muted-foreground w-full text-nowrap">
            <Filter
              placeholder={t("filterPlaceholder")}
              initialSearchString={searchString}
              onSearchChange={handleFilterChange}
            />
          </div>
        </div>

        <div className="flex flex-col w-full sm:w-2/3 items-end">
          {totalItems > 0 && (
            <>
              <div className="justify-end">
                <PaginationInfo
                  startIndex={startIndex + 1}
                  endIndex={endIndex}
                  totalRows={totalItems}
                  searchString={searchString}
                  pageSize={pageSize}
                  pageSizeOptions={[...PAGE_SIZE_OPTIONS]}
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
          <span className="text-sm text-muted-foreground mr-2">
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleBulkAction("link")}
            disabled={isBulkProcessing}
          >
            {isBulkProcessing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Link2 className="h-4 w-4" />
            )}
            {t("bulkLink", { count: selectedCount })}
          </Button>
        </div>
      )}

      {selectedCount === 0 && (
        <div className="flex items-center gap-2 mt-4 mb-2 p-2 bg-muted/50 rounded-lg border h-12 text-sm">
          {t("tableHint")}
        </div>
      )}

      <div data-testid="duplicates-table">
        <DataTable
          columns={columns}
          data={pageItems}
          onSortChange={handleSortChange}
          sortConfig={sortConfig}
          columnVisibility={columnVisibility}
          onColumnVisibilityChange={setColumnVisibility}
          isLoading={isLoading}
          pageSize={pageSize}
          onTestCaseClick={handleRowClick}
          rowSelection={rowSelection}
          onRowSelectionChange={handleRowSelectionChange}
        />
      </div>

      <DuplicateComparisonDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        pair={
          selectedPair
            ? {
                id: selectedPair.id,
                caseAId: selectedPair.caseAId,
                caseBId: selectedPair.caseBId,
                caseAName: selectedPair.caseAName,
                caseBName: selectedPair.caseBName,
                projectId: Number(projectId),
                score: selectedPair.score,
                matchedFields: selectedPair.matchedFields,
              }
            : null
        }
        onResolved={handleResolved}
      />
    </div>
  );
}
