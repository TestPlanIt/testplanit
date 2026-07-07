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
import { RepositoryCaseSource } from "~/zenstack/models";
import { ColumnDef, createColumnHelper } from "@tanstack/react-table";
import { formatDistanceToNow } from "date-fns";
import { Layers } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import type {
  ExecutionLogRow,
  ExecutionLogStepRow,
} from "~/utils/executionLogUtils";

type ExecutionLogRowOrStep = ExecutionLogRow | ExecutionLogStepRow;

function isStepRow(row: any): row is ExecutionLogStepRow {
  return row && row.isStep === true;
}

export function useExecutionLogColumns(
  projectId?: number | string,
  isCrossProject?: boolean
): ColumnDef<ExecutionLogRowOrStep, any>[] {
  const t = useTranslations();
  const tCommon = useTranslations("common");
  const columnHelper = createColumnHelper<ExecutionLogRowOrStep>();

  return useMemo(() => {
    const columns: ColumnDef<ExecutionLogRowOrStep, any>[] = [];

    if (isCrossProject) {
      columns.push(
        columnHelper.accessor(
          (row) => (isStepRow(row) ? "" : (row.project?.name ?? "")),
          {
            id: "project",
            header: () => <span>{t("reports.dimensions.project")}</span>,
            cell: (info) => {
              const row = info.row.original;
              if (isStepRow(row)) return null;
              const project = row.project;
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
          }
        ) as ColumnDef<ExecutionLogRowOrStep, any>
      );
    }

    columns.push(
      columnHelper.accessor(
        (row) => (isStepRow(row) ? row.stepText : row.testCaseName),
        {
          id: "testCaseName",
          header: () => <span>{t("reports.dimensions.testCase")}</span>,
          cell: (info) => {
            const row = info.row.original;
            if (isStepRow(row)) {
              return (
                <div className="ps-6 text-sm space-y-1 py-1">
                  <div className="flex gap-2 items-start">
                    <span className="text-muted-foreground shrink-0 inline-flex items-center gap-1">
                      {row.sharedGroupName && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Layers
                                size={14}
                                className="text-primary shrink-0"
                              />
                            </TooltipTrigger>
                            <TooltipContent>
                              {t("repository.steps.sharedStepGroupTitle", {
                                name: row.sharedGroupName,
                              })}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                      {t("common.fields.step")} {row.stepNumber}
                    </span>
                    {row.stepText ? (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="line-clamp-2 cursor-default">
                              {row.stepText}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-md whitespace-pre-wrap">
                            {row.stepText}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </div>
                  {row.expectedResult && (
                    <div className="flex gap-2">
                      <span className="text-muted-foreground shrink-0">
                        {t("common.fields.expectedResult")}
                      </span>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="line-clamp-2 cursor-default">
                              {row.expectedResult}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-md whitespace-pre-wrap">
                            {row.expectedResult}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  )}
                </div>
              );
            }
            const rowProjectId = row.project?.id || projectId;
            return (
              <CaseDisplay
                id={row.testCaseId}
                name={row.testCaseName}
                source={row.testCaseSource as RepositoryCaseSource}
                hasParameters={row.testCaseHasParameters}
                link={
                  rowProjectId
                    ? `/projects/repository/${rowProjectId}/${row.testCaseId}`
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
        }
      ) as ColumnDef<ExecutionLogRowOrStep, any>
    );

    columns.push(
      columnHelper.accessor((row) => (isStepRow(row) ? "" : row.testRunName), {
        id: "testRunName",
        header: () => <span>{t("reports.dimensions.testRun")}</span>,
        cell: (info) => {
          const row = info.row.original;
          if (isStepRow(row)) return null;
          const { testRunId, testRunName, testRunIsDeleted } = row;
          const rowProjectId = row.project?.id || projectId;
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
      }) as ColumnDef<ExecutionLogRowOrStep, any>
    );

    columns.push(
      columnHelper.accessor((row) => row.status?.name ?? "", {
        id: "statusName",
        header: () => <span>{tCommon("actions.status")}</span>,
        cell: (info) => {
          const { status } = info.row.original;
          if (!status?.name) return null;
          return <StatusDotDisplay name={status.name} color={status.color} />;
        },
        enableSorting: true,
        size: 140,
        minSize: 100,
      }) as ColumnDef<ExecutionLogRowOrStep, any>
    );

    columns.push(
      columnHelper.accessor(
        (row) => (isStepRow(row) ? "" : (row.executedBy?.name ?? "")),
        {
          id: "executedBy",
          header: () => <span>{tCommon("fields.executedBy")}</span>,
          cell: (info) => {
            const row = info.row.original;
            if (isStepRow(row)) return null;
            const { executedBy } = row;
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
        }
      ) as ColumnDef<ExecutionLogRowOrStep, any>
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
      }) as ColumnDef<ExecutionLogRowOrStep, any>
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
      }) as ColumnDef<ExecutionLogRowOrStep, any>
    );

    return columns;
  }, [columnHelper, t, tCommon, projectId, isCrossProject]);
}
