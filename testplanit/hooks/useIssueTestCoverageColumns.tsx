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
import { cn } from "~/utils";
import { IssueStatusDisplay } from "@/components/IssueStatusDisplay";
import { IssuePriorityDisplay } from "@/components/IssuePriorityDisplay";
import { IssuesDisplay } from "@/components/tables/IssuesDisplay";

// Flat row structure for grouping
interface IssueTestCoverageRow {
  id: number;

  // Issue dimension
  issueId: number;
  issueName: string;
  issueTitle: string;
  issueStatus: string | null;
  issuePriority: string | null;
  issueTypeName: string | null;
  externalKey: string | null;
  externalUrl: string | null;

  // Test case dimension
  testCaseId: number;
  testCaseName: string;
  testCaseSource: string;

  // Test case metrics
  lastStatusId: number | null;
  lastStatusName: string | null;
  lastStatusColor: string | null;
  lastStatusIsSuccess: boolean | null;
  lastStatusIsFailure: boolean | null;
  lastExecutedAt: string | null;

  // Issue-level summary
  linkedTestCases: number;
  passedTestCases: number;
  failedTestCases: number;
  untestedTestCases: number;
  passRate: number;

  project?: {
    id: number;
    name?: string;
  };
}

export function useIssueTestCoverageSummaryColumns(
  projectId?: number | string,
  dimensions?: string[],
  isCrossProject?: boolean
): ColumnDef<IssueTestCoverageRow, any>[] {
  const t = useTranslations();
  const tCommon = useTranslations("common");

  return useMemo(() => {
    const columnHelper = createColumnHelper<IssueTestCoverageRow>();
    const columns: ColumnDef<IssueTestCoverageRow, any>[] = [];

    // Add project column first if "project" is in dimensions or if it's cross-project
    if (dimensions?.includes("project") || (isCrossProject && !projectId)) {
      columns.push(
        columnHelper.accessor(
          (row) => {
            const project = row.project;
            if (!project) return null;
            return project.id ?? project.name ?? null;
          },
          {
            id: "project",
            enableGrouping: false,
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
          }
        )
      );
    }

    // Column: Issue (dimension for grouping)
    columns.push(
      columnHelper.accessor("issueId", {
        id: "issueId",
        enableHiding: false,
        enableGrouping: true, // Enable grouping by issue
        header: () => <span>{t("reports.ui.issueTestCoverage.issue")}</span>,
        cell: (info) => {
          const row = info.row.original;
          const parentProjectId = row.project?.id || projectId;

          return (
            <IssuesDisplay
              id={row.issueId}
              name={row.externalKey || row.issueName}
              externalId={row.externalKey}
              externalUrl={row.externalUrl}
              title={row.issueTitle}
              status={row.issueStatus}
              size="small"
              projectIds={parentProjectId ? [Number(parentProjectId)] : []}
              issueTypeName={row.issueTypeName}
            />
          );
        },
        aggregationFn: "unique",
        aggregatedCell: (info) => {
          // When grouped, show the issue info with count
          const firstRow = info.row.subRows[0]?.original;
          if (!firstRow) return null;

          const parentProjectId = firstRow.project?.id || projectId;

          return (
            <IssuesDisplay
              id={firstRow.issueId}
              name={firstRow.externalKey || firstRow.issueName}
              externalId={firstRow.externalKey}
              externalUrl={firstRow.externalUrl}
              title={firstRow.issueTitle}
              status={firstRow.issueStatus}
              size="small"
              projectIds={parentProjectId ? [Number(parentProjectId)] : []}
              issueTypeName={firstRow.issueTypeName}
            />
          );
        },
        enableSorting: true,
        size: 350,
        minSize: 200,
        maxSize: 600,
      })
    );

    // Column: Test Case (dimension for grouping)
    columns.push(
      columnHelper.accessor("testCaseId", {
        id: "testCaseId",
        enableHiding: false,
        enableGrouping: true, // Enable grouping by test case
        header: () => <span>{t("reports.ui.issueTestCoverage.testCase")}</span>,
        cell: (info) => {
          const row = info.row.original;
          const parentProjectId = row.project?.id || projectId;

          return (
            <CaseDisplay
              id={row.testCaseId}
              name={row.testCaseName}
              source={row.testCaseSource as RepositoryCaseSource}
              link={
                parentProjectId
                  ? `/projects/repository/${parentProjectId}/${row.testCaseId}`
                  : undefined
              }
              size="small"
              maxLines={2}
            />
          );
        },
        aggregationFn: "count",
        aggregatedCell: (info) => {
          // When grouped by issue, show test case count
          const count = info.row.subRows.length;
          return (
            <span className="text-muted-foreground text-sm">
              {count}{" "}
              {t("reports.ui.issueTestCoverage.testCases", { count })}
            </span>
          );
        },
        enableSorting: true,
        size: 250,
        minSize: 150,
        maxSize: 600,
      })
    );

    // Column: Issue Status
    columns.push(
      columnHelper.accessor("issueStatus", {
        id: "issueStatus",
        enableHiding: false,
        enableGrouping: false,
        header: () => (
          <span>{t("reports.ui.issueTestCoverage.issueStatus")}</span>
        ),
        cell: (info) => {
          return <IssueStatusDisplay status={info.row.original.issueStatus} />;
        },
        aggregatedCell: (info) => {
          const firstRow = info.row.subRows[0]?.original;
          return <IssueStatusDisplay status={firstRow?.issueStatus} />;
        },
        enableSorting: true,
        size: 120,
        minSize: 100,
      })
    );

    // Column: Issue Priority
    columns.push(
      columnHelper.accessor("issuePriority", {
        id: "issuePriority",
        enableHiding: false,
        enableGrouping: false,
        header: () => <span>{t("reports.ui.issueTestCoverage.priority")}</span>,
        cell: (info) => {
          return (
            <IssuePriorityDisplay priority={info.row.original.issuePriority} />
          );
        },
        aggregatedCell: (info) => {
          const firstRow = info.row.subRows[0]?.original;
          return <IssuePriorityDisplay priority={firstRow?.issuePriority} />;
        },
        enableSorting: true,
        size: 140,
        minSize: 100,
      })
    );

    // Column: Last Test Status (for individual test cases)
    columns.push(
      columnHelper.accessor("lastStatusName", {
        id: "lastStatusName",
        enableHiding: false,
        enableGrouping: false,
        header: () => (
          <span>{t("reports.ui.issueTestCoverage.lastStatus")}</span>
        ),
        cell: (info) => {
          const row = info.row.original;
          const statusName = row.lastStatusName;
          const statusColor = row.lastStatusColor;

          if (!statusName) {
            return (
              <span className="text-muted-foreground italic text-sm">
                {t("reports.ui.issueTestCoverage.notTested")}
              </span>
            );
          }

          return (
            <div className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: statusColor || "#6b7280" }}
              />
              <span className="text-sm">{statusName}</span>
            </div>
          );
        },
        aggregatedCell: () => null, // Don't show for grouped rows
        enableSorting: true,
        size: 140,
        minSize: 100,
      })
    );

    // Column: Last Executed (for individual test cases)
    columns.push(
      columnHelper.accessor("lastExecutedAt", {
        id: "lastExecutedAt",
        enableHiding: false,
        enableGrouping: false,
        header: () => (
          <span>{t("reports.ui.issueTestCoverage.lastExecuted")}</span>
        ),
        cell: (info) => {
          const lastExecuted = info.row.original.lastExecutedAt;

          if (!lastExecuted) {
            return (
              <span className="text-muted-foreground italic text-sm">
                {t("reports.ui.testCaseHealth.never")}
              </span>
            );
          }

          const date = new Date(lastExecuted);
          return (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="cursor-default text-sm">
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
        aggregatedCell: () => null, // Don't show for grouped rows
        enableSorting: true,
        size: 160,
        minSize: 120,
      })
    );

    // Column: Test Results Summary (aggregated metric)
    columns.push(
      columnHelper.accessor("passedTestCases", {
        id: "testResults",
        enableHiding: false,
        enableGrouping: false,
        header: () => (
          <span>{t("reports.ui.issueTestCoverage.testResults")}</span>
        ),
        cell: () => null, // Only show for grouped rows
        aggregatedCell: (info) => {
          const firstRow = info.row.subRows[0]?.original;
          if (!firstRow) return null;

          return (
            <div className="flex items-center gap-2 text-sm">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-green-600 dark:text-green-400 font-mono cursor-default">
                      {firstRow.passedTestCases}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t("reports.ui.issueTestCoverage.passed")}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <span className="text-muted-foreground">/</span>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-red-600 dark:text-red-400 font-mono cursor-default">
                      {firstRow.failedTestCases}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t("reports.ui.issueTestCoverage.failed")}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <span className="text-muted-foreground">/</span>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-gray-500 dark:text-gray-400 font-mono cursor-default">
                      {firstRow.untestedTestCases}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t("reports.ui.issueTestCoverage.untested")}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          );
        },
        enableSorting: true,
        size: 120,
        minSize: 100,
      })
    );

    // Column: Pass Rate (aggregated metric)
    columns.push(
      columnHelper.accessor("passRate", {
        id: "passRate",
        enableHiding: false,
        enableGrouping: false,
        header: () => <span>{t("reports.ui.issueTestCoverage.passRate")}</span>,
        cell: () => null, // Only show for grouped rows
        aggregatedCell: (info) => {
          const firstRow = info.row.subRows[0]?.original;
          if (!firstRow) return null;

          const rate = firstRow.passRate;
          const testedCount =
            firstRow.passedTestCases + firstRow.failedTestCases;

          if (testedCount === 0) {
            return <span className="text-muted-foreground">-</span>;
          }

          const getPassRateColor = (r: number) => {
            if (r >= 90) return "text-green-600 dark:text-green-400";
            if (r >= 70) return "text-yellow-600 dark:text-yellow-400";
            if (r >= 50) return "text-orange-600 dark:text-orange-400";
            return "text-red-600 dark:text-red-400";
          };

          return (
            <span
              className={cn("font-mono font-semibold", getPassRateColor(rate))}
            >
              {rate}
              {"%"}
            </span>
          );
        },
        enableSorting: true,
        size: 100,
        minSize: 80,
      })
    );

    return columns;
  }, [t, tCommon, projectId, dimensions, isCrossProject]);
}
