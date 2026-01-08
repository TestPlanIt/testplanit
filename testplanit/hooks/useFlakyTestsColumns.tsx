import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { createColumnHelper, ColumnDef } from "@tanstack/react-table";
import StatusDotDisplay from "@/components/StatusDotDisplay";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { format } from "date-fns";
import { CaseDisplay } from "@/components/tables/CaseDisplay";
import { RepositoryCaseSource } from "@prisma/client";
import { Link } from "~/lib/navigation";

interface ExecutionStatus {
  resultId: number;
  testRunId: number | null;
  statusName: string;
  statusColor: string;
  isSuccess: boolean;
  isFailure: boolean;
  executedAt: string;
}

interface FlakyTestRow {
  testCaseId: number;
  testCaseName: string;
  testCaseSource: string;
  flipCount: number;
  executions: ExecutionStatus[];
  project?: {
    id: number;
    name?: string;
  };
}

export function useFlakyTestsColumns(
  consecutiveRuns: number,
  projectId?: number | string,
  dimensions?: string[],
  isCrossProject?: boolean
): ColumnDef<FlakyTestRow, any>[] {
  const t = useTranslations();
  const tCommon = useTranslations("common");
  const columnHelper = createColumnHelper<FlakyTestRow>();

  return useMemo(() => {
    const columns: ColumnDef<FlakyTestRow, any>[] = [];

    // Add project column first if "project" is in dimensions or if it's cross-project
    // (for cross-project, we always want to show project even if dimensions aren't set yet)
    if (dimensions?.includes("project") || (isCrossProject && !projectId)) {
      // Custom accessor that returns a primitive value for proper grouping
      // Returns project ID for grouping, but we'll display the name in the cell
      const projectAccessor = (row: FlakyTestRow) => {
        const project = row.project;
        if (!project) return null;
        // Return ID for grouping (ensures same project groups together)
        // Use name as fallback if ID is not available
        return project.id ?? project.name ?? null;
      };

      columns.push(
        columnHelper.accessor(projectAccessor, {
          id: "project",
          header: () => <span>{t("reports.dimensions.project")}</span>,
          cell: (info) => {
            // Get the actual project object from the row, not the accessor value
            const projectData = info.row.original.project;
            return (
              <span className="font-medium">
                {projectData?.name || tCommon("labels.unknown")}
              </span>
            );
          },
          enableSorting: true,
          sortingFn: (rowA, rowB) => {
            const aVal = rowA.original.project;
            const bVal = rowB.original.project;

            // Handle object sorting by name
            const aStr = aVal?.name || String(aVal || "");
            const bStr = bVal?.name || String(bVal || "");
            return aStr.localeCompare(bStr);
          },
          size: 200,
          minSize: 150,
          maxSize: 400,
        }) as ColumnDef<FlakyTestRow, any>
      );
    }

    // Column 1: Test Case Name
    columns.push(
      columnHelper.accessor("testCaseName", {
        id: "testCaseName",
        header: () => <span>{t("reports.dimensions.testCase")}</span>,
        cell: (info) => {
          // Use project ID from row data for cross-project, or fall back to prop
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
        size: 500,
        minSize: 200,
        maxSize: 1500,
      }) as ColumnDef<FlakyTestRow, any>
    );

    // Column 2: Flip Count
    columns.push(
      columnHelper.accessor("flipCount", {
        id: "flipCount",
        header: () => <span>{t("reports.ui.flakyTests.flips")}</span>,
        cell: (info) => (
          <span className="font-mono font-semibold text-orange-600 dark:text-orange-400">
            {info.getValue()}
          </span>
        ),
        enableSorting: true,
        size: 100,
        minSize: 100,
      }) as ColumnDef<FlakyTestRow, any>
    );

    // Column 3: Execution History (compact view showing all statuses)
    columns.push(
      columnHelper.display({
        id: "executionHistory",
        header: () => (
          <span>
            {t("reports.ui.flakyTests.lastNResults", {
              count: consecutiveRuns,
            })}
          </span>
        ),
        cell: (info) => {
          const executions = info.row.original.executions || [];
          const totalSlots = Math.max(executions.length, consecutiveRuns);

          // Calculate opacity: index 0 = 1 (full), index 1 = 0.7, then fade to 0.2
          const getOpacity = (index: number) => {
            if (index === 0) return 1;
            if (totalSlots <= 2) return 0.7;
            // From index 1 (0.7) to the last index (0.2)
            return 0.7 - ((index - 1) / (totalSlots - 2)) * 0.5;
          };

          return (
            <TooltipProvider>
              <div className="flex items-center gap-0.5">
                {executions
                  .slice(0, consecutiveRuns)
                  .map((execution, index) => {
                    const testCaseId = info.row.original.testCaseId;
                    // Use project ID from row data for cross-project, or fall back to prop
                    const rowProjectId =
                      info.row.original.project?.id || projectId;
                    const hasLink = rowProjectId && execution.testRunId;
                    const linkHref = hasLink
                      ? `/projects/runs/${rowProjectId}/${execution.testRunId}?selectedCase=${testCaseId}`
                      : undefined;

                    const boxStyle = {
                      backgroundColor: execution.statusColor,
                      opacity: getOpacity(index),
                    };

                    const boxContent = hasLink ? (
                      <Link
                        href={linkHref!}
                        className="block w-4 h-4 rounded-sm transition-all hover:opacity-80"
                        style={boxStyle}
                      />
                    ) : (
                      <div
                        className="w-4 h-4 rounded-sm cursor-default"
                        style={boxStyle}
                      />
                    );

                    return (
                      <Tooltip
                        key={`${info.row.original.testCaseId}-exec-${execution.resultId}-${index}`}
                      >
                        <TooltipTrigger asChild>{boxContent}</TooltipTrigger>
                        <TooltipContent>
                          <div className="text-xs space-y-1">
                            <StatusDotDisplay
                              name={execution.statusName}
                              color={execution.statusColor}
                            />
                            <div className="opacity-80">
                              {format(new Date(execution.executedAt), "PPp")}
                            </div>
                            {!execution.testRunId && (
                              <div className="text-destructive text-xs">
                                {t("reports.ui.flakyTests.testRunDeleted")}
                              </div>
                            )}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                {executions.length < consecutiveRuns &&
                  Array.from({
                    length: consecutiveRuns - executions.length,
                  }).map((_, index) => (
                    <div
                      key={`${info.row.original.testCaseId}-empty-${executions.length + index}`}
                      className="w-4 h-4 rounded-sm bg-muted"
                      style={{ opacity: getOpacity(executions.length + index) }}
                    />
                  ))}
              </div>
            </TooltipProvider>
          );
        },
        enableSorting: false,
      }) as ColumnDef<FlakyTestRow, any>
    );

    return columns;
  }, [
    consecutiveRuns,
    columnHelper,
    t,
    tCommon,
    projectId,
    dimensions,
    isCrossProject,
  ]);
}
