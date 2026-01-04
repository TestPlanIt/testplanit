/**
 * Hook for generating table columns for drill-down data
 */

import { useMemo } from "react";
import { useTranslations, useLocale } from "next-intl";
import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";
import type { DrillDownRecord } from "~/lib/types/reportDrillDown";
import { toHumanReadable } from "~/utils/duration";
import { format } from "date-fns";
import { getDateFnsLocale } from "~/utils/locales";

// Component imports
import StatusDotDisplay from "~/components/StatusDotDisplay";
import { UserNameCell } from "~/components/tables/UserNameCell";
import { TestCaseNameDisplay } from "~/components/TestCaseNameDisplay";
import { TestRunNameDisplay } from "~/components/TestRunNameDisplay";
import { ConfigurationNameDisplay } from "~/components/ConfigurationNameDisplay";
import { MilestoneIconAndName } from "~/components/MilestoneIconAndName";
import { WorkflowStateDisplay } from "~/components/WorkflowStateDisplay";
import { SessionNameDisplay } from "~/components/SessionNameDisplay";
import { Link } from "~/lib/navigation";

interface UseDrillDownColumnsProps {
  /** The metric ID to determine which columns to show */
  metricId: string;
}

/**
 * Hook to generate columns for drill-down tables based on metric type
 */
