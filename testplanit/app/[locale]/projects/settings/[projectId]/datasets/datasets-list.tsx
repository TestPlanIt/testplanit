"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { DateTimeDisplay } from "@/components/search/DateTimeDisplay";
import { CasesListDisplay } from "@/components/tables/CaseListDisplay";
import { UserNameCell } from "@/components/tables/UserNameCell";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/tables/DataTable";
import { type ColumnDef } from "@tanstack/react-table";
import {
  Database,
  DatabaseArrowUp,
  Loader2,
  SquarePen,
  Trash,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
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
    createdBy: { id: string } | null;
  }>;
  createdBy: { id: string } | null;
  _count: { sharedAssignments: number };
}

function getColumnsCount(parametersJson: unknown): number | null {
  if (!Array.isArray(parametersJson)) return null;
  return parametersJson.length;
}

export function DatasetsList({ projectId }: DatasetsListProps) {
  const t = useTranslations("projects.settings.datasets");
  const { data: session } = useSession();
  const dateTimeFormat = session?.user?.preferences?.dateFormat
    ? `${session.user.preferences.dateFormat} ${session.user.preferences.timeFormat || "HH:mm"}`
    : undefined;
  const timezone = session?.user?.preferences?.timezone || "Etc/UTC";

  const [pendingDelete, setPendingDelete] = useState<{
    id: number;
    name: string;
  } | null>(null);

  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >({});

  const {
    data: datasets,
    isLoading,
    error,
    refetch,
  } = useClientQueries(schema).dataSet.useFindMany({
    where: { projectId, isShared: true, isDeleted: false },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      description: true,
      version: true,
      createdBy: { select: { id: true } },
      _count: { select: { sharedAssignments: true } },
      versions: {
        take: 1,
        orderBy: { version: "desc" },
        select: {
          rowCount: true,
          parametersJson: true,
          createdAt: true,
          createdBy: { select: { id: true } },
        },
      },
    },
  });

  const columns: ColumnDef<DatasetRow>[] = [
    {
      id: "name",
      header: () => t("columns.name"),
      cell: ({ row }) => (
        <span
          className="flex items-center gap-2 font-medium"
          data-testid={`dataset-list-name-${row.original.id}`}
        >
          <DatabaseArrowUp
            className="h-4 w-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <span>{row.original.name}</span>
        </span>
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
          <div className="whitespace-nowrap">
            <DateTimeDisplay
              date={new Date(latest.createdAt as string)}
              showTime
              formatString={dateTimeFormat}
              timezone={timezone}
              className="text-sm"
            />
          </div>
        );
      },
    },
    {
      id: "owner",
      header: () => t("columns.owner"),
      cell: ({ row }) => {
        const latest = row.original.versions[0];
        const editorId =
          latest?.createdBy?.id ?? row.original.createdBy?.id ?? null;
        if (!editorId)
          return <span className="text-muted-foreground">{"—"}</span>;
        return <UserNameCell userId={editorId} hideLink />;
      },
    },
    {
      id: "assignments",
      header: () => t("columns.assignments"),
      cell: ({ row }) => (
        <div className="text-center">
          <CasesListDisplay
            count={row.original._count.sharedAssignments}
            filter={{
              sharedDataSetAssignment: {
                is: { sharedDataSetId: row.original.id },
              },
            }}
          />
        </div>
      ),
    },
    {
      id: "actions",
      header: () => t("columns.actions"),
      cell: ({ row }) => (
        <div className="bg-primary-foreground whitespace-nowrap flex justify-end gap-1">
          <Button variant="ghost" className="px-2 py-1 h-auto" asChild>
            <Link
              href={`/projects/settings/${projectId}/datasets/${row.original.id}`}
              aria-label={t("actionOpen")}
              data-testid={`dataset-list-open-${row.original.id}`}
            >
              <SquarePen className="h-5 w-5" />
            </Link>
          </Button>
          <Button
            variant="destructive"
            className="px-2 py-1 h-auto"
            onClick={() =>
              setPendingDelete({
                id: row.original.id,
                name: row.original.name,
              })
            }
            aria-label={t("actionDelete")}
            data-testid={`dataset-list-delete-${row.original.id}`}
          >
            <Trash className="h-5 w-5" />
          </Button>
        </div>
      ),
    },
  ];

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
        <DataTable
          columns={columns}
          data={(datasets ?? []) as unknown as DatasetRow[]}
          columnVisibility={columnVisibility}
          onColumnVisibilityChange={setColumnVisibility}
          rowTestIdPrefix="dataset-list-row"
        />
      </div>

      {pendingDelete ? (
        <DatasetDeleteConfirmDialog
          projectId={projectId}
          dataSetId={pendingDelete.id}
          dataSetName={pendingDelete.name}
          open
          onOpenChange={(open) => {
            if (!open) setPendingDelete(null);
          }}
        />
      ) : null}
    </>
  );
}
