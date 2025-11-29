"use client";
import React, { useEffect, useRef } from "react";
import * as d3 from "d3";
import useResponsiveSVG from "~/hooks/useResponsiveSVG";
import { useTranslations } from "next-intl";
import { SimpleChartDataPoint } from "./ReportChart";

interface ReportLineChartProps {
  data: SimpleChartDataPoint[];
}

export const ReportLineChart: React.FC<ReportLineChartProps> = ({ data }) => {
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

    const margin = { top: 20, right: 30, bottom: 70, left: 60 };
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;

    const xAccessor = (d: SimpleChartDataPoint) => new Date(d.name);
    const yAccessor = (d: SimpleChartDataPoint) => d.value;

    const xScale = d3
      .scaleTime()
      .domain(d3.extent(data, xAccessor) as [Date, Date])
      .range([0, chartWidth]);

    const yScale = d3
      .scaleLinear()
      .domain([0, d3.max(data, yAccessor) as number])
      .range([chartHeight, 0])
      .nice();

    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    g.append("g")
      .attr("class", "x-axis")
      .attr("transform", `translate(0,${chartHeight})`)
      .call(d3.axisBottom(xScale))
      .selectAll("text")
      .attr("transform", "rotate(-45)")
      .style("text-anchor", "end");

    g.append("g").attr("class", "y-axis").call(d3.axisLeft(yScale));

    const line = d3
      .line<SimpleChartDataPoint>()
      .x((d) => xScale(xAccessor(d)))
      .y((d) => yScale(yAccessor(d)));

    // Create the line path with animation
    const path = g
      .append("path")
      .datum(data)
      .attr("fill", "none")
      .attr("stroke", "steelblue")
      .attr("stroke-width", 1.5)
      .attr("d", line);

    // Get the path length for animation
    const totalLength = (path.node() as SVGPathElement).getTotalLength();

    // Animate the line drawing
    path
      .attr("stroke-dasharray", `${totalLength} ${totalLength}`)
      .attr("stroke-dashoffset", totalLength)
      .transition()
      .duration(1200)
      .ease(d3.easeQuadOut)
      .attr("stroke-dashoffset", 0);

    // Create dots with staggered animation
    const dots = g
      .selectAll(".dot")
      .data(data)
      .enter()
      .append("circle")
      .attr("class", "dot")
      .attr("cx", (d) => xScale(xAccessor(d)))
      .attr("cy", (d) => yScale(yAccessor(d)))
      .attr("r", 0) // Start with no radius
      .attr("fill", "steelblue")
      .style("opacity", 0); // Start invisible

    // Add event handlers to dots
    dots
      .on("mouseover", (event, d) => {
        if (tooltipRef.current) {
          tooltipRef.current.style.display = "block";
          tooltipRef.current.innerHTML = `<strong>${
            d.name
          }</strong><br/>Value: ${d.formattedValue}`;
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

    // Animate dots appearing after line starts drawing
    dots
      .transition()
      .delay((d, i) => 600 + i * 100) // Start after line begins
      .duration(400)
      .ease(d3.easeBackOut.overshoot(1.3))
      .attr("r", 5)
      .style("opacity", 1);
  }, [data, width, height, t]);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%", minHeight: "150px" }}
    >
      <svg ref={svgRef} width={width} height={height}></svg>
    </div>
  );
};
