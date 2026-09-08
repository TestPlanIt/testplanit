import * as d3 from "d3";
import { useLocale, useTranslations } from "next-intl";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  assignExecutionLanes,
  buildExecutionWindows,
  hasRealExecutionWindows,
} from "~/utils/automatedRunMetrics";

export interface ExecutionTimelineResult {
  /** Repository case id — makes the bar a click-through when provided. */
  caseId?: number | string;
  resultId?: number;
  name: string;
  suiteName?: string | null;
  statusName: string;
  color: string;
  isDeleted?: boolean;
  time?: number | null;
  executedAt?: Date | string | null;
  createdAt?: Date | string | null;
  /** Reporter-supplied worker id — real lanes instead of inferred ones. */
  worker?: string | null;
}

interface JUnitExecutionTimelineProps {
  results: ExecutionTimelineResult[];
  height?: number;
  onResultClick?: (caseId: number | string) => void;
}

interface TimelineBar {
  result: ExecutionTimelineResult;
  lane: string;
  /** Seconds from the run's start. */
  x0: number;
  x1: number;
}

/**
 * Per-worker execution timeline swimlane: each test is a bar
 * on a real time axis, packed into the lanes the run's concurrency implies
 * (first-fit over the reconstructed execution windows — stage 2's reporter
 * worker ids will replace the inference with real lane names).
 *
 * Bulk XML imports stamp every result with the upload instant, so no real
 * windows exist; those runs fall back to one lane per suite with durations
 * laid end-to-end — the pre-swimlane Status Timeline rendering.
 */
