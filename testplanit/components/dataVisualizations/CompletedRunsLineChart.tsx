"use client";

import React, { useEffect, useRef } from "react";
import * as d3 from "d3";
import useResponsiveSVG from "~/hooks/useResponsiveSVG";
import { useTranslations } from "next-intl";

export interface MonthlyCount {
  month: string; // Format: YYYY-MM
  count: number; // Total count (kept for backward compatibility)
  manual?: number; // Manual (REGULAR) runs
  automated?: number; // Automated (JUNIT) runs
}

interface CompletedRunsLineChartProps {
  data: MonthlyCount[];
  isZoomed?: boolean; // Add zoom level prop
}

const CompletedRunsLineChart: React.FC<CompletedRunsLineChartProps> = ({
  data,
  isZoomed = false, // Default to false
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { width, height } = useResponsiveSVG(containerRef);
  const t = useTranslations();

  // Effect to manage tooltip DIV in document.body
  useEffect(() => {
    const tooltipElement = document.createElement("div");
    tooltipElement.style.position = "fixed";
    tooltipElement.style.display = "none";
    tooltipElement.style.backgroundColor = "rgba(0,0,0,0.75)";
    tooltipElement.style.color = "white";
    tooltipElement.style.padding = "5px 10px"; // Matching original style
    tooltipElement.style.borderRadius = "4px";
    tooltipElement.style.fontSize = "11px"; // Matching original style
    tooltipElement.style.pointerEvents = "none";
    tooltipElement.style.zIndex = "2000"; // Ensure high z-index

    document.body.appendChild(tooltipElement);
    tooltipRef.current = tooltipElement;

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
      data.length === 0 ||
      width === 0 ||
      height === 0
    ) {
      if (svgRef.current) d3.select(svgRef.current).selectAll("*").remove();
      return;
    }

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const margin = { top: 20, right: 20, bottom: 40, left: 40 }; // Margins for axes
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;

    // --- Scales ---
    const xScale = d3
      .scalePoint<string>()
      .domain(data.map((d) => d.month))
      .range([0, chartWidth])
      .padding(0.5); // Add padding for points

    // Calculate max value across all series
    const maxValue = d3.max(data, (d) =>
      Math.max(d.count, d.manual || 0, d.automated || 0)
    ) || 1;

    const yScale = d3
      .scaleLinear()
      .domain([0, maxValue]) // Start y at 0, handle max=0
      .range([chartHeight, 0])
      .nice(); // Make ticks end on nice values

    // --- Axes ---
    const xAxis = d3
      .axisBottom(xScale)
      .tickFormat((monthStr) => {
        // Format ticks to show MMM (e.g., Jan)
        const [year, month] = monthStr.split("-");
        const date = new Date(parseInt(year), parseInt(month) - 1);
        return d3.timeFormat("%b")(date);
      })
      .tickSizeOuter(0);

    const yAxis = d3
      .axisLeft(yScale)
      .ticks(Math.min(5, d3.max(data, (d) => d.count) || 1)); // Max 5 ticks, or fewer if max count is low

    // Calculate responsive font sizes based on zoom level
    const baseFontSize = Math.max(
      10,
      Math.min(16, chartWidth * (isZoomed ? 0.03 : 0.02))
    );
    const tickFontSize = Math.max(8, baseFontSize * (isZoomed ? 0.9 : 0.8));

    // --- Drawing Area ---
    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left}, ${margin.top})`);

    // Draw X Axis
    g.append("g")
      .attr("transform", `translate(0, ${chartHeight})`)
      .call(xAxis)
      .selectAll("text")
      .style("text-anchor", "middle")
      .style("font-size", `${tickFontSize}px`);

    // Draw Y Axis
    g.append("g")
      .call(yAxis)
      .call((s) => s.select(".domain").remove()) // Remove y-axis line
      .call((s) =>
        s
          .selectAll(".tick line")
          .clone() // Add grid lines
          .attr("x2", chartWidth)
          .attr("stroke-opacity", 0.1)
      )
      .selectAll("text")
      .style("font-size", `${tickFontSize}px`);

    // --- Define colors for each line ---
    const colors = {
      total: "#1e40af", // blue-800
      manual: "#059669", // green-600
      automated: "#9333ea", // purple-600
    };

    // --- Draw three lines: manual, automated, total ---
    const series = [
      { key: "manual" as const, color: colors.manual, accessor: (d: MonthlyCount) => d.manual || 0 },
      { key: "automated" as const, color: colors.automated, accessor: (d: MonthlyCount) => d.automated || 0 },
      { key: "total" as const, color: colors.total, accessor: (d: MonthlyCount) => d.count },
    ];

    series.forEach(({ key, color, accessor }) => {
      const lineGenerator = d3
        .line<MonthlyCount>()
        .x((d) => xScale(d.month)!)
        .y((d) => yScale(accessor(d)))
        .curve(d3.curveMonotoneX); // Smooth curve

      const linePath = g
        .append("path")
        .datum(data)
        .attr("fill", "none")
        .attr("stroke", color)
        .attr("stroke-width", key === "total" ? 2 : 1.5)
        .attr("opacity", key === "total" ? 0.8 : 0.7)
        .attr("d", lineGenerator);

      // Animate line drawing
      const totalLength = linePath.node()?.getTotalLength?.() || 0;
      linePath
        .attr("stroke-dasharray", totalLength)
        .attr("stroke-dashoffset", totalLength)
        .transition()
        .duration(900)
        .ease(d3.easeCubic)
        .attr("stroke-dashoffset", 0);
    });

    // --- Draw Points for each series ---
    series.forEach(({ key, color, accessor }) => {
      g.selectAll(`.dot-${key}`)
        .data(data)
        .enter()
        .append("circle")
        .attr("class", `dot-${key}`)
        .attr("cx", (d) => xScale(d.month)!)
        .attr("cy", (d) => yScale(accessor(d)))
        .attr("r", 0)
        .attr("fill", color)
        .attr("stroke", "white")
        .attr("stroke-width", key === "total" ? 1.5 : 1)
        .style("cursor", "pointer")
        .on("mouseover", function (event, d) {
          d3.select(this).attr("r", key === "total" ? 6 : 5); // Enlarge dot
          if (tooltipRef.current) {
            tooltipRef.current.style.display = "block";
            const [year, month] = d.month.split("-");
            const date = new Date(parseInt(year), parseInt(month) - 1);
            const monthName = d3.timeFormat("%B %Y")(date); // Full month name + year
            tooltipRef.current.innerHTML = `
              <strong>${monthName}</strong><br/>
              <span style="color: ${colors.manual}">● ${t("runs.typeFilter.manual")}: ${d.manual || 0}</span><br/>
              <span style="color: ${colors.automated}">● ${t("runs.typeFilter.automated")}: ${d.automated || 0}</span><br/>
              <span style="color: ${colors.total}">● ${t("common.labels.total")}: ${d.count}</span>
            `;
          }
        })
        .on("mousemove", function (event) {
          if (tooltipRef.current) {
            tooltipRef.current.style.left = `${event.clientX + 15}px`; // Use clientX
            tooltipRef.current.style.top = `${event.clientY - 10}px`; // Use clientY
          }
        })
        .on("mouseout", function () {
          d3.select(this).attr("r", key === "total" ? 4 : 3.5); // Reset dot size
          if (tooltipRef.current) {
            tooltipRef.current.style.display = "none";
          }
        })
        .transition()
        .duration(700)
        .delay((_, i) => 400 + i * 60)
        .attr("r", key === "total" ? 4 : 3.5);
    });

    // --- Add Legend ---
    const legendData = [
      { key: "manual", label: t("runs.typeFilter.manual"), color: colors.manual },
      { key: "automated", label: t("runs.typeFilter.automated"), color: colors.automated },
      { key: "total", label: t("common.labels.total"), color: colors.total },
    ];

    const legend = svg
      .append("g")
      .attr("class", "legend")
      .attr("transform", `translate(${margin.left}, 5)`);

    const legendItemWidth = 100;
    const legendSpacing = isZoomed ? 120 : 90;

    legendData.forEach((item, i) => {
      const legendItem = legend
        .append("g")
        .attr("transform", `translate(${i * legendSpacing}, 0)`);

      legendItem
        .append("line")
        .attr("x1", 0)
        .attr("x2", 20)
        .attr("y1", 0)
        .attr("y2", 0)
        .attr("stroke", item.color)
        .attr("stroke-width", item.key === "total" ? 2 : 1.5);

      legendItem
        .append("text")
        .attr("x", 25)
        .attr("y", 0)
        .attr("dy", "0.32em")
        .style("font-size", `${tickFontSize}px`)
        .style("fill", "currentColor")
        .text(item.label);
    });
  }, [data, width, height, isZoomed, t]);

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        minHeight: "250px",
      }}
    >
      <svg ref={svgRef} width={width} height={height}></svg>
      {/* Tooltip div is no longer rendered here */}
    </div>
  );
};

export default CompletedRunsLineChart;