export function useDrillDownColumns({
  metricId,
}: UseDrillDownColumnsProps): ColumnDef<DrillDownRecord, any>[] {
  const tCommon = useTranslations("common");
  const tLinkedCases = useTranslations("linkedCases");
  const tMilestones = useTranslations("milestones");
  const locale = useLocale();
  const dateFnsLocale = getDateFnsLocale(locale);
  const columnHelper = createColumnHelper<DrillDownRecord>();

  // Memoize translation values to avoid issues with useMemo dependencies
  const translations = useMemo(
    () => ({
      milestone: tCommon("fields.milestone"),
      project: tCommon("fields.project"),
      createdBy: tCommon("fields.createdBy"),
      createdAt: tCommon("fields.createdAt"),
      status: tCommon("actions.status"),
      state: tCommon("fields.state"),
      testRuns: tCommon("fields.testRuns"),
      completed: tCommon("fields.completed"),
      folder: tCommon("fields.folder"),
      executedBy: tCommon("fields.executedBy"),
      date: tCommon("fields.date"),
      elapsed: tCommon("fields.elapsed"),
      configuration: tCommon("fields.configuration"),
      steps: tCommon("fields.steps"),
      priority: tCommon("fields.priority"),
      duration: tCommon("fields.duration"),
      startDate: tCommon("fields.startDate"),
      yes: tCommon("yes"),
      no: tCommon("no"),
      name: tCommon("name"),
      statusPending: tCommon("status.pending"),
      key: tCommon("fields.key"),
      summary: tCommon("fields.summary"),
      progress: tCommon("fields.progress"),
      automated: tCommon("fields.automated"),
      manual: tCommon("fields.manual"),
      charter: tCommon("fields.charter"),
      session: tCommon("fields.session"),
      testCase: tLinkedCases("testCase"),
      milestoneStatusNotStarted: tMilestones("statusLabels.NOT_STARTED"),
      milestoneStatusInProgress: tMilestones("statusLabels.IN_PROGRESS"),
      milestoneStatusCompleted: tMilestones("statusLabels.completed"),
    }),
    [tCommon, tLinkedCases, tMilestones]
  );

  return useMemo(() => {
    // Milestone metrics columns
    if (metricId === "totalMilestones" || metricId === "activeMilestones") {
      return [
        columnHelper.accessor((row: any) => row.name, {
          id: "milestone",
          header: () => translations.milestone,
          cell: (info) => {
            const row = info.row.original as any;
            const projectId = row.projectId || row.project?.id;
            return (
              <MilestoneIconAndName
                milestone={{
                  id: row.id,
                  name: row.name,
                  milestoneType: row.milestoneType,
                }}
                projectId={projectId}
              />
            );
          },
          enableSorting: false,
          size: 300,
          minSize: 200,
          maxSize: 500,
        }),
        columnHelper.accessor((row: any) => row.project?.name, {
          id: "project",
          header: () => translations.project,
          cell: (info) => {
            const value = info.getValue();
            return <span>{value || "-"}</span>;
          },
          enableSorting: false,
          size: 180,
          minSize: 120,
          maxSize: 300,
        }),
        columnHelper.accessor(
          (row: any) => row.creator?.name || row.creator?.email,
          {
            id: "creator",
            header: () => translations.createdBy,
            cell: (info) => {
              const row = info.row.original as any;
              return row.createdBy ? (
                <UserNameCell userId={row.createdBy} hideLink={true} />
              ) : (
                <span>-</span>
              );
            },
            enableSorting: false,
            size: 150,
            minSize: 100,
            maxSize: 250,
          }
        ),
        columnHelper.accessor(
          (row: any) => {
            // Show status based on isStarted and isCompleted
            if (row.isCompleted) return translations.milestoneStatusCompleted;
            if (row.isStarted) return translations.milestoneStatusInProgress;
            return translations.milestoneStatusNotStarted;
          },
          {
            id: "status",
            header: () => translations.status,
            cell: (info) => {
              const row = info.row.original as any;
              const status = row.isCompleted
                ? translations.milestoneStatusCompleted
                : row.isStarted
                  ? translations.milestoneStatusInProgress
                  : translations.milestoneStatusNotStarted;
              // Use a simple badge-like display
              return (
                <span
                  className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                    row.isCompleted
                      ? "bg-success/10 text-success"
                      : row.isStarted
                        ? "bg-primary/10 text-primary"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {status}
                </span>
              );
            },
            enableSorting: false,
            size: 120,
            minSize: 100,
            maxSize: 200,
          }
        ),
        columnHelper.accessor((row: any) => row.createdAt, {
          id: "createdAt",
          header: () => translations.createdAt,
          cell: (info) => {
            const value = info.getValue();
            if (!value) return <span>-</span>;
            try {
              const date = new Date(value);
              return (
                <span>{format(date, "PP", { locale: dateFnsLocale })}</span>
              );
            } catch {
              return <span>-</span>;
            }
          },
          enableSorting: false,
          size: 150,
          minSize: 120,
          maxSize: 200,
        }),
      ];
    }

    // Milestone Completion columns - shows test cases from test runs
    if (metricId === "milestoneCompletion") {
      return [
        columnHelper.accessor((row: any) => row.repositoryCase?.name, {
          id: "testCase",
          header: () => translations.testCase,
          cell: (info) => {
            const row = info.row.original as any;
            const projectId = row.repositoryCase?.project?.id;
            return (
              <TestCaseNameDisplay
                testCase={{
                  id: row.repositoryCase?.id || row.repositoryCaseId || 0,
                  name: row.repositoryCase?.name || "",
                }}
                projectId={projectId}
              />
            );
          },
          enableSorting: false,
          size: 300,
          minSize: 200,
          maxSize: 500,
        }),
        columnHelper.accessor((row: any) => row.testRun?.name, {
          id: "testRun",
          header: () => translations.testRuns,
          cell: (info) => {
            const row = info.row.original as any;
            const projectId = row.repositoryCase?.project?.id;
            return (
              <TestRunNameDisplay
                testRun={{
                  id: row.testRun?.id || row.testRunId || 0,
                  name: row.testRun?.name || "",
                }}
                projectId={projectId}
              />
            );
          },
          enableSorting: false,
          size: 250,
          minSize: 150,
          maxSize: 400,
        }),
        columnHelper.accessor((row: any) => row.status?.name, {
          id: "status",
          header: () => translations.status,
          cell: (info) => {
            const row = info.row.original as any;
            if (!row.status) {
              return (
                <span className="text-muted-foreground">
                  {translations.statusPending}
                </span>
              );
            }
            return (
              <StatusDotDisplay
                name={row.status.name}
                color={row.status.color?.value}
              />
            );
          },
          enableSorting: false,
          size: 150,
          minSize: 100,
          maxSize: 200,
        }),
        columnHelper.accessor((row: any) => row.status?.isCompleted, {
          id: "completed",
          header: () => translations.completed,
          cell: (info) => {
            const value = info.getValue();
            if (value === true) {
              return (
                <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-success/10 text-success">
                  {translations.yes}
                </span>
              );
            }
            return (
              <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-muted text-muted-foreground">
                {translations.no}
              </span>
            );
          },
          enableSorting: false,
          size: 120,
          minSize: 80,
          maxSize: 150,
        }),
        columnHelper.accessor((row: any) => row.repositoryCase?.folder?.name, {
          id: "folder",
          header: () => translations.folder,
          cell: (info) => {
            const value = info.getValue();
            return <span>{value || "-"}</span>;
          },
          enableSorting: false,
          size: 180,
          minSize: 120,
          maxSize: 300,
        }),
        columnHelper.accessor((row: any) => row.repositoryCase?.project?.name, {
          id: "project",
          header: () => translations.project,
          cell: (info) => {
            const value = info.getValue();
            return <span>{value || "-"}</span>;
          },
          enableSorting: false,
          size: 180,
          minSize: 120,
          maxSize: 300,
        }),
      ];
    }

    // Test execution metrics columns
    if (
      metricId === "testResults" ||
      metricId === "testResultCount" ||
      metricId === "executionCount" ||
      metricId === "passRate"
    ) {
      return [
        columnHelper.accessor(
          (row: any) => row.testRunCase?.repositoryCase?.name,
          {
            id: "testCase",
            header: () => translations.testCase,
            cell: (info) => {
              const row = info.row.original as any;
              const projectId = row.testRun?.projectId;
              return (
                <TestCaseNameDisplay
                  testCase={{
                    id: row.testRunCase?.repositoryCase?.id || 0,
                    name: row.testRunCase?.repositoryCase?.name || "",
                  }}
                  projectId={projectId}
                  className="truncate"
                />
              );
            },
            enableSorting: false,
            size: 250,
            minSize: 150,
            maxSize: 500,
          }
        ),
        columnHelper.accessor((row: any) => row.testRun?.name, {
          id: "testRun",
          header: () => translations.testRuns,
          cell: (info) => {
            const row = info.row.original as any;
            const projectId = row.testRun?.projectId;
            return (
              <TestRunNameDisplay
                testRun={{
                  id: row.testRunId,
                  name: row.testRun?.name || "",
                }}
                projectId={projectId}
                className="truncate"
              />
            );
          },
          enableSorting: false,
          size: 250,
          minSize: 150,
          maxSize: 500,
        }),
        columnHelper.accessor((row: any) => row.status?.name, {
          id: "status",
          header: () => translations.status,
          cell: (info) => {
            const row = info.row.original as any;
            return (
              <StatusDotDisplay
                name={row.status?.name || ""}
                color={row.status?.color?.value}
              />
            );
          },
          enableSorting: false,
          size: 120,
          minSize: 100,
          maxSize: 200,
        }),
        columnHelper.accessor((row: any) => row.executedBy?.name, {
          id: "executedBy",
          header: () => translations.executedBy,
          cell: (info) => {
            const row = info.row.original as any;
            return row.executedById ? (
              <UserNameCell userId={row.executedById} hideLink={true} />
            ) : (
              <span>-</span>
            );
          },
          enableSorting: false,
          size: 150,
          minSize: 100,
          maxSize: 250,
        }),
        columnHelper.accessor((row: any) => row.executedAt, {
          id: "executedAt",
          header: () => translations.date,
          cell: (info) => {
            const value = info.getValue();
            if (!value) return <span>-</span>;
            try {
              const date = new Date(value);
              return (
                <span>{format(date, "PPp", { locale: dateFnsLocale })}</span>
              );
            } catch {
              return <span>-</span>;
            }
          },
          enableSorting: false,
          size: 180,
          minSize: 150,
          maxSize: 250,
        }),
        columnHelper.accessor((row: any) => row.elapsed, {
          id: "elapsed",
          header: () => translations.elapsed,
          cell: (info) => {
            const value = info.getValue();
            if (value === null || value === undefined) return <span>-</span>;
            return <span>{toHumanReadable(value)}</span>;
          },
          enableSorting: false,
          size: 120,
          minSize: 80,
          maxSize: 180,
        }),
        columnHelper.accessor((row: any) => row.testRun?.configuration?.name, {
          id: "configuration",
          header: () => translations.configuration,
          cell: (info) => {
            const row = info.row.original as any;
            return (
              <ConfigurationNameDisplay
                configuration={row.testRun?.configuration}
              />
            );
          },
          enableSorting: false,
          size: 200,
          minSize: 150,
          maxSize: 350,
        }),
      ];
    }

    // Average Elapsed Time metric columns
    if (
      metricId === "avgElapsed" ||
      metricId === "avgElapsedTime" ||
      metricId === "averageElapsed"
    ) {
      return [
        columnHelper.accessor((row: any) => row.elapsed, {
          id: "elapsed",
          header: () => translations.elapsed,
          cell: (info) => {
            const value = info.getValue();
            if (value === null || value === undefined) return <span>-</span>;
            return <span>{toHumanReadable(value)}</span>;
          },
          enableSorting: false,
          size: 150,
          minSize: 100,
          maxSize: 200,
        }),
        columnHelper.accessor(
          (row: any) => row.testRunCase?.repositoryCase?.name,
          {
            id: "testCase",
            header: () => translations.testCase,
            cell: (info) => {
              const row = info.row.original as any;
              const projectId = row.testRun?.projectId;
              return (
                <TestCaseNameDisplay
                  testCase={{
                    id: row.testRunCase?.repositoryCase?.id || 0,
                    name: row.testRunCase?.repositoryCase?.name || "",
                  }}
                  projectId={projectId}
                  className="truncate"
                />
              );
            },
            enableSorting: false,
            size: 250,
            minSize: 150,
            maxSize: 500,
          }
        ),
        columnHelper.accessor((row: any) => row.testRun?.name, {
          id: "testRun",
          header: () => translations.testRuns,
          cell: (info) => {
            const row = info.row.original as any;
            const projectId = row.testRun?.projectId;
            return (
              <TestRunNameDisplay
                testRun={{
                  id: row.testRunId,
                  name: row.testRun?.name || "",
                }}
                projectId={projectId}
                className="truncate"
              />
            );
          },
          enableSorting: false,
          size: 250,
          minSize: 150,
          maxSize: 500,
        }),
        columnHelper.accessor((row: any) => row.executedBy?.name, {
          id: "executedBy",
          header: () => translations.executedBy,
          cell: (info) => {
            const row = info.row.original as any;
            return row.executedById ? (
              <UserNameCell userId={row.executedById} hideLink={true} />
            ) : (
              <span>-</span>
            );
          },
          enableSorting: false,
          size: 150,
          minSize: 100,
          maxSize: 250,
        }),
        columnHelper.accessor((row: any) => row.executedAt, {
          id: "executedAt",
          header: () => translations.date,
          cell: (info) => {
            const value = info.getValue();
            if (!value) return <span>-</span>;
            try {
              const date = new Date(value);
              return (
                <span>{format(date, "PPp", { locale: dateFnsLocale })}</span>
              );
            } catch {
              return <span>-</span>;
            }
          },
          enableSorting: false,
          size: 180,
          minSize: 150,
          maxSize: 250,
        }),
      ];
    }

    // Total Elapsed Time metric columns
    if (metricId === "sumElapsed" || metricId === "totalElapsedTime") {
      return [
        columnHelper.accessor((row: any) => row.elapsed, {
          id: "elapsed",
          header: () => translations.elapsed,
          cell: (info) => {
            const value = info.getValue();
            if (value === null || value === undefined) return <span>-</span>;
            return <span>{toHumanReadable(value)}</span>;
          },
          enableSorting: false,
          size: 150,
          minSize: 100,
          maxSize: 200,
        }),
        columnHelper.accessor(
          (row: any) => row.testRunCase?.repositoryCase?.name,
          {
            id: "testCase",
            header: () => translations.testCase,
            cell: (info) => {
              const row = info.row.original as any;
              const projectId = row.testRun?.projectId;
              return (
                <TestCaseNameDisplay
                  testCase={{
                    id: row.testRunCase?.repositoryCase?.id || 0,
                    name: row.testRunCase?.repositoryCase?.name || "",
                  }}
                  projectId={projectId}
                  className="truncate"
                />
              );
            },
            enableSorting: false,
            size: 250,
            minSize: 150,
            maxSize: 500,
          }
        ),
        columnHelper.accessor((row: any) => row.testRun?.name, {
          id: "testRun",
          header: () => translations.testRuns,
          cell: (info) => {
            const row = info.row.original as any;
            const projectId = row.testRun?.projectId;
            return (
              <TestRunNameDisplay
                testRun={{
                  id: row.testRunId,
                  name: row.testRun?.name || "",
                }}
                projectId={projectId}
                className="truncate"
              />
            );
          },
          enableSorting: false,
          size: 250,
          minSize: 150,
          maxSize: 500,
        }),
        columnHelper.accessor((row: any) => row.executedBy?.name, {
          id: "executedBy",
          header: () => translations.executedBy,
          cell: (info) => {
            const row = info.row.original as any;
            return row.executedById ? (
              <UserNameCell userId={row.executedById} hideLink={true} />
            ) : (
              <span>-</span>
            );
          },
          enableSorting: false,
          size: 150,
          minSize: 100,
          maxSize: 250,
        }),
        columnHelper.accessor((row: any) => row.executedAt, {
          id: "executedAt",
          header: () => translations.date,
          cell: (info) => {
            const value = info.getValue();
            if (!value) return <span>-</span>;
            try {
              const date = new Date(value);
              return (
                <span>{format(date, "PPp", { locale: dateFnsLocale })}</span>
              );
            } catch {
              return <span>-</span>;
            }
          },
          enableSorting: false,
          size: 180,
          minSize: 150,
          maxSize: 250,
        }),
      ];
    }

    // Test runs columns
    if (metricId === "testRuns") {
      return [
        columnHelper.accessor((row: any) => row.name, {
          id: "name",
          header: () => translations.testRuns,
          cell: (info) => {
            const row = info.row.original as any;
            const projectId = row.projectId || row.project?.id;
            return (
              <TestRunNameDisplay
                testRun={{
                  id: row.id,
                  name: row.name,
                }}
                projectId={projectId}
                className="truncate"
              />
            );
          },
          enableSorting: false,
          size: 250,
          minSize: 150,
          maxSize: 500,
        }),
        columnHelper.accessor((row: any) => row.state?.name, {
          id: "status",
          header: () => translations.status,
          cell: (info) => {
            const row = info.row.original as any;
            return (
              <StatusDotDisplay
                name={row.state?.name || ""}
                color={row.state?.color?.value}
              />
            );
          },
          enableSorting: false,
          size: 120,
          minSize: 100,
          maxSize: 200,
        }),
        columnHelper.accessor((row: any) => row.createdBy?.name, {
          id: "createdBy",
          header: () => translations.createdBy,
          cell: (info) => {
            const row = info.row.original as any;
            return row.createdById ? (
              <UserNameCell userId={row.createdById} hideLink={true} />
            ) : (
              <span>-</span>
            );
          },
          enableSorting: false,
          size: 150,
          minSize: 100,
          maxSize: 250,
        }),
        columnHelper.accessor((row: any) => row.startedAt, {
          id: "startedAt",
          header: () => translations.startDate,
          cell: (info) => {
            const value = info.getValue();
            if (!value) return <span>-</span>;
            try {
              const date = new Date(value);
              return (
                <span>{format(date, "PPp", { locale: dateFnsLocale })}</span>
              );
            } catch {
              return <span>-</span>;
            }
          },
          enableSorting: false,
          size: 180,
          minSize: 150,
          maxSize: 250,
        }),
        columnHelper.accessor(
          (row: any) => {
            const row_ = row as any;
            const total =
              (row_.passed || 0) +
              (row_.failed || 0) +
              (row_.blocked || 0) +
              (row_.untested || 0);
            const executed = total - (row_.untested || 0);
            return total > 0 ? `${executed}/${total}` : "-";
          },
          {
            id: "progress",
            header: () => translations.progress,
            cell: (info) => <span>{info.getValue()}</span>,
            enableSorting: false,
            size: 100,
            minSize: 80,
            maxSize: 150,
          }
        ),
        columnHelper.accessor((row: any) => row.milestone?.name, {
          id: "milestone",
          header: () => translations.milestone,
          cell: (info) => {
            const value = info.getValue();
            return <span>{value || "-"}</span>;
          },
          enableSorting: false,
          size: 150,
          minSize: 100,
          maxSize: 250,
        }),
      ];
    }

    // Average Steps and Total Steps columns - show test case name and step count
    if (
      metricId === "averageSteps" ||
      metricId === "totalSteps" ||
      metricId === "avgStepsPerCase"
    ) {
      return [
        columnHelper.accessor((row: any) => row.name, {
          id: "testCase",
          header: () => translations.testCase,
          cell: (info) => {
            const row = info.row.original as any;
            const projectId = row.projectId || row.project?.id;
            return (
              <TestCaseNameDisplay
                testCase={{
                  id: row.id,
                  name: row.name,
                }}
                projectId={projectId}
                className="truncate"
              />
            );
          },
          enableSorting: false,
          size: 250,
          minSize: 150,
          maxSize: 500,
        }),
        columnHelper.accessor(
          (row: any) => {
            const row_ = row as any;
            return row_.steps?.length || 0;
          },
          {
            id: "stepCount",
            header: () => translations.steps,
            cell: (info) => {
              const value = info.getValue();
              return <span>{value}</span>;
            },
            enableSorting: false,
            size: 100,
            minSize: 80,
            maxSize: 150,
          }
        ),
      ];
    }

    // Test cases columns
    if (metricId === "testCases") {
      return [
        columnHelper.accessor((row: any) => row.name, {
          id: "name",
          header: () => translations.testCase,
          cell: (info) => {
            const row = info.row.original as any;
            const projectId = row.projectId || row.project?.id;
            return (
              <TestCaseNameDisplay
                testCase={{
                  id: row.id,
                  name: row.name,
                }}
                projectId={projectId}
                className="truncate"
              />
            );
          },
          enableSorting: false,
          size: 250,
          minSize: 150,
          maxSize: 500,
        }),
        columnHelper.accessor((row: any) => row.state?.name, {
          id: "state",
          header: () => translations.state,
          cell: (info) => {
            const row = info.row.original as any;
            if (!row.state) return <span>-</span>;
            return <WorkflowStateDisplay state={row.state} size="sm" />;
          },
          enableSorting: false,
          size: 150,
          minSize: 100,
          maxSize: 220,
        }),
        columnHelper.accessor((row: any) => row.folder?.name, {
          id: "folder",
          header: () => translations.folder,
          cell: (info) => {
            const value = info.getValue();
            return <span>{value || "-"}</span>;
          },
          enableSorting: false,
          size: 180,
          minSize: 120,
          maxSize: 300,
        }),
        columnHelper.accessor((row: any) => row.createdAt, {
          id: "createdAt",
          header: () => translations.createdAt,
          cell: (info) => {
            const value = info.getValue();
            if (!value) return <span>-</span>;
            try {
              const date = new Date(value);
              return (
                <span>{format(date, "PP", { locale: dateFnsLocale })}</span>
              );
            } catch {
              return <span>-</span>;
            }
          },
          enableSorting: false,
          size: 150,
          minSize: 120,
          maxSize: 200,
        }),
      ];
    }

    // Repository stats test case metrics (testCaseCount, automatedCount, manualCount, automationRate)
    if (
      metricId === "testCaseCount" ||
      metricId === "createdCaseCount" ||
      metricId === "automatedCount" ||
      metricId === "manualCount" ||
      metricId === "automationRate"
    ) {
      const columns = [
        columnHelper.accessor((row: any) => row.name, {
          id: "testCase",
          header: () => translations.testCase,
          cell: (info) => {
            const row = info.row.original as any;
            const projectId = row.projectId || row.project?.id;
            return (
              <TestCaseNameDisplay
                testCase={{
                  id: row.id,
                  name: row.name,
                }}
                projectId={projectId}
                className="truncate"
              />
            );
          },
          enableSorting: false,
          size: 250,
          minSize: 150,
          maxSize: 500,
        }),
        columnHelper.accessor((row: any) => row.state?.name, {
          id: "state",
          header: () => translations.state,
          cell: (info) => {
            const row = info.row.original as any;
            if (!row.state) return <span>-</span>;
            return <WorkflowStateDisplay state={row.state} size="sm" />;
          },
          enableSorting: false,
          size: 150,
          minSize: 100,
          maxSize: 220,
        }),
        columnHelper.accessor((row: any) => row.folder?.name, {
          id: "folder",
          header: () => translations.folder,
          cell: (info) => {
            const value = info.getValue();
            return <span>{value || "-"}</span>;
          },
          enableSorting: false,
          size: 180,
          minSize: 120,
          maxSize: 300,
        }),
        columnHelper.accessor((row: any) => row.project?.name, {
          id: "project",
          header: () => translations.project,
          cell: (info) => {
            const value = info.getValue();
            return <span>{value || "-"}</span>;
          },
          enableSorting: false,
          size: 180,
          minSize: 120,
          maxSize: 300,
        }),
        columnHelper.accessor(
          (row: any) => row.creator?.name || row.creator?.email,
          {
            id: "creator",
            header: () => translations.createdBy,
            cell: (info) => {
              const row = info.row.original as any;
              return row.creatorId ? (
                <UserNameCell userId={row.creatorId} hideLink={true} />
              ) : (
                <span>-</span>
              );
            },
            enableSorting: false,
            size: 150,
            minSize: 100,
            maxSize: 250,
          }
        ),
        columnHelper.accessor((row: any) => row.createdAt, {
          id: "createdAt",
          header: () => translations.createdAt,
          cell: (info) => {
            const value = info.getValue();
            if (!value) return <span>-</span>;
            try {
              const date = new Date(value);
              return (
                <span>{format(date, "PP", { locale: dateFnsLocale })}</span>
              );
            } catch {
              return <span>-</span>;
            }
          },
          enableSorting: false,
          size: 150,
          minSize: 120,
          maxSize: 200,
        }),
      ];

      // Add Automated column for automationRate metric
      if (metricId === "automationRate") {
        columns.splice(
          2,
          0,
          columnHelper.accessor((row: any) => row.automated, {
            id: "automated",
            header: () => translations.automated,
            cell: (info) => {
              const value = info.getValue();
              if (value === null || value === undefined) return <span>-</span>;
              return (
                <span
                  className={
                    value ? "text-success font-medium" : "text-muted-foreground"
                  }
                >
                  {value ? translations.automated : translations.manual}
                </span>
              );
            },
            enableSorting: false,
            size: 120,
            minSize: 100,
            maxSize: 200,
          })
        );
      }

      return columns;
    }

    // Sessions columns
    if (metricId === "sessions" || metricId === "sessionCount") {
      return [
        columnHelper.accessor((row: any) => row.id, {
          id: "name",
          header: () => translations.name,
          cell: (info) => {
            const row = info.row.original as any;
            const projectId = row.project?.id ?? row.projectId;
            const sessionId = row.id;
            const sessionData = {
              id: sessionId,
              name: row.name,
              isDeleted: row.isDeleted,
            };

            const content = (
              <SessionNameDisplay session={sessionData} showIcon={true} />
            );

            if (projectId && sessionId) {
              return (
                <Link
                  href={`/projects/sessions/${projectId}/${sessionId}`}
                  className="inline-flex items-start gap-1 text-primary hover:underline"
                >
                  {content}
                </Link>
              );
            }

            return content;
          },
          enableSorting: false,
          size: 200,
          minSize: 150,
          maxSize: 400,
        }),
        columnHelper.accessor((row: any) => row.charter, {
          id: "charter",
          header: () => translations.charter,
          cell: (info) => {
            const value = info.getValue();
            return <span className="truncate">{value || "-"}</span>;
          },
          enableSorting: false,
          size: 250,
          minSize: 150,
          maxSize: 500,
        }),
        columnHelper.accessor((row: any) => row.createdBy?.name, {
          id: "createdBy",
          header: () => translations.createdBy,
          cell: (info) => {
            const row = info.row.original as any;
            return row.createdById ? (
              <UserNameCell userId={row.createdById} hideLink={true} />
            ) : (
              <span>-</span>
            );
          },
          enableSorting: false,
          size: 150,
          minSize: 100,
          maxSize: 250,
        }),
        columnHelper.accessor((row: any) => row.startedAt, {
          id: "startedAt",
          header: () => translations.startDate,
          cell: (info) => {
            const value = info.getValue();
            if (!value) return <span>-</span>;
            try {
              const date = new Date(value);
              return (
                <span>{format(date, "PPp", { locale: dateFnsLocale })}</span>
              );
            } catch {
              return <span>-</span>;
            }
          },
          enableSorting: false,
          size: 180,
          minSize: 150,
          maxSize: 250,
        }),
        columnHelper.accessor((row: any) => row.duration, {
          id: "duration",
          header: () => translations.duration,
          cell: (info) => {
            const value = info.getValue();
            if (value === null || value === undefined) return <span>-</span>;
            return <span>{toHumanReadable(value)}</span>;
          },
          enableSorting: false,
          size: 120,
          minSize: 80,
          maxSize: 180,
        }),
      ];
    }

    // Session Duration metric columns
    if (
      metricId === "sessionDuration" ||
      metricId === "averageTimeSpent" ||
      metricId === "averageDuration" ||
      metricId === "totalDuration"
    ) {
      return [
        columnHelper.accessor((row: any) => row.id, {
          id: "name",
          header: () => translations.name,
          cell: (info) => {
            const row = info.row.original as any;
            const projectId = row.project?.id ?? row.projectId;
            const sessionId = row.id;
            const sessionData = {
              id: sessionId,
              name: row.name,
              isDeleted: row.isDeleted,
            };

            const content = (
              <SessionNameDisplay session={sessionData} showIcon={true} />
            );

            if (projectId && sessionId) {
              return (
                <Link
                  href={`/projects/sessions/${projectId}/${sessionId}`}
                  className="inline-flex items-start gap-1 text-primary hover:underline"
                >
                  {content}
                </Link>
              );
            }

            return content;
          },
          enableSorting: false,
          size: 200,
          minSize: 150,
          maxSize: 400,
        }),
        columnHelper.accessor((row: any) => row.duration, {
          id: "duration",
          header: () => translations.duration,
          cell: (info) => {
            const value = info.getValue();
            if (value === null || value === undefined) return <span>-</span>;
            return <span>{toHumanReadable(value)}</span>;
          },
          enableSorting: false,
          size: 150,
          minSize: 100,
          maxSize: 200,
        }),
        columnHelper.accessor((row: any) => row.charter, {
          id: "charter",
          header: () => translations.charter,
          cell: (info) => {
            const value = info.getValue();
            return <span className="truncate">{value || "-"}</span>;
          },
          enableSorting: false,
          size: 250,
          minSize: 150,
          maxSize: 500,
        }),
        columnHelper.accessor((row: any) => row.createdBy?.name, {
          id: "createdBy",
          header: () => translations.createdBy,
          cell: (info) => {
            const row = info.row.original as any;
            return row.createdById ? (
              <UserNameCell userId={row.createdById} hideLink={true} />
            ) : (
              <span>-</span>
            );
          },
          enableSorting: false,
          size: 150,
          minSize: 100,
          maxSize: 250,
        }),
        columnHelper.accessor((row: any) => row.startedAt, {
          id: "startedAt",
          header: () => translations.startDate,
          cell: (info) => {
            const value = info.getValue();
            if (!value) return <span>-</span>;
            try {
              const date = new Date(value);
              return (
                <span>{format(date, "PPp", { locale: dateFnsLocale })}</span>
              );
            } catch {
              return <span>-</span>;
            }
          },
          enableSorting: false,
          size: 180,
          minSize: 150,
          maxSize: 250,
        }),
      ];
    }

    // Session results columns
    if (metricId === "sessionResultCount") {
      return [
        columnHelper.accessor((row: any) => row.session?.id, {
          id: "session",
          header: () => translations.session,
          cell: (info) => {
            const row = info.row.original as any;
            const session = row.session;

            if (!session) {
              return <span>-</span>;
            }

            const projectId = session.project?.id;
            const sessionData = {
              id: session.id,
              name: session.name,
              isDeleted: session.isDeleted,
            };

            const content = (
              <SessionNameDisplay session={sessionData} showIcon={true} />
            );

            if (projectId && session.id) {
              return (
                <Link
                  href={`/projects/sessions/${projectId}/${session.id}`}
                  className="inline-flex items-start gap-1 text-primary hover:underline"
                >
                  {content}
                </Link>
              );
            }

            return content;
          },
          enableSorting: false,
          size: 250,
          minSize: 150,
          maxSize: 500,
        }),
        columnHelper.accessor((row: any) => row.session?.project?.name, {
          id: "project",
          header: () => translations.project,
          cell: (info) => {
            const value = info.getValue();
            return <span>{value || "-"}</span>;
          },
          enableSorting: false,
          size: 180,
          minSize: 120,
          maxSize: 300,
        }),
        columnHelper.accessor((row: any) => row.createdBy?.name, {
          id: "createdBy",
          header: () => translations.createdBy,
          cell: (info) => {
            const row = info.row.original as any;
            return row.createdById ? (
              <UserNameCell userId={row.createdById} hideLink={true} />
            ) : (
              <span>-</span>
            );
          },
          enableSorting: false,
          size: 150,
          minSize: 100,
          maxSize: 250,
        }),
        columnHelper.accessor((row: any) => row.createdAt, {
          id: "createdAt",
          header: () => translations.createdAt,
          cell: (info) => {
            const value = info.getValue();
            if (!value) return <span>-</span>;
            try {
              const date = new Date(value);
              return (
                <span>{format(date, "PPp", { locale: dateFnsLocale })}</span>
              );
            } catch {
              return <span>-</span>;
            }
          },
          enableSorting: false,
          size: 180,
          minSize: 150,
          maxSize: 250,
        }),
      ];
    }

    // Issues columns
    if (metricId === "issues") {
      return [
        columnHelper.accessor((row: any) => row.key, {
          id: "key",
          header: () => translations.key,
          cell: (info) => {
            const value = info.getValue();
            return <span className="font-mono font-medium">{value}</span>;
          },
          enableSorting: false,
          size: 120,
          minSize: 80,
          maxSize: 180,
        }),
        columnHelper.accessor((row: any) => row.summary, {
          id: "summary",
          header: () => translations.summary,
          cell: (info) => {
            const value = info.getValue();
            return <span className="truncate">{value}</span>;
          },
          enableSorting: false,
          size: 300,
          minSize: 200,
          maxSize: 600,
        }),
        columnHelper.accessor((row: any) => row.status, {
          id: "status",
          header: () => translations.status,
          cell: (info) => {
            const value = info.getValue();
            return <span>{value || "-"}</span>;
          },
          enableSorting: false,
          size: 120,
          minSize: 100,
          maxSize: 200,
        }),
        columnHelper.accessor((row: any) => row.priority, {
          id: "priority",
          header: () => translations.priority,
          cell: (info) => {
            const value = info.getValue();
            return <span>{value || "-"}</span>;
          },
          enableSorting: false,
          size: 100,
          minSize: 80,
          maxSize: 150,
        }),
        columnHelper.accessor((row: any) => row.createdBy?.name, {
          id: "createdBy",
          header: () => translations.createdBy,
          cell: (info) => {
            const row = info.row.original as any;
            return row.createdById ? (
              <UserNameCell userId={row.createdById} hideLink={true} />
            ) : (
              <span>-</span>
            );
          },
          enableSorting: false,
          size: 150,
          minSize: 100,
          maxSize: 250,
        }),
      ];
    }

    // Default columns (fallback) - try to intelligently display data
    // Check if record has common fields and display them appropriately
    return [
      // Try to find a name field
      columnHelper.accessor(
        (row: any) => {
          const r = row as any;
          return (
            r.name ||
            r.testCase?.name ||
            r.testRunCase?.repositoryCase?.name ||
            r.testRun?.name ||
            ""
          );
        },
        {
          id: "name",
          header: () => translations.name,
          cell: (info) => {
            const row = info.row.original as any;
            // Try to use TestCaseNameDisplay if it looks like a test case
            if (
              row.id &&
              (row.name ||
                row.testCase?.name ||
                row.testRunCase?.repositoryCase?.name)
            ) {
              const testCaseId =
                row.id ||
                row.testCase?.id ||
                row.testRunCase?.repositoryCase?.id ||
                0;
              const testCaseName =
                row.name ||
                row.testCase?.name ||
                row.testRunCase?.repositoryCase?.name ||
                "";
              const projectId =
                row.projectId || row.project?.id || row.testRun?.projectId;
              return (
                <TestCaseNameDisplay
                  testCase={{
                    id: testCaseId,
                    name: testCaseName,
                  }}
                  projectId={projectId}
                  className="truncate"
                />
              );
            }
            // Try to use TestRunNameDisplay if it looks like a test run
            if (row.id && row.testRun?.name) {
              const projectId =
                row.projectId || row.project?.id || row.testRun?.projectId;
              return (
                <TestRunNameDisplay
                  testRun={{
                    id: row.id,
                    name: row.testRun.name,
                  }}
                  projectId={projectId}
                  className="truncate"
                />
              );
            }
            // Fallback to plain text
            const value = info.getValue();
            return <span>{value || "-"}</span>;
          },
          enableSorting: false,
          size: 250,
          minSize: 150,
          maxSize: 500,
        }
      ),
      // Try to find a status field
      columnHelper.accessor(
        (row: any) => {
          const r = row as any;
          return r.status?.name || r.state?.name || "";
        },
        {
          id: "status",
          header: () => translations.status,
          cell: (info) => {
            const row = info.row.original as any;
            if (row.status) {
              return (
                <StatusDotDisplay
                  name={row.status.name}
                  color={row.status.color?.value}
                />
              );
            }
            if (row.state) {
              return (
                <StatusDotDisplay
                  name={row.state.name}
                  color={row.state.color?.value}
                />
              );
            }
            return <span>-</span>;
          },
          enableSorting: false,
          size: 120,
          minSize: 100,
          maxSize: 200,
        }
      ),
      // Show ID only if name is not available
      columnHelper.accessor("id" as any, {
        id: "id",
        header: () => "ID",
        cell: (info) => {
          const row = info.row.original as any;
          // Only show ID if there's no name field
          if (
            !row.name &&
            !row.testCase?.name &&
            !row.testRunCase?.repositoryCase?.name &&
            !row.testRun?.name
          ) {
            return <span>{info.getValue()}</span>;
          }
          return (
            <span className="text-muted-foreground text-xs">
              {info.getValue()}
            </span>
          );
        },
        enableSorting: false,
        size: 100,
        minSize: 80,
        maxSize: 150,
      }),
    ];
  }, [metricId, translations, dateFnsLocale, columnHelper]);
}