const JUnitExecutionTimeline: React.FC<JUnitExecutionTimelineProps> = ({
  results,
  height = 220,
  onResultClick,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const t = useTranslations();
  const locale = useLocale();

  // Axis ticks in narrow localized units ("2h 5m", "45s", "250ms") — a long
  // run's axis in raw seconds ("25000s") is unreadable.
  const formatTick = useCallback(
    (totalSeconds: number): string => {
      const unit = (value: number, name: string) =>
        value.toLocaleString(locale, {
          style: "unit",
          unit: name,
          unitDisplay: "narrow",
          maximumFractionDigits: 0,
        } as Intl.NumberFormatOptions);
      if (totalSeconds > 0 && totalSeconds < 1) {
        return unit(Math.round(totalSeconds * 1000), "millisecond");
      }
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      let seconds = Math.round(totalSeconds % 60);
      if (seconds === 60) seconds = 0;
      const parts: string[] = [];
      if (hours) parts.push(unit(hours, "hour"));
      if (minutes) parts.push(unit(minutes, "minute"));
      // Three units is axis noise — past an hour, minutes are enough.
      if (seconds && !hours) parts.push(unit(seconds, "second"));
      if (parts.length === 0) parts.push(unit(seconds, "second"));
      return parts.join(" ");
    },
    [locale]
  );

  // Responsive: track container width
  useEffect(() => {
    if (!containerRef.current) return;
    const handleResize = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.offsetWidth);
      }
    };
    handleResize();
    const resizeObserver = new window.ResizeObserver(handleResize);
    resizeObserver.observe(containerRef.current);
    window.addEventListener("resize", handleResize);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  const { bars, laneNames } = useMemo(() => {
    const windows = buildExecutionWindows(results);
    if (hasRealExecutionWindows(windows)) {
      let minStart = Infinity;
      for (const w of windows) if (w.startMs < minStart) minStart = w.startMs;

      // Reporter-supplied worker ids give real lanes; anything less falls
      // back to first-fit packing over the reconstructed windows.
      if (windows.every((w) => w.result.worker != null)) {
        const collator = new Intl.Collator(undefined, { numeric: true });
        const names = Array.from(
          new Set(windows.map((w) => String(w.result.worker)))
        )
          .sort((a, b) => collator.compare(a, b))
          .map((id) => t("charts.worker", { id }));
        const timelineBars: TimelineBar[] = windows.map((w) => ({
          result: w.result,
          lane: t("charts.worker", { id: String(w.result.worker) }),
          x0: (w.startMs - minStart) / 1000,
          x1: (w.endMs - minStart) / 1000,
        }));
        return { bars: timelineBars, laneNames: names };
      }

      const lanes = assignExecutionLanes(windows);
      let laneCount = 0;
      for (const lane of lanes) if (lane + 1 > laneCount) laneCount = lane + 1;
      const names = Array.from({ length: laneCount }, (_, i) =>
        t("charts.lane", { number: i + 1 })
      );
      const timelineBars: TimelineBar[] = windows.map((w, i) => ({
        result: w.result,
        lane: names[lanes[i]],
        x0: (w.startMs - minStart) / 1000,
        x1: (w.endMs - minStart) / 1000,
      }));
      return { bars: timelineBars, laneNames: names };
    }

    // Fallback: no real windows — lane per suite, durations end-to-end.
    const bySuite = new Map<string, ExecutionTimelineResult[]>();
    for (const result of results) {
      if (typeof result.time !== "number" || !(result.time > 0)) continue;
      const suite = result.suiteName || "";
      const list = bySuite.get(suite);
      if (list) list.push(result);
      else bySuite.set(suite, [result]);
    }
    const laneNames: string[] = [];
    const bars: TimelineBar[] = [];
    for (const [suite, suiteResults] of bySuite) {
      laneNames.push(suite);
      let acc = 0;
      for (const result of suiteResults) {
        bars.push({
          result,
          lane: suite,
          x0: acc,
          x1: acc + (result.time as number),
        });
        acc += result.time as number;
      }
    }
    return { bars, laneNames };
  }, [results, t]);

  useEffect(() => {
    if (bars.length === 0 || containerWidth === 0) {
      if (svgRef.current) d3.select(svgRef.current).selectAll("*").remove();
      return;
    }

    const width = containerWidth;
    const margin = { top: 10, right: 20, bottom: 30, left: 110 };
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;

    const y = d3
      .scaleBand()
      .domain(laneNames)
      .range([0, chartHeight])
      .padding(laneNames.length > 20 ? 0.1 : 0.2);
    const maxX = d3.max(bars, (d) => d.x1) || 1;
    const x = d3.scaleLinear().domain([0, maxX]).range([0, chartWidth]);

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    g.append("g")
      .attr("transform", `translate(0,${chartHeight})`)
      .call(
        d3
          .axisBottom(x)
          .ticks(5)
          .tickFormat((d) => formatTick(Number(d)))
      );
    const yAxis = g.append("g").call(d3.axisLeft(y));
    // Long suite names (fallback mode) overflow the margin — truncate.
    yAxis
      .selectAll<SVGTextElement, string>("text")
      .text((d) => (d.length > 16 ? `${d.slice(0, 15)}…` : d))
      .append("title")
      .text((d) => d);

    const tooltip = d3
      .select(containerRef.current)
      .append("div")
      .attr("class", "junit-timeline-tooltip")
      .style("position", "absolute")
      .style("background", "rgba(0,0,0,0.85)")
      .style("color", "#fff")
      .style("padding", "6px 12px")
      .style("border-radius", "4px")
      .style("font-size", "12px")
      .style("pointer-events", "none")
      .style("z-index", 10)
      .style("display", "none");

    const clickable = (d: TimelineBar) =>
      !!onResultClick && d.result.caseId != null && !d.result.isDeleted;

    g.selectAll<SVGRectElement, TimelineBar>(".timeline-bar")
      .data(bars)
      .enter()
      .append("rect")
      .attr("class", "timeline-bar")
      .attr("x", (d) => x(d.x0))
      .attr("y", (d) => y(d.lane) ?? 0)
      // Sub-pixel bars vanish; keep every test at least a sliver.
      .attr("width", (d) => Math.max(x(d.x1) - x(d.x0), 1.5))
      .attr("height", y.bandwidth())
      .attr("fill", (d) => d.result.color)
      .attr("rx", 2)
      .attr("ry", 2)
      .style("cursor", (d) => (clickable(d) ? "pointer" : "default"))
      .style("opacity", 0)
      .on("mouseover", function (event, d) {
        tooltip.style("display", "block").html(
          `<strong>${d.result.name}</strong><br/>` +
            t("charts.status", { status: d.result.statusName }) +
            "<br/>" +
            t("common.ui.charts.duration", {
              seconds: (d.x1 - d.x0).toFixed(2),
            }) +
            (d.result.suiteName ? `<br/>${d.result.suiteName}` : "")
        );
        d3.select(this).style("opacity", 0.8);
      })
      .on("mousemove", function (event) {
        tooltip
          .style("left", event.offsetX + 10 + "px")
          .style("top", event.offsetY - 20 + "px");
      })
      .on("mouseout", function () {
        tooltip.style("display", "none");
        d3.select(this).style("opacity", 1);
      })
      .on("click", function (event, d) {
        if (clickable(d)) onResultClick!(d.result.caseId as number | string);
      })
      .transition()
      .duration(500)
      .delay((d, i) => Math.min(i * 10, 500))
      .style("opacity", 1);

    return () => {
      tooltip.remove();
    };
  }, [bars, laneNames, height, containerWidth, t, formatTick, onResultClick]);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", minHeight: height, position: "relative" }}
      data-testid="junit-execution-timeline"
    >
      <svg ref={svgRef} width={containerWidth} height={height}></svg>
    </div>
  );
};

export default JUnitExecutionTimeline;
