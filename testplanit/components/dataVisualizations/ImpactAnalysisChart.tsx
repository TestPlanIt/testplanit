"use client";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import * as d3 from "d3";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  ListChecks,
  PlayCircle,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import React, { useEffect, useMemo, useRef } from "react";
import useResponsiveSVG from "~/hooks/useResponsiveSVG";
import { IMPACT_TRIGGER_LABEL_KEY } from "~/hooks/useImpactAnalysisColumns";
import type {
  ImpactAnalysisReportRow,
  ImpactTrigger,
} from "~/utils/impactAnalysisReportUtils";

interface ImpactAnalysisChartProps {
  data: ImpactAnalysisReportRow[];
}

const TRIGGERS: ImpactTrigger[] = ["manual", "pull_request", "push"];
const TRIGGER_COLORS: Record<ImpactTrigger, string> = {
  manual: "#6b7280",
  pull_request: "#3b82f6",
  push: "#22c55e",
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** Summary figures the tiles show; exported so tests can pin them. */
export function summarizeImpactAnalyses(data: ImpactAnalysisReportRow[]) {
  const total = data.length;
  const composed = data.filter((row) => row.testRun !== null).length;
  const executedRuns = data.filter(
    (row) => row.outcome === "passed" || row.outcome === "failed"
  ).length;
  const withFailures = data.filter((row) => row.outcome === "failed").length;
  const suggested = data.reduce(
    (sum, row) => sum + row.pinnedCaseCount + row.affectedCaseCount,
    0
  );
  const accepted = data.reduce((sum, row) => sum + row.acceptedCaseCount, 0);
  const pct = (part: number, whole: number) =>
    whole > 0 ? Math.round((part / whole) * 100) : 0;
  return {
    total,
    composed,
    composedPct: pct(composed, total),
    withFailures,
    withFailuresPct: pct(withFailures, executedRuns),
    medianAffected: median(
      data.map((row) => row.pinnedCaseCount + row.affectedCaseCount)
    ),
    acceptedPct: pct(accepted, suggested),
  };
}

export const ImpactAnalysisChart: React.FC<ImpactAnalysisChartProps> = ({
  data,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { width, height } = useResponsiveSVG(containerRef);
  const t = useTranslations("reports.ui.impactAnalysis");
  const tGlobal = useTranslations();
  const tReports = useTranslations("reports.ui");
  const locale = useLocale();

  const summary = useMemo(() => summarizeImpactAnalyses(data), [data]);

  // One bar per ISO week, stacked by trigger.
  const weeks = useMemo(() => {
    const byWeek = new Map<string, Record<ImpactTrigger, number>>();
    for (const row of data) {
      const week = d3.timeMonday.floor(new Date(row.createdAt));
      const key = week.toISOString();
      const bucket = byWeek.get(key) ?? { manual: 0, pull_request: 0, push: 0 };
      bucket[row.trigger] += 1;
      byWeek.set(key, bucket);
    }
    return [...byWeek.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, counts]) => ({ week: new Date(key), ...counts }));
  }, [data]);

  useEffect(() => {
    if (!svgRef.current || width === 0 || height === 0) {
      if (svgRef.current) d3.select(svgRef.current).selectAll("*").remove();
      return;
    }
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    if (weeks.length === 0) return;

    const margin = { top: 24, right: 16, bottom: 36, left: 40 };
    const innerWidth = Math.max(0, width - margin.left - margin.right);
    const innerHeight = Math.max(0, height - margin.top - margin.bottom);
    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3
      .scaleBand<string>()
      .domain(weeks.map((w) => w.week.toISOString()))
      .range([0, innerWidth])
      .padding(0.25);
    const y = d3
      .scaleLinear()
      .domain([
        0,
        d3.max(weeks, (w) => w.manual + w.pull_request + w.push) ?? 1,
      ])
      .nice()
      .range([innerHeight, 0]);
    const stack = d3
      .stack<(typeof weeks)[number], ImpactTrigger>()
      .keys(TRIGGERS);
    const dateFormat = new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
    });

    g.append("g")
      .attr("transform", `translate(0,${innerHeight})`)
      .call(
        d3
          .axisBottom(x)
          .tickFormat((key) => dateFormat.format(new Date(key)))
          .tickValues(
            x.domain().filter((_, i) => i % Math.ceil(weeks.length / 8) === 0)
          )
      )
      .selectAll("text")
      .attr("class", "fill-muted-foreground text-[10px]");
    g.append("g")
      .call(
        d3
          .axisLeft(y)
          .ticks(Math.min(5, y.domain()[1]))
          .tickFormat(d3.format("d"))
      )
      .selectAll("text")
      .attr("class", "fill-muted-foreground text-[10px]");

    const layers = g
      .selectAll("g.layer")
      .data(stack(weeks))
      .join("g")
      .attr("class", "layer")
      .attr("fill", (d) => TRIGGER_COLORS[d.key]);
    // A sparse window would otherwise stretch one week across the chart.
    const barWidth = Math.min(x.bandwidth(), 56);
    const barOffset = (x.bandwidth() - barWidth) / 2;
    layers
      .selectAll("rect")
      .data((d) => d.map((point) => ({ ...point, key: d.key })))
      .join("rect")
      .attr("x", (d) => (x(d.data.week.toISOString()) ?? 0) + barOffset)
      .attr("y", (d) => y(d[1]))
      .attr("height", (d) => Math.max(0, y(d[0]) - y(d[1])))
      .attr("width", barWidth)
      .append("title")
      .text(
        (d) =>
          `${t("chart.week", { date: dateFormat.format(d.data.week) })}\n${tGlobal(IMPACT_TRIGGER_LABEL_KEY[d.key] as any)}: ${d[1] - d[0]}`
      );

    const legend = svg
      .append("g")
      .attr("transform", `translate(${margin.left},8)`);
    TRIGGERS.forEach((trigger, i) => {
      const item = legend
        .append("g")
        .attr("transform", `translate(${i * 120},0)`);
      item
        .append("rect")
        .attr("width", 10)
        .attr("height", 10)
        .attr("rx", 2)
        .attr("fill", TRIGGER_COLORS[trigger]);
      item
        .append("text")
        .attr("x", 14)
        .attr("y", 9)
        .attr("class", "fill-muted-foreground text-[10px]")
        .text(tGlobal(IMPACT_TRIGGER_LABEL_KEY[trigger] as any));
    });
  }, [weeks, width, height, locale, t, tGlobal]);

  if (data.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        {tReports("noDataAvailable")}
      </div>
    );
  }

  const tile = (
    icon: React.ReactNode,
    value: React.ReactNode,
    label: string,
    tooltip?: string,
    className = "bg-muted/50 border"
  ) => (
    <div className={`flex items-center gap-3 rounded-lg p-3 ${className}`}>
      <div className="rounded-md bg-primary/10 p-2">{icon}</div>
      <div>
        <p className="text-2xl font-bold">{value}</p>
        <div className="flex items-center gap-1">
          <p className="text-xs text-muted-foreground">{label}</p>
          {tooltip && (
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="h-3 w-3 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">
                <div className="text-xs">{tooltip}</div>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );
  const withPct = (value: number, pct: number) => (
    <>
      {value}
      <span className="ms-1 text-sm font-normal">
        {"("}
        {pct}
        {"%)"}
      </span>
    </>
  );

  return (
    <div
      className="flex h-full flex-col gap-4"
      data-testid="impact-analysis-chart"
    >
      <div className="grid grid-cols-2 gap-3 px-2 md:grid-cols-5">
        {tile(
          <Activity className="h-4 w-4 text-primary" />,
          summary.total,
          t("stats.analyses")
        )}
        {tile(
          <PlayCircle className="h-4 w-4 text-primary" />,
          withPct(summary.composed, summary.composedPct),
          t("stats.runsComposed"),
          t("stats.runsComposedTooltip")
        )}
        {tile(
          <AlertTriangle className="h-4 w-4 text-destructive" />,
          withPct(summary.withFailures, summary.withFailuresPct),
          t("stats.runsWithFailures"),
          t("stats.runsWithFailuresTooltip"),
          "bg-destructive/5 border border-destructive/20"
        )}
        {tile(
          <ListChecks className="h-4 w-4 text-primary" />,
          summary.medianAffected,
          t("stats.medianAffected"),
          t("stats.medianAffectedTooltip")
        )}
        {tile(
          <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />,
          `${summary.acceptedPct}%`,
          t("stats.acceptedShare"),
          t("stats.acceptedShareTooltip"),
          "bg-green-500/5 border border-green-500/20"
        )}
      </div>
      <div className="px-2 text-sm font-medium">{t("chart.perWeek")}</div>
      <div ref={containerRef} className="min-h-[220px] w-full flex-1">
        <svg ref={svgRef} width={width} height={height} />
      </div>
    </div>
  );
};
