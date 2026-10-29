"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { Filter } from "@/components/tables/Filter";
import { DataTable } from "@/components/tables/DataTable";
import type {
  ColumnDef,
  RowSelectionState,
} from "@/components/tables/tableFeatures";
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
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  softDeletedItemTypes,
  type TrashIconName,
} from "@/[locale]/admin/trash/itemTypes";
import DynamicIcon from "~/components/DynamicIcon";
import { RelativeTimeTooltip } from "~/components/RelativeTimeTooltip";
import {
  userTrashItemTypes,
  type UserTrashItem,
} from "~/lib/userTrash/itemTypes";

interface TrashResponse {
  windowDays: number;
  items: UserTrashItem[];
}

interface TrashRow extends UserTrashItem {
  /** DataTable row key: item types have overlapping numeric ids. */
  rowId: string;
}

const ALL = "__all__";

const typeDisplay = new Map(
  softDeletedItemTypes.map((entry) => [entry.name, entry])
);

export function userTrashQueryKey(userId: string) {
  return ["user-trash", userId] as const;
}

async function fetchTrash(userId: string): Promise<TrashResponse> {
  const response = await fetch(
    `/api/trash?userId=${encodeURIComponent(userId)}`
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function daysLeft(restorableUntil: string, now = Date.now()): number {
  const ms = new Date(restorableUntil).getTime() - now;
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

/**
 * The Trash section of a user's profile: everything they deleted that is still
 * inside the self-service restore window, with per-row and bulk Restore. Only
 * names are shown — never ids; the server resolves every label.
 */
export function UserTrash({ userId }: { userId: string }) {
  const t = useTranslations("users.profile.trash");
  const tGlobal = useTranslations();
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: userTrashQueryKey(userId),
    queryFn: () => fetchTrash(userId),
  });

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState(ALL);
  const [projectFilter, setProjectFilter] = useState(ALL);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >({});
  const [pending, setPending] = useState<TrashRow[] | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);

  const rows = useMemo<TrashRow[]>(
    () =>
      (data?.items ?? []).map((item) => ({
        ...item,
        rowId: `${item.itemType}:${item.id}`,
      })),
    [data]
  );

  const typeOptions = useMemo(
    () =>
      userTrashItemTypes
        .map((entry) => entry.itemType)
        .filter((name) => rows.some((row) => row.itemType === name))
        .map((name) => ({
          name,
          label: tGlobal(typeDisplay.get(name)!.translationKey as any),
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [rows, tGlobal]
  );

  const projectOptions = useMemo(() => {
    const seen = new Map<number, string>();
    for (const row of rows) seen.set(row.projectId, row.projectName);
    return [...seen.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter(
      (row) =>
        (typeFilter === ALL || row.itemType === typeFilter) &&
        (projectFilter === ALL || String(row.projectId) === projectFilter) &&
        (!query ||
          row.name.toLowerCase().includes(query) ||
          (row.context ?? "").toLowerCase().includes(query))
    );
  }, [rows, search, typeFilter, projectFilter]);

  const selectedRows = useMemo(
    () => filteredRows.filter((row) => rowSelection[row.rowId]),
    [filteredRows, rowSelection]
  );

  const failureMessage = useCallback(
    (code: string | undefined) => {
      const known = [
        "parent_deleted",
        "name_conflict",
        "expired",
        "forbidden",
        "disabled",
        "not_owner",
        "not_found",
      ];
      return known.includes(code ?? "")
        ? t(`failure.${code}` as any)
        : tGlobal("common.errors.unknown");
    },
    [t, tGlobal]
  );

  const restoreOne = useCallback(
    async (row: TrashRow): Promise<string | null> => {
      const response = await fetch(
        `/api/trash/${encodeURIComponent(row.itemType)}/${encodeURIComponent(row.id)}`,
        { method: "PATCH" }
      );
      if (response.ok) return null;
      let code: string | undefined;
      try {
        code = (await response.json()).code;
      } catch {
        // Non-JSON error body: fall through to the generic message.
      }
      return failureMessage(code);
    },
    [failureMessage]
  );

  const runRestore = useCallback(async () => {
    if (!pending?.length) return;
    setIsRestoring(true);
    try {
      if (pending.length === 1) {
        const row = pending[0];
        const failure = await restoreOne(row);
        if (failure) {
          toast.error(t("restoreFailed", { name: row.name, message: failure }));
        } else {
          toast.success(t("restored", { name: row.name }));
        }
      } else {
        let restored = 0;
        let failed = 0;
        for (const row of pending) {
          const failure = await restoreOne(row);
          if (failure) {
            failed += 1;
            toast.error(
              t("restoreFailed", { name: row.name, message: failure })
            );
          } else {
            restored += 1;
          }
        }
        toast[failed ? "warning" : "success"](
          t("bulkResult", { restored, failed })
        );
      }
    } finally {
      setIsRestoring(false);
      setPending(null);
      setRowSelection({});
      await queryClient.invalidateQueries({
        queryKey: userTrashQueryKey(userId),
      });
    }
  }, [pending, restoreOne, t, queryClient, userId]);

  const columns = useMemo<ColumnDef<TrashRow>[]>(
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
            aria-label={tGlobal("common.aria.selectAll")}
            data-testid="user-trash-select-all"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            onClick={(e) => e.stopPropagation()}
            aria-label={tGlobal("common.bulk.selectItem")}
            data-testid={`user-trash-select-${row.original.rowId}`}
          />
        ),
        enableSorting: false,
        enableResizing: false,
        enableHiding: false,
        size: 40,
      },
      {
        id: "itemType",
        accessorKey: "itemType",
        header: tGlobal("common.fields.type"),
        cell: ({ row }) => {
          const display = typeDisplay.get(row.original.itemType);
          return (
            <span className="flex items-center gap-2">
              {display && (
                <DynamicIcon
                  name={display.iconName as TrashIconName}
                  className="h-4 w-4 shrink-0"
                />
              )}
              <span>
                {display
                  ? tGlobal(display.translationKey as any)
                  : row.original.itemType}
              </span>
            </span>
          );
        },
      },
      {
        id: "name",
        accessorKey: "name",
        header: tGlobal("common.name"),
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="truncate font-medium">{row.original.name}</div>
            {row.original.context && (
              <div className="truncate text-xs text-muted-foreground">
                {row.original.context}
              </div>
            )}
          </div>
        ),
      },
      {
        id: "project",
        accessorKey: "projectName",
        header: tGlobal("common.fields.project"),
      },
      {
        id: "deletedAt",
        accessorKey: "deletedAt",
        header: tGlobal("common.status.deleted"),
        cell: ({ row }) => (
          <RelativeTimeTooltip date={row.original.deletedAt} />
        ),
      },
      {
        id: "timeLeft",
        accessorKey: "restorableUntil",
        header: t("timeLeftColumn"),
        cell: ({ row }) =>
          t("timeLeft", { days: daysLeft(row.original.restorableUntil) }),
      },
      {
        id: "actions",
        header: tGlobal("common.actions.actionsLabel"),
        cell: ({ row }) => (
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              setPending([row.original]);
            }}
            data-testid={`user-trash-restore-${row.original.rowId}`}
          >
            {tGlobal("common.actions.restore")}
          </Button>
        ),
        enableSorting: false,
        enableHiding: false,
      },
    ],
    [t, tGlobal]
  );

  if (isLoading) {
    return (
      <p className="text-sm text-muted-foreground">
        {tGlobal("common.loading")}
      </p>
    );
  }
  if (isError || !data) {
    return (
      <p className="text-sm text-destructive">
        {tGlobal("common.errors.fetchFailed")}
      </p>
    );
  }
  if (data.windowDays <= 0) {
    return (
      <p
        className="text-sm text-muted-foreground"
        data-testid="user-trash-disabled"
      >
        {t("disabled")}
      </p>
    );
  }
  if (rows.length === 0) {
    return (
      <p
        className="text-sm text-muted-foreground"
        data-testid="user-trash-empty"
      >
        {t("empty", { days: data.windowDays })}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="user-trash">
      <p className="text-sm text-muted-foreground">{t("description")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Filter
          placeholder={tGlobal("common.placeholders.filterByName")}
          initialSearchString={search}
          onSearchChange={setSearch}
          dataTestId="user-trash-search"
        />
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-44" data-testid="user-trash-type-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>
              {tGlobal("users.profile.auditLog.allTypes")}
            </SelectItem>
            {typeOptions.map((option) => (
              <SelectItem key={option.name} value={option.name}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={projectFilter} onValueChange={setProjectFilter}>
          <SelectTrigger
            className="w-44"
            data-testid="user-trash-project-filter"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>
              {tGlobal("reviews.inbox.filterAllProjects")}
            </SelectItem>
            {projectOptions.map((option) => (
              <SelectItem key={option.id} value={String(option.id)}>
                {option.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedRows.length > 0 && (
          <Button
            size="sm"
            className="ml-auto"
            onClick={() => setPending(selectedRows)}
            data-testid="user-trash-restore-selected"
          >
            {tGlobal("common.bulk.restoreAction", {
              count: selectedRows.length,
            })}
          </Button>
        )}
      </div>

      {filteredRows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {tGlobal("common.ui.search.noResultsFound")}
        </p>
      ) : (
        <DataTable
          columns={columns}
          data={filteredRows}
          columnVisibility={columnVisibility}
          onColumnVisibilityChange={setColumnVisibility}
          rowSelection={rowSelection}
          onRowSelectionChange={setRowSelection}
          getRowId={(row: TrashRow) => row.rowId}
          testIdPrefix="user-trash-table"
          rowTestIdPrefix="user-trash-row"
        />
      )}

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && !isRestoring) setPending(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {tGlobal("common.actions.confirmRestoreTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.length === 1
                ? t("confirmDescription", {
                    name: pending[0].name,
                    project: pending[0].projectName,
                  })
                : t("bulkConfirmDescription", { count: pending?.length ?? 0 })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRestoring}>
              {tGlobal("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void runRestore();
              }}
              disabled={isRestoring}
              data-testid="user-trash-confirm-restore"
            >
              {tGlobal("common.actions.restore")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
