import { CodeRepositoryName } from "@/components/CodeRepositoryName";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ColumnDef,
  createColumnHelper,
} from "@/components/tables/tableFeatures";
import { format, formatDistanceToNow } from "date-fns";
import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { cn } from "~/utils";
import { TestRunNameDisplay } from "~/components/TestRunNameDisplay";
import type {
  ImpactAnalysisReportRow,
  ImpactRunOutcome,
  ImpactTrigger,
} from "~/utils/impactAnalysisReportUtils";

/** Label keys per trigger, shared by the columns, controls, chart and CSV. */
export const IMPACT_TRIGGER_LABEL_KEY: Record<ImpactTrigger, string> = {
  manual: "common.fields.manual",
  pull_request: "runs.impact.pull.label",
  push: "reports.ui.impactAnalysis.triggerPush",
};

export const IMPACT_OUTCOME_LABEL_KEY: Record<ImpactRunOutcome, string> = {
  failed: "reports.metrics.failed",
  passed: "reports.metrics.passed",
  not_executed: "reports.ui.impactAnalysis.outcomeNotExecuted",
  no_run: "reports.ui.impactAnalysis.outcomeNoRun",
};

// Same badge treatment as the Test Case Health report's status column.
const OUTCOME_BADGE: Record<
  ImpactRunOutcome,
  {
    variant: "default" | "destructive" | "secondary" | "outline";
    className: string;
  }
> = {
  failed: {
    variant: "destructive",
    className: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20",
  },
  passed: {
    variant: "default",
    className: "bg-success/10 text-success border-success/20",
  },
  not_executed: {
    variant: "secondary",
    className:
      "bg-gray-500/10 text-gray-700 dark:text-gray-400 border-gray-500/20",
  },
  no_run: { variant: "outline", className: "" },
};

