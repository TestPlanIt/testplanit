"use client";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  CheckCircle2,
  HelpCircle,
  ListChecks,
  Minus,
  PlayCircle,
  TrendingDown,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import React, { useMemo } from "react";
import {
  failRateTrend,
  headlineStats,
  rowsForProject,
  type ResultsTrendMeta,
  type ResultsTrendRow,
  type HeadlineStat,
} from "~/utils/resultsTrendShared";
import { ResultsTrendDetailChart } from "./ResultsTrendDetailChart";
import { ResultsTrendHeatmap } from "./ResultsTrendHeatmap";
import {
  formatRate,
  formatSigned,
  periodLongLabel,
} from "./resultsTrendChartUtils";

interface ResultsTrendChartProps {
  data: ResultsTrendRow[];
  meta: ResultsTrendMeta;
}

/**
 * The report's visualization: the failure-rate verdict and its supporting
 * sentence, the last complete period's headline figures, the combined pass /
 * fail rate chart, the per-project heatmap and the per-project detail chart,
 * with the counting rules spelled out at the bottom.
 */
export const ResultsTrendChart: React.FC<ResultsTrendChartProps> = ({
  data,
  meta,
}) => {
  const locale = useLocale();
  const t = useTranslations("reports.ui.resultsTrend");
  const tReports = useTranslations("reports.ui");
  const tCommon = useTranslations("common");
  const grouping = meta.settings.dateGrouping;
  const shownRates =
    (meta.settings.showPassRate ? 1 : 0) + (meta.settings.showFailRate ? 1 : 0);
  const combinedRows = useMemo(() => rowsForProject(data, null), [data]);
  const trend = useMemo(() => failRateTrend(combinedRows), [combinedRows]);
  const stats = useMemo(() => headlineStats(combinedRows), [combinedRows]);
  if (data.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        {tReports("noDataAvailable")}
      </div>
    );
  }

  const verdictIcon =
    trend?.verdict === "better" ? (
      <TrendingDown className="h-6 w-6 text-green-600 dark:text-green-400" />
    ) : trend?.verdict === "worse" ? (
      <TrendingUp className="h-6 w-6 text-red-600 dark:text-red-400" />
    ) : (
      <Minus className="h-6 w-6 text-muted-foreground" />
    );

  const tile = (
    key: string,
    icon: React.ReactNode,
    label: string,
    stat: HeadlineStat,
    kind: "rate" | "volume",
    goodWhenUp: boolean
  ) => {
    const value =
      kind === "rate"
        ? formatRate(stat.current, locale)
        : stat.current === null
          ? "—"
          : stat.current.toLocaleString(locale);
    const delta = stat.delta;
    const isGood = delta !== null && (goodWhenUp ? delta > 0 : delta < 0);
    const isBad = delta !== null && (goodWhenUp ? delta < 0 : delta > 0);
    return (
      <div
        key={key}
        className="flex items-center gap-3 rounded-lg border bg-muted/50 p-3"
        data-testid={`results-trend-stat-${key}`}
      >
        <div className="rounded-md bg-primary/10 p-2">{icon}</div>
        <div className="min-w-0">
          <p className="text-2xl font-bold">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p
            className={`text-xs tabular-nums ${
              isGood
                ? "text-green-600 dark:text-green-400"
                : isBad
                  ? "text-red-600 dark:text-red-400"
                  : "text-muted-foreground"
            }`}
          >
            {delta === null
              ? t("stats.noBaseline")
              : kind === "rate"
                ? t("stats.deltaPoints", {
                    change: formatSigned(delta, locale),
                    count: stat.baselinePeriods,
                  })
                : t("stats.deltaPercent", {
                    change: formatSigned(delta, locale, 0),
                    count: stat.baselinePeriods,
                  })}
          </p>
        </div>
      </div>
    );
  };

  return (
    <div
      className="flex h-full flex-col gap-5"
      data-testid="results-trend-chart"
    >
      {/* Verdict */}
      <div className="flex items-start gap-3 px-2">
        <div className="mt-0.5">{verdictIcon}</div>
        <div>
          <p
            className="text-lg font-semibold"
            data-testid="results-trend-verdict"
          >
            {trend ? t(`verdict.${trend.verdict}`) : t("verdict.notEnough")}
          </p>
          <p className="text-sm text-muted-foreground">
            {trend
              ? t("verdict.detail", {
                  start: formatRate(trend.startRate, locale),
                  end: formatRate(trend.endRate, locale),
                  change: formatSigned(trend.changePoints, locale),
                  count: trend.periodsUsed,
                  grouping,
                })
              : t("verdict.notEnoughDetail")}
          </p>
        </div>
      </div>

      {/* Headline stats: the last complete period against the periods before it */}
      {stats.period && (
        <div className="px-2">
          <p className="mb-2 text-xs text-muted-foreground">
            {t("stats.lastComplete", {
              period: periodLongLabel(stats.period, grouping, locale),
            })}
          </p>
          <div
            className={`grid grid-cols-2 gap-3 ${
              shownRates === 2
                ? "md:grid-cols-4"
                : shownRates === 1
                  ? "md:grid-cols-3"
                  : "md:grid-cols-2"
            }`}
          >
            {meta.settings.showPassRate &&
              tile(
                "passRate",
                <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />,
                tCommon("fields.passRate"),
                stats.passRate,
                "rate",
                true
              )}
            {meta.settings.showFailRate &&
              tile(
                "failRate",
                <XCircle className="h-4 w-4 text-destructive" />,
                t("failRate"),
                stats.failRate,
                "rate",
                false
              )}
            {tile(
              "results",
              <ListChecks className="h-4 w-4 text-primary" />,
              t("stats.results"),
              stats.results,
              "volume",
              true
            )}
            {tile(
              "runs",
              <PlayCircle className="h-4 w-4 text-primary" />,
              t("stats.runs"),
              stats.runs,
              "volume",
              true
            )}
          </div>
        </div>
      )}

      {/* Results by period: the counts behind the rates, all selected projects */}
      <div className="flex flex-col gap-2">
        <div className="px-2 text-sm font-medium">{t("detail.title")}</div>
        <div className="h-[300px]">
          <ResultsTrendDetailChart
            rows={combinedRows}
            grouping={grouping}
            showPassRate={meta.settings.showPassRate}
            showFailRate={meta.settings.showFailRate}
            showCounts={meta.settings.showCounts}
          />
        </div>
      </div>

      {/* Fail rate by project and period */}
      {meta.projects.length > 1 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1 px-2 text-sm font-medium">
            {t("heatmap.title")}
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="h-3 w-3 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs text-xs">
                {t("heatmap.help")}
              </TooltipContent>
            </Tooltip>
          </div>
          <ResultsTrendHeatmap
            rows={data}
            periods={meta.periods}
            grouping={grouping}
            projects={meta.projects}
          />
        </div>
      )}

      {/* Method notes */}
      <div className="px-2 pb-2 text-xs text-muted-foreground">
        <p className="font-medium">{t("method.title")}</p>
        <ul className="list-disc ps-4">
          <li>{t(`method.runSource.${meta.settings.runSource}`)}</li>
          <li>
            {t("method.periods", {
              grouping: meta.settings.dateGrouping,
              timezone: meta.settings.timezone,
            })}
          </li>
          <li>
            {meta.settings.attemptMode === "latest"
              ? t("method.latestAttempt")
              : t("method.everyAttempt")}
          </li>
          <li>
            {meta.settings.countSkipped
              ? t("method.skippedCounted")
              : t("method.skippedExcluded")}
          </li>
          <li>
            {meta.settings.includeAborted
              ? t("method.abortedIncluded")
              : t("method.abortedExcluded")}
          </li>
          <li>{t("method.trend")}</li>
        </ul>
      </div>
    </div>
  );
};
