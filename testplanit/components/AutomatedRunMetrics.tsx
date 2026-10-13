import { CaseDisplay } from "@/components/tables/CaseDisplay";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Zap } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useMemo } from "react";
import {
  computeAutomatedRunMetrics,
  computeConcurrencyMetrics,
  computeRetryMetrics,
  topSlowestResults,
  type AutomatedResultMetricInput,
} from "~/utils/automatedRunMetrics";
import { toHumanReadable } from "~/utils/duration";

export interface AutomatedRunMetricsResult extends AutomatedResultMetricInput {
  /** Repository case id — makes the slowest-tests entry a link. */
  id?: number | string;
  /** JUnitTestResult row id — orders retry attempts. */
  resultId?: number;
  name?: string | null;
  source?: string | null;
  automated?: boolean;
  isDeleted?: boolean;
  hasParameters?: boolean;
  executedAt?: Date | string | null;
  createdAt?: Date | string | null;
}

interface AutomatedRunMetricsProps {
  results: AutomatedRunMetricsResult[];
  projectId?: string | number;
  /** Makes the Flaky Tests tile a filter shortcut when provided. */
  onFlakyClick?: () => void;
  /** Makes the Retries tile a filter shortcut when provided. */
  onRetriesClick?: () => void;
}

function formatTileDuration(seconds: number, locale: string): string {
  return seconds < 10
    ? toHumanReadable(seconds, {
        isSeconds: true,
        locale,
        round: false,
        maxDecimalPoints: 1,
      })
    : toHumanReadable(seconds, { isSeconds: true, locale, largest: 2 });
}

