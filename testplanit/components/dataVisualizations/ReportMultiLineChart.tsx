"use client";
import React, { useEffect, useRef } from "react";
import * as d3 from "d3";
import useResponsiveSVG from "~/hooks/useResponsiveSVG";
import { useTranslations } from "next-intl";

export interface MultiLineSeries {
  name: string;
  values: {
    date: Date;
    value: number;
    formattedValue: string;
  }[];
  color?: string;
}

interface ReportMultiLineChartProps {
  data: MultiLineSeries[];
}

export const ReportMultiLineChart: React.FC<ReportMultiLineChartProps> = ({
  data,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
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
    if (!svgRef.current || data.length === 0 || width === 0 || height === 0) {
      if (svgRef.current) d3.select(svgRef.current).selectAll("*").remove();
      return;
    }

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    // Fixed legend height - legend will be in a separate scrollable container
    const legendHeight = 120; // Fixed height for legend area
    const margin = { top: 20, right: 20, bottom: 70, left: 60 };
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom - legendHeight;

    const allDates = data.flatMap((series) => series.values.map((d) => d.date));
    const allValues = data.flatMap((series) =>
      series.values.map((d) => d.value)
    );

    const xScale = d3
      .scaleTime()
      .domain(d3.extent(allDates) as [Date, Date])
      .range([0, chartWidth]);
    const yScale = d3
      .scaleLinear()
      .domain([0, d3.max(allValues) as number])
      .range([chartHeight, 0])
      .nice();
    const color = d3
      .scaleOrdinal(d3.schemeTableau10)
      .domain(data.map((d) => d.name));

    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    g.append("g")
      .attr("transform", `translate(0,${chartHeight})`)
      .call(d3.axisBottom(xScale).ticks(5))
      .selectAll("text")
      .attr("transform", "rotate(-45)")
      .style("text-anchor", "end");

    g.append("g").call(d3.axisLeft(yScale));

    const line = d3
      .line<{ date: Date; value: number }>()
      .x((d) => xScale(d.date))
      .y((d) => yScale(d.value));

    const series = g
      .selectAll(".series")
      .data(data)
      .enter()
      .append("g")
      .attr("class", "series");

    // Create line paths with animation
    const linePaths = series
      .append("path")
      .attr("class", "line")
      .attr("d", (d) => line(d.values))
      .style("fill", "none")
      .style("stroke", (d) => d.color || color(d.name))
      .style("stroke-width", 2);

    // Animate each line drawing with stagger
    linePaths.each(function (d, i) {
      const path = d3.select(this);
      const totalLength = (this as SVGPathElement).getTotalLength();

      path
        .attr("stroke-dasharray", `${totalLength} ${totalLength}`)
        .attr("stroke-dashoffset", totalLength)
        .transition()
        .delay(i * 200) // Stagger each line
        .duration(1000)
        .ease(d3.easeQuadOut)
        .attr("stroke-dashoffset", 0);
    });

    // Create dots with staggered animation
    const dots = series
      .selectAll(".dot")
      .data((d) => d.values.map((v) => ({ ...v, seriesName: d.name })))
      .enter()
      .append("circle")
      .attr("class", "dot")
      .attr("cx", (d) => xScale(d.date))
      .attr("cy", (d) => yScale(d.value))
      .attr("r", 0) // Start with no radius
      .style("fill", (d) => {
        const seriesData = data.find((s) => s.name === d.seriesName);
        return seriesData?.color || color(d.seriesName);
      })
      .style("opacity", 0); // Start invisible

    // Add event handlers to dots
    dots
      .on("mouseover", (event, d) => {
        if (tooltipRef.current) {
          tooltipRef.current.style.display = "block";
          tooltipRef.current.innerHTML = `<strong>${
            d.seriesName
          }</strong><br/>${d.date.toLocaleDateString()}<br/>Value: ${
            d.formattedValue
          }`;
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

    // Animate dots appearing after their respective lines start drawing
    dots
      .transition()
      .delay((d, i) => {
        const seriesIndex = data.findIndex((s) => s.name === d.seriesName);
        return seriesIndex * 200 + 600 + i * 50; // Start after line begins
      })
      .duration(300)
      .ease(d3.easeBackOut.overshoot(1.3))
      .attr("r", 4)
      .style("opacity", 1);

    // Legend will be rendered in a separate HTML container below
  }, [data, width, height]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        minHeight: "200px",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <svg
        ref={svgRef}
        width={width}
        height={height - 120}
        style={{ flexShrink: 0 }}
      ></svg>
      <div
        style={{
          maxHeight: "120px",
          overflowY: "auto",
          overflowX: "hidden",
          padding: "10px",
          borderTop: "1px solid #e5e7eb",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
          gap: "8px",
          fontSize: "12px",
        }}
      >
        {data.map((series, i) => {
          const seriesColor =
            series.color ||
            d3.scaleOrdinal(d3.schemeTableau10).domain(data.map((d) => d.name))(
              series.name
            );
          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                minWidth: 0,
              }}
            >
              <div
                style={{
                  width: "12px",
                  height: "12px",
                  backgroundColor: seriesColor as string,
                  borderRadius: "2px",
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={series.name}
              >
                {series.name}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
