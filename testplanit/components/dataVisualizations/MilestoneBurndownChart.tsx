"use client";

import * as d3 from "d3";
import { useTranslations } from "next-intl";
import React, { useEffect, useRef } from "react";
import useResponsiveSVG from "~/hooks/useResponsiveSVG";
import type { MilestoneBurndownData } from "~/lib/services/milestoneBurndown";

interface MilestoneBurndownChartProps {
  data: MilestoneBurndownData;
}

const COLORS = {
  actual: "#2563eb", // blue-600 — remaining work
  ideal: "#9ca3af", // gray-400 — ideal guideline
  today: "#d97706", // amber-600 — today marker
};

// Variance heat strip (schedule health per day): how far actual remaining sits
// from the ideal that day, as a signed fraction of the ideal. Ahead → blue/
// purple, on the line → green, warming through yellow to red as it falls
// behind; days not yet reached stay neutral.
const HEAT = {
  ahead: "#9333ea", // purple-600 — comfortably ahead of ideal
  aheadMid: "#3b82f6", // blue-500 — running ahead
  onTrack: "#16a34a", // green-600 — on the ideal line
  mid: "#eab308", // yellow-500 — slipping behind
  behind: "#dc2626", // red-600 — behind ideal
  future: "#e5e7eb", // gray-200 — day not reached yet
};
const STRIP_H = 12;

const parseDay = (day: string) => new Date(`${day}T00:00:00.000Z`);

/**
 * Milestone/sprint burndown (fast-follow READY, D4). Plots the actual
 * remaining-work line from `useMilestoneBurndown` against an ideal guideline
 * (drawn only when the milestone has a target end date) and a "today" marker.
 *
 * A dumb d3 renderer over the server-computed series — all bucketing and window
 * logic lives in `lib/services/milestoneBurndown.ts`. Follows the
 * `CompletedRunsLineChart` conventions (responsive SVG, body-mounted tooltip,
 * animated path draw).
 */
