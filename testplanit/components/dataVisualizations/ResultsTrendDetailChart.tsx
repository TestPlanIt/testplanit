"use client";
import * as d3 from "d3";
import { useLocale, useTranslations } from "next-intl";
import React, { useEffect, useRef, useState } from "react";
import useResponsiveSVG from "~/hooks/useResponsiveSVG";
import { ResultsTrendPip } from "./ResultsTrendPip";
import type { DateGrouping } from "~/lib/reports/dateGrouping";
import {
  rateFit,
  type ResultBucket,
  type ResultsTrendRow,
} from "~/utils/resultsTrendShared";
import {
  BUCKET_ORDER,
  TREND_COLORS,
  formatRate,
  periodLabel,
  periodLongLabel,
  type TrendTooltip,
} from "./resultsTrendChartUtils";

interface ResultsTrendDetailChartProps {
  /** One project's rows (or the combined rows), oldest period first. */
  rows: ResultsTrendRow[];
  grouping: DateGrouping;
  /** Which rates to draw on the right-hand axis, each with its trend. */
  showPassRate: boolean;
  showFailRate: boolean;
  /** Draw the stacked result totals; off, the rates stand alone. */
  showCounts: boolean;
}

/** A legend swatch wide enough to tell a dashed trend from a solid rate. */
const LegendLine: React.FC<{ color: string; dashed?: boolean }> = ({
  color,
  dashed = false,
}) => (
  <svg width="22" height="6" aria-hidden="true" className="shrink-0">
    <line
      x1="0"
      y1="3"
      x2="22"
      y2="3"
      stroke={color}
      strokeWidth="2"
      strokeDasharray={dashed ? "5 3" : undefined}
      strokeOpacity={dashed ? 0.45 : 1}
    />
  </svg>
);

/**
 * A combo chart: passed, failed, skipped and other counts per period as
 * stacked bars on the left axis, and the shown rates as lines on a
 * right-hand 0–100% axis, each with its fitted trend as a dashed line.
 */
export const ResultsTrendDetailChart: React.FC<
  ResultsTrendDetailChartProps
