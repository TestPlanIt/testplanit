import React, { useEffect, useRef } from "react";
import * as d3 from "d3";
import type { ChartableItem, ChartableCase } from "../UserDashboard"; // Updated import
import { toHumanReadable } from "../../utils/duration";
import useResponsiveSVG from "~/hooks/useResponsiveSVG"; // Import the hook
import { useTranslations } from "next-intl";

interface UserWorkChartProps {
  data: ChartableItem[]; // Updated prop type
  locale?: string;
}

const UserWorkChart: React.FC<UserWorkChartProps> = ({
  data,
  locale = "en",
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { width, height } = useResponsiveSVG(containerRef);
  const t = useTranslations();

  useEffect(() => {
    if (data && data.length > 0 && svgRef.current && width > 0 && height > 0) {
      const svg = d3.select(svgRef.current);
      svg.selectAll("*").remove();

      const margin = { top: 20, right: 30, bottom: 70, left: 150 };
      const chartWidth = width - margin.left - margin.right;
      const chartHeight = height - margin.top - margin.bottom;

      if (chartWidth <= 0 || chartHeight <= 0) return;

      const g = svg
        .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

      const y = d3
        .scaleBand()
        .domain(data.map((d) => d.name)) // Session names or Test Run names
        .range([0, chartHeight])
        .padding(0.2); // Increased padding a bit for groups

      const x = d3
        .scaleLinear()
        .domain([
          0,
          d3.max(data, (d) =>
            d.type === "Session" ? d.timeValue : d.totalTimeValue
          ) || 0,
        ])
        .range([0, chartWidth]);

      g.append("g")
        .attr("transform", `translate(0,${chartHeight})`)
        .call(
          d3
            .axisBottom(x)
            .tickFormat((d) => `${(+d / 3600).toFixed(1)} business hours`)
        )
        .selectAll("text")
        .attr("transform", "translate(-10,0)rotate(-45)")
        .style("text-anchor", "end");

      g.append("text")
        .attr("text-anchor", "end")
        .attr("x", chartWidth / 2 + margin.left)
        .attr("y", chartHeight + margin.top + 40)
        .text(t("charts.duration"));

      g.append("g").call(d3.axisLeft(y));

      // Create groups for each item (Session or Test Run Group)
      const itemGroups = g
        .selectAll(".chart-item-group")
        .data(data)
        .enter()
        .append("g")
        .attr("class", "chart-item-group")
        .attr("transform", (d) => `translate(0, ${y(d.name) || 0})`);

      // Render Session bars
      itemGroups
        .filter((d) => d.type === "Session")
        .append("rect")
        .attr("class", "session-bar")
        .attr("height", y.bandwidth())
        .attr("x", 0)
        .attr("width", 0)
        .attr("fill", "orange")
        .style("cursor", "pointer")
        .on("click", (event, d) => {
          const sessionData = d as Extract<ChartableItem, { type: "Session" }>;
          if (sessionData.link) {
            window.location.href = sessionData.link;
          }
        })
        .transition()
        .duration(800)
        .attr("width", (d) =>
          x((d as Extract<ChartableItem, { type: "Session" }>).timeValue)
        )
        .selection()
        .append("title")
        .text((d) => {
          const sessionData = d as Extract<ChartableItem, { type: "Session" }>;
          return `${sessionData.type}: ${sessionData.name}\nProject: ${sessionData.projectName}\nTime: ${(sessionData.timeValue / 3600).toFixed(1)} business hours`;
        });

      // Render Test Run Group stacked bars
      const testRunGroups = itemGroups.filter(
        (d) => d.type === "Test Run Group"
      ) as d3.Selection<
        SVGGElement,
        Extract<ChartableItem, { type: "Test Run Group" }>,
        SVGGElement,
        ChartableItem
      >;

      testRunGroups.each(function (runGroupData) {
        const groupSelection = d3.select(this);
        let currentX = 0;

        runGroupData.cases.forEach((caseData) => {
          if (caseData.timeValue <= 0) return; // Skip cases with no time

          const caseWidth = x(caseData.timeValue) - x(0); // Calculate width based on its own timeValue

          groupSelection
            .append("rect")
            .attr("class", "case-segment")
            .attr("x", currentX)
            .attr("height", y.bandwidth())
            .attr("width", 0)
            .attr("fill", "steelblue")
            .attr("stroke", "white")
            .attr("stroke-width", 0.5) // Thinner stroke
            .style("cursor", "pointer")
            .on("click", () => {
              // Event is not directly used here for caseData
              if (caseData.link) {
                window.location.href = caseData.link;
              }
            })
            .transition()
            .duration(800)
            .attr("width", caseWidth)
            .selection()
            .append("title")
            .text(
              () =>
                `${caseData.name}\nTest Run: ${runGroupData.name}\nProject: ${runGroupData.projectName}\nTime: ${(caseData.timeValue / 3600).toFixed(1)} business hours`
            );

          currentX += caseWidth;
        });
      });
    }
  }, [data, width, height, locale, t]);

  return (
    <div ref={containerRef} style={{ width: "100%", height: "350px" }}>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="user-work-chart"
      />
    </div>
  );
};

export default UserWorkChart;
