import { ProjectNameDisplay } from "@/components/search/ProjectNameDisplay";
import {
  ColumnDef,
  createColumnHelper,
} from "@/components/tables/tableFeatures";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import {
  formatRate,
  periodLongLabel,
  TREND_COLORS,
} from "@/components/dataVisualizations/resultsTrendChartUtils";
import { ResultsTrendPip } from "@/components/dataVisualizations/ResultsTrendPip";
import type { DateGrouping } from "~/lib/reports/dateGrouping";
import type { ResultBucket, ResultsTrendRow } from "~/utils/resultsTrendShared";

const BUCKET_COLORS: Record<ResultBucket, string> = {
  passed: TREND_COLORS.passed,
  failed: TREND_COLORS.failed,
  skipped: TREND_COLORS.skipped,
  other: TREND_COLORS.other,
};

/**
 * The results table: one row per project per period plus the combined row
 * ("All selected projects") for each period, newest period first.
 */
/**
 * `includeProject` adds the Project column, which only the cross-project
 * report needs: a single project's rows all name the same project.
 */
export function useResultsTrendColumns(
  grouping: DateGrouping,
  includeProject: boolean
): ColumnDef<ResultsTrendRow, any>[] {
  const t = useTranslations("reports.ui.resultsTrend");
  const tMetrics = useTranslations("reports.metrics");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const columnHelper = createColumnHelper<ResultsTrendRow>();

  return useMemo(() => {
    const count = (
      id: "runs" | "results" | "passed" | "failed" | "skipped" | "other",
      header: string
    ) =>
      columnHelper.accessor(id, {
        id,
        header: () => (
          <span className="inline-flex items-center gap-1.5">
            {id in BUCKET_COLORS ? (
              <ResultsTrendPip color={BUCKET_COLORS[id as ResultBucket]} />
            ) : null}
            {header}
          </span>
        ),
        cell: (info) => (
          <span className="tabular-nums">
            {info.getValue().toLocaleString(locale)}
          </span>
        ),
        enableSorting: true,
        size: 110,
        minSize: 80,
        maxSize: 200,
      }) as ColumnDef<ResultsTrendRow, any>;
    const rate = (id: "passRate" | "failRate", header: string) =>
      columnHelper.accessor(id, {
        id,
        header: () => (
          <span className="inline-flex items-center gap-1.5">
            <ResultsTrendPip color={TREND_COLORS[id]} />
            {header}
          </span>
        ),
        cell: (info) => (
          <span className="tabular-nums">
            {formatRate(info.getValue(), locale)}
          </span>
        ),
        enableSorting: true,
        size: 110,
        minSize: 80,
        maxSize: 200,
      }) as ColumnDef<ResultsTrendRow, any>;

    const projectColumn = includeProject
      ? [
          columnHelper.accessor((row) => row.project?.name ?? "", {
            id: "project",
            header: () => <span>{tCommon("fields.project")}</span>,
            cell: (info) => {
              const project = info.row.original.project;
              if (!project) {
                return (
                  <span className="font-medium">{t("chart.allProjects")}</span>
                );
              }
              return (
                <ProjectNameDisplay
                  projectName={project.name}
                  projectId={project.id}
                  iconUrl={project.iconUrl}
                  showLink
                  fitContainer
                />
              );
            },
            enableSorting: true,
            size: 220,
            minSize: 140,
            maxSize: 400,
          }) as ColumnDef<ResultsTrendRow, any>,
        ]
      : [];
    return [
      ...projectColumn,
      columnHelper.accessor("periodStart", {
        id: "periodStart",
        header: () => <span>{t("period")}</span>,
        cell: (info) => (
          <span className="whitespace-nowrap">
            {periodLongLabel(info.getValue(), grouping, locale)}
            {info.row.original.partial ? (
              <span className="ms-1 text-xs text-muted-foreground">
                {`(${t("inProgress")})`}
              </span>
            ) : null}
          </span>
        ),
        enableSorting: true,
        size: 200,
        minSize: 140,
        maxSize: 300,
      }) as ColumnDef<ResultsTrendRow, any>,
      count("runs", tCommon("fields.testRuns")),
      count("results", tCommon("results")),
      count("passed", tMetrics("passed")),
      count("failed", tMetrics("failed")),
      count("skipped", t("skipped")),
      count("other", t("other")),
      rate("passRate", tCommon("fields.passRate")),
      rate("failRate", t("failRate")),
    ];
  }, [columnHelper, grouping, includeProject, locale, t, tCommon, tMetrics]);
}
