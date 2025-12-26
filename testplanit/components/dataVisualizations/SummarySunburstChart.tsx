"use client";

import React, { useEffect, useRef } from "react";
import * as d3 from "d3";
import { toHumanReadable } from "~/utils/duration";
import useResponsiveSVG from "~/hooks/useResponsiveSVG";
import { useTranslations } from "next-intl";

export interface SunburstHierarchyNode {
  name: string;
  id: string;
  value?: number;
  children?: SunburstHierarchyNode[];
  originalValue?: number;
  itemType?: "root" | "testRun" | "user";
  imageUrl?: string;
}

export interface SunburstLegendItem {
  id: string;
  name: string;
  color: string;
}

interface SummarySunburstChartProps {
  data: SunburstHierarchyNode;
  projectId: string;
  onSessionClick?: (sessionId: string) => void;
  onTestRunClick?: (testRunId: string) => void;
  onSegmentHover?: (details: string | null) => void;
  onLegendDataGenerated?: (legendItems: SunburstLegendItem[]) => void;
  onTotalCalculated?: (totalValue: number) => void;
  isZoomed?: boolean;
}

const SummarySunburstChart: React.FC<SummarySunburstChartProps> = ({
  data,
  projectId,
  onSessionClick,
  onTestRunClick,
  onSegmentHover,
  onLegendDataGenerated,
  onTotalCalculated,
  isZoomed = false,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { width, height } = useResponsiveSVG(containerRef);
  const t = useTranslations();

  // Effect to manage tooltip DIV in document.body
  useEffect(() => {
    // Create tooltip div programmatically
    const tooltipElement = document.createElement("div");
    tooltipElement.style.position = "fixed";
    tooltipElement.style.display = "none";
    tooltipElement.style.backgroundColor = "rgba(0,0,0,0.75)";
    tooltipElement.style.color = "white";
    tooltipElement.style.padding = "8px 12px";
    tooltipElement.style.borderRadius = "4px";
    tooltipElement.style.fontSize = "12px";
    tooltipElement.style.pointerEvents = "none";
    tooltipElement.style.zIndex = "2000"; // Ensure it's above most things, including dialogs

    document.body.appendChild(tooltipElement);
    tooltipRef.current = tooltipElement;

    // Cleanup function: remove tooltip from body when component unmounts
    return () => {
      if (
        tooltipRef.current &&
        tooltipRef.current.parentNode === document.body
      ) {
        document.body.removeChild(tooltipRef.current);
      }
      tooltipRef.current = null; // Clear ref
    };
  }, []); // Empty dependency array means this runs once on mount and cleans up on unmount

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
      if (onLegendDataGenerated) onLegendDataGenerated([]);
      if (onTotalCalculated) onTotalCalculated(0);
      return;
    }

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const margin = { top: 0, right: 0, bottom: 0, left: 0 };
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;
    const chartRadius = Math.min(chartWidth, chartHeight) / 2;

    const colorScale = d3.scaleOrdinal(d3.schemeTableau10);
    const userColorShadeFactor = 0.7;

    const innerHoleRadius = chartRadius * 0.2;
    const testRunRingOuterRadius = chartRadius * 0.8;
    const userRingOuterRadius = chartRadius * 0.95;

    const hierarchy = d3
      .hierarchy<SunburstHierarchyNode>(data)
      .sum((d) => d.value || 0)
      .sort((a, b) => (b.value || 0) - (a.value || 0));

    const partition = d3
      .partition<SunburstHierarchyNode>()
      .size([2 * Math.PI, 1]);

    const root = partition(hierarchy);

    const legendItems: SunburstLegendItem[] = [];
    root.descendants().forEach((d: any) => {
      if (d.depth === 1 && d.data.itemType === "testRun") {
        legendItems.push({
          id: d.data.id,
          name: d.data.name,
          color: colorScale(d.data.id),
        });
      }
    });
    if (onLegendDataGenerated) {
      onLegendDataGenerated(legendItems);
    }

    const arc = d3
      .arc<any, d3.HierarchyRectangularNode<SunburstHierarchyNode>>()
      .startAngle((d) => d.x0)
      .endAngle((d) => d.x1)
      .padAngle((d) => Math.min((d.x1 - d.x0) / 2, 0.005))
      .padRadius(chartRadius * 0.5)
      .innerRadius((d) => {
        if (d.depth === 1) return innerHoleRadius;
        if (d.depth === 2) return testRunRingOuterRadius;
        return 0;
      })
      .outerRadius((d) => {
        if (d.depth === 1) return testRunRingOuterRadius;
        if (d.depth === 2) return userRingOuterRadius;
        return innerHoleRadius;
      });

    const g = svg
      .append("g")
      .attr("transform", `translate(${width / 2}, ${height / 2})`);

    const pathContainerGroup = g.append("g"); // Group for path elements

    const pathElements = pathContainerGroup
      .selectAll("path")
      .data(root.descendants().slice(1))
      .join("path")
      .attr("fill", (d: any) => {
        if (d.data.itemType === "user" && d.parent) {
          return (
            d3
              .color(colorScale(d.parent.data.id))
              ?.darker(userColorShadeFactor)
              .toString() || colorScale("default")
          );
        }
        return colorScale(d.data.id);
      });

    // Start paths as invisible
    pathElements.style("opacity", 0);

    // Animate the 'd' attribute (arc paths) with staggered timing and fade in
    pathElements
      .transition()
      .duration(800) // Animation duration
      .delay((d, i) => (d.depth - 1) * 200 + i * 50) // Stagger by depth and index
      .ease(d3.easeBackOut.overshoot(1.1))
      .style("opacity", 1)
      .attrTween(
        "d",
        function (d_node: d3.HierarchyRectangularNode<SunburstHierarchyNode>) {
          const x0_val = d_node.x0; // Segment's fixed start angle
          const x1_interp = d3.interpolate(x0_val, d_node.x1); // Interpolate end angle from startAngle to its final value

          return function (t) {
            // Create a temporary node data object for the arc generator at each step of the interpolation
            const tempNodeData = {
              ...d_node, // Spread original node properties (y0, y1, depth, data, etc.)
              x0: x0_val,
              x1: x1_interp(t), // Use interpolated end angle
            };
            return (
              arc(
                tempNodeData as d3.HierarchyRectangularNode<SunburstHierarchyNode>
              ) || ""
            );
          };
        }
      );

    // Attach .each and event handlers to the pathElements selection
    pathElements.each(function (d: any) {
      const currentPath = d3.select(this);
      const itemType = d.data.itemType;
      const nodeId = d.data.id as string;

      // Default styles
      currentPath.style("cursor", "default").on("click.navigation", null);

      let isClickable = false;

      // Session Click Logic
      if (
        itemType === "testRun" && // Sessions on session page use itemType 'testRun' for depth 1
        nodeId.startsWith("session-") &&
        onSessionClick
      ) {
        const idParts = nodeId.split("-");
        const sessionId = idParts.length > 1 ? idParts[1] : null;
        if (sessionId) {
          isClickable = true;
          currentPath
            .style("cursor", "pointer")
            .on("click.navigation", (event) => {
              onSessionClick(sessionId);
            });
        }
      }
      // Test Run Click Logic
      else if (
        itemType === "testRun" && // Test Runs on runs page use itemType 'testRun' for depth 1
        nodeId.startsWith("run-") &&
        onTestRunClick
      ) {
        const idParts = nodeId.split("-");
        const testRunId = idParts.length > 1 ? idParts[1] : null;
        if (testRunId) {
          isClickable = true;
          currentPath
            .style("cursor", "pointer")
            .on("click.navigation", (event) => {
              onTestRunClick(testRunId);
            });
        }
      }

      // Apply hover effects if clickable
      if (isClickable) {
        currentPath
          .on("mouseover.linkeffect", function () {
            currentPath.transition().duration(150).attr("opacity", 0.7);
          })
          .on("mouseout.linkeffect", function () {
            currentPath.transition().duration(150).attr("opacity", 1);
          });
      } else {
        currentPath
          .on("mouseover.linkeffect", null)
          .on("mouseout.linkeffect", null);
      }

      // Tooltip logic
      currentPath
        .on("mouseover.tooltip", function (event, d_node: any) {
          if (tooltipRef.current) {
            tooltipRef.current.style.display = "block";
            const name = d_node.data.name;
            const value = d_node.data.originalValue || d_node.value || 0;
            const duration = toHumanReadable(value, {
              isSeconds: true,
              round: false,
              largest: 6,
            });
            let tooltipContent = `<strong>${name}</strong>`;
            if (value > 0) {
              if (duration && duration.trim() !== "") {
                tooltipContent += `<br/>${t("common.ui.charts.duration")}: ${duration}`;
              }
            }
            tooltipRef.current.innerHTML = tooltipContent;
          }
          if (onSegmentHover) onSegmentHover(d_node.data.name);
        })
        .on("mousemove.tooltip", function (event) {
          if (tooltipRef.current) {
            tooltipRef.current.style.left = `${event.clientX + 15}px`;
            tooltipRef.current.style.top = `${event.clientY - 10}px`;
          }
        })
        .on("mouseout.tooltip", function () {
          if (tooltipRef.current) {
            tooltipRef.current.style.display = "none";
          }
          if (onSegmentHover) onSegmentHover(null);
        });

      if (onSegmentHover) onSegmentHover(null);
    });

    const totalOriginalSeconds =
      data.children?.reduce((sum, run) => sum + (run.originalValue || 0), 0) ||
      0;

    if (onTotalCalculated) {
      onTotalCalculated(totalOriginalSeconds);
    }

    // Avatar and Label Configuration
    const avatarRingOuterRadius = userRingOuterRadius; // Avatars are in the user ring
    const avatarRingInnerRadius = testRunRingOuterRadius;
    const avatarSize = Math.max(
      isZoomed ? 12 : 8,
      Math.min(
        chartRadius * (isZoomed ? 0.15 : 0.1),
        (avatarRingOuterRadius - avatarRingInnerRadius) *
          (isZoomed ? 0.75 : 0.6),
        isZoomed ? 30 : 20
      )
    );

    const labelMinAngle = 0.05; // For text labels (depth 1)
    const userLabelMinAngle = 0.08; // Fallback for user text if needed, or guide for avatar visibility
    const labelFontSize = Math.max(
      isZoomed ? 14 : 7,
      Math.min(isZoomed ? 14 : 9, chartRadius * (isZoomed ? 0.09 : 0.06))
    );

    // Manage SVG defs for clipPaths (for circular avatars)
    let defs: d3.Selection<SVGDefsElement, unknown, null, undefined> =
      svg.select<SVGDefsElement>("defs#sunburst-chart-defs");
    if (defs.empty()) {
      defs = svg.append("defs").attr("id", "sunburst-chart-defs");
    }

    function isLabelOrAvatarVisible(
      d: d3.HierarchyRectangularNode<SunburstHierarchyNode>
    ) {
      const angle = d.x1 - d.x0;
      if (d.depth === 1) return angle > labelMinAngle;
      if (d.depth === 2 && d.data.itemType === "user") {
        const yPosition = (avatarRingInnerRadius + avatarRingOuterRadius) / 2;
        const arcWidthAtAvatarPosition = angle * yPosition;
        // Ensure segment is wide enough for avatar and some padding
        return arcWidthAtAvatarPosition > avatarSize * 1.2;
      }
      return false;
    }

    function getLabelOrAvatarTransform(
      d: d3.HierarchyRectangularNode<SunburstHierarchyNode>
    ) {
      const rotation = (((d.x0 + d.x1) / 2) * 180) / Math.PI - 90;
      let radialDistance = 0;
      if (d.depth === 1) {
        radialDistance = (innerHoleRadius + testRunRingOuterRadius) / 2;
      } else if (d.depth === 2 && d.data.itemType === "user") {
        radialDistance = (avatarRingInnerRadius + avatarRingOuterRadius) / 2;
      }
      return `rotate(${rotation}) translate(${radialDistance},0) rotate(${rotation > 90 ? 180 : 0})`;
    }

    const labelData = root
      .descendants()
      .slice(1)
      .filter(
        (d) => d.depth === 1 || (d.depth === 2 && d.data.itemType === "user")
      );

    const labelsGroup = g
      .append("g")
      .attr("pointer-events", "none")
      .attr("text-anchor", "middle")
      .style("user-select", "none");

    labelsGroup
      .selectAll("g.label-item")
      .data(labelData)
      .join("g")
      .attr("class", "label-item")
      .attr("transform", getLabelOrAvatarTransform)
      .style("opacity", (d) => {
        // Initially set user items (depth 2) to invisible
        if (d.depth === 2 && d.data.itemType === "user") {
          return 0;
        }
        return +isLabelOrAvatarVisible(d); // TestRun items (depth 1) visible as per logic
      })
      .each(function (dNode) {
        const group = d3.select(this);
        const d = dNode as d3.HierarchyRectangularNode<SunburstHierarchyNode>;

        // Apply fade-in transition specifically for user items after initial animation
        if (d.depth === 2 && d.data.itemType === "user") {
          group
            .transition()
            .delay(600)
            .duration(200)
            .style("opacity", +isLabelOrAvatarVisible(d));
        }

        if (d.depth === 2 && d.data.itemType === "user") {
          group.select("text.run-label").remove();

          const initials = d.data.name
            ? d.data.name
                .split(" ")
                .map((n) => n[0])
                .join("")
                .substring(0, 2)
                .toUpperCase()
            : "";

          if (d.data.imageUrl) {
            // Clear fallback if switching to image
            group.select("circle.avatar-fallback-circle").remove();
            group.select("text.avatar-fallback-text").remove();

            const baseClipId = `clip-sunburst-${d.data.id.replace(
              /[^a-zA-Z0-9-_]/g,
              ""
            )}`;
            const clipId = isZoomed
              ? `${baseClipId}-zoomed`
              : `${baseClipId}-normal`;

            let clipPath = defs.select<SVGClipPathElement>(`#${clipId}`);
            if (clipPath.empty()) {
              // If this specific (normal or zoomed) clipPath doesn't exist, create it.
              // Remove the other version if it exists to prevent defs bloat, though not strictly necessary for functionality.
              const otherClipId = isZoomed
                ? `${baseClipId}-normal`
                : `${baseClipId}-zoomed`;
              defs.select(`#${otherClipId}`).remove();

              clipPath = defs.append("clipPath").attr("id", clipId);
              // Append circle with the correct radius for the current zoom state.
              clipPath
                .append("circle")
                .attr("r", avatarSize / 2)
                .attr("cx", 0)
                .attr("cy", 0);
            } else {
              // If it somehow exists (e.g. multiple items with same ID, unlikely with this change),
              // ensure its circle is correctly sized. This branch is less likely to be hit now.
              let circleInClipPath =
                clipPath.select<SVGCircleElement>("circle");
              if (circleInClipPath.empty()) {
                circleInClipPath = clipPath.append("circle");
              }
              circleInClipPath
                .attr("r", avatarSize / 2)
                .attr("cx", 0)
                .attr("cy", 0);
            }

            let img = group.select<SVGImageElement>("image.user-avatar");
            if (img.empty()) {
              img = group.append("image").classed("user-avatar", true);
            }
            img
              .attr("href", d.data.imageUrl)
              .attr("x", -avatarSize / 2)
              .attr("y", -avatarSize / 2)
              .attr("width", avatarSize)
              .attr("height", avatarSize)
              .attr("clip-path", `url(#${clipId})`)
              .attr("preserveAspectRatio", "xMidYMid slice"); // Ensure image covers the area
          } else {
            // Fallback: Circle with initials
            group.select("image.user-avatar").remove(); // Clear image if switching to fallback

            let fallbackCircle = group.select<SVGCircleElement>(
              "circle.avatar-fallback-circle"
            );
            if (fallbackCircle.empty()) {
              fallbackCircle = group
                .append("circle")
                .classed("avatar-fallback-circle", true);
            }
            fallbackCircle
              .attr("r", avatarSize / 2)
              .attr("fill", colorScale(d.parent?.data.id || d.data.id))
              .style("opacity", 0.6);

            let fallbackText = group.select<SVGTextElement>(
              "text.avatar-fallback-text"
            );
            if (fallbackText.empty()) {
              fallbackText = group
                .append("text")
                .classed("avatar-fallback-text", true);
            }
            fallbackText
              .style("font-size", `${avatarSize * (isZoomed ? 0.6 : 0.5)}px`)
              .attr("dy", "0.35em")
              .style("fill", "currentColor")
              .text(initials);
          }
        } else if (d.depth === 1) {
          // Test Run Name (text label)
          // Clear avatar elements if switching to text label
          group.select("image.user-avatar").remove();
          group.select("circle.avatar-fallback-circle").remove();
          group.select("text.avatar-fallback-text").remove();

          let textLabel = group.select<SVGTextElement>("text.run-label");
          if (textLabel.empty()) {
            textLabel = group.append("text").classed("run-label", true);
          }
          textLabel
            .attr("dy", "0.35em")
            .style("font-size", `${labelFontSize}px`)
            .style("fill", "currentColor")
            .text(() => {
              const angle = d.x1 - d.x0;
              const midpointRadius =
                (innerHoleRadius + testRunRingOuterRadius) / 2;
              const arcLength = angle * midpointRadius;
              const maxChars = Math.floor(arcLength / (labelFontSize * 0.6));
              const name = d.data.name;
              if (maxChars <= 2) return "";
              return name.length > maxChars
                ? name.substring(0, maxChars - 2) + "..."
                : name;
            });
        }
      });
  }, [
    data,
    width,
    height,
    projectId,
    onSessionClick,
    onTestRunClick,
    onSegmentHover,
    onLegendDataGenerated,
    onTotalCalculated,
    isZoomed,
    t,
  ]);

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

export default SummarySunburstChart;
