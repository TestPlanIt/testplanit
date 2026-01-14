"use client";
import React, { useEffect, useRef } from "react";
import * as d3 from "d3";
import useResponsiveSVG from "~/hooks/useResponsiveSVG";
import { useTranslations } from "next-intl";
import { GroupedChartDataPoint } from "./ReportChart";

interface ReportGroupedBarChartProps {
  data: GroupedChartDataPoint[];
  dimensions: { value: string; label: string }[];
  metrics: { value: string; label: string }[];
}

export const ReportGroupedBarChart: React.FC<ReportGroupedBarChartProps> = ({
  data,
  dimensions,
  metrics,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { width, height } = useResponsiveSVG(containerRef);
  const t = useTranslations("charts");

  useEffect(() => {
    const tooltipElement = document.createElement("div");
    tooltipElement.style.position = "fixed";
    tooltipElement.style.display = "none";
    tooltipElement.style.backgroundColor = "rgba(0,0,0,0.75)";
    tooltipElement.style.color = "white";
    tooltipElement.style.padding = "5px 10px";
    tooltipElement.style.borderRadius = "4px";
    tooltipElement.style.fontSize = "12px";
    tooltipElement.style.pointerEvents = "none";
    tooltipElement.style.zIndex = "2000";
    document.body.appendChild(tooltipElement);
    tooltipRef.current = tooltipElement;

    return () => {
      if (tooltipRef.current?.parentNode) {
        tooltipRef.current.parentNode.removeChild(tooltipRef.current);
      }
      tooltipRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!svgRef.current || !data || data.length === 0 || width === 0 || height === 0) {
      if (svgRef.current) d3.select(svgRef.current).selectAll("*").remove();
      return;
    }

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    // Get subgroups early to calculate legend size
    const subGroups = Array.from(
      new Set(data.map((d: GroupedChartDataPoint) => d.subGroup))
    );

    // Calculate legend height based on number of subgroups
    const legendItemHeight = 20;
    const legendPadding = 10;
    const legendHeight =
      subGroups.length * legendItemHeight + legendPadding * 2;

    const margin = { top: 20, right: 30, bottom: 70 + legendHeight, left: 60 };
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;

    const xAccessor1 = (d: GroupedChartDataPoint) => d.mainGroup;
    const xAccessor2 = (d: GroupedChartDataPoint) => d.subGroup;
    const yAccessor = (d: GroupedChartDataPoint) => d.value;

    const mainGroups = Array.from(new Set(data.map(xAccessor1)));

    const xScale = d3
      .scaleBand()
      .domain(mainGroups)
      .range([0, chartWidth])
      .padding(0.2);
    const xSubgroupScale = d3
      .scaleBand()
      .domain(subGroups)
      .range([0, xScale.bandwidth()])
      .padding(0.05);
    const yScale = d3
      .scaleLinear()
      .domain([0, d3.max(data, yAccessor) as number])
      .range([chartHeight, 0])
      .nice();
    const color = d3.scaleOrdinal(d3.schemeCategory10).domain(subGroups);

    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    g.append("g")
      .attr("transform", `translate(0, ${chartHeight})`)
      .call(d3.axisBottom(xScale))
      .selectAll("text")
      .attr("transform", "rotate(-45)")
      .style("text-anchor", "end");

    g.append("g").call(d3.axisLeft(yScale));

    // Create bars with animations
    const bars = g
      .append("g")
      .selectAll("rect")
      .data(data)
      .enter()
      .append("rect")
      .attr(
        "x",
        (d) =>
          (xScale(xAccessor1(d)) as number) +
          (xSubgroupScale(xAccessor2(d)) as number)
      )
      .attr("y", chartHeight) // Start at bottom
      .attr("width", xSubgroupScale.bandwidth())
      .attr("height", 0) // Start with no height
      .attr("fill", (d) => d.color || color(xAccessor2(d)))
      .style("opacity", 0); // Start invisible

    // Add event handlers to bars before animation
    bars
      .on("mouseover", (event, d) => {
        if (tooltipRef.current) {
          tooltipRef.current.style.display = "block";
          tooltipRef.current.innerHTML = `<strong>${d.mainGroup}</strong><br/>${d.subGroup}: ${d.formattedValue}`;
        }
      })
      .on("mousemove", (event) => {
        if (tooltipRef.current) {
          tooltipRef.current.style.left = `${event.pageX + 10}px`;
          tooltipRef.current.style.top = `${event.pageY - 10}px`;
        }
      })
      .on("mouseout", () => {
        if (tooltipRef.current) {
          tooltipRef.current.style.display = "none";
        }
      });

    // Animate bars growing up and fading in
    bars
      .transition()
      .duration(800)
      .delay((d, i) => i * 50) // Stagger animation
      .ease(d3.easeBackOut.overshoot(1.2))
      .attr("y", (d) => yScale(yAccessor(d)))
      .attr("height", (d) => chartHeight - yScale(yAccessor(d)))
      .style("opacity", 1);

    // Add legend
    const legend = svg
      .append("g")
      .attr("class", "legend")
      .attr(
        "transform",
        `translate(${margin.left}, ${height - legendHeight + legendPadding})`
      );

    const legendItems = legend
      .selectAll(".legend-item")
      .data(subGroups)
      .enter()
      .append("g")
      .attr("class", "legend-item")
      .attr("transform", (d, i) => `translate(0, ${i * legendItemHeight})`);

    // Add colored rectangles
    legendItems
      .append("rect")
      .attr("width", 12)
      .attr("height", 12)
      .attr("rx", 2)
      .style("fill", (d) => color(d));

    // Add text labels
    legendItems
      .append("text")
      .attr("x", 18)
      .attr("y", 10)
      .style("font-size", "12px")
      .style("fill", "currentColor")
      .text((d) => d);
  }, [data, dimensions, metrics, width, height]);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%", minHeight: "150px" }}
    >
      <svg ref={svgRef} width={width} height={height}></svg>
    </div>
  );
};
