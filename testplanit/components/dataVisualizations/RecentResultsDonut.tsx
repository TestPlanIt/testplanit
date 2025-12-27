"use client";

import React, { useEffect, useRef } from "react";
import * as d3 from "d3";
import useResponsiveSVG from "~/hooks/useResponsiveSVG";
import { useTranslations } from "next-intl";

// Simplified data item for this chart
export interface RecentResultStatusItem {
  id: string | number;
  name: string;
  value: number; // Count of results for this status
  color: string; // Color for this status
  formattedValue?: string;
  // Add percentage if needed directly in tooltip, or calculate outside
}

interface RecentResultsDonutProps {
  data: RecentResultStatusItem[];
  isZoomed?: boolean; // Add zoom level prop
  formattedTotal?: string;
  centerLabel?: string; // Allow custom label instead of "Total"
}

const RecentResultsDonut: React.FC<RecentResultsDonutProps> = ({
  data,
  isZoomed = false, // Default to false
  formattedTotal,
  centerLabel,
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

    const margin = { top: 5, right: 5, bottom: 5, left: 5 };
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;
    const radius = Math.min(chartWidth, chartHeight) / 2;
    const innerRadius = radius * 0.4;

    const pie = d3
      .pie<RecentResultStatusItem>()
      .value((d) => d.value)
      .sort(null);

    const arc = d3
      .arc<any, d3.PieArcDatum<RecentResultStatusItem>>()
      .innerRadius(innerRadius)
      .outerRadius(radius);

    const g = svg
      .append("g")
      .attr("transform", `translate(${width / 2}, ${height / 2})`);

    const totalCount = d3.sum(data, (d) => d.value);

    const centerTextFontSize = Math.max(
      10,
      Math.min(20, radius * (isZoomed ? 0.25 : 0.12))
    );
    const tooltipFontSize = isZoomed ? 18 : 13;
    const segmentLabelFontSize = Math.max(
      8,
      Math.min(20, radius * (isZoomed ? 0.25 : 0.1))
    );

    // Create a label arc for positioning text
    const labelArc = d3
      .arc<any, d3.PieArcDatum<RecentResultStatusItem>>()
      .innerRadius(radius * 0.85)
      .outerRadius(radius * 0.85);

    const arcPaths = g
      .selectAll("path")
      .data(pie(data))
      .enter()
      .append("path")
      .attr("fill", (d) => d.data.color)
      .attr("stroke", "white")
      .style("stroke-width", isZoomed ? "2px" : "1.5px")
      .style("cursor", "default")
      .attr("d", arc)
      .style("opacity", 0); // Start invisible

    // Animate arcs growing and fading in
    arcPaths
      .transition()
      .duration(800)
      .delay((d, i) => i * 100) // Stagger animation
      .ease(d3.easeBackOut.overshoot(1.1))
      .style("opacity", 1)
      .attrTween("d", function (d) {
        const i = d3.interpolate(
          { startAngle: d.startAngle, endAngle: d.startAngle },
          d
        );
        return function (t) {
          return arc(i(t)) || "";
        };
      });

    arcPaths
      .on("mouseover", function (event, d) {
        d3.select(this).transition().duration(150).attr("opacity", 0.85);
        if (tooltipRef.current) {
          tooltipRef.current.style.display = "block";
          tooltipRef.current.style.fontSize = `${tooltipFontSize}px`;
          const percentage =
            totalCount > 0 ? ((d.data.value / totalCount) * 100).toFixed(1) : 0;
          const displayValue =
            d.data.formattedValue ?? t("charts.count", { count: d.data.value });
          tooltipRef.current.innerHTML = `
            <strong>${d.data.name}</strong><br/>
            ${displayValue}<br/>
            ${t("charts.percent", { percent: percentage })}
          `;
        }
      })
      .on("mousemove", function (event) {
        if (tooltipRef.current) {
          tooltipRef.current.style.left = `${event.clientX + 15}px`;
          tooltipRef.current.style.top = `${event.clientY - 10}px`;
        }
      })
      .on("mouseout", function () {
        d3.select(this).transition().duration(150).attr("opacity", 1);
        if (tooltipRef.current) {
          tooltipRef.current.style.display = "none";
        }
      });

    // Add labels with background pills
    const labelGroups = g
      .selectAll(".segment-label-group")
      .data(pie(data))
      .enter()
      .append("g")
      .attr("class", "segment-label-group")
      .attr("transform", (d) => {
        const [x, y] = labelArc.centroid(d);
        return `translate(${x}, ${y})`;
      })
      .style("opacity", 0); // Start invisible

    // First add the text to measure its size
    labelGroups.each(function (d) {
      const group = d3.select(this);

      // Add text elements first (invisible)
      const nameText = group
        .append("text")
        .attr("text-anchor", "middle")
        .attr("dy", "-0.1em")
        .style("font-size", `${segmentLabelFontSize}px`)
        .style("font-weight", "bold")
        .style("opacity", "0")
        .text(d.data.name);

      const valueText = group
        .append("text")
        .attr("text-anchor", "middle")
        .attr("dy", "1.1em")
        .style("font-size", `${segmentLabelFontSize * 0.9}px`)
        .style("font-weight", "normal")
        .style("opacity", "0")
        .text(d.data.formattedValue ?? d.data.value.toString());

      // Get bounding boxes
      const nameBBox = (nameText.node() as SVGTextElement).getBBox();
      const valueBBox = (valueText.node() as SVGTextElement).getBBox();

      // Calculate combined bounding box
      const combinedBBox = {
        x: Math.min(nameBBox.x, valueBBox.x),
        y: nameBBox.y,
        width: Math.max(nameBBox.width, valueBBox.width),
        height: valueBBox.y + valueBBox.height - nameBBox.y,
      };

      // Add background rectangle with padding
      const padding = 6;
      group
        .insert("rect", "text")
        .attr("x", combinedBBox.x - padding)
        .attr("y", combinedBBox.y - padding / 2)
        .attr("width", combinedBBox.width + padding * 2)
        .attr("height", combinedBBox.height + padding)
        .attr("rx", 4)
        .attr("ry", 4)
        .style("fill", "hsl(var(--background) / 0.7)")
        .style("stroke", "hsl(var(--border))")
        .style("stroke-width", "1px");

      // Make text visible
      nameText
        .style("opacity", "1")
        .style("fill", "hsl(var(--foreground))")
        .style("pointer-events", "none");

      valueText
        .style("opacity", "1")
        .style("fill", "hsl(var(--foreground))")
        .style("pointer-events", "none");
    });

    // Animate label groups fading in after arcs
    labelGroups
      .transition()
      .delay((d, i) => 600 + i * 100) // Start after arcs begin
      .duration(400)
      .ease(d3.easeQuadOut)
      .style("opacity", 1);

    // Center text with background pill
    const centerGroup = g.append("g").style("opacity", 0);

    // Add center text first (invisible)
    const centerLabelText = centerGroup
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dy", "-0.3em")
      .style("font-size", `${centerTextFontSize * 0.9}px`)
      .style("font-weight", "normal")
      .style("opacity", "0")
      .text(centerLabel || t("common.labels.total"));

    const centerValueText = centerGroup
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dy", "0.8em")
      .style("font-size", `${centerTextFontSize}px`)
      .style("font-weight", "bold")
      .style("opacity", "0")
      .text(formattedTotal ?? totalCount);

    // Get combined bounding box
    const labelBBox = (centerLabelText.node() as SVGTextElement).getBBox();
    const valueBBox = (centerValueText.node() as SVGTextElement).getBBox();
    const combinedBBox = {
      x: Math.min(labelBBox.x, valueBBox.x),
      y: labelBBox.y,
      width: Math.max(labelBBox.width, valueBBox.width),
      height: valueBBox.y + valueBBox.height - labelBBox.y,
    };

    // Add background pill
    const padding = 10;
    centerGroup
      .insert("rect", "text")
      .attr("x", combinedBBox.x - padding)
      .attr("y", combinedBBox.y - padding / 2)
      .attr("width", combinedBBox.width + padding * 2)
      .attr("height", combinedBBox.height + padding)
      .attr("rx", 6)
      .attr("ry", 6)
      .style("fill", "hsl(var(--background) / 0.6)")
      .style("stroke", "hsl(var(--border))")
      .style("stroke-width", "1px");

    // Make center text visible
    centerLabelText
      .style("opacity", "1")
      .style("fill", "hsl(var(--muted-foreground))");

    centerValueText
      .style("opacity", "1")
      .style("fill", "hsl(var(--foreground))");

    // Animate center group
    centerGroup
      .transition()
      .delay(400)
      .duration(600)
      .ease(d3.easeQuadOut)
      .style("opacity", 1);
  }, [data, width, height, isZoomed, t, formattedTotal, centerLabel]);

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
    </div>
  );
};

export default RecentResultsDonut;
