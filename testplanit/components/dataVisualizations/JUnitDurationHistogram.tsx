import React, { useRef, useEffect } from "react";
import * as d3 from "d3";
import { useTranslations } from "next-intl";

interface JUnitDurationHistogramProps {
  jUnitSuites: Array<{
    name: string;
    testCases: Array<{
      name: string;
      time?: number | null;
    }>;
  }>;
  height?: number;
  binCount?: number;
  isZoomed?: boolean;
}

const JUnitDurationHistogram: React.FC<JUnitDurationHistogramProps> = ({
  jUnitSuites,
  height = 220,
  binCount = 20,
  isZoomed = false,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = React.useState<number>(0);
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
    // Gather all durations
    const durations: number[] = [];
    jUnitSuites.forEach((suite) => {
      suite.testCases.forEach((tc) => {
        if (typeof tc.time === "number" && !isNaN(tc.time)) {
          durations.push(tc.time);
        }
      });
    });
    if (durations.length === 0) {
      if (svgRef.current) d3.select(svgRef.current).selectAll("*").remove();
      return;
    }
    // Bin durations
    const bins = d3
      .bin()
      .domain([0, d3.max(durations) || 1])
      .thresholds(binCount)(durations);

    // Chart dimensions
    const width = containerWidth;
    const margin = { top: 30, right: 20, bottom: 40, left: 50 };
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;

    // Scales
    const x = d3
      .scaleLinear()
      .domain([0, d3.max(durations) || 1])
      .range([0, chartWidth]);
    const y = d3
      .scaleLinear()
      .domain([0, d3.max(bins, (d) => d.length) || 1])
      .nice()
      .range([chartHeight, 0]);

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
          .ticks(isZoomed ? 16 : 8)
          .tickFormat((d) => t("charts.seconds", { seconds: String(d) }))
      )
      .selectAll("text")
      .style("font-size", isZoomed ? "16px" : "11px");
    // Y axis
    g.append("g")
      .call(d3.axisLeft(y).ticks(isZoomed ? 10 : 5))
      .selectAll("text")
      .style("font-size", isZoomed ? "16px" : "11px");

    // Tooltip
    const tooltip = d3
      .select(containerRef.current)
      .append("div")
      .attr("class", "junit-histogram-tooltip")
      .style("position", "absolute")
      .style("background", "rgba(0,0,0,0.85)")
      .style("color", "#fff")
      .style("padding", "6px 12px")
      .style("border-radius", "4px")
      .style("font-size", isZoomed ? "18px" : "12px")
      .style("pointer-events", "none")
      .style("z-index", 10)
      .style("display", "none");

    // Draw bars
    const bars = g
      .selectAll(".bar")
      .data(bins)
      .enter()
      .append("rect")
      .attr("class", "bar")
      .attr("x", (d) => x(d.x0 ?? 0))
      .attr("width", (d) => x(d.x1 ?? 0) - x(d.x0 ?? 0) - 1)
      .attr("y", chartHeight) // Start at bottom
      .attr("height", 0) // Start with no height
      .attr("fill", "hsl(var(--primary))")
      .attr("rx", 2)
      .style("opacity", 0); // Start invisible

    // Add event handlers before animation
    bars
      .on("mouseover", function (event, d) {
        tooltip.style("display", "block").html(
          `<strong>${t("charts.testCases", { count: d.length })}</strong><br/>` +
            t("charts.durationRange", {
              from: d.x0 !== undefined ? d.x0.toFixed(2) : "0.00",
              to: d.x1 !== undefined ? d.x1.toFixed(2) : "0.00",
            })
        );
        d3.select(this).attr("fill", "hsl(var(--primary) / 0.6)");
      })
      .on("mousemove", function (event) {
        tooltip
          .style("left", event.offsetX + margin.left + 10 + "px")
          .style("top", event.offsetY + margin.top - 30 + "px");
      })
      .on("mouseout", function () {
        tooltip.style("display", "none");
        d3.select(this).attr("fill", "hsl(var(--primary))");
      });

    // Animate bars growing up and fading in
    bars
      .transition()
      .duration(800)
      .delay((d, i) => i * 50) // Stagger animation
      .ease(d3.easeBackOut.overshoot(1.2))
      .attr("y", (d) => y(d.length))
      .attr("height", (d) => chartHeight - y(d.length))
      .style("opacity", 1);

    // Clean up tooltip on unmount
    return () => {
      tooltip.remove();
    };
  }, [jUnitSuites, height, containerWidth, binCount, isZoomed, t]);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", minHeight: height, position: "relative" }}
    >
      <svg ref={svgRef} width={containerWidth} height={height}></svg>
    </div>
  );
};

export default JUnitDurationHistogram;