export function useImpactAnalysisColumns(
  projectId?: number | string,
  dimensions?: string[],
  isCrossProject?: boolean
): ColumnDef<ImpactAnalysisReportRow, any>[] {
  const t = useTranslations();
  const tCommon = useTranslations("common");
  const tImpact = useTranslations("reports.ui.impactAnalysis");
  const columnHelper = createColumnHelper<ImpactAnalysisReportRow>();

  return useMemo(() => {
    const columns: ColumnDef<ImpactAnalysisReportRow, any>[] = [];
    const rowProjectId = (row: ImpactAnalysisReportRow) =>
      row.project?.id ?? projectId;

    if (dimensions?.includes("project") || (isCrossProject && !projectId)) {
      columns.push(
        columnHelper.accessor((row) => row.project?.name ?? "", {
          id: "project",
          header: () => <span>{tCommon("fields.project")}</span>,
          cell: (info) => (
            <span className="font-medium">
              {info.row.original.project?.name || tCommon("labels.unknown")}
            </span>
          ),
          enableSorting: true,
          size: 180,
          minSize: 120,
          maxSize: 400,
        }) as ColumnDef<ImpactAnalysisReportRow, any>
      );
    }

    columns.push(
      columnHelper.accessor("createdAt", {
        id: "createdAt",
        header: () => <span>{tCommon("fields.started")}</span>,
        cell: (info) => {
          const date = new Date(info.getValue());
          return (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-sm">
                  {formatDistanceToNow(date, { addSuffix: true })}
                </span>
              </TooltipTrigger>
              <TooltipContent>{format(date, "PPp")}</TooltipContent>
            </Tooltip>
          );
        },
        enableSorting: true,
        size: 160,
        minSize: 130,
        maxSize: 240,
      }) as ColumnDef<ImpactAnalysisReportRow, any>
    );

    columns.push(
      columnHelper.accessor((row) => row.repository.name, {
        id: "repository",
        header: () => <span>{tCommon("pageTitles.repository")}</span>,
        cell: (info) => (
          <CodeRepositoryName
            name={info.row.original.repository.name}
            provider={info.row.original.repository.provider}
            branch={info.row.original.repository.branch}
          />
        ),
        enableSorting: true,
        size: 280,
        minSize: 180,
        maxSize: 480,
      }) as ColumnDef<ImpactAnalysisReportRow, any>
    );

    columns.push(
      columnHelper.accessor("trigger", {
        id: "trigger",
        header: () => <span>{t("reports.dimensions.trigger")}</span>,
        cell: (info) => {
          const row = info.row.original;
          const label = t(IMPACT_TRIGGER_LABEL_KEY[row.trigger] as any);
          return (
            <span className="flex min-w-0 flex-col">
              <Badge variant="outline" className="w-fit">
                {label}
              </Badge>
              {row.triggerLabel && (
                <span className="truncate text-xs text-muted-foreground">
                  {row.triggerUrl ? (
                    <a
                      href={row.triggerUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 hover:underline"
                    >
                      {row.triggerLabel}
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  ) : (
                    row.triggerLabel
                  )}
                </span>
              )}
            </span>
          );
        },
        enableSorting: true,
        size: 220,
        minSize: 140,
        maxSize: 400,
      }) as ColumnDef<ImpactAnalysisReportRow, any>
    );

    columns.push(
      columnHelper.accessor((row) => `${row.baseRef}…${row.headRef}`, {
        id: "commits",
        header: () => <span>{t("runs.impact.pick.modeCommits")}</span>,
        cell: (info) => (
          <code className="text-xs">
            {info.row.original.baseRef}
            {"…"}
            {info.row.original.headRef}
          </code>
        ),
        enableSorting: false,
        size: 180,
        minSize: 120,
        maxSize: 320,
      }) as ColumnDef<ImpactAnalysisReportRow, any>
    );

    columns.push(
      columnHelper.accessor("fileCount", {
        id: "fileCount",
        header: () => <span>{tImpact("changedFiles")}</span>,
        cell: (info) => {
          const row = info.row.original;
          return (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="tabular-nums">{row.fileCount}</span>
              </TooltipTrigger>
              <TooltipContent>
                {tImpact("changedFilesDetail", {
                  files: row.fileCount,
                  additions: row.additions,
                  deletions: row.deletions,
                })}
              </TooltipContent>
            </Tooltip>
          );
        },
        enableSorting: true,
        size: 200,
        minSize: 150,
        maxSize: 260,
      }) as ColumnDef<ImpactAnalysisReportRow, any>
    );

    const countColumn = (
      id: keyof ImpactAnalysisReportRow & string,
      header: string
    ) =>
      columnHelper.accessor(id as any, {
        id,
        header: () => <span>{header}</span>,
        cell: (info) => (
          <span className="tabular-nums">{String(info.getValue() ?? 0)}</span>
        ),
        enableSorting: true,
        size: 180,
        minSize: 130,
        maxSize: 240,
      }) as ColumnDef<ImpactAnalysisReportRow, any>;
    columns.push(
      countColumn("pinnedCaseCount", t("runs.impact.affected.tierPinned")),
      countColumn("affectedCaseCount", t("runs.impact.affected.tierAffected")),
      countColumn("relatedCaseCount", t("runs.impact.affected.tierRelated")),
      countColumn("acceptedCaseCount", tImpact("accepted"))
    );

    columns.push(
      columnHelper.accessor((row) => row.testRun?.name ?? "", {
        id: "testRun",
        header: () => (
          <span>{tCommon("actions.junit.import.testRun.label")}</span>
        ),
        cell: (info) => {
          const row = info.row.original;
          const pid = rowProjectId(row);
          if (!row.testRun) {
            return <span className="text-muted-foreground">{"—"}</span>;
          }
          return (
            <TestRunNameDisplay
              testRun={row.testRun}
              projectId={pid ?? undefined}
              className="truncate"
            />
          );
        },
        enableSorting: true,
        size: 220,
        minSize: 140,
        maxSize: 400,
      }) as ColumnDef<ImpactAnalysisReportRow, any>
    );

    columns.push(
      columnHelper.accessor("outcome", {
        id: "outcome",
        header: () => <span>{t("reports.dimensions.outcome")}</span>,
        cell: (info) => {
          const row = info.row.original;
          const outcome = info.getValue() as ImpactRunOutcome;
          const badge = (
            <Badge
              variant={OUTCOME_BADGE[outcome].variant}
              className={cn("font-medium", OUTCOME_BADGE[outcome].className)}
            >
              {t(IMPACT_OUTCOME_LABEL_KEY[outcome] as any)}
            </Badge>
          );
          if (!row.testRun) return badge;
          return (
            <Tooltip>
              <TooltipTrigger asChild>
                <span>{badge}</span>
              </TooltipTrigger>
              <TooltipContent>
                {tImpact("runResults", {
                  executed: row.runExecutedCount,
                  passed: row.runPassedCount,
                  failed: row.runFailedCount,
                })}
              </TooltipContent>
            </Tooltip>
          );
        },
        enableSorting: true,
        size: 170,
        minSize: 130,
        maxSize: 240,
      }) as ColumnDef<ImpactAnalysisReportRow, any>
    );

    columns.push(
      columnHelper.accessor("durationMs", {
        id: "durationMs",
        header: () => <span>{tCommon("fields.duration")}</span>,
        cell: (info) => {
          const ms = info.getValue() as number | null;
          if (ms === null)
            return <span className="text-muted-foreground">{"—"}</span>;
          const seconds = Math.round(ms / 1000);
          return (
            <span className="tabular-nums">
              {seconds >= 60
                ? `${Math.floor(seconds / 60)}m ${seconds % 60}s`
                : `${seconds}s`}
            </span>
          );
        },
        enableSorting: true,
        size: 100,
        minSize: 80,
        maxSize: 160,
      }) as ColumnDef<ImpactAnalysisReportRow, any>
    );

    columns.push(
      columnHelper.accessor((row) => row.createdBy.name ?? "", {
        id: "createdBy",
        header: () => <span>{t("reports.dimensions.creator")}</span>,
        cell: (info) => (
          <span>
            {info.row.original.createdBy.name || tCommon("labels.unknown")}
          </span>
        ),
        enableSorting: true,
        size: 160,
        minSize: 120,
        maxSize: 300,
      }) as ColumnDef<ImpactAnalysisReportRow, any>
    );

    return columns;
  }, [
    projectId,
    dimensions,
    isCrossProject,
    t,
    tCommon,
    tImpact,
    columnHelper,
  ]);
}
