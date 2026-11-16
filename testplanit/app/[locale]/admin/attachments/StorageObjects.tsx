"use client";

import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { RowSelectionState } from "@tanstack/react-table";
import { filesize } from "filesize";
import { Loader2, ScanSearch, Trash2 } from "lucide-react";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { DateFormatter } from "@/components/DateFormatter";
import { useDebounce } from "@/components/Debounce";
import { DataTable } from "@/components/tables/DataTable";
import { Filter } from "@/components/tables/Filter";
import { ColumnDef } from "@/components/tables/tableFeatures";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RowSelectCheckbox } from "@/components/tables/RowSelectCheckbox";
import { Checkbox } from "@/components/ui/checkbox";
import { MultiAsyncCombobox } from "@/components/ui/multi-async-combobox";
import { apiFetch } from "~/lib/basePath";
import { MAX_ACTION_ATTACHMENTS } from "~/lib/services/adminAttachmentRules";
import type {
  AdminStorageObject,
  StorageScanState,
} from "~/lib/services/storageObjects";
import type { OrphanDeleteResult } from "~/lib/services/storageScan";
import {
  STORAGE_OBJECT_STATUSES,
  type StorageObjectStatus,
} from "~/lib/services/storageScanRules";

const PAGE_SIZE = 100;

type ObjectPage = { items: AdminStorageObject[]; totalCount: number };

async function getJson<T>(url: string): Promise<T> {
  const response = await apiFetch(url);
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return (await response.json()) as T;
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const response = await apiFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return (await response.json()) as T;
}

