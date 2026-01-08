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

interface ExecutionStatus {
  resultId: number;
  statusName: string;
  statusColor: string;
  isSuccess: boolean;
  isFailure: boolean;
  executedAt: string;
}

interface FlakyTestRow {
  testCaseId: number;
  testCaseName: string;
  flipCount: number;
  executions: ExecutionStatus[];
}

export function useFlakyTestsColumns(
  consecutiveRuns: number
): ColumnDef<FlakyTestRow, any>[] {
  const t = useTranslations();
  const columnHelper = createColumnHelper<FlakyTestRow>();

  return useMemo(() => {
    const columns: ColumnDef<FlakyTestRow, any>[] = [];

    // Column 1: Test Case Name
    columns.push(
      columnHelper.accessor("testCaseName", {
        id: "testCaseName",
        header: () => <span>{t("reports.dimensions.testCase")}</span>,
        cell: (info) => (
          <span className="font-medium">{info.getValue()}</span>
        ),
        enableSorting: true,
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
      }) as ColumnDef<FlakyTestRow, any>
    );

    // Column 3: Execution History (compact view showing all statuses)
    columns.push(
      columnHelper.display({
        id: "executionHistory",
        header: () => (
          <span>
            {t("reports.ui.flakyTests.lastNResults", { count: consecutiveRuns })}
          </span>
        ),
        cell: (info) => {
          const executions = info.row.original.executions || [];

          return (
            <TooltipProvider>
              <div className="flex items-center gap-0.5">
                {executions.slice(0, consecutiveRuns).map((execution, index) => (
                  <Tooltip key={`${info.row.id}-exec-${index}`}>
                    <TooltipTrigger asChild>
                      <div
                        className="w-4 h-4 rounded-sm cursor-pointer"
                        style={{ backgroundColor: execution.statusColor }}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      <div className="text-xs">
                        <div className="font-medium text-popover-foreground">
                          {execution.statusName}
                        </div>
                        <div className="text-popover-foreground/70">
                          {format(new Date(execution.executedAt), "PPp")}
                        </div>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                ))}
                {executions.length < consecutiveRuns &&
                  Array.from({ length: consecutiveRuns - executions.length }).map(
                    (_, index) => (
                      <div
                        key={`${info.row.id}-empty-${index}`}
                        className="w-4 h-4 rounded-sm bg-muted"
                      />
                    )
                  )}
              </div>
            </TooltipProvider>
          );
        },
        enableSorting: false,
      }) as ColumnDef<FlakyTestRow, any>
    );

    return columns;
  }, [consecutiveRuns, columnHelper, t]);
}