const MilestoneBurndownChart: React.FC<MilestoneBurndownChartProps> = ({
  data,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { width, height } = useResponsiveSVG(containerRef);
  const t = useTranslations("milestones.burndown");

  // Tooltip DIV mounted on document.body so it escapes any overflow clipping.
  useEffect(() => {
    const el = document.createElement("div");
    el.style.position = "fixed";
    el.style.display = "none";
    el.style.backgroundColor = "rgba(0,0,0,0.75)";
    el.style.color = "white";
    el.style.padding = "5px 10px";
    el.style.borderRadius = "4px";
    el.style.fontSize = "11px";
    el.style.pointerEvents = "none";
    el.style.zIndex = "2000";
    document.body.appendChild(el);
    tooltipRef.current = el;
    return () => {
      if (
        tooltipRef.current &&
        tooltipRef.current.parentNode === document.body
      ) {
        document.body.removeChild(tooltipRef.current);
      }
      tooltipRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (
      !svgRef.current ||
      !data ||
      data.actual.length === 0 ||
      !data.start ||
      width === 0 ||
      height === 0
    ) {
      if (svgRef.current) d3.select(svgRef.current).selectAll("*").remove();
      return;
    }

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    // The variance heat strip only renders when there's a target to compare
    // against; reserve room beneath the x-axis labels for it in that case.
    const hasHeat = data.hasTarget;
    const margin = { top: 24, right: 20, bottom: hasHeat ? 50 : 32, left: 44 };
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;
    if (chartWidth <= 0 || chartHeight <= 0) return;

    const actual = data.actual.map((p) => ({
      date: parseDay(p.date),
      remaining: p.remaining,
    }));
    const startDate = parseDay(data.start);
    const targetDate = data.end ? parseDay(data.end) : null;
    // The x-axis spans to the target end when there is one, else to the last
    // actual point.
    const lastActual = actual[actual.length - 1].date;
    const domainEnd =
      targetDate && targetDate.getTime() > lastActual.getTime()
        ? targetDate
        : lastActual;

    const xScale = d3
      .scaleTime()
      .domain([startDate, domainEnd])
      .range([0, chartWidth]);

    const yMax = Math.max(
      data.total,
      d3.max(actual, (d) => d.remaining) ?? 0,
      1
    );
    const yScale = d3
      .scaleLinear()
      .domain([0, yMax])
      .range([chartHeight, 0])
      .nice();

    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left}, ${margin.top})`);

    // --- Axes ---
    const tickCount = Math.min(6, actual.length);
    const xAxis = d3
      .axisBottom(xScale)
      .ticks(tickCount)
      .tickFormat((d) => d3.timeFormat("%b %d")(d as Date))
      .tickSizeOuter(0);
    const yAxis = d3.axisLeft(yScale).ticks(Math.min(5, yMax));

    g.append("g")
      .attr("transform", `translate(0, ${chartHeight})`)
      .call(xAxis)
      .call((s) => s.select(".domain").attr("stroke-opacity", 0.2))
      .selectAll("text")
      .style("font-size", "10px")
      .style("fill", "currentColor")
      .style("opacity", 0.7);

    g.append("g")
      .call(yAxis)
      .call((s) => s.select(".domain").remove())
      .call((s) =>
        s
          .selectAll(".tick line")
          .clone()
          .attr("x2", chartWidth)
          .attr("stroke-opacity", 0.1)
      )
      .selectAll("text")
      .style("font-size", "10px")
      .style("fill", "currentColor")
      .style("opacity", 0.7);

    // --- Ideal guideline: remaining-at-start → 0 at the target end ---
    if (data.hasTarget && targetDate) {
      const idealPoints: [Date, number][] = [
        [startDate, actual[0].remaining],
        [targetDate, 0],
      ];
      const idealLine = d3
        .line<[Date, number]>()
        .x((d) => xScale(d[0]))
        .y((d) => yScale(d[1]));
      g.append("path")
        .datum(idealPoints)
        .attr("fill", "none")
        .attr("stroke", COLORS.ideal)
        .attr("stroke-width", 1.5)
        .attr("stroke-dasharray", "4 4")
        .attr("opacity", 0.8)
        .attr("d", idealLine);
    }

    // --- Today marker ---
    const now = new Date();
    if (
      now.getTime() >= startDate.getTime() &&
      now.getTime() <= domainEnd.getTime()
    ) {
      const x = xScale(now);
      g.append("line")
        .attr("x1", x)
        .attr("x2", x)
        .attr("y1", 0)
        .attr("y2", chartHeight)
        .attr("stroke", COLORS.today)
        .attr("stroke-width", 1)
        .attr("stroke-dasharray", "2 3")
        .attr("opacity", 0.7);
      g.append("text")
        .attr("x", x)
        .attr("y", -8)
        .attr("text-anchor", "middle")
        .style("font-size", "9px")
        .style("fill", COLORS.today)
        .text(t("today"));
    }

    // --- Variance heat strip (beneath the x-axis): per-day schedule health,
    //     colored by how far actual sits from that day's ideal, as a signed
    //     fraction of the ideal. Ahead → blue/purple, on the line → green,
    //     warming to red when behind; days not yet reached stay neutral. Only
    //     meaningful against a target. ---
    if (hasHeat && targetDate) {
      const idealStart = actual[0].remaining;
      const spanMs = targetDate.getTime() - startDate.getTime();
      const nowMs = now.getTime();
      const stripY = chartHeight + 22;
      const heatScale = d3
        .scaleLinear<string>()
        .domain([-0.5, -0.25, 0, 0.25, 0.5])
        .range([HEAT.ahead, HEAT.aheadMid, HEAT.onTrack, HEAT.mid, HEAT.behind])
        .clamp(true);
      const idealAt = (dMs: number) => {
        const progress = spanMs > 0 ? (dMs - startDate.getTime()) / spanMs : 1;
        return Math.max(0, idealStart * (1 - progress));
      };
      const cellFill = (remaining: number, dMs: number) => {
        if (dMs > nowMs) return HEAT.future; // day not reached yet
        const ideal = idealAt(dMs);
        const variance = remaining - ideal; // > 0 behind, < 0 ahead
        // Signed fraction of that day's ideal. Near the finish (ideal ≈ 0) the
        // fraction blows up, so fall back to the sign alone — a still-open
        // milestone reads behind, an already-cleared one reads ahead.
        const ratio = ideal > 1 ? variance / ideal : Math.sign(variance) * 0.5;
        return heatScale(ratio);
      };
      const heatG = g.append("g");
      actual.forEach((pt, i) => {
        const x0 = xScale(pt.date);
        const x1 =
          i < actual.length - 1 ? xScale(actual[i + 1].date) : chartWidth;
        const dMs = pt.date.getTime();
        heatG
          .append("rect")
          .attr("x", x0)
          .attr("y", stripY)
          .attr("width", Math.max(1, x1 - x0))
          .attr("height", STRIP_H)
          .attr("fill", cellFill(pt.remaining, dMs))
          .style("cursor", "pointer")
          .on("mouseover", function () {
            if (!tooltipRef.current) return;
            tooltipRef.current.style.display = "block";
            const label = d3.timeFormat("%B %d, %Y")(pt.date);
            const variance = Math.round(pt.remaining - idealAt(dMs));
            const status =
              dMs > nowMs
                ? null
                : variance > 0
                  ? t("tooltipBehind", { count: variance })
                  : variance < 0
                    ? t("tooltipAhead", { count: -variance })
                    : t("heatOnTrack");
            tooltipRef.current.innerHTML = `<strong>${label}</strong>${
              status ? `<br/>${status}` : ""
            }`;
          })
          .on("mousemove", function (event) {
            if (tooltipRef.current) {
              tooltipRef.current.style.left = `${event.clientX + 15}px`;
              tooltipRef.current.style.top = `${event.clientY - 10}px`;
            }
          })
          .on("mouseout", function () {
            if (tooltipRef.current) tooltipRef.current.style.display = "none";
          });
      });
    }

    // --- Actual remaining line (step-after: flat until an execution drops it) ---
    const actualLine = d3
      .line<{ date: Date; remaining: number }>()
      .x((d) => xScale(d.date))
      .y((d) => yScale(d.remaining))
      .curve(d3.curveStepAfter);
    const linePath = g
      .append("path")
      .datum(actual)
      .attr("fill", "none")
      .attr("stroke", COLORS.actual)
      .attr("stroke-width", 2)
      .attr("d", actualLine);
    const totalLength = linePath.node()?.getTotalLength?.() || 0;
    linePath
      .attr("stroke-dasharray", totalLength)
      .attr("stroke-dashoffset", totalLength)
      .transition()
      .duration(800)
      .ease(d3.easeCubic)
      .attr("stroke-dashoffset", 0);

    // --- Dots + tooltip on each daily point ---
    g.selectAll(".burndown-dot")
      .data(actual)
      .enter()
      .append("circle")
      .attr("class", "burndown-dot")
      .attr("cx", (d) => xScale(d.date))
      .attr("cy", (d) => yScale(d.remaining))
      .attr("r", 2.5)
      .attr("fill", COLORS.actual)
      .attr("stroke", "white")
      .attr("stroke-width", 1)
      .style("cursor", "pointer")
      .on("mouseover", function (_event, d) {
        d3.select(this).attr("r", 4.5);
        if (tooltipRef.current) {
          tooltipRef.current.style.display = "block";
          const label = d3.timeFormat("%B %d, %Y")(d.date);
          tooltipRef.current.innerHTML = `<strong>${label}</strong><br/>${t(
            "tooltipRemaining",
            { count: d.remaining }
          )}`;
        }
      })
      .on("mousemove", function (event) {
        if (tooltipRef.current) {
          tooltipRef.current.style.left = `${event.clientX + 15}px`;
          tooltipRef.current.style.top = `${event.clientY - 10}px`;
        }
      })
      .on("mouseout", function () {
        d3.select(this).attr("r", 2.5);
        if (tooltipRef.current) tooltipRef.current.style.display = "none";
      });

    // --- Legend ---
    const legend = svg
      .append("g")
      .attr("class", "legend")
      .attr("transform", `translate(${margin.left}, 6)`);
    type LegendKind = "line" | "dashed" | "square";
    const legendItems: { label: string; color: string; kind: LegendKind }[] = [
      { label: t("remaining"), color: COLORS.actual, kind: "line" },
    ];
    if (data.hasTarget) {
      legendItems.push({
        label: t("ideal"),
        color: COLORS.ideal,
        kind: "dashed",
      });
      // Heat-strip key: what the purple→green→red cells beneath the axis mean.
      legendItems.push({
        label: t("heatAhead"),
        color: HEAT.ahead,
        kind: "square",
      });
      legendItems.push({
        label: t("heatOnTrack"),
        color: HEAT.onTrack,
        kind: "square",
      });
      legendItems.push({
        label: t("heatBehind"),
        color: HEAT.behind,
        kind: "square",
      });
    }
    // Lay items out left-to-right, advancing by each label's measured width so
    // the next swatch clears the previous text — fixed spacing would collide
    // once a label (or its translation) runs long, e.g. "Items Remaining".
    let legendX = 0;
    legendItems.forEach((item) => {
      const itemGroup = legend
        .append("g")
        .attr("transform", `translate(${legendX}, 0)`);
      if (item.kind === "square") {
        itemGroup
          .append("rect")
          .attr("x", 0)
          .attr("y", -5)
          .attr("width", 10)
          .attr("height", 10)
          .attr("rx", 2)
          .attr("fill", item.color);
      } else {
        itemGroup
          .append("line")
          .attr("x1", 0)
          .attr("x2", 18)
          .attr("y1", 0)
          .attr("y2", 0)
          .attr("stroke", item.color)
          .attr("stroke-width", 2)
          .attr("stroke-dasharray", item.kind === "dashed" ? "4 4" : null);
      }
      // Swatch (~18px line / 10px square) + gap, the label width, then a 16px
      // gutter. getComputedTextLength is 0 in jsdom, so estimate there.
      const swatchW = item.kind === "square" ? 15 : 23;
      const textNode = itemGroup
        .append("text")
        .attr("x", swatchW)
        .attr("y", 0)
        .attr("dy", "0.32em")
        .style("font-size", "10px")
        .style("fill", "currentColor")
        .text(item.label);
      const textWidth =
        (textNode.node() as SVGTextElement)?.getComputedTextLength?.() ||
        item.label.length * 6;
      legendX += swatchW + textWidth + 16;
    });
  }, [data, width, height, t]);

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        minHeight: "220px",
      }}
    >
      <svg ref={svgRef} width={width} height={height}></svg>
    </div>
  );
};

export default MilestoneBurndownChart;
