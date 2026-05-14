"use client";

import { DateFormatter } from "@/components/DateFormatter";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  Database,
  Loader2,
  MoreHorizontal,
  PencilLine,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useFindManyDataSet } from "~/lib/hooks";
import { Link } from "~/lib/navigation";
import { DatasetDeleteConfirmDialog } from "./dataset-delete-confirm-dialog";

interface DatasetsListProps {
  projectId: number;
}

interface DatasetRow {
  id: number;
  name: string;
  description: string | null;
  version: number;
  versions: Array<{
    rowCount: number;
    parametersJson: unknown;
    createdAt: Date | string;
    createdBy: { id: string; name: string | null; email: string } | null;
  }>;
  createdBy: { id: string; name: string | null; email: string } | null;
  _count: { sharedAssignments: number };
}

function getColumnsCount(parametersJson: unknown): number | null {
  if (!Array.isArray(parametersJson)) return null;
  return parametersJson.length;
}

export function DatasetsList({ projectId }: DatasetsListProps) {
  const t = useTranslations("projects.settings.datasets");

  const [pendingDelete, setPendingDelete] = useState<{
    id: number;
    name: string;
  } | null>(null);

  const {
    data: datasets,
    isLoading,
    error,
    refetch,
  } = useFindManyDataSet({
    where: { projectId, isShared: true, isDeleted: false },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      description: true,
      version: true,
      createdBy: { select: { id: true, name: true, email: true } },
      _count: { select: { sharedAssignments: true } },
      versions: {
        take: 1,
        orderBy: { version: "desc" },
        select: {
          rowCount: true,
          parametersJson: true,
          createdAt: true,
          createdBy: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });

  const columns: ColumnDef<DatasetRow>[] = [
    {
      id: "name",
      header: () => t("columns.name"),
      cell: ({ row }) => (
        <Link
          href={`/projects/settings/${projectId}/datasets/${row.original.id}`}
          className="font-medium text-primary hover:underline"
          data-testid={`dataset-list-name-${row.original.id}`}
        >
          {row.original.name}
        </Link>
      ),
    },
    {
      id: "columns",
      header: () => t("columns.columns"),
      cell: ({ row }) => {
        const latest = row.original.versions[0];
        const count = latest ? getColumnsCount(latest.parametersJson) : null;
        return (
          <span className="text-sm text-muted-foreground">
            {count === null ? "—" : count}
          </span>
        );
      },
    },
    {
      id: "rows",
      header: () => t("columns.rows"),
      cell: ({ row }) => {
        const latest = row.original.versions[0];
        return (
          <span className="text-sm text-muted-foreground">
            {latest ? latest.rowCount : "—"}
          </span>
        );
      },
    },
    {
      id: "version",
      header: () => t("columns.version"),
      cell: ({ row }) => (
        <span className="text-sm">
          {t("versionLabel", { version: row.original.version })}
        </span>
      ),
    },
    {
      id: "lastEdited",
      header: () => t("columns.lastEdited"),
      cell: ({ row }) => {
        const latest = row.original.versions[0];
        if (!latest)
          return <span className="text-muted-foreground">{"—"}</span>;
        return (
          <span className="text-sm text-muted-foreground">
            <DateFormatter date={new Date(latest.createdAt as string)} />
          </span>
        );
      },
    },
    {
      id: "owner",
      header: () => t("columns.owner"),
      cell: ({ row }) => {
        const latest = row.original.versions[0];
        const editor =
          latest?.createdBy ?? row.original.createdBy ?? null;
        return (
          <span className="text-sm text-muted-foreground">
            {editor?.name ?? editor?.email ?? "—"}
          </span>
        );
      },
    },
    {
      id: "assignments",
      header: () => t("columns.assignments"),
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {t("assignmentsCount", {
            count: row.original._count.sharedAssignments,
          })}
        </span>
      ),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">{t("columns.actions")}</span>,
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("actionsMenuLabel")}
              data-testid={`dataset-list-actions-${row.original.id}`}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link
                href={`/projects/settings/${projectId}/datasets/${row.original.id}`}
                data-testid={`dataset-list-open-${row.original.id}`}
              >
                <PencilLine className="h-4 w-4" />
                {t("actionOpen")}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                setPendingDelete({
                  id: row.original.id,
                  name: row.original.name,
                })
              }
              data-testid={`dataset-list-delete-${row.original.id}`}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
              {t("actionDelete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const table = useReactTable<DatasetRow>({
    data: (datasets ?? []) as unknown as DatasetRow[],
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => String(row.id),
  });

  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center py-12"
        data-testid="datasets-list-loading"
      >
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-3 py-12 text-center"
        data-testid="datasets-list-error"
      >
        <p className="text-sm text-destructive">{t("loadError")}</p>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          {t("retry")}
        </Button>
      </div>
    );
  }

  if (!datasets || datasets.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-3 py-12 text-center"
        data-testid="datasets-list-empty"
      >
        <Database className="h-10 w-10 text-muted-foreground/40" />
        <h3 className="text-base font-semibold">{t("emptyHeading")}</h3>
        <p className="text-sm text-muted-foreground max-w-md">
          {t("emptyBody")}
        </p>
      </div>
    );
  }

  return (
    <>
      <div data-testid="datasets-list">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((h) => (
                  <TableHead key={h.id}>
                    {flexRender(h.column.columnDef.header, h.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                data-testid={`dataset-list-row-${row.original.id}`}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {pendingDelete ? (
        <DatasetDeleteConfirmDialog
          projectId={projectId}
          dataSetId={pendingDelete.id}
          dataSetName={pendingDelete.name}
          open={pendingDelete !== null}
          onOpenChange={(open) => {
            if (!open) setPendingDelete(null);
          }}
        />
      ) : null}
    </>
  );
}
