"use client";

import React, { useEffect, useRef } from "react";
import * as d3 from "d3";
import useResponsiveSVG from "~/hooks/useResponsiveSVG"; // Assuming this hook is available and works as in SummarySunburstChart
import { useTranslations } from "next-intl";

// Define the structure for a sunburst chart node
export interface SunburstNode {
  name: string;
  children?: SunburstNode[];
  value?: number; // For leaf nodes
  id?: number | string; // Optional: useful for interactions
  color?: string; // To store the color for the node
  data?: SunburstNode; // D3 often wraps original data in a 'data' property
}

// Define the expected structure for a repository case aggregate
interface RepositoryCaseAggregate {
  automated: boolean;
  count: number;
  state?: {
    name: string;
    color?: {
      value: string;
    } | null;
  } | null;
}

interface ProjectOverviewSunburstChartProps {
  data: RepositoryCaseAggregate[];
}

const ProjectOverviewSunburstChart: React.FC<
  ProjectOverviewSunburstChartProps
> = ({ data }) => {
  const t = useTranslations();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { width, height } = useResponsiveSVG(containerRef);

  // Effect to manage tooltip DIV in document.body (from SummarySunburstChart)
  useEffect(() => {
    const tooltipElement = document.createElement("div");
    tooltipElement.style.position = "fixed";
    tooltipElement.style.display = "none";
    tooltipElement.style.backgroundColor = "rgba(0,0,0,0.85)";
    tooltipElement.style.color = "white";
    tooltipElement.style.padding = "5px 10px";
    tooltipElement.style.borderRadius = "3px";
    tooltipElement.style.fontSize = "12px";
    tooltipElement.style.pointerEvents = "none";
    tooltipElement.style.zIndex = "2000";
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
    const transformDataForSunburst = (
      cases: RepositoryCaseAggregate[]
    ): SunburstNode => {
      const root: SunburstNode = { name: "root", children: [] };
      const automationGroupMap = new Map<string, SunburstNode>();

      cases.forEach((caseItem) => {
        const count = caseItem.count ?? 0;
        if (!count) {
          return;
        }

        const automationStatusName = caseItem.automated
          ? t("common.fields.automated")
          : t("common.fields.notAutomated");

        let automationNode = automationGroupMap.get(automationStatusName);
        if (!automationNode) {
          automationNode = { name: automationStatusName, children: [] };
          automationGroupMap.set(automationStatusName, automationNode);
          root.children?.push(automationNode);
        }

        const stateName = caseItem.state?.name || t("common.labels.unknown");
        const stateColor = caseItem.state?.color?.value;
        let stateNode = automationNode.children?.find(
          (child) => child.name === stateName
        );

        if (!stateNode) {
          stateNode = { name: stateName, value: 0, color: stateColor };
          automationNode.children?.push(stateNode);
        }
        stateNode.value = (stateNode.value || 0) + count;
      });
      return root;
    };

    if (!svgRef.current || !data || width === 0 || height === 0) {
      if (svgRef.current) d3.select(svgRef.current).selectAll("*").remove();
      return;
    }

    const sunburstData = transformDataForSunburst(data);
    if (!sunburstData.children || sunburstData.children.length === 0) {
      if (svgRef.current) d3.select(svgRef.current).selectAll("*").remove();
      // Optionally display a message like "No data to display"
      const svg = d3.select(svgRef.current);
      svg
        .append("text")
        .attr("x", width / 2)
        .attr("y", height / 2)
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "middle")
        .style("font-size", "14px")
        .style("fill", "#888")
        .text(t("common.labels.noCases")); // Using translation
      return;
    }

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const radius = Math.min(width, height) / 2 - 10;
    const holeRadius = radius * 0.3; // Define a 10% hole in the center

    const d3ColorScale = d3.scaleOrdinal(["#1f77b4", "#ff7f0e"]); // Colors for Automated/Not Automated

    // Create the D3 hierarchy and partition
    const hierarchy = d3
      .hierarchy<SunburstNode>(sunburstData)
      .sum((d) => d.value || 0)
      .sort((a, b) => (b.value || 0) - (a.value || 0));

    const partition = d3
      .partition<SunburstNode>()
      .size([2 * Math.PI, radius * radius]); // area

    const rootNode = partition(hierarchy);

    // Define arc generator
    const arc = d3
      .arc<d3.HierarchyRectangularNode<SunburstNode>>()
      .startAngle((d) => d.x0)
      .endAngle((d) => d.x1)
      .padAngle((d) => Math.min((d.x1 - d.x0) / 2, 0.005))
      .padRadius(radius / 2)
      .innerRadius((d) => {
        if (d.depth === 1) return holeRadius; // First ring starts at the edge of the hole
        return Math.sqrt(d.y0); // Subsequent rings start where their parent ended
      })
      .outerRadius((d) => Math.sqrt(d.y1) - 1);

    const g = svg
      .append("g")
      .attr("transform", `translate(${width / 2},${height / 2})`);

    const path = g
      .selectAll("path")
      .data(rootNode.descendants().slice(1)) // Skip the root node itself
      .join("path")
      .attr("fill", (d) => {
        if (d.depth === 1) return d3ColorScale(d.data.name); // Automated/Manual color
        if (d.depth === 2) return d.data.color || "#ccc";
        if (d.depth === 3 && d.parent)
          return (
            d3
              .color(
                d3ColorScale(d.parent.parent?.data.name || d.parent.data.name)
              )
              ?.darker(0.5)
              .toString() || d3ColorScale(d.data.name)
          );
        return "#ccc"; // Default for deeper or unstyled levels
      })
      .attr("fill-opacity", 0.8)
      .attr("d", arc)
      .style("cursor", "pointer")
      .style("opacity", 0); // Start invisible

    // Add event handlers before animation
    path
      .on("mouseover", (event, d) => {
        path.interrupt(); // Interrupt ongoing transitions
        path.attr("fill-opacity", 0.5);
        d3.select(event.currentTarget).attr("fill-opacity", 1);
        if (tooltipRef.current) {
          tooltipRef.current.style.display = "block";
          const count = d.value || 0;
          tooltipRef.current.innerHTML = `${d.data.name}<br/>${t("charts.count", { count })}`;
        }
      })
      .on("mousemove", (event) => {
        if (tooltipRef.current) {
          tooltipRef.current.style.left = `${event.clientX + 15}px`;
          tooltipRef.current.style.top = `${event.clientY + 15}px`;
        }
      })
      .on("mouseout", () => {
        path.attr("fill-opacity", 0.8);
        if (tooltipRef.current) tooltipRef.current.style.display = "none";
      });

    // Animate arcs growing with staggered timing
    path
      .transition()
      .duration(800)
      .delay((d, i) => (d.depth - 1) * 200 + i * 50) // Stagger by depth and index
      .ease(d3.easeBackOut.overshoot(1.1))
      .style("opacity", 1);

    // Add total count and label in the center
    const centerText = g
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "central") // Use central for easier tspan alignment
      .style("fill", "#333")
      .style("opacity", 0); // Start invisible

    centerText
      .append("tspan")
      .attr("x", 0)
      .attr("dy", "-0.3em") // Adjust dy to position the number slightly up
      .style("font-size", `${Math.max(14, holeRadius * 0.5)}px`) // Larger font for the number
      .style("font-weight", "bold")
      .text(rootNode.value || 0);

    centerText
      .append("tspan")
      .attr("x", 0)
      .attr("dy", "1.5em") // Adjust dy to position the label below the number
      .style("font-size", `${Math.max(10, holeRadius * 0.25)}px`) // Smaller font for the label
      .text(t("common.fields.testCases"));

    // Animate center text
    centerText
      .transition()
      .delay(600)
      .duration(600)
      .ease(d3.easeQuadOut)
      .style("opacity", 1);

    g.selectAll("text.label")
      .data(
        rootNode
          .descendants()
          .filter((d) => d.depth && (d.y1 - d.y0) * (d.x1 - d.x0) > 0.015)
      )
      .join("text")
      .attr("class", "label") // Added class here
      .attr("transform", (d) => {
        const x = (((d.x0 + d.x1) / 2) * 180) / Math.PI;
        const y = Math.sqrt(d.y0 + (d.y1 - d.y0) / 2);
        return `rotate(${x - 90}) translate(${y},0) rotate(${x < 180 ? 0 : 180})`;
      })
      .attr("dy", "0.35em")
      .attr("fill", "currentColor")
      .style("font-size", "10px")
      .attr("text-anchor", "middle")
      .text((d) =>
        d.data.name.length > 15
          ? d.data.name.substring(0, 12) + "..."
          : d.data.name
      )
      .style("pointer-events", "none");
  }, [data, width, height, t]); // Removed transformDataForSunburst from dependency array

  return (
    <div ref={containerRef} className="w-full h-64 relative">
      {" "}
      {/* Ensure container has dimensions */}
      <svg ref={svgRef} width={width} height={height}></svg>
    </div>
  );
};

export default ProjectOverviewSunburstChart;
