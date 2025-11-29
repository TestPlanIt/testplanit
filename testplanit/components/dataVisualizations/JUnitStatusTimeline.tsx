import React, { useRef, useEffect, useState } from "react";
import * as d3 from "d3";
import { useTranslations } from "next-intl";

interface JUnitStatusTimelineProps {
  jUnitSuites: Array<{
    name: string;
    timestamp?: string | Date | null;
    testCases: Array<{
      name: string;
      time?: number | null;
      result?: {
        status?: { name: string; color?: { value?: string } };
      } | null;
    }>;
  }>;
  height?: number;
}

const colorFallback = (statusName: string) => {
  switch (statusName) {
    case "FAILED":
    case "FAILURE":
    case "ERROR":
      return "#ef4444";
    case "SKIPPED":
      return "#a1a1aa";
    case "PASSED":
    default:
      return "#22c55e";
  }
};

const JUnitStatusTimeline: React.FC<JUnitStatusTimelineProps> = ({
  jUnitSuites,
  height = 220,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const t = useTranslations();

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

  useEffect(() => {
    if (!jUnitSuites || jUnitSuites.length === 0 || containerWidth === 0) {
      if (svgRef.current) d3.select(svgRef.current).selectAll("*").remove();
      return;
    }

    // Sort suites by timestamp (ascending)
    const sortedSuites = [...jUnitSuites].sort((a, b) => {
      const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return ta - tb;
    });

    // Prepare data for stacked bars
    const suiteData = sortedSuites.map((suite) => {
      let acc = 0;
      const segments = suite.testCases.map((tc) => {
        const duration =
          typeof tc.time === "number" && !isNaN(tc.time) ? tc.time : 0;
        const statusName = tc.result?.status?.name || "PASSED";
        const color =
          tc.result?.status?.color?.value || colorFallback(statusName);
        const segment = {
          testCaseName: tc.name,
          statusName,
          color,
          duration,
          x0: acc,
          x1: acc + duration,
        };
        acc += duration;
        return segment;
      });
      return {
        suiteName: suite.name,
        segments,
        totalDuration: acc,
      };
    });

    // Chart dimensions
    const width = containerWidth;
    const margin = { top: 30, right: 20, bottom: 30, left: 120 };
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;
    // Y scale: one band per suite
    const suiteNames = suiteData.map((s) => s.suiteName);
    const y = d3
      .scaleBand()
      .domain(suiteNames)
      .range([0, chartHeight])
      .padding(0.2);
    // X scale: duration (seconds)
    const maxDuration = d3.max(suiteData, (d) => d.totalDuration) || 1;
    const x = d3.scaleLinear().domain([0, maxDuration]).range([0, chartWidth]);
    // Clear and create svg
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);
    // X axis
    g.append("g")
      .attr("transform", `translate(0,${chartHeight})`)
      .call(
        d3
          .axisBottom(x)
          .ticks(5)
          .tickFormat((d) => t("charts.seconds", { seconds: String(d) }))
      );
    // Y axis
    g.append("g").call(d3.axisLeft(y));
    // Tooltip
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
    // Draw stacked bars
    g.selectAll(".suite-bar")
      .data(suiteData)
      .enter()
      .append("g")
      .attr("class", "suite-bar")
      .attr("transform", (d) => `translate(0,${y(d.suiteName)})`)
      .each(function (suite, suiteIndex) {
        const segments = d3
          .select(this)
          .selectAll(".segment")
          .data(suite.segments)
          .enter()
          .append("rect")
          .attr("class", "segment")
          .attr("x", (d) => x(d.x0))
          .attr("width", 0) // Start with no width
          .attr("height", y.bandwidth())
          .attr("fill", (d) => d.color)
          .attr("rx", 3)
          .attr("ry", 3)
          .style("opacity", 0); // Start invisible

        // Add event handlers before animation
        segments
          .on("mouseover", function (event, d) {
            tooltip
              .style("display", "block")
              .html(
                `<strong>${d.testCaseName}</strong><br/>` +
                  t("charts.status", { status: d.statusName }) +
                  "<br/>" +
                  t("charts.duration", { seconds: d.duration.toFixed(2) })
              );
            d3.select(this).attr("opacity", 0.8);
          })
          .on("mousemove", function (event) {
            tooltip
              .style("left", event.offsetX + margin.left + 10 + "px")
              .style("top", event.offsetY + margin.top - 20 + "px");
          })
          .on("mouseout", function () {
            tooltip.style("display", "none");
            d3.select(this).attr("opacity", 1);
          });

        // Animate segments growing and fading in
        segments
          .transition()
          .duration(800)
          .delay((d, i) => suiteIndex * 100 + i * 50) // Stagger by suite and segment
          .ease(d3.easeBackOut.overshoot(1.2))
          .attr("width", (d) => x(d.x1) - x(d.x0))
          .style("opacity", 1);
      });
    // Clean up tooltip on unmount
    return () => {
      tooltip.remove();
    };
  }, [jUnitSuites, height, containerWidth, t]);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", minHeight: height, position: "relative" }}
    >
      <svg ref={svgRef} width={containerWidth} height={height}></svg>
    </div>
  );
};

export default JUnitStatusTimeline;
