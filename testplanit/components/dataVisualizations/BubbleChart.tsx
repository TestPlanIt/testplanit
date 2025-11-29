import React, { useEffect, useRef, useCallback } from "react";
import * as d3 from "d3";

// Type for the raw tag data input
type TagData = {
  id: number; // Numeric ID for tags
  name: string;
  count: number;
};

// Type for the data associated with each LEAF node in the D3 hierarchy
type LeafHierarchyData = TagData & { value: number };

// Type for the data associated with the ROOT node in the D3 hierarchy
interface RootHierarchyData {
  rootId: string; // Using a distinct name for the root's identifier
  children: LeafHierarchyData[];
}

// Union type for any datum that can be part of our D3 hierarchy
type HierarchyNodeDatum = RootHierarchyData | LeafHierarchyData;

// Props for the BubbleChart component
type BubbleChartProps = {
  tags: TagData[];
  onTagClick: (tagId: number) => void; // Callback for when a tag bubble is clicked
};

export const BubbleChart: React.FC<BubbleChartProps> = ({
  tags,
  onTagClick, // Use the callback prop
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const resizeFrameRef = useRef<number | null>(null);

  const drawChart = useCallback(() => {
    if (
      !svgRef.current ||
      !containerRef.current ||
      !tags ||
      tags.length === 0
    ) {
      if (svgRef.current) d3.select(svgRef.current).selectAll("*").remove();
      return;
    }

    const svgElement = svgRef.current;
    const container = containerRef.current;

    const width = container.clientWidth;
    const height =
      container.clientHeight > 0 ? container.clientHeight : width * 0.8;
    const margin = 2;

    if (width === 0 || height === 0) {
      return;
    }

      const hierarchyInput: RootHierarchyData = {
        rootId: "rootNode",
        children: tags.map((tag) => ({
          ...tag,
          value: tag.count,
        })),
      };

      const root = d3
        .hierarchy<HierarchyNodeDatum>(hierarchyInput, (d) => {
          if ("children" in d && d.children) {
            return d.children;
          }
          return null;
        })
        .sum((d) => {
          if (!("children" in d) || !d.children) {
            if (typeof (d as LeafHierarchyData).value === "number") {
              return (d as LeafHierarchyData).value;
            }
          }
          return 0;
        })
        .sort((a, b) => (b.value || 0) - (a.value || 0));

      const pack = d3
        .pack<HierarchyNodeDatum>()
        .size([width - margin * 2, height - margin * 2])
        .padding(5);

      const packedRoot = pack(root);

      // Determine min/max values for color scaling
      const leafDataValues = packedRoot
        .leaves()
        .map((d) => (d.data as LeafHierarchyData).value);
      const minValue = d3.min(leafDataValues) || 0;
      const maxValue = d3.max(leafDataValues) || 1;

      let computedPrimaryColorString = "hsl(210, 40%, 50%)"; // A sensible default
      if (svgElement && typeof window !== "undefined") {
        const style = getComputedStyle(svgElement);
        const primaryVar = style.getPropertyValue("--primary").trim();

        if (primaryVar) {
          if (
            primaryVar.split(" ").length === 3 &&
            !primaryVar.startsWith("hsl")
          ) {
            // Input: "H S% L%" -> Output: "hsl(H, S%, L%)"
            const parts = primaryVar.split(" ");
            computedPrimaryColorString = `hsl(${parts[0]}, ${parts[1]}, ${parts[2]})`;
          } else if (
            primaryVar.startsWith("hsl(") &&
            primaryVar.split(",").length === 1
          ) {
            // Input: "hsl(H S% L%)" -> Output: "hsl(H, S%, L%)"
            // Handles if primaryVar is already hsl() but with spaces instead of commas
            computedPrimaryColorString = primaryVar
              .replace(/\s+/g, ",")
              .replace("(,", "(");
          } else {
            computedPrimaryColorString = primaryVar;
          }
        } else {
          const h = style.getPropertyValue("--primary-h").trim();
          const s = style.getPropertyValue("--primary-s").trim();
          const l = style.getPropertyValue("--primary-l").trim();
          if (h && s && l) {
            // Output: "hsl(H, S%, L%)"
            computedPrimaryColorString = `hsl(${h}, ${s}, ${l})`;
          }
        }
      }

      // Ensure the string is in the format d3.color expects, specifically with commas for hsl if it was space-separated.
      // If it was "H S% L%", it's now "hsl(H, S%, L%)".
      // If it was "hsl(H S% L%)", the regex above attempts to put commas.
      // This is a bit of a brute force replacement for spaces within hsl() to commas, might need refinement.
      if (
        computedPrimaryColorString.startsWith("hsl(") &&
        computedPrimaryColorString.includes(" ") &&
        !computedPrimaryColorString.includes(",")
      ) {
        const content = computedPrimaryColorString.substring(
          4,
          computedPrimaryColorString.length - 1
        );
        const parts = content.split(/\s+/).join(", ");
        computedPrimaryColorString = `hsl(${parts})`;
      }

      const opacityScale = d3
        .scaleLinear()
        .domain([minValue, maxValue])
        .range([0.3, 0.9]);

    const svg = d3
      .select(svgElement)
      .attr("width", width)
      .attr("height", height)
      .attr("viewBox", [-margin, -margin, width, height])
      .attr("style", "max-width: 100%; height: auto; font: 10px sans-serif;")
      .attr("text-anchor", "middle");

    svg.selectAll("*").remove();

    const leafNodes = svg
      .append("g")
      .selectAll("g")
      .data(packedRoot.leaves())
      .join("g")
      .attr("transform", (d) => `translate(${d.x},${d.y})`);

    const foregroundColor = "hsl(var(--primary-foreground))";

    leafNodes.append("title").text((d) => {
      const nodeData = d.data as LeafHierarchyData;
      return `${nodeData.name}\n${d3.format(",d")(nodeData.value)}`;
    });

    leafNodes
      .append("circle")
      .attr("r", 0)
      .attr("fill", (d) => {
        const value = (d.data as LeafHierarchyData).value;
        const d3Color = d3.color(computedPrimaryColorString);
        if (d3Color) {
          d3Color.opacity = opacityScale(value);
          return d3Color.toString();
        }
        return "#888";
      })
      .style("cursor", "pointer")
      .on("mouseenter", function (_event, d) {
        d3.select(this)
          .transition()
          .duration(300)
          .attr("r", d.r * 1.4)
          .style("filter", "brightness(1.15)");
      })
      .on("mouseleave", function (_event, d) {
        d3.select(this)
          .transition()
          .duration(200)
          .attr("r", d.r)
          .style("filter", "brightness(1)");
      })
      .on("click", (_event, d) => {
        const nodeData = d.data as LeafHierarchyData;
        if (nodeData.id != null) {
          onTagClick(nodeData.id);
        }
      })
      .transition()
      .duration(500)
      .attr("r", (d) => d.r * 1.25)
      .transition()
      .duration(250)
      .attr("r", (d) => d.r * 0.9)
      .transition()
      .duration(350)
      .attr("r", (d) => d.r * 1.05)
      .transition()
      .duration(150)
      .attr("r", (d) => d.r);

      leafNodes.each(function (dNode) {
        const group = d3.select(this);
        const radius = dNode.r;
        const diameter = radius * 2;
        const nodeData = dNode.data as LeafHierarchyData;

        if (radius < 10) return;

        const baseFontSize = Math.max(8, Math.min(radius / 3, 16));

        const fo = group
          .append("foreignObject")
          .attr("x", -radius)
          .attr("y", -radius)
          .attr("width", diameter)
          .attr("height", diameter)
          .style("pointer-events", "none");

        const div = fo
          .append("xhtml:div")
          .style("display", "flex")
          .style("flex-direction", "column")
          .style("align-items", "center")
          .style("justify-content", "center")
          .style("width", "100%")
          .style("height", "100%")
          .style("font-family", "'Noto Sans', sans-serif")
          .style("color", foregroundColor)
          .style("text-align", "center")
          .style("overflow", "hidden")
          .style("word-break", "break-word")
          .style("pointer-events", "none");

        const nameText = nodeData.name;

        div.html(
          `<div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; height: 100%; padding: 3px; box-sizing: border-box; cursor: pointer;">
          <span style="font-size: ${baseFontSize}px; line-height: 1.1; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; max-height: ${
            baseFontSize * 1.1 * 2
          }px;">
            ${nameText}
          </span>
        </div>`
        );
      });
  }, [tags, onTagClick]);

  useEffect(() => {
    const scheduleDraw = () => {
      if (resizeFrameRef.current !== null) {
        cancelAnimationFrame(resizeFrameRef.current);
      }
      resizeFrameRef.current = window.requestAnimationFrame(() => {
        resizeFrameRef.current = null;
        drawChart();
      });
    };

    scheduleDraw();
    window.addEventListener("resize", scheduleDraw);

    return () => {
      if (resizeFrameRef.current !== null) {
        cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }
      window.removeEventListener("resize", scheduleDraw);
    };
  }, [drawChart]); // drawChart is the only dependency here as containerRef itself doesn't trigger re-runs of this effect

  return (
    <div
      ref={containerRef}
      className="w-full h-full flex items-center justify-center"
    >
      <svg ref={svgRef} />
    </div>
  );
};
