"use client";

import { useDebounce } from "@/components/Debounce";
import { Loading } from "@/components/Loading";
import { Filter } from "@/components/tables/Filter";
import { VirtualizedDataTable } from "@/components/tables/VirtualizedDataTable";
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
import { Button, buttonVariants } from "@/components/ui/button";
import { CardContent } from "@/components/ui/card";
import { ColumnDef, VisibilityState } from "@tanstack/react-table";
import { AlertTriangle, UndoDot } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "~/utils";

// Item type is now generic, but we ensure 'id' for actions
interface SoftDeletedItem extends Record<string, any> {
  id: string | number;
}

interface SoftDeletedDataTableProps {
  itemType: string;
  translationKey: string; // Keep this prop to translate the item type name
  // Called after a successful restore/purge so callers can refresh derived
  // state (e.g. the sidebar counts). Optional and non-breaking.
  onMutate?: () => void;
}

// Rows fetched per scroll page. Infinite scroll pulls the next batch as the
// sentinel nears the viewport, so a large bin (e.g. TestRunStepResults) never
// loads more than one page up front.
const PAGE_SIZE = 50;

export default function SoftDeletedDataTable({
  itemType,
  translationKey,
  onMutate,
}: SoftDeletedDataTableProps) {
  const t = useTranslations("admin.trash.table");
  const tActions = useTranslations("common.actions");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");

  const [data, setData] = useState<SoftDeletedItem[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});

  // Sorting and search state
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

  // Bumped after a restore/purge to reset the virtualizer's scroll to the top
  // once the first page reloads (the acted-on row is gone).
  const [reloadNonce, setReloadNonce] = useState(0);

  // Refs so the infinite-scroll callbacks stay stable while still reading the
  // latest values: `requestIdRef` invalidates responses from a superseded
  // reset, `loadingMoreRef` guards against overlapping load-more fetches, and
  // the length/total refs feed the next page's skip without re-creating the
  // callback on every append.
  const requestIdRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const dataLengthRef = useRef(0);
  const totalItemsRef = useRef(0);
  useEffect(() => {
    dataLengthRef.current = data.length;
  }, [data]);
  useEffect(() => {
    totalItemsRef.current = totalItems;
  }, [totalItems]);

  const buildQuery = useCallback(
    (skip: number) => {
      const params = new URLSearchParams();
      params.append("skip", String(skip));
      params.append("take", String(PAGE_SIZE));
      params.append("sortBy", sortConfig.column);
      params.append("sortDir", sortConfig.direction);
      if (debouncedSearchString) {
        params.append("search", debouncedSearchString);
      }
      return params.toString();
    },
    [sortConfig.column, sortConfig.direction, debouncedSearchString]
  );

  // Load (or reload) the first page. Runs on mount and whenever the search or
  // sort changes; each call takes a new request id so a slower in-flight
  // response from a superseded query is dropped.
  const loadFirstPage = useCallback(async () => {
    const reqId = ++requestIdRef.current;
    loadingMoreRef.current = false;
    setIsInitialLoading(true);
    setError(null);
    setLoadMoreError(false);

    try {
      const response = await fetch(
        `/api/admin/trash/${itemType}?${buildQuery(0)}`
      );
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to fetch ${itemType}`);
      }
      const { items, totalCount } = await response.json();
      if (reqId !== requestIdRef.current) return;
      setData(items);
      setTotalItems(totalCount);
    } catch (e: any) {
      if (reqId !== requestIdRef.current) return;
      setError(e.message || "An unexpected error occurred.");
      setData([]);
      setTotalItems(0);
    } finally {
      if (reqId === requestIdRef.current) setIsInitialLoading(false);
    }
  }, [itemType, buildQuery]);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  // Append the next page. The shared virtualizer guard already prevents
  // double-firing; `loadingMoreRef` is a belt-and-braces guard against an
  // overlapping fetch, and the request-id check drops a page that landed after
  // a reset.
  const handleLoadMore = useCallback(async () => {
    if (loadingMoreRef.current) return;
    if (dataLengthRef.current >= totalItemsRef.current) return;
    const reqId = requestIdRef.current;
    loadingMoreRef.current = true;
    setIsLoadingMore(true);
    setLoadMoreError(false);

    try {
      const response = await fetch(
        `/api/admin/trash/${itemType}?${buildQuery(dataLengthRef.current)}`
      );
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to fetch ${itemType}`);
      }
      const { items } = await response.json();
      if (reqId !== requestIdRef.current) return;
      setData((prev) => [...prev, ...items]);
    } catch {
      if (reqId === requestIdRef.current) setLoadMoreError(true);
    } finally {
      loadingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  }, [itemType, buildQuery]);

  const handleRestore = (itemId: string | number) => {
    setAlertActionType("restore");
    setAlertItemId(itemId);
    setIsAlertOpen(true);
  };

  const handlePurge = (itemId: string | number) => {
    setAlertActionType("purge");
    setAlertItemId(itemId);
    setIsAlertOpen(true);
  };

  const executeConfirmedAction = async () => {
    if (!alertActionType || alertItemId === null) return;

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
      // Reload the first page so the removed row disappears and the total
      // updates, and reset the scroll to the top.
      setReloadNonce((n) => n + 1);
      void loadFirstPage();
      onMutate?.(); // Let callers refresh derived state (e.g. counts)
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
        id: "id",
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
        size: 240,
        minSize: 240,
        enableResizing: false,
        cell: () => <div className="flex space-x-2"></div>,
      },
    ];

    if (isInitialLoading && data.length === 0) {
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
      id: "id",
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
        size: 240,
        minSize: 240,
        enableResizing: false,
        cell: ({ row }: { row: { original: SoftDeletedItem } }) => {
          // Add type to row
          const item = row.original;
          return (
            <div className="flex justify-end space-x-2">
              <Button
                variant="outline"
                className="px-2 py-1 h-auto"
                onClick={() => handleRestore(item.id)}
              >
                <UndoDot className="h-5 w-5" />
                {tActions("restore")}
              </Button>
              <Button
                variant="destructive"
                className="px-2 py-1 h-auto"
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
  }, [data, tActions, isInitialLoading]);

  const itemTypeLabel = tGlobal(translationKey as any);
  const hasMore = data.length < totalItems;

  return (
    <CardContent className="flex h-full min-h-0 flex-col gap-4 p-0">
      {/* Filter row */}
      <div className="flex shrink-0 flex-col md:flex-row items-center justify-between gap-4">
        <div className="w-full md:w-1/3 min-w-[250px]">
          <Filter
            key={`${itemType}-filter`}
            placeholder={tCommon("filter.placeholder", {
              item: itemTypeLabel.toLowerCase(),
            })}
            initialSearchString={searchString}
            onSearchChange={setSearchString}
          />
        </div>
        {totalItems > 0 && (
          <p className="text-sm text-muted-foreground">
            {tGlobal("admin.auditLogs.showing", {
              loaded: data.length.toLocaleString(),
              total: totalItems.toLocaleString(),
            })}
          </p>
        )}
      </div>

      {error && data.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-center text-muted-foreground">
          {t("error", { itemType: itemTypeLabel, message: error })}
        </div>
      ) : isInitialLoading && data.length === 0 ? (
        <Loading />
      ) : data.length === 0 ? (
        // Empty bin: show a plain message, not an empty table with a bare
        // ID/Actions header.
        <div className="flex flex-1 items-center justify-center text-center text-muted-foreground">
          {debouncedSearchString
            ? t("noResults", {
                itemType: itemTypeLabel,
                query: debouncedSearchString,
              })
            : t("noItems", { itemType: itemTypeLabel })}
        </div>
      ) : (
        <div className="min-h-[400px] w-full flex-1">
          <VirtualizedDataTable
            columns={columns as ColumnDef<any, any>[]}
            data={data}
            columnVisibility={columnVisibility}
            onColumnVisibilityChange={setColumnVisibility}
            sortConfig={sortConfig}
            onSortChange={handleSortChange}
            enableColumnPinning
            hasMore={hasMore}
            isLoading={isInitialLoading || isLoadingMore}
            onLoadMore={handleLoadMore}
            loadMoreError={loadMoreError}
            onRetryLoadMore={handleLoadMore}
            resetKey={`${debouncedSearchString}|${reloadNonce}`}
            testIdPrefix={`trash-${itemType}-table`}
            rowTestIdPrefix={`trash-${itemType}-row`}
          />
        </div>
      )}

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
                  itemType: itemTypeLabel,
                })}
              {alertActionType === "purge" &&
                t("purgeConfirmationMessage", {
                  itemType: itemTypeLabel,
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