/** Says what deleting the chosen objects will do, then does it. */
function DeleteObjectsDialog({
  keys,
  onClose,
  onDone,
}: {
  keys: string[] | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("admin.attachments.storage");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();
  const [running, setRunning] = useState(false);

  const { data: preview, isError } = useQuery({
    queryKey: ["admin-storage-delete-preview", keys],
    queryFn: () =>
      postJson<OrphanDeleteResult>(
        "/api/admin/attachments/storage/objects/delete",
        { keys, dryRun: true }
      ),
    enabled: !!keys,
    gcTime: 0,
    staleTime: 0,
  });

  if (!keys) return null;

  const run = async () => {
    setRunning(true);
    try {
      const result = await postJson<OrphanDeleteResult>(
        "/api/admin/attachments/storage/objects/delete",
        { keys, dryRun: false }
      );
      toast.success(t("deleted", { count: result.deleted }));
      if (result.failed > 0) {
        toast.error(
          tCommon("errors.somethingWentWrong") + ` (${result.failed})`
        );
      }
      await queryClient.invalidateQueries({ queryKey: ["admin-storage"] });
      onDone();
    } catch {
      toast.error(tCommon("errors.somethingWentWrong"));
    } finally {
      setRunning(false);
    }
  };

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !running) onClose();
      }}
    >
      <AlertDialogContent data-testid="storage-delete-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{tCommon("actions.delete")}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              {isError ? (
                <p className="text-destructive">
                  {tCommon("errors.somethingWentWrong")}
                </p>
              ) : !preview ? (
                <p>{tCommon("loading")}</p>
              ) : (
                <>
                  <p data-testid="storage-delete-summary">
                    {t("confirmDelete", {
                      count: preview.deleted,
                      size: filesize(preview.bytes),
                    })}
                  </p>
                  {preview.skipped > 0 && (
                    <p data-testid="storage-delete-skipped">
                      {t("skipped", { count: preview.skipped })}
                    </p>
                  )}
                </>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={running}>
            {tCommon("cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={running || !preview || preview.deleted === 0}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            data-testid="storage-delete-confirm"
            onClick={(event) => {
              event.preventDefault();
              void run();
            }}
          >
            {running && <Loader2 className="h-4 w-4 animate-spin" />}
            {running ? tCommon("actions.deleting") : tCommon("actions.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * What is in the storage bucket as of the last scan: every object under
 * `uploads/`, whether anything uses it, and deletion of the orphans.
 */
export function StorageObjects({
  onShowMissingFiles,
}: {
  onShowMissingFiles: () => void;
}) {
  const t = useTranslations("admin.attachments.storage");
  const tSelection = useTranslations("admin.attachments.selection");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const { data: session } = useSession();
  const queryClient = useQueryClient();

  const [searchString, setSearchString] = useState("");
  const debouncedSearch = useDebounce(searchString, 400);
  const [statuses, setStatuses] = useState<StorageObjectStatus[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [sortConfig, setSortConfig] = useState<{
    column: string;
    direction: "asc" | "desc";
  }>({ column: "size", direction: "desc" });

  const { data: state } = useQuery({
    queryKey: ["admin-storage", "scan"],
    queryFn: () =>
      getJson<StorageScanState>("/api/admin/attachments/storage/scan"),
    refetchInterval: (query) =>
      query.state.data?.scan?.status === "RUNNING" ? 3000 : false,
  });
  const scan = state?.scan ?? null;
  const scanning = scan?.status === "RUNNING";
  // The list shows the scan's findings, so reread it when a scan ends.
  const scanStatus = scan?.status;
  useEffect(() => {
    if (scanStatus && scanStatus !== "RUNNING") {
      void queryClient.invalidateQueries({
        queryKey: ["admin-storage", "objects"],
      });
    }
  }, [scanStatus, queryClient]);

  const [starting, setStarting] = useState(false);
  const startScan = async () => {
    setStarting(true);
    try {
      const response = await apiFetch("/api/admin/attachments/storage/scan", {
        method: "POST",
      });
      // A scan someone else started is not an error: show it running.
      if (!response.ok && response.status !== 409) {
        throw new Error(`Request failed (${response.status})`);
      }
      await queryClient.invalidateQueries({
        queryKey: ["admin-storage", "scan"],
      });
    } catch {
      toast.error(tCommon("errors.somethingWentWrong"));
    } finally {
      setStarting(false);
    }
  };

  const params = useMemo(() => {
    const search = new URLSearchParams({
      sortBy: sortConfig.column,
      sortDir: sortConfig.direction,
      take: String(PAGE_SIZE),
    });
    if (statuses.length > 0) search.set("statuses", statuses.join(","));
    if (folders.length > 0) search.set("folders", folders.join(","));
    if (debouncedSearch.trim()) search.set("q", debouncedSearch.trim());
    return search.toString();
  }, [statuses, folders, debouncedSearch, sortConfig]);

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: ["admin-storage", "objects", params],
      queryFn: ({ pageParam }) =>
        getJson<ObjectPage>(
          `/api/admin/attachments/storage/objects?${params}&skip=${pageParam}`
        ),
      initialPageParam: 0,
      getNextPageParam: (lastPage, allPages) => {
        const loaded = allPages.reduce(
          (sum, page) => sum + page.items.length,
          0
        );
        return lastPage.items.length < PAGE_SIZE ||
          loaded >= lastPage.totalCount
          ? undefined
          : loaded;
      },
    });
  const items = useMemo(
    () => data?.pages.flatMap((page) => page.items) ?? [],
    [data]
  );
  const totalItems = data?.pages[0]?.totalCount ?? 0;

  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  // A selection belongs to the list it was made in.
  useEffect(() => setRowSelection({}), [params]);
  const selectedKeys = useMemo(
    () =>
      Object.entries(rowSelection)
        .filter(([, picked]) => picked)
        .map(([key]) => key),
    [rowSelection]
  );
  const [deleting, setDeleting] = useState<string[] | null>(null);

  // Selecting every match means keys the list has not paged in yet, so they
  // are fetched on demand, and only when asked for.
  const [selectingAll, setSelectingAll] = useState(false);
  const selectAllMatches = async () => {
    setSelectingAll(true);
    try {
      const { keys } = await getJson<{ keys: string[] }>(
        `/api/admin/attachments/storage/objects/keys?${params}`
      );
      setRowSelection(Object.fromEntries(keys.map((key) => [key, true])));
    } catch {
      toast.error(tCommon("errors.somethingWentWrong"));
    } finally {
      setSelectingAll(false);
    }
  };
  const allLoadedSelected =
    items.length > 0 && items.every((item) => rowSelection[item.key]);
  const allMatchesSelected =
    allLoadedSelected && totalItems > 0 && selectedKeys.length >= totalItems;

  const statusLabel = useCallback(
    (status: StorageObjectStatus) => t(`status.${status}`),
    [t]
  );
  const fetchStatuses = useCallback(
    async (query: string, page: number, size: number) => {
      const term = query.trim().toLowerCase();
      const matching = STORAGE_OBJECT_STATUSES.filter((status) =>
        statusLabel(status).toLowerCase().includes(term)
      );
      return {
        results: matching.slice(page * size, page * size + size),
        total: matching.length,
      };
    },
    [statusLabel]
  );
  const folderNames = useMemo(
    () => (state?.folders ?? []).map((folder) => folder.folder),
    [state]
  );
  const fetchFolders = useCallback(
    async (query: string, page: number, size: number) => {
      const term = query.trim().toLowerCase();
      const matching = folderNames.filter((folder) =>
        folder.toLowerCase().includes(term)
      );
      return {
        results: matching.slice(page * size, page * size + size),
        total: matching.length,
      };
    },
    [folderNames]
  );

  const dateFormat = session?.user?.preferences?.dateFormat;
  const timezone = session?.user?.preferences?.timezone;
  const columns = useMemo<ColumnDef<AdminStorageObject>[]>(
    () => [
      {
        id: "select",
        header: ({ table }) => (
          <Checkbox
            checked={
              table.getIsAllRowsSelected() ||
              (table.getIsSomeRowsSelected() && "indeterminate")
            }
            onCheckedChange={(value) => table.toggleAllRowsSelected(!!value)}
            aria-label={tCommon("actions.selectAll")}
            data-testid="storage-select-all"
          />
        ),
        cell: ({ row, table }) => (
          <RowSelectCheckbox
            row={row}
            table={table}
            aria-label={tCommon("actions.select")}
            data-testid={`storage-select-${row.index}`}
          />
        ),
        enableSorting: false,
        enableResizing: false,
        enableHiding: false,
        meta: { isPinned: "left" },
        size: 40,
      },
      {
        id: "key",
        accessorKey: "key",
        header: tCommon("fields.key"),
        enableSorting: true,
        enableResizing: true,
        enableHiding: false,
        size: 520,
        cell: ({ row }) => (
          <span className="truncate font-mono text-xs" title={row.original.key}>
            {row.original.key.slice(row.original.folder.length + 1)}
          </span>
        ),
      },
      {
        id: "size",
        accessorKey: "size",
        header: tCommon("fields.size"),
        enableSorting: true,
        enableResizing: true,
        size: 130,
        cell: ({ row }) => filesize(row.original.size),
      },
      {
        id: "status",
        header: tCommon("actions.status"),
        enableSorting: false,
        enableResizing: true,
        size: 190,
        cell: ({ row }) => (
          <Badge
            variant={
              row.original.status === "REFERENCED" ? "secondary" : "outline"
            }
            data-testid={`storage-status-${row.index}`}
          >
            {statusLabel(row.original.status)}
          </Badge>
        ),
      },
      {
        id: "folder",
        header: tCommon("fields.folder"),
        enableSorting: false,
        enableResizing: true,
        size: 240,
        cell: ({ row }) => (
          <span className="truncate text-muted-foreground">
            {row.original.folder}
          </span>
        ),
      },
      {
        id: "lastModified",
        accessorKey: "lastModified",
        header: tCommon("updated"),
        enableSorting: true,
        enableResizing: true,
        size: 150,
        cell: ({ row }) => (
          <DateFormatter
            date={row.original.lastModified}
            formatString={dateFormat || "MM_DD_YYYY_DASH"}
            timezone={timezone || "Etc/UTC"}
          />
        ),
      },
    ],
    [tCommon, statusLabel, dateFormat, timezone]
  );
  const columnVisibility = useMemo(
    () => Object.fromEntries(columns.map((column) => [column.id, true])),
    [columns]
  );

  const totals = useMemo(() => {
    const all = { objects: 0, bytes: 0, orphans: 0, orphanBytes: 0 };
    for (const folder of state?.folders ?? []) {
      all.objects += folder.objects;
      all.bytes += folder.bytes;
      all.orphans += folder.orphans;
      all.orphanBytes += folder.orphanBytes;
    }
    return all;
  }, [state]);
  const hasFindings = (state?.folders.length ?? 0) > 0;

  return (
    <div className="space-y-4" data-testid="storage-view">
      <div className="flex items-start justify-between gap-3 rounded-md border p-3">
        <div className="min-w-0 space-y-1 text-sm">
          <p className="font-medium" data-testid="storage-scan-status">
            {scanning ? (
              tGlobal("sharedSteps.stepDuplicates.scanning")
            ) : scan?.status === "FAILED" ? (
              tGlobal("projects.settings.impact.repositories.scanFailed")
            ) : scan?.finishedAt ? (
              <>
                {tGlobal("projects.settings.impact.scanLastScan", {
                  date: new Date(scan.finishedAt).toLocaleString(locale),
                })}
              </>
            ) : (
              t("neverScanned")
            )}
          </p>
          {scan?.status === "FAILED" && scan.error && (
            <p className="break-all text-destructive">{scan.error}</p>
          )}
          {hasFindings && (
            <p
              className="text-muted-foreground"
              data-testid="storage-scan-summary"
            >
              {t("summary", {
                objects: totals.objects,
                size: filesize(totals.bytes),
                orphans: totals.orphans,
                orphanSize: filesize(totals.orphanBytes),
              })}
            </p>
          )}
          {!!scan?.missingCount && !scanning && (
            <p className="flex flex-wrap items-center gap-2">
              <span>{t("missingFiles", { count: scan.missingCount })}</span>
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0"
                data-testid="storage-show-missing"
                onClick={onShowMissingFiles}
              >
                {tGlobal("reports.ui.codePinCoverage.coverageFilter")}
              </Button>
            </p>
          )}
        </div>
        <Button
          type="button"
          onClick={() => void startScan()}
          disabled={scanning || starting}
          className="shrink-0"
          data-testid="storage-scan-start"
        >
          {scanning || starting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ScanSearch className="h-4 w-4" />
          )}
          {scanning
            ? tGlobal("sharedSteps.stepDuplicates.scanning")
            : tGlobal("sharedSteps.stepDuplicates.rescan")}
        </Button>
      </div>

      <Filter
        key="admin-storage-filter"
        placeholder={tCommon("fields.key")}
        initialSearchString={searchString}
        onSearchChange={setSearchString}
      />
      <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <div className="min-w-0" data-testid="storage-status-filter">
          <MultiAsyncCombobox<StorageObjectStatus>
            value={statuses}
            onValueChange={setStatuses}
            fetchOptions={fetchStatuses}
            getOptionValue={(status) => status}
            getOptionLabel={statusLabel}
            renderOption={(status) => (
              <span className="truncate">{statusLabel(status)}</span>
            )}
            placeholder={tCommon("filters.allStatuses")}
            ariaLabel={tCommon("actions.status")}
          />
        </div>
        <div className="min-w-0" data-testid="storage-folder-filter">
          <MultiAsyncCombobox<string>
            value={folders}
            onValueChange={setFolders}
            fetchOptions={fetchFolders}
            getOptionValue={(folder) => folder}
            getOptionLabel={(folder) => folder}
            renderOption={(folder) => (
              <span className="truncate">{folder}</span>
            )}
            placeholder={t("allFolders")}
            ariaLabel={tCommon("fields.folder")}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          className="flex min-h-8 flex-wrap items-center gap-2"
          data-testid="storage-bulk-actions"
        >
          {selectedKeys.length > 0 && (
            <>
              <span className="text-sm text-muted-foreground">
                {tCommon("labels.selected", {
                  count: selectedKeys.length.toLocaleString(locale),
                })}
              </span>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                data-testid="storage-bulk-delete"
                onClick={() => setDeleting(selectedKeys)}
              >
                <Trash2 className="h-4 w-4" />
                {tCommon("actions.delete")}
              </Button>
            </>
          )}
        </div>
        {items.length > 0 && (
          <p
            className="text-sm text-muted-foreground"
            data-testid="storage-showing"
          >
            {tGlobal("admin.auditLogs.showing", {
              loaded: items.length.toLocaleString(locale),
              total: totalItems.toLocaleString(locale),
            })}
          </p>
        )}
      </div>

      {allLoadedSelected &&
        totalItems > items.length &&
        !allMatchesSelected && (
          <div
            className="flex flex-wrap items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm"
            data-testid="storage-select-all-matches-prompt"
          >
            <span>{t("loadedSelected", { shown: items.length })}</span>
            {totalItems <= MAX_ACTION_ATTACHMENTS ? (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0"
                onClick={() => void selectAllMatches()}
                disabled={selectingAll}
                data-testid="storage-select-all-matches"
              >
                {tSelection("selectAllMatches", { total: totalItems })}
              </Button>
            ) : (
              <span className="text-muted-foreground">
                {tSelection("tooMany", {
                  max: MAX_ACTION_ATTACHMENTS.toLocaleString(locale),
                })}
              </span>
            )}
          </div>
        )}
      {allMatchesSelected && totalItems > items.length && (
        <p
          className="rounded-md bg-muted px-3 py-2 text-sm"
          data-testid="storage-all-matches-selected"
        >
          {tSelection("allMatchesSelected", { total: totalItems })}
        </p>
      )}

      <DataTable
        virtualized
        fillViewport
        columns={columns as any}
        data={items}
        getRowId={(row: AdminStorageObject) => row.key}
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        testIdPrefix="admin-storage-table"
        rowTestIdPrefix="storage-row"
        hasMore={!!hasNextPage}
        onLoadMore={fetchNextPage}
        resetKey={params}
        onSortChange={(column) =>
          setSortConfig({
            column,
            direction:
              sortConfig.column === column && sortConfig.direction === "asc"
                ? "desc"
                : "asc",
          })
        }
        onSortColumn={(column, direction) =>
          setSortConfig(
            direction === null
              ? { column: "size", direction: "desc" }
              : { column, direction }
          )
        }
        sortConfig={sortConfig}
        columnVisibility={columnVisibility}
        onColumnVisibilityChange={() => {}}
        isLoading={isLoading || isFetchingNextPage}
      />

      <DeleteObjectsDialog
        keys={deleting}
        onClose={() => setDeleting(null)}
        onDone={() => {
          setDeleting(null);
          setRowSelection({});
        }}
      />
    </div>
  );
}