function MetricTile({
  label,
  value,
  hint,
  onClick,
  testId,
}: {
  label: string;
  value: string;
  hint?: string;
  onClick?: () => void;
  testId?: string;
}) {
  const body = (
    <>
      <div className="text-xs text-muted-foreground truncate" title={label}>
        {label}
      </div>
      <div
        className={`text-sm font-semibold truncate${onClick ? " underline decoration-dotted underline-offset-2" : ""}`}
        title={value}
      >
        {value}
      </div>
    </>
  );
  const tile = onClick ? (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className="rounded-md border p-2 min-w-0 w-full text-start hover:bg-accent transition-colors"
    >
      {body}
    </button>
  ) : (
    <div className="rounded-md border p-2 min-w-0" data-testid={testId}>
      {body}
    </div>
  );
  if (!hint) return tile;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{tile}</TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Execution metrics for an automated run: pass rate, the
 * wall-clock window vs the summed per-test time (and the parallelism the two
 * imply), duration percentiles, and the slowest tests.
 */
export function AutomatedRunMetrics({
  results,
  projectId: propProjectId,
  onFlakyClick,
  onRetriesClick,
}: AutomatedRunMetricsProps) {
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const params = useParams();
  const projectId = propProjectId || (params.projectId as string | undefined);

  const metrics = useMemo(() => {
    // Same window semantics as the summary service: a reporter only
    // sometimes sends executedAt, so fall back to the import time.
    let first: number | null = null;
    let last: number | null = null;
    for (const result of results) {
      const at = result.executedAt ?? result.createdAt;
      if (!at) continue;
      const ms = new Date(at).getTime();
      if (Number.isNaN(ms)) continue;
      if (first === null || ms < first) first = ms;
      if (last === null || ms > last) last = ms;
    }
    return computeAutomatedRunMetrics({
      results,
      firstResultAt: first !== null ? new Date(first) : null,
      lastResultAt: last !== null ? new Date(last) : null,
    });
  }, [results]);

  const slowestResults = useMemo(
    () => topSlowestResults(results, 5),
    [results]
  );

  const retryMetrics = useMemo(() => computeRetryMetrics(results), [results]);

  const concurrency = useMemo(
    () => computeConcurrencyMetrics(results),
    [results]
  );

  if (results.length === 0) return null;

  const tiles: Array<{
    label: string;
    value: string;
    hint?: string;
    onClick?: () => void;
    testId?: string;
  }> = [];

  if (metrics.passRate !== null) {
    tiles.push({
      label: tCommon("fields.passRate"),
      value: `${metrics.passRate.toFixed(0)}%`,
      hint: tCommon("labels.passRateHint", {
        passed: metrics.passedCount,
        total: metrics.totalCount,
      }),
    });
  }
  if (concurrency !== null) {
    // Peak concurrent tests — the run's effective worker count — with the
    // time-weighted average in the hint.
    tiles.push({
      label: tCommon("fields.parallelization"),
      value: `${concurrency.peak.toLocaleString(locale)}×`,
      hint: tCommon("labels.parallelizationPeakHint", {
        peak: concurrency.peak,
        average: concurrency.average.toLocaleString(locale, {
          maximumFractionDigits: 1,
        }),
      }),
    });
  } else if (metrics.parallelism !== null) {
    tiles.push({
      label: tCommon("fields.parallelization"),
      value: `${metrics.parallelism.toLocaleString(locale, {
        maximumFractionDigits: 1,
      })}×`,
      hint: tCommon("labels.parallelizationHint"),
    });
  }
  if (metrics.wallClockSeconds !== null && metrics.wallClockSeconds >= 1) {
    tiles.push({
      label: tCommon("fields.runDuration"),
      value: formatTileDuration(metrics.wallClockSeconds, locale),
      hint: tCommon("labels.runDurationHint"),
    });
  }
  if (metrics.totalTime > 0) {
    tiles.push({
      label: tCommon("fields.totalElapsed"),
      value: formatTileDuration(metrics.totalTime, locale),
      hint: tCommon("labels.totalElapsedHint"),
    });
  }
  if (metrics.avgTime !== null) {
    tiles.push({
      label: tCommon("fields.avgTestTime"),
      value: formatTileDuration(metrics.avgTime, locale),
    });
  }
  if (metrics.medianTime !== null) {
    tiles.push({
      label: tCommon("fields.medianTestTime"),
      value: formatTileDuration(metrics.medianTime, locale),
    });
  }
  if (retryMetrics.retriesCount > 0) {
    tiles.push({
      label: tCommon("fields.retries"),
      value: retryMetrics.retriesCount.toLocaleString(locale),
      hint: tCommon("labels.retriesHint"),
      onClick: onRetriesClick,
      testId: "metric-tile-retries",
    });
    tiles.push({
      label: tCommon("fields.flakyTests"),
      value: retryMetrics.flakyCaseCount.toLocaleString(locale),
      hint: tCommon("labels.flakyTestHint"),
      onClick: retryMetrics.flakyCaseCount > 0 ? onFlakyClick : undefined,
      testId: "metric-tile-flaky",
    });
  }

  if (tiles.length === 0 && slowestResults.length === 0) return null;

  return (
    <Card shadow="none" data-testid="automated-run-metrics">
      <CardHeader className="p-2">
        <CardTitle className="text-base font-medium">
          {tCommon("labels.executionMetrics")}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-2 pt-0 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {tiles.map((tile) => (
            <MetricTile key={tile.label} {...tile} />
          ))}
        </div>
        {slowestResults.length > 0 && (
          <div>
            <div className="text-xs text-muted-foreground mb-1">
              {tCommon("labels.slowestTests")}
            </div>
            <ul className="space-y-1">
              {slowestResults.map((result, index) => (
                <li
                  key={`${result.id ?? result.name ?? "case"}-${index}`}
                  className="flex items-center justify-between gap-2 text-xs"
                >
                  <div
                    className="min-w-0 flex-1"
                    title={result.name ?? undefined}
                  >
                    <CaseDisplay
                      testCase={{
                        id: result.id,
                        name: result.name ?? undefined,
                        source: result.source ?? undefined,
                        automated: result.automated,
                        isDeleted: result.isDeleted,
                        hasParameters: result.hasParameters,
                      }}
                      projectId={projectId}
                      size="small"
                      className="truncate"
                    />
                  </div>
                  {result.id !== undefined &&
                    retryMetrics.flakyCaseIds.has(result.id) && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Zap
                            className="h-3 w-3 shrink-0 text-amber-500"
                            aria-label={tCommon("labels.flakyTestHint")}
                          />
                        </TooltipTrigger>
                        <TooltipContent>
                          {tCommon("labels.flakyTestHint")}
                        </TooltipContent>
                      </Tooltip>
                    )}
                  <span className="shrink-0 text-muted-foreground">
                    {formatTileDuration(result.time as number, locale)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default AutomatedRunMetrics;
