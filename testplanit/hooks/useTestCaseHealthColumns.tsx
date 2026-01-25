import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { createColumnHelper, ColumnDef } from "@tanstack/react-table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { format, formatDistanceToNow } from "date-fns";
import { CaseDisplay } from "@/components/tables/CaseDisplay";
import { RepositoryCaseSource } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { cn } from "~/utils";
import type { HealthStatus } from "~/utils/testCaseHealthUtils";

interface TestCaseHealthRow {
  testCaseId: number;
  testCaseName: string;
  testCaseSource: string;
  createdAt: string;
  lastExecutedAt: string | null;
  daysSinceLastExecution: number | null;
  totalExecutions: number;
  passCount: number;
  failCount: number;
  passRate: number;
  healthStatus: HealthStatus;
  isStale: boolean;
  healthScore: number;
  project?: {
    id: number;
    name?: string;
  };
}

export function useTestCaseHealthColumns(
  projectId?: number | string,
  dimensions?: string[],
  isCrossProject?: boolean
): ColumnDef<TestCaseHealthRow, any>[] {
  const t = useTranslations();
  const tCommon = useTranslations("common");
  const columnHelper = createColumnHelper<TestCaseHealthRow>();

  return useMemo(() => {
    const columns: ColumnDef<TestCaseHealthRow, any>[] = [];

    // Add project column first if "project" is in dimensions or if it's cross-project
    if (dimensions?.includes("project") || (isCrossProject && !projectId)) {
      const projectAccessor = (row: TestCaseHealthRow) => {
        const project = row.project;
        if (!project) return null;
        return project.id ?? project.name ?? null;
      };

      columns.push(
        columnHelper.accessor(projectAccessor, {
          id: "project",
          header: () => <span>{t("reports.dimensions.project")}</span>,
          cell: (info) => {
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
            const aStr = aVal?.name || String(aVal || "");
            const bStr = bVal?.name || String(bVal || "");
            return aStr.localeCompare(bStr);
          },
          size: 200,
          minSize: 150,
          maxSize: 400,
        }) as ColumnDef<TestCaseHealthRow, any>
      );
    }

    // Column: Test Case Name
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
        size: 400,
        minSize: 200,
        maxSize: 1000,
      }) as ColumnDef<TestCaseHealthRow, any>
    );

    // Column: Health Status Badge
    columns.push(
      columnHelper.accessor("healthStatus", {
        id: "healthStatus",
        header: () => <span>{t("reports.ui.testCaseHealth.status")}</span>,
        cell: (info) => {
          const status = info.getValue() as HealthStatus;
          const statusConfig: Record<
            HealthStatus,
            { label: string; variant: "default" | "destructive" | "secondary" | "outline"; className: string }
          > = {
            healthy: {
              label: t("reports.ui.testCaseHealth.healthStatus.healthy"),
              variant: "default",
              className: "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20",
            },
            never_executed: {
              label: t("reports.ui.testCaseHealth.healthStatus.neverExecuted"),
              variant: "secondary",
              className: "bg-gray-500/10 text-gray-700 dark:text-gray-400 border-gray-500/20",
            },
            always_passing: {
              label: t("reports.ui.testCaseHealth.healthStatus.alwaysPassing"),
              variant: "outline",
              className: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
            },
            always_failing: {
              label: t("reports.ui.testCaseHealth.healthStatus.alwaysFailing"),
              variant: "destructive",
              className: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20",
            },
          };

          const config = statusConfig[status];

          // Handle undefined or unknown status gracefully
          if (!config) {
            return (
              <Badge variant="secondary" className="font-medium">
                {tCommon("labels.unknown")}
              </Badge>
            );
          }

          return (
            <Badge variant={config.variant} className={cn("font-medium", config.className)}>
              {config.label}
            </Badge>
          );
        },
        enableSorting: true,
        sortingFn: (rowA, rowB) => {
          const statusPriority: Record<HealthStatus, number> = {
            always_failing: 1,
            never_executed: 2,
            always_passing: 3,
            healthy: 4,
          };
          const statusDiff = statusPriority[rowA.original.healthStatus] -
            statusPriority[rowB.original.healthStatus];
          if (statusDiff !== 0) return statusDiff;
          // Secondary sort: stale tests first within same status
          if (rowA.original.isStale !== rowB.original.isStale) {
            return rowA.original.isStale ? -1 : 1;
          }
          return 0;
        },
        size: 140,
        minSize: 120,
      }) as ColumnDef<TestCaseHealthRow, any>
    );

    // Column: Stale indicator
    columns.push(
      columnHelper.accessor("isStale", {
        id: "isStale",
        header: () => <span>{t("reports.ui.testCaseHealth.healthStatus.stale")}</span>,
        cell: (info) => {
          const isStale = info.getValue();
          return isStale ? (
            <span className="text-yellow-600 dark:text-yellow-400 font-medium">
              {t("common.yes")}
            </span>
          ) : (
            <span className="text-muted-foreground">
              {t("common.no")}
            </span>
          );
        },
        enableSorting: true,
        size: 80,
        minSize: 60,
      }) as ColumnDef<TestCaseHealthRow, any>
    );

    // Column: Health Score
    columns.push(
      columnHelper.accessor("healthScore", {
        id: "healthScore",
        header: () => <span>{t("reports.ui.testCaseHealth.healthScore")}</span>,
        cell: (info) => {
          const score = info.getValue();
          const getScoreColor = (s: number) => {
            if (s >= 80) return "text-green-600 dark:text-green-400";
            if (s >= 60) return "text-yellow-600 dark:text-yellow-400";
            if (s >= 40) return "text-orange-600 dark:text-orange-400";
            return "text-red-600 dark:text-red-400";
          };
          return (
            <span className={cn("font-mono font-semibold", getScoreColor(score))}>
              {score}
            </span>
          );
        },
        enableSorting: true,
        size: 100,
        minSize: 80,
      }) as ColumnDef<TestCaseHealthRow, any>
    );

    // Column: Last Executed
    columns.push(
      columnHelper.accessor("lastExecutedAt", {
        id: "lastExecutedAt",
        header: () => <span>{t("reports.ui.testCaseHealth.lastExecuted")}</span>,
        cell: (info) => {
          const lastExecuted = info.getValue();
          if (!lastExecuted) {
            return (
              <span className="text-muted-foreground italic">
                {t("reports.ui.testCaseHealth.never")}
              </span>
            );
          }
          const date = new Date(lastExecuted);
          return (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="cursor-default">
                    {formatDistanceToNow(date, { addSuffix: true })}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <span>{format(date, "PPp")}</span>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          );
        },
        enableSorting: true,
        sortingFn: (rowA, rowB) => {
          const aVal = rowA.original.lastExecutedAt;
          const bVal = rowB.original.lastExecutedAt;
          if (!aVal && !bVal) return 0;
          if (!aVal) return 1;
          if (!bVal) return -1;
          return new Date(aVal).getTime() - new Date(bVal).getTime();
        },
        size: 150,
        minSize: 120,
      }) as ColumnDef<TestCaseHealthRow, any>
    );

    // Column: Total Executions
    columns.push(
      columnHelper.accessor("totalExecutions", {
        id: "totalExecutions",
        header: () => <span>{t("reports.ui.testCaseHealth.executions")}</span>,
        cell: (info) => (
          <span className="font-mono">{info.getValue()}</span>
        ),
        enableSorting: true,
        size: 100,
        minSize: 80,
      }) as ColumnDef<TestCaseHealthRow, any>
    );

    // Column: Pass Rate
    columns.push(
      columnHelper.accessor("passRate", {
        id: "passRate",
        header: () => <span>{t("reports.ui.testCaseHealth.passRate")}</span>,
        cell: (info) => {
          const rate = info.getValue();
          const total = info.row.original.totalExecutions;
          if (total === 0) {
            return <span className="text-muted-foreground">-</span>;
          }
          const getPassRateColor = (r: number) => {
            if (r >= 90) return "text-green-600 dark:text-green-400";
            if (r >= 70) return "text-yellow-600 dark:text-yellow-400";
            if (r >= 50) return "text-orange-600 dark:text-orange-400";
            return "text-red-600 dark:text-red-400";
          };
          return (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className={cn("font-mono font-semibold cursor-default", getPassRateColor(rate))}>
                    {rate}
                    {"%"}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <div className="text-xs space-y-1">
                    <div>
                      {t("reports.ui.testCaseHealth.passCount")}: {info.row.original.passCount}
                    </div>
                    <div>
                      {t("reports.ui.testCaseHealth.failCount")}: {info.row.original.failCount}
                    </div>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          );
        },
        enableSorting: true,
        size: 100,
        minSize: 80,
      }) as ColumnDef<TestCaseHealthRow, any>
    );

    return columns;
  }, [columnHelper, t, tCommon, projectId, dimensions, isCrossProject]);
}
