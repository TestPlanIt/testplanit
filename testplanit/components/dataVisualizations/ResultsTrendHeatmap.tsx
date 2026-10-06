"use client";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ProjectNameDisplay } from "@/components/search/ProjectNameDisplay";
import { TrendingDown, TrendingUp } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import React, { useMemo } from "react";
import type { DateGrouping } from "~/lib/reports/dateGrouping";
import {
  failRateTrend,
  rowsForProject,
  type ResultsTrendRow,
  type TrendProject,
  type TrendPeriod,
} from "~/utils/resultsTrendShared";
import {
  formatRate,
  formatSigned,
  periodLabel,
  periodLongLabel,
  TREND_COLORS,
} from "./resultsTrendChartUtils";
import { ResultsTrendPip } from "./ResultsTrendPip";

interface ResultsTrendHeatmapProps {
  rows: ResultsTrendRow[];
  periods: TrendPeriod[];
  grouping: DateGrouping;
  /** Already ranked by total results, most first. */
  projects: TrendProject[];
}

/** Fail rate at which a cell reaches full shading. */
export const HEATMAP_FULL_INTENSITY_RATE = 35;

/** Cell shading: 0 at no failures, 1 at HEATMAP_FULL_INTENSITY_RATE and above. */
export function heatmapIntensity(failRate: number | null): number {
  if (failRate === null) return 0;
  return Math.min(1, Math.max(0, failRate / HEATMAP_FULL_INTENSITY_RATE));
}

/**
 * One row per project and one column per period, each cell shaded by its fail
 * rate; the row ends with the project's trend change and total results.
 */
export const ResultsTrendHeatmap: React.FC<ResultsTrendHeatmapProps> = ({
  rows,
  periods,
  grouping,
  projects,
}) => {
  const locale = useLocale();
  const t = useTranslations("reports.ui.resultsTrend");
  const tMetrics = useTranslations("reports.metrics");
  const tCommon = useTranslations("common");

  const byProject = useMemo(() => {
    const map = new Map<
      number,
      {
        cells: Map<string, ResultsTrendRow>;
        total: number;
        trend: ReturnType<typeof failRateTrend>;
      }
    >();
    for (const project of projects) {
      const projectRows = rowsForProject(rows, project.id);
      map.set(project.id, {
        cells: new Map(projectRows.map((row) => [row.periodStart, row])),
        total: projectRows.reduce((sum, row) => sum + row.results, 0),
        trend: failRateTrend(projectRows),
      });
    }
    return map;
  }, [rows, projects]);

  // A project with runs but no results in the window has nothing to shade;
  // it stays in the table and the detail selector.
  const shown = projects.filter(
    (project) => (byProject.get(project.id)?.total ?? 0) > 0
  );
  if (shown.length === 0) return null;

  return (
    <div className="overflow-x-auto" data-testid="results-trend-heatmap">
      <table className="w-full border-separate border-spacing-0.5 text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 bg-background px-2 py-1 text-start font-medium text-muted-foreground">
              {tCommon("fields.project")}
            </th>
            {periods.map((period) => (
              <th
                key={period.periodStart}
                className="px-1 py-1 text-center font-normal text-muted-foreground whitespace-nowrap"
                title={
                  period.partial
                    ? t("chart.partialPeriod", {
                        grouping,
                        period: periodLongLabel(
                          period.periodStart,
                          grouping,
                          locale
                        ),
                      })
                    : periodLongLabel(period.periodStart, grouping, locale)
                }
              >
                {periodLabel(period.periodStart, grouping, locale)}
                {period.partial ? "*" : ""}
              </th>
            ))}
            <th className="px-2 py-1 text-end font-medium text-muted-foreground whitespace-nowrap">
              {t("heatmap.trend")}
            </th>
            <th className="px-2 py-1 text-end font-medium text-muted-foreground whitespace-nowrap">
              {tCommon("results")}
            </th>
          </tr>
        </thead>
        <tbody>
          {shown.map((project) => {
            const data = byProject.get(project.id)!;
            return (
              <tr
                key={project.id}
                data-testid={`results-trend-heatmap-row-${project.id}`}
              >
                <td className="sticky left-0 bg-background px-2 py-1 font-medium whitespace-nowrap">
                  <ProjectNameDisplay
                    projectName={project.name}
                    projectId={project.id}
                    iconUrl={project.iconUrl}
                  />
                </td>
                {periods.map((period) => {
                  const cell = data.cells.get(period.periodStart);
                  const rate = cell?.failRate ?? null;
                  const intensity = heatmapIntensity(rate);
                  return (
                    <td key={period.periodStart} className="p-0">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div
                            className="flex h-7 min-w-[2.75rem] items-center justify-center rounded-sm tabular-nums"
                            style={{
                              backgroundColor: `rgba(239, 68, 68, ${
                                rate === null ? 0 : 0.08 + intensity * 0.8
                              })`,
                              color:
                                intensity > 0.55 ? "#fff" : "var(--foreground)",
                              opacity: period.partial ? 0.7 : 1,
                            }}
                          >
                            {rate === null ? (
                              <span className="text-muted-foreground">
                                {"\u2014"}
                              </span>
                            ) : (
                              formatRate(rate, locale, 0)
                            )}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-xs">
                          <div className="font-medium">
                            {project.name}
                            {" \u00b7 "}
                            {periodLongLabel(
                              period.periodStart,
                              grouping,
                              locale
                            )}
                            {period.partial ? ` (${t("inProgress")})` : ""}
                          </div>
                          {cell ? (
                            <div className="opacity-90">
                              {(
                                [
                                  ["passed", tMetrics("passed")],
                                  ["failed", tMetrics("failed")],
                                  ["skipped", t("skipped")],
                                  ["other", t("other")],
                                ] as const
                              ).map(([bucket, label]) => (
                                <div
                                  key={bucket}
                                  className="flex items-center gap-1.5"
                                >
                                  <ResultsTrendPip
                                    color={TREND_COLORS[bucket]}
                                  />
                                  <span>
                                    {label}:{" "}
                                    {cell[bucket].toLocaleString(locale)}
                                  </span>
                                </div>
                              ))}
                              <div>
                                {tCommon("fields.testRuns")}:{" "}
                                {cell.runs.toLocaleString(locale)}
                                {" · "}
                                {tCommon("fields.passRate")}:{" "}
                                {formatRate(cell.passRate, locale)}
                              </div>
                            </div>
                          ) : null}
                        </TooltipContent>
                      </Tooltip>
                    </td>
                  );
                })}
                <td className="px-2 py-1 text-end tabular-nums whitespace-nowrap">
                  {data.trend ? (
                    <span
                      className={`inline-flex items-center gap-1 ${
                        data.trend.verdict === "better"
                          ? "text-green-600 dark:text-green-400"
                          : data.trend.verdict === "worse"
                            ? "text-red-600 dark:text-red-400"
                            : "text-muted-foreground"
                      }`}
                      title={t(`verdict.${data.trend.verdict}`)}
                    >
                      {data.trend.verdict === "better" ? (
                        <TrendingDown className="h-3 w-3" />
                      ) : data.trend.verdict === "worse" ? (
                        <TrendingUp className="h-3 w-3" />
                      ) : null}
                      {t("trend.points", {
                        change: formatSigned(data.trend.changePoints, locale),
                      })}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">{"\u2014"}</span>
                  )}
                </td>
                <td className="px-2 py-1 text-end tabular-nums">
                  {data.total.toLocaleString(locale)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
