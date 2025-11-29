"use client";
import React, { useEffect, useRef } from "react";
import * as d3 from "d3";
import { toHumanReadable } from "~/utils/duration";
import useResponsiveSVG from "~/hooks/useResponsiveSVG";
import { useTranslations, useLocale } from "next-intl";

export interface SunburstHierarchyNode {
  name: string;
  id: string;
  value?: number;
  formattedValue?: string;
  children?: SunburstHierarchyNode[];
  color?: string;
}

interface ReportSunburstChartProps {
  data: SunburstHierarchyNode;
  isZoomed?: boolean;
  isTimeBased?: boolean;
  totalLabel?: string;
  totalValue?: number;
}

export const ReportSunburstChart: React.FC<ReportSunburstChartProps> = ({
  data,
  isZoomed = false,
  isTimeBased = false,
  totalLabel,
  totalValue,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { width, height } = useResponsiveSVG(containerRef);
  const t = useTranslations();
  const locale = useLocale();

  useEffect(() => {
    const tooltipElement = document.createElement("div");
    tooltipElement.style.position = "fixed";
    tooltipElement.style.display = "none";
    tooltipElement.style.backgroundColor = "rgba(0,0,0,0.75)";
    tooltipElement.style.color = "white";
    tooltipElement.style.padding = "8px 12px";
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
      !data.children ||
      data.children.length === 0 ||
      width === 0 ||
      height === 0
    ) {
      if (svgRef.current) d3.select(svgRef.current).selectAll("*").remove();
      return;
    }

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const radius = Math.min(width, height) / 2;
    const colorScale = d3.scaleOrdinal(d3.schemeTableau10);

    const hierarchy = d3
      .hierarchy<SunburstHierarchyNode>(data)
      .sum((d) => d.value || 0)
      .sort((a, b) => (b.value || 0) - (a.value || 0));

    const holeRadius = radius * 0.2;

    const partition = d3
      .partition<SunburstHierarchyNode>()
      .size([2 * Math.PI, radius - holeRadius]);

    const root = partition(hierarchy);

    const arc = d3
      .arc<any, d3.HierarchyRectangularNode<SunburstHierarchyNode>>()
      .startAngle((d) => d.x0)
      .endAngle((d) => d.x1)
      .padAngle((d) => Math.min((d.x1 - d.x0) / 2, 0.005))
      .padRadius(radius / 2)
      .innerRadius((d) => d.y0 + holeRadius)
      .outerRadius((d) => d.y1 + holeRadius);

    const g = svg
      .append("g")
      .attr("transform", `translate(${width / 2},${height / 2})`);

    const path = g
      .selectAll("path")
      .data(root.descendants().slice(1)) // Skip root
      .join("path")
      .attr("d", arc)
      .attr("fill", (d) => {
        if (d.data.color) return d.data.color;
        while (d.depth > 1) d = d.parent!;
        return colorScale(d.data.name);
      })
      .attr("fill-opacity", (d) => (d.children ? 0.9 : 0.7))
      .style("opacity", 0); // Start invisible

    // Add event handlers before animation
    path
      .on("mouseover", (event, d) => {
        if (tooltipRef.current) {
          tooltipRef.current.style.display = "block";
          const node = d.data;
          const value = d.value || 0;

          // Use pre-formatted value if available, otherwise format based on type
          let displayValue = node.formattedValue;
          if (!displayValue) {
            if (isTimeBased) {
              displayValue = toHumanReadable(value, {
                isSeconds: true,
                locale,
              });
            } else {
              displayValue = value.toLocaleString();
            }
          }

          tooltipRef.current.innerHTML = `<strong>${node.name}</strong><br/>${displayValue}`;
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

    // Animate arcs growing with staggered timing
    path
      .transition()
      .duration(800)
      .delay((d, i) => (d.depth - 1) * 200 + i * 50) // Stagger by depth and index
      .ease(d3.easeBackOut.overshoot(1.1))
      .style("opacity", 1);

    // Add center total if provided
    if (totalValue !== undefined && totalLabel) {
      const centerTextFontSize = Math.max(12, Math.min(24, holeRadius * 0.6));
      const centerLabelFontSize = Math.max(10, Math.min(16, holeRadius * 0.4));

      const centerText = g
        .append("text")
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "central")
        .style("fill", "#333")
        .style("opacity", 0); // Start invisible

      // Format the total value
      let formattedValue: string;
      if (isTimeBased) {
        formattedValue = toHumanReadable(totalValue, {
          isSeconds: true,
          locale,
        });
      } else {
        formattedValue = totalValue.toLocaleString();
      }

      centerText
        .append("tspan")
        .attr("x", 0)
        .attr("dy", "-0.3em")
        .style("font-size", `${centerTextFontSize}px`)
        .style("font-weight", "bold")
        .text(formattedValue);

      centerText
        .append("tspan")
        .attr("x", 0)
        .attr("dy", "1.5em")
        .style("font-size", `${centerLabelFontSize}px`)
        .text(totalLabel);

      // Animate center text
      centerText
        .transition()
        .delay(600)
        .duration(600)
        .ease(d3.easeQuadOut)
        .style("opacity", 1);
    }
  }, [data, width, height, t, isTimeBased, locale, totalLabel, totalValue]);

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        minHeight: "300px",
      }}
    >
      <svg ref={svgRef} width={width} height={height}></svg>
    </div>
  );
};
