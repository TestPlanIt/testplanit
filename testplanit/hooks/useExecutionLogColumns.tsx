import { DateFormatter } from "@/components/DateFormatter";
import { DurationDisplay } from "@/components/DurationDisplay";
import StatusDotDisplay from "@/components/StatusDotDisplay";
import { TestRunNameDisplay } from "@/components/TestRunNameDisplay";
import { CaseDisplay } from "@/components/tables/CaseDisplay";
import { UserNameCell } from "@/components/tables/UserNameCell";
import { ProjectNameDisplay } from "@/components/search/ProjectNameDisplay";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { RepositoryCaseSource } from "@prisma/client";
import { ColumnDef, createColumnHelper } from "@tanstack/react-table";
import { formatDistanceToNow } from "date-fns";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import type { ExecutionLogRow } from "~/utils/executionLogUtils";

export function useExecutionLogColumns(
  projectId?: number | string,
  isCrossProject?: boolean
): ColumnDef<ExecutionLogRow, any>[] {
  const t = useTranslations();
  const tCommon = useTranslations("common");
  const columnHelper = createColumnHelper<ExecutionLogRow>();

  return useMemo(() => {
    const columns: ColumnDef<ExecutionLogRow, any>[] = [];

    if (isCrossProject) {
      columns.push(
        columnHelper.accessor((row) => row.project?.name ?? "", {
          id: "project",
          header: () => <span>{t("reports.dimensions.project")}</span>,
          cell: (info) => {
            const project = info.row.original.project;
            if (!project)
              return (
                <span className="text-muted-foreground">
                  {tCommon("labels.unknown")}
                </span>
              );
            return (
              <ProjectNameDisplay
                projectName={project.name}
                projectId={project.id}
                iconUrl={project.iconUrl}
                showLink
              />
            );
          },
          enableSorting: true,
          size: 180,
          minSize: 120,
        }) as ColumnDef<ExecutionLogRow, any>
      );
    }

    columns.push(
      columnHelper.accessor("testCaseName", {
        id: "testCaseName",
        header: () => <span>{t("reports.dimensions.testCase")}</span>,
        cell: (info) => {
          const rowProjectId = info.row.original.project?.id || projectId;
          return (
            <CaseDisplay
              id={info.row.original.testCaseId}
              name={info.row.original.testCaseName}
              source={info.row.original.testCaseSource as RepositoryCaseSource}
              link={
                rowProjectId
                  ? `/projects/repository/${rowProjectId}/${info.row.original.testCaseId}`
                  : undefined
              }
              size="medium"
              maxLines={2}
            />
          );
        },
        enableSorting: true,
        size: 320,
        minSize: 200,
        maxSize: 800,
      }) as ColumnDef<ExecutionLogRow, any>
    );

    columns.push(
      columnHelper.accessor("testRunName", {
        id: "testRunName",
        header: () => <span>{t("reports.dimensions.testRun")}</span>,
        cell: (info) => {
          const { testRunId, testRunName, testRunIsDeleted } =
            info.row.original;
          const rowProjectId = info.row.original.project?.id || projectId;
          return (
            <TestRunNameDisplay
              testRun={{
                id: testRunId,
                name: testRunName,
                isDeleted: testRunIsDeleted,
              }}
              projectId={rowProjectId}
              showIcon
            />
          );
        },
        enableSorting: true,
        size: 240,
        minSize: 150,
        maxSize: 500,
      }) as ColumnDef<ExecutionLogRow, any>
    );

    columns.push(
      columnHelper.accessor((row) => row.status?.name ?? "", {
        id: "statusName",
        header: () => <span>{tCommon("actions.status")}</span>,
        cell: (info) => {
          const { status } = info.row.original;
          if (!status) return null;
          return <StatusDotDisplay name={status.name} color={status.color} />;
        },
        enableSorting: true,
        size: 140,
        minSize: 100,
      }) as ColumnDef<ExecutionLogRow, any>
    );

    columns.push(
      columnHelper.accessor((row) => row.executedBy?.name ?? "", {
        id: "executedBy",
        header: () => <span>{tCommon("fields.executedBy")}</span>,
        cell: (info) => {
          const { executedBy } = info.row.original;
          if (!executedBy?.id)
            return (
              <span className="text-muted-foreground">
                {executedBy?.name || "-"}
              </span>
            );
          return (
            <div className="truncate">
              <UserNameCell userId={executedBy.id} />
            </div>
          );
        },
        enableSorting: true,
        size: 160,
        minSize: 120,
      }) as ColumnDef<ExecutionLogRow, any>
    );

    columns.push(
      columnHelper.accessor("executedAt", {
        id: "executedAt",
        header: () => <span>{tCommon("fields.executedAt")}</span>,
        cell: (info) => {
          const dateStr = info.getValue();
          if (!dateStr) return <span className="text-muted-foreground">-</span>;
          const date = new Date(dateStr);
          return (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="cursor-default text-sm">
                    {formatDistanceToNow(date, { addSuffix: true })}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <DateFormatter date={date} formatString="PPp" />
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          );
        },
        enableSorting: true,
        sortingFn: (rowA, rowB) => {
          const aVal = rowA.original.executedAt;
          const bVal = rowB.original.executedAt;
          if (!aVal && !bVal) return 0;
          if (!aVal) return 1;
          if (!bVal) return -1;
          return new Date(aVal).getTime() - new Date(bVal).getTime();
        },
        size: 160,
        minSize: 120,
      }) as ColumnDef<ExecutionLogRow, any>
    );

    columns.push(
      columnHelper.accessor("elapsed", {
        id: "elapsed",
        header: () => <span>{tCommon("fields.duration")}</span>,
        cell: (info) => {
          const elapsed = info.getValue();
          if (!elapsed || elapsed <= 0)
            return <span className="text-muted-foreground">-</span>;
          return <DurationDisplay seconds={elapsed} />;
        },
        enableSorting: true,
        size: 110,
        minSize: 80,
      }) as ColumnDef<ExecutionLogRow, any>
    );

    return columns;
  }, [columnHelper, t, tCommon, projectId, isCrossProject]);
}
