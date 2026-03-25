"use client";

import { DataTable } from "@/components/tables/DataTable";
import { Filter } from "@/components/tables/Filter";
import { PaginationComponent } from "@/components/tables/Pagination";
import { PaginationInfo } from "@/components/tables/PaginationControls";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { RowSelectionState, Updater } from "@tanstack/react-table";
import { CopyX, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import React, { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  useFindManyStepSequenceMatch,
  useUpdateStepSequenceMatch,
} from "~/lib/hooks/step-sequence-match";
import { extractTextFromNode } from "~/utils/extractTextFromJson";
import { type StepDuplicateRow, getColumns } from "./stepDuplicateColumns";
import { StepDuplicateConversionDialog } from "./StepDuplicateConversionDialog";
import type { RepositoryCaseSource } from "@prisma/client";

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

interface StepDuplicateResultsTableProps {
  projectId: string;
  onRowClick?: (row: StepDuplicateRow) => void;
}

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

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
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(
    null
  );
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);

  const updateMatch = useUpdateStepSequenceMatch();

  const { data: allMatches, isLoading } = useFindManyStepSequenceMatch({
    where: {
      projectId: Number(projectId),
      status: "PENDING",
      isDeleted: false,
    },
    include: {
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
                orderBy: { order: "asc" },
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

  const sortedItems: StepDuplicateRow[] = useMemo(() => {
    const raw = allMatches ?? [];
    let mapped: StepDuplicateRow[] = raw.map((match) => {
      const members = (match as any).members ?? [];
      const caseNames: string[] = members
        .map((m: any) => m.case?.name ?? "")
        .filter(Boolean);

      // Build step preview from the first member's actual steps
      let matchedStepsPreview = "";
      const firstMember = members[0];
      if (firstMember?.case?.steps) {
        const steps = firstMember.case.steps as Array<{
          id: number;
          step: unknown;
          order: number;
        }>;
        const startId = firstMember.startStepId;
        const endId = firstMember.endStepId;
        const startIdx = steps.findIndex((s: any) => s.id === startId);
        const endIdx = steps.findIndex((s: any) => s.id === endId);
        if (startIdx >= 0 && endIdx >= 0) {
          const matchedSteps = steps.slice(startIdx, endIdx + 1);
          matchedStepsPreview = matchedSteps
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
          matchedStepsPreview || `${match.stepCount} matched steps`,
        casesCount: members.length,
        caseNames,
        status: match.status,
      };
    });

    if (searchString) {
      const lower = searchString.toLowerCase();
      mapped = mapped.filter((item) =>
        item.caseNames.some((name) => name.toLowerCase().includes(lower))
      );
    }

    if (sortConfig) {
      const { column, direction } = sortConfig;
      const dir = direction === "asc" ? 1 : -1;
      mapped.sort((a, b) => {
        let aVal: string | number;
        let bVal: string | number;
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
    }

    return mapped;
  }, [allMatches, sortConfig, searchString]);

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
    queryClient.invalidateQueries({
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
      queryClient.invalidateQueries({
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
        </div>
      )}

      {selectedCount === 0 && (
        <div className="flex items-center gap-2 mt-4 mb-2 p-2 bg-muted/50 rounded-lg border h-12 text-sm">
          {t("tableHint")}
        </div>
      )}

      <div data-testid="step-duplicates-table w-full">
        <DataTable
          columns={columns}
          data={pageItems}
          onSortChange={handleSortChange}
          sortConfig={sortConfig}
          columnVisibility={columnVisibility}
          onColumnVisibilityChange={setColumnVisibility}
          isLoading={isLoading}
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
