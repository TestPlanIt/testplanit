"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useTranslations } from "next-intl";
import { DataTable } from "@/components/tables/DataTable";
import { Button } from "@/components/ui/button";
import { ColumnDef, VisibilityState } from "@tanstack/react-table";
import { useDebounce } from "@/components/Debounce";
import { Filter } from "@/components/tables/Filter";
import { PaginationComponent } from "@/components/tables/Pagination";
import { PaginationInfo } from "@/components/tables/PaginationControls";
import { CardContent } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "~/utils";
import { buttonVariants } from "@/components/ui/button";
import { AlertTriangle, RefreshCcw, UndoDot } from "lucide-react";

// Item type is now generic, but we ensure 'id' for actions
interface SoftDeletedItem extends Record<string, any> {
  id: string | number;
}

interface SoftDeletedDataTableProps {
  itemType: string;
  translationKey: string; // Keep this prop to translate the item type name
}

const DEFAULT_PAGE_SIZE = 10;

export default function SoftDeletedDataTable({
  itemType,
  translationKey,
}: SoftDeletedDataTableProps) {
  const t = useTranslations("admin.trash.table");
  const tActions = useTranslations("common.actions");
  const tItemTypes = useTranslations("admin.trash.itemTypes");
  const tCommon = useTranslations("common");

  const [data, setData] = useState<SoftDeletedItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});

  // Pagination, sorting, and search state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number | "All">(DEFAULT_PAGE_SIZE);
  const [totalItems, setTotalItems] = useState(0);
  const [sortConfig, setSortConfig] = useState<{
    column: string;
    direction: "asc" | "desc";
  }>({ column: "id", direction: "asc" }); // Default sort by id
  const [searchString, setSearchString] = useState("");
  const debouncedSearchString = useDebounce(searchString, 500);

  // State for confirmation dialog
  const [isAlertOpen, setIsAlertOpen] = useState(false);
  const [alertActionType, setAlertActionType] = useState<
    "restore" | "purge" | null
  >(null);
  const [alertItemId, setAlertItemId] = useState<string | number | null>(null);

  const effectivePageSize =
    typeof pageSize === "number"
      ? pageSize
      : totalItems > 0
        ? totalItems
        : DEFAULT_PAGE_SIZE;
  const skip =
    (currentPage - 1) * (typeof pageSize === "number" ? pageSize : 0); // if pageSize is "All", skip is 0 or not used if take is totalItems
  const totalPages = Math.ceil(
    totalItems / (typeof pageSize === "number" ? pageSize : totalItems || 1)
  );
  const startIndex = totalItems > 0 ? skip + 1 : 0;
  const endIndex = Math.min(skip + effectivePageSize, totalItems);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    const params = new URLSearchParams();
    params.append("skip", String(skip));
    params.append("take", String(effectivePageSize));
    params.append("sortBy", sortConfig.column);
    params.append("sortDir", sortConfig.direction);
    if (debouncedSearchString) {
      params.append("search", debouncedSearchString);
    }

    try {
      const response = await fetch(
        `/api/admin/trash/${itemType}?${params.toString()}`
      );
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Failed to fetch ${itemType}`);
      }
      const { items: resultData, totalCount } = await response.json();
      setData(resultData);
      setTotalItems(totalCount);
    } catch (e: any) {
      setError(e.message || "An unexpected error occurred.");
      setData([]);
      setTotalItems(0);
    } finally {
      setIsLoading(false);
    }
  }, [
    itemType,
    skip,
    effectivePageSize,
    sortConfig.column,
    sortConfig.direction,
    debouncedSearchString,
  ]);

  useEffect(() => {
    if (itemType) {
      fetchData();
    }
  }, [itemType, fetchData]);

  // Reset to first page when search, sort or page size changes
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearchString, sortConfig, pageSize]);

  const handleRestore = async (itemId: string | number) => {
    setAlertActionType("restore");
    setAlertItemId(itemId);
    setIsAlertOpen(true);
  };

  const handlePurge = async (itemId: string | number) => {
    setAlertActionType("purge");
    setAlertItemId(itemId);
    setIsAlertOpen(true);
  };

  const executeConfirmedAction = async () => {
    if (!alertActionType || alertItemId === null) return;

    const currentItemTypeDisplay = tItemTypes(translationKey as any);

    try {
      let response;
      if (alertActionType === "restore") {
        response = await fetch(`/api/admin/trash/${itemType}/${alertItemId}`, {
          method: "PATCH",
        });
      } else if (alertActionType === "purge") {
        response = await fetch(`/api/admin/trash/${itemType}/${alertItemId}`, {
          method: "DELETE",
        });
      }

      if (response && !response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ error: response.statusText }));
        throw new Error(
          errorData.error || `Failed to ${alertActionType} ${itemType}`
        );
      }
      fetchData(); // Refetch data on success
    } catch (e: any) {
      setError(
        e.message || `An unexpected error occurred during ${alertActionType}.`
      );
    } finally {
      setIsAlertOpen(false);
      setAlertActionType(null);
      setAlertItemId(null);
    }
  };

  const handleSortChange = (columnId: string) => {
    if (!columnId) return;
    const direction =
      sortConfig &&
      sortConfig.column === columnId &&
      sortConfig.direction === "asc"
        ? "desc"
        : "asc";
    setSortConfig({ column: columnId, direction });
  };

  const columns = useMemo<ColumnDef<SoftDeletedItem>[]>(() => {
    const defaultColumns: ColumnDef<SoftDeletedItem>[] = [
      {
        accessorKey: "id",
        header: "ID",
        cell: ({ getValue }: { getValue: () => any }) => String(getValue()),
        meta: { isPinned: "left" },
        enableSorting: true,
      },
      {
        id: "actions",
        header: tActions("actionsLabel"),
        meta: { isPinned: "right" },
        cell: () => <div className="flex space-x-2"></div>,
      },
    ];

    if (isLoading && data.length === 0) {
      return defaultColumns;
    }

    if (!data || data.length === 0) {
      return defaultColumns;
    }

    // data is present, generate dynamic columns
    const firstItem = data[0]; // data[0] is now guaranteed to exist here
    const generatedColumns: ColumnDef<SoftDeletedItem>[] = Object.keys(
      firstItem
    )
      .filter((key: string) => key !== "id") // Add type to key
      .map((key: string) => ({
        // Add type to key
        accessorKey: key,
        header: key.charAt(0).toUpperCase() + key.slice(1),
        cell: ({ getValue }: { getValue: () => any }) => {
          // Add type to getValue
          const value = getValue();
          if (value instanceof Date) return value.toLocaleDateString();
          if (typeof value === "object" && value !== null)
            return JSON.stringify(value);
          if (typeof value === "boolean") return value ? "True" : "False";
          return String(value);
        },
        enableSorting: true,
      }));

    const idColumn: ColumnDef<SoftDeletedItem> = {
      accessorKey: "id",
      header: "ID",
      cell: ({ getValue }: { getValue: () => any }) => String(getValue()),
      enableSorting: true,
      meta: { isPinned: "left" },
    };

    return [
      idColumn,
      ...generatedColumns,
      {
        id: "actions",
        header: tActions("actionsLabel"),
        meta: { isPinned: "right" },
        cell: ({ row }: { row: { original: SoftDeletedItem } }) => {
          // Add type to row
          const item = row.original;
          return (
            <div className="flex space-x-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleRestore(item.id)}
              >
                <UndoDot className="h-5 w-5" />
                {tActions("restore")}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => handlePurge(item.id)}
              >
                <AlertTriangle className="h-5 w-5" />
                {tActions("purge")}
              </Button>
            </div>
          );
        },
      },
    ];
  }, [data, tActions, isLoading]);

  const pageSizeOptions: Array<number | "All"> = useMemo(() => {
    if (totalItems <= DEFAULT_PAGE_SIZE && totalItems > 0) return ["All"];
    const options: Array<number | "All"> = [10, 25, 50, 100, 250].filter(
      (size) => size < totalItems || totalItems === 0
    );
    if (totalItems > 0) options.push("All");
    return options.length > 0 ? options : [DEFAULT_PAGE_SIZE, "All"];
  }, [totalItems]);

  let tableContent;
  if (isLoading && data.length === 0 && !error) {
    tableContent = (
      <p>{t("loading", { itemType: tItemTypes(translationKey as any) })}</p>
    );
  } else if (error) {
    tableContent = (
      <p>
        {t("error", {
          itemType: tItemTypes(translationKey as any),
          message: error,
        })}
      </p>
    );
  } else if (!isLoading && data.length === 0 && !debouncedSearchString) {
    tableContent = (
      <p className="mt-4 text-center">
        {t("noItems", { itemType: tItemTypes(translationKey as any) })}
      </p>
    );
  } else if (!isLoading && data.length === 0 && debouncedSearchString) {
    tableContent = (
      <p className="mt-4 text-center">
        {t("noResults", {
          itemType: tItemTypes(translationKey as any),
          query: debouncedSearchString,
        })}
      </p>
    );
  } else {
    tableContent = (
      <DataTable
        columns={columns as ColumnDef<any>[]}
        data={data as any[]}
        columnVisibility={columnVisibility}
        onColumnVisibilityChange={setColumnVisibility}
        onSortChange={handleSortChange}
        sortConfig={sortConfig}
        isLoading={isLoading}
      />
    );
  }

  return (
    <CardContent>
      {/* Row 1: Filter and Pagination Info */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="w-full md:w-1/3 min-w-[250px]">
          <Filter
            key={`${itemType}-filter`}
            placeholder={tCommon("filter.placeholder", {
              item: tItemTypes(translationKey as any).toLowerCase(),
            })}
            initialSearchString={searchString}
            onSearchChange={setSearchString}
          />
        </div>
        <div className="w-full md:w-auto">
          {" "}
          {/* md:w-auto allows PaginationInfo to take its natural width */}
          {totalItems > 0 && (
            <PaginationInfo
              key={`${itemType}-pagination-info`}
              startIndex={startIndex}
              endIndex={endIndex}
              totalRows={totalItems}
              searchString={debouncedSearchString}
              pageSize={pageSize}
              pageSizeOptions={pageSizeOptions}
              handlePageSizeChange={(size) => setPageSize(size)}
            />
          )}
        </div>
      </div>

      {/* Row 2: Pagination Component (actual page buttons) - right justified */}
      {/* This div will span the full width, and justify-end will push the PaginationComponent to the right */}
      {totalItems > 0 && totalPages > 1 && (
        <div className="flex flex-col items-end w-full mb-4">
          <div className="w-fit">
            <PaginationComponent
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={setCurrentPage}
            />
          </div>
        </div>
      )}

      {tableContent}

      {/* Bottom pagination has been removed based on user request */}

      <AlertDialog open={isAlertOpen} onOpenChange={setIsAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {alertActionType === "restore" && tActions("confirmRestoreTitle")}
              {alertActionType === "purge" && tActions("confirmPurgeTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {alertActionType === "restore" &&
                t("restoreConfirmationMessage", {
                  itemType: tItemTypes(translationKey as any),
                })}
              {alertActionType === "purge" &&
                t("purgeConfirmationMessage", {
                  itemType: tItemTypes(translationKey as any),
                })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setIsAlertOpen(false)}>
              {tCommon("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={executeConfirmedAction}
              className={cn(
                alertActionType === "purge" &&
                  buttonVariants({ variant: "destructive" })
              )}
            >
              {alertActionType === "restore" && tActions("restore")}
              {alertActionType === "purge" && tActions("purge")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CardContent>
  );
}
