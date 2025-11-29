"use client";
import React, { useEffect, useRef } from "react";
import * as d3 from "d3";
import useResponsiveSVG from "~/hooks/useResponsiveSVG";
import { useTranslations } from "next-intl";
import { SimpleChartDataPoint } from "./ReportChart";

interface ReportBarChartProps {
  data: SimpleChartDataPoint[];
}

export const ReportBarChart: React.FC<ReportBarChartProps> = ({ data }) => {
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

    const xAccessor = (d: SimpleChartDataPoint) => d.name;
    const yAccessor = (d: SimpleChartDataPoint) => d.value;

    const xScale = d3
      .scaleBand()
      .domain(data.map(xAccessor))
      .range([0, chartWidth])
      .padding(0.2);

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

    // Create bars with animations
    const bars = g
      .selectAll(".bar")
      .data(data)
      .enter()
      .append("rect")
      .attr("class", "bar")
      .attr("x", (d) => xScale(xAccessor(d)) as number)
      .attr("y", chartHeight) // Start at bottom
      .attr("width", xScale.bandwidth())
      .attr("height", 0) // Start with no height
      .attr("fill", (d) => d.color || "currentColor")
      .style("opacity", 0); // Start invisible

    // Add event handlers to bars before animation
    bars
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

    // Animate bars growing up and fading in
    bars
      .transition()
      .duration(800)
      .delay((d, i) => i * 50) // Stagger animation
      .ease(d3.easeBackOut.overshoot(1.2))
      .attr("y", (d) => yScale(yAccessor(d)))
      .attr("height", (d) => chartHeight - yScale(yAccessor(d)))
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