> = ({ rows, grouping, showPassRate, showFailRate, showCounts }) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { width, height } = useResponsiveSVG(containerRef);
  const locale = useLocale();
  const t = useTranslations("reports.ui.resultsTrend");
  const tMetrics = useTranslations("reports.metrics");
  const tCommon = useTranslations("common");
  const [tooltip, setTooltip] = useState<TrendTooltip | null>(null);

  const bucketLabel: Record<ResultBucket, string> = {
    passed: tMetrics("passed"),
    failed: tMetrics("failed"),
    skipped: t("skipped"),
    other: t("other"),
  };

  useEffect(() => {
    if (!svgRef.current || width === 0 || height === 0) {
      if (svgRef.current) d3.select(svgRef.current).selectAll("*").remove();
      return;
    }
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    if (rows.length === 0) return;

    const rateKeys = (["passRate", "failRate"] as const).filter((key) =>
      key === "passRate" ? showPassRate : showFailRate
    );
    // Counts own the left axis; the rates take the right one beside them,
    // or the left one when the counts are hidden.
    const ratesOnRight = showCounts && rateKeys.length > 0;
    const margin = {
      top: 12,
      right: ratesOnRight ? 44 : 16,
      bottom: 28,
      left: 44,
    };
    const innerWidth = Math.max(0, width - margin.left - margin.right);
    const innerHeight = Math.max(0, height - margin.top - margin.bottom);
    const barHeight = innerHeight;

    const keys = rows.map((row) => row.periodStart);
    const x = d3
      .scaleBand<string>()
      .domain(keys)
      .range([0, innerWidth])
      .padding(0.3);
    const yCount = d3
      .scaleLinear()
      .domain([0, d3.max(rows, (row) => row.results) || 1])
      .nice()
      .range([barHeight, 0]);

    const root = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const partial = rows.find((row) => row.partial);
    if (partial) {
      root
        .append("rect")
        .attr(
          "x",
          (x(partial.periodStart) ?? 0) - (x.step() - x.bandwidth()) / 2
        )
        .attr("y", 0)
        .attr("width", x.step())
        .attr("height", innerHeight)
        .attr("fill", "currentColor")
        .attr("class", "text-muted-foreground")
        .attr("fill-opacity", 0.08);
    }

    // Stacked counts.
    if (showCounts) {
      const bars = root.append("g");
      bars
        .append("g")
        .call(
          d3
            .axisLeft(yCount)
            .ticks(4)
            .tickFormat((d) => d3.format("~s")(d as number))
        )
        .call((g) => g.select(".domain").remove())
        .call((g) => g.selectAll("line").remove())
        .selectAll("text")
        .attr("class", "fill-muted-foreground text-[10px]");
      const stack = d3
        .stack<ResultsTrendRow, ResultBucket>()
        .keys(BUCKET_ORDER)
        .value((row, key) => row[key]);
      const barWidth = Math.min(x.bandwidth(), 40);
      const barOffset = (x.bandwidth() - barWidth) / 2;
      bars
        .selectAll("g.layer")
        .data(stack(rows))
        .join("g")
        .attr("class", "layer")
        .attr("fill", (layer) => TREND_COLORS[layer.key])
        .selectAll("rect")
        .data((layer) => layer)
        .join("rect")
        .attr("x", (d) => (x(d.data.periodStart) ?? 0) + barOffset)
        .attr("y", (d) => yCount(d[1]))
        .attr("height", (d) => Math.max(0, yCount(d[0]) - yCount(d[1]) - 1))
        .attr("width", barWidth);
    }

    // Rates over the bars: each shown rate's line joins the periods that
    // have a rate, and its dashed line is the fitted trend over the
    // complete ones.
    if (rateKeys.length > 0) {
      const yRate = d3.scaleLinear().domain([0, 100]).range([barHeight, 0]);
      const rateAxis = ratesOnRight ? d3.axisRight(yRate) : d3.axisLeft(yRate);
      root
        .append("g")
        .attr("transform", `translate(${ratesOnRight ? innerWidth : 0},0)`)
        .call(
          rateAxis.tickValues([0, 25, 50, 75, 100]).tickFormat((d) => `${d}%`)
        )
        .call((g) => g.select(".domain").remove())
        .call((g) => g.selectAll("line").remove())
        .selectAll("text")
        .attr("class", "fill-muted-foreground text-[10px]");
      const center = (row: ResultsTrendRow) =>
        (x(row.periodStart) ?? 0) + x.bandwidth() / 2;
      const clamp = (v: number) => Math.max(0, Math.min(100, v));
      rateKeys.forEach((key) => {
        const rated = rows.filter((row) => row[key] !== null);
        root
          .append("path")
          .datum(rated)
          .attr("fill", "none")
          .attr("stroke", TREND_COLORS[key])
          .attr("stroke-width", 2)
          .attr("stroke-linejoin", "round")
          .attr(
            "d",
            d3
              .line<ResultsTrendRow>()
              .x(center)
              .y((row) => yRate(row[key] as number))
          );
        const fit = rateFit(rows, key);
        const fitted = rated.filter((row) => !row.partial);
        if (fit && fitted.length >= 2) {
          root
            .append("line")
            .attr("x1", center(fitted[0]))
            .attr("y1", yRate(clamp(fit.start)))
            .attr("x2", center(fitted[fitted.length - 1]))
            .attr("y2", yRate(clamp(fit.end)))
            .attr("stroke", TREND_COLORS[key])
            .attr("stroke-width", 2)
            .attr("stroke-dasharray", "6 4")
            .attr("stroke-opacity", 0.45);
        }
        root
          .selectAll(`circle.${key}`)
          .data(rated)
          .join("circle")
          .attr("class", key)
          .attr("cx", center)
          .attr("cy", (row) => yRate(row[key] as number))
          .attr("r", 3.5)
          .attr("fill", TREND_COLORS[key])
          .attr("stroke", "var(--background)")
          .attr("stroke-width", 2);
      });
    }

    const every = Math.ceil(
      keys.length / Math.max(1, Math.floor(innerWidth / 64))
    );
    root
      .append("g")
      .attr("transform", `translate(0,${innerHeight})`)
      .call(
        d3
          .axisBottom(x)
          .tickValues(keys.filter((_, i) => i % every === 0))
          .tickFormat((key) => periodLabel(key, grouping, locale))
      )
      .call((g) =>
        g
          .select(".domain")
          .attr("stroke", "currentColor")
          .attr("stroke-opacity", 0.2)
      )
      .call((g) => g.selectAll("line").remove())
      .selectAll("text")
      .attr("class", "fill-muted-foreground text-[10px]");

    root
      .selectAll("rect.hit")
      .data(rows)
      .join("rect")
      .attr("class", "hit")
      .attr(
        "x",
        (row) => (x(row.periodStart) ?? 0) - (x.step() - x.bandwidth()) / 2
      )
      .attr("y", 0)
      .attr("width", x.step())
      .attr("height", innerHeight)
      .attr("fill", "transparent")
      .on("mousemove", (event: MouseEvent, row) => {
        const bounds = containerRef.current?.getBoundingClientRect();
        setTooltip({
          x: event.clientX - (bounds?.left ?? 0),
          y: event.clientY - (bounds?.top ?? 0),
          title: row.partial
            ? t("chart.partialPeriod", {
                grouping,
                period: periodLongLabel(row.periodStart, grouping, locale),
              })
            : t("chart.period", {
                grouping,
                date: periodLongLabel(row.periodStart, grouping, locale),
              }),
          lines: [
            ...(showCounts
              ? BUCKET_ORDER.map((bucket) => ({
                  label: bucketLabel[bucket],
                  value: row[bucket].toLocaleString(locale),
                  color: TREND_COLORS[bucket],
                }))
              : []),
            ...(showPassRate
              ? [
                  {
                    label: tCommon("fields.passRate"),
                    value: formatRate(row.passRate, locale),
                    color: TREND_COLORS.passRate,
                  },
                ]
              : []),
            ...(showFailRate
              ? [
                  {
                    label: t("failRate"),
                    value: formatRate(row.failRate, locale),
                    color: TREND_COLORS.failRate,
                  },
                ]
              : []),
            {
              label: tCommon("results"),
              value: row.results.toLocaleString(locale),
            },
            {
              label: tCommon("fields.testRuns"),
              value: row.runs.toLocaleString(locale),
            },
          ],
        });
      })
      .on("mouseleave", () => setTooltip(null));
    // bucketLabel is rebuilt from the translators each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    rows,
    grouping,
    showPassRate,
    showFailRate,
    showCounts,
    width,
    height,
    locale,
    t,
    tMetrics,
    tCommon,
  ]);

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3 px-2 text-xs text-muted-foreground">
        {(showCounts ? BUCKET_ORDER : []).map((bucket) => (
          <span key={bucket} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: TREND_COLORS[bucket] }}
            />
            {bucketLabel[bucket]}
          </span>
        ))}
        {(["passRate", "failRate"] as const)
          .filter((key) => (key === "passRate" ? showPassRate : showFailRate))
          .map((key) => {
            const label =
              key === "passRate" ? tCommon("fields.passRate") : t("failRate");
            return (
              <React.Fragment key={key}>
                <span className="flex items-center gap-1.5">
                  <LegendLine color={TREND_COLORS[key]} />
                  {label}
                </span>
                <span className="flex items-center gap-1.5">
                  <LegendLine color={TREND_COLORS[key]} dashed />
                  {t("chart.rateTrend", { rate: label })}
                </span>
              </React.Fragment>
            );
          })}
      </div>
      <div
        ref={containerRef}
        className="relative min-h-[240px] w-full flex-1"
        data-testid="results-trend-detail-chart"
      >
        <svg ref={svgRef} width={width} height={height} />
        {tooltip && (
          <div
            className="pointer-events-none absolute z-20 rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
            style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}
          >
            <div className="font-medium">{tooltip.title}</div>
            {tooltip.lines.map((line) => (
              <div
                key={line.label}
                className="flex items-center gap-1.5 text-muted-foreground"
              >
                {line.color ? <ResultsTrendPip color={line.color} /> : null}
                <span>
                  {line.label}: {line.value}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
