"use client";
import React, { useEffect, useRef, useMemo } from "react";
import * as d3 from "d3";
import useResponsiveSVG from "~/hooks/useResponsiveSVG";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "~/lib/navigation";

interface ExecutionStatus {
  resultId: number;
  testRunId: number | null;
  statusName: string;
  statusColor: string;
  isSuccess: boolean;
  isFailure: boolean;
  executedAt: string;
}

interface FlakyTestData {
  testCaseId: number;
  testCaseName: string;
  testCaseSource: string;
  flipCount: number;
  executions: ExecutionStatus[];
  project?: {
    id: number;
    name?: string;
  };
}

interface BubbleDataPoint {
  id: number;
  name: string;
  flipCount: number;
  recencyScore: number; // 0-1, higher = more recent failures
  failureRate: number; // 0-1, percentage of non-success executions
  priorityScore: number; // Combined score for sizing
  mostRecentFailure: Date | null;
  totalExecutions: number;
}

interface FlakyTestsBubbleChartProps {
  data: FlakyTestData[];
  consecutiveRuns: number;
  totalCount?: number; // Total number of flaky tests (including those not shown)
  projectId?: number | string; // Project ID for building links (used when not cross-project)
  onTestClick?: (testCaseId: number, projectId?: number) => void;
}

/**
 * Calculate a recency score based on how recently the test has failed.
 * Score is 0-1, where 1 means the most recent execution was a failure.
 * Uses exponential decay - more recent failures weight more heavily.
 */
function calculateRecencyScore(executions: ExecutionStatus[]): number {
  if (!executions || executions.length === 0) return 0;

  let score = 0;
  let weight = 1;
  const decayFactor = 0.7; // Each older execution is worth 70% of the previous

  for (let i = 0; i < executions.length; i++) {
    const execution = executions[i];
    if (!execution.isSuccess) {
      score += weight;
    }
    weight *= decayFactor;
  }

  // Normalize by max possible score (geometric series sum)
  const maxScore =
    (1 - Math.pow(decayFactor, executions.length)) / (1 - decayFactor);
  return maxScore > 0 ? score / maxScore : 0;
}

/**
 * Calculate failure rate as percentage of non-success executions
 */
function calculateFailureRate(executions: ExecutionStatus[]): number {
  if (!executions || executions.length === 0) return 0;
  const failures = executions.filter((e) => !e.isSuccess).length;
  return failures / executions.length;
}

/**
 * Find the most recent failure date
 */
function getMostRecentFailure(executions: ExecutionStatus[]): Date | null {
  if (!executions) return null;
  for (const execution of executions) {
    if (!execution.isSuccess) {
      return new Date(execution.executedAt);
    }
  }
  return null;
}

export const FlakyTestsBubbleChart: React.FC<FlakyTestsBubbleChartProps> = ({
  data,
  consecutiveRuns,
  totalCount,
  projectId,
  onTestClick,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { width, height } = useResponsiveSVG(containerRef);
  const t = useTranslations("reports.ui.flakyTests");
  const locale = useLocale();
  const router = useRouter();

  // Transform flaky test data into bubble chart data points
  const bubbleData = useMemo((): BubbleDataPoint[] => {
    return data
      .filter((test) => test.executions && Array.isArray(test.executions))
      .map((test) => {
        const recencyScore = calculateRecencyScore(test.executions);
        const failureRate = calculateFailureRate(test.executions);
        const mostRecentFailure = getMostRecentFailure(test.executions);

        // Priority score combines flip count (instability) with recency
        // Both are important - a highly flaky test with recent failures is highest priority
        const normalizedFlipCount = test.flipCount / (consecutiveRuns - 1); // Normalize to 0-1
        const priorityScore = normalizedFlipCount * 0.5 + recencyScore * 0.5;

        return {
          id: test.testCaseId,
          name: test.testCaseName,
          flipCount: test.flipCount,
          recencyScore,
          failureRate,
          priorityScore,
          mostRecentFailure,
          totalExecutions: test.executions.length,
        };
      });
  }, [data, consecutiveRuns]);

  // Calculate date range from all executions
  const dateRange = useMemo(() => {
    let minDate: Date | null = null;
    let maxDate: Date | null = null;

    for (const test of data) {
      if (!test.executions || !Array.isArray(test.executions)) continue;
      for (const execution of test.executions) {
        const execDate = new Date(execution.executedAt);
        if (!minDate || execDate < minDate) minDate = execDate;
        if (!maxDate || execDate > maxDate) maxDate = execDate;
      }
    }

    return { minDate, maxDate };
  }, [data]);

  // Setup tooltip
  useEffect(() => {
    const tooltipElement = document.createElement("div");
    tooltipElement.style.position = "fixed";
    tooltipElement.style.display = "none";
    tooltipElement.style.backgroundColor = "hsl(var(--popover))";
    tooltipElement.style.color = "hsl(var(--popover-foreground))";
    tooltipElement.style.padding = "8px 12px";
    tooltipElement.style.borderRadius = "6px";
    tooltipElement.style.fontSize = "12px";
    tooltipElement.style.pointerEvents = "none";
    tooltipElement.style.zIndex = "2000";
    tooltipElement.style.boxShadow = "0 2px 8px rgba(0,0,0,0.15)";
    tooltipElement.style.border = "1px solid hsl(var(--border))";
    tooltipElement.style.maxWidth = "300px";
    document.body.appendChild(tooltipElement);
    tooltipRef.current = tooltipElement;

    return () => {
      if (tooltipRef.current?.parentNode) {
        tooltipRef.current.parentNode.removeChild(tooltipRef.current);
      }
      tooltipRef.current = null;
    };
  }, []);

  // Render chart
  useEffect(() => {
    if (
      !svgRef.current ||
      !bubbleData ||
      bubbleData.length === 0 ||
      width === 0 ||
      height === 0
    ) {
      if (svgRef.current) d3.select(svgRef.current).selectAll("*").remove();
      return;
    }

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const margin = { top: 40, right: 40, bottom: 85, left: 70 };
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;

    // X-axis: Recency score (0 = no recent failures, 1 = very recent failures)
    const xScale = d3
      .scaleLinear()
      .domain([0, 1])
      .range([0, chartWidth])
      .nice();

    // Y-axis: Flip count
    const maxFlips = d3.max(bubbleData, (d) => d.flipCount) || consecutiveRuns;
    const yScale = d3
      .scaleLinear()
      .domain([0, maxFlips])
      .range([chartHeight, 0])
      .nice();

    // Bubble size: Based on failure rate (more failures = bigger bubble)
    const sizeScale = d3
      .scaleSqrt()
      .domain([0, 1])
      .range([6, Math.min(chartWidth, chartHeight) / 12]);

    // Color scale: Based on priority score (green = low priority, red = high priority)
    const colorScale = d3.scaleSequential(d3.interpolateRdYlGn).domain([1, 0]); // Inverted so red = high priority

    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    // Add gradient background to show danger zones
    const defs = svg.append("defs");
    const gradient = defs
      .append("linearGradient")
      .attr("id", "danger-gradient")
      .attr("x1", "0%")
      .attr("y1", "100%")
      .attr("x2", "100%")
      .attr("y2", "0%");

    gradient
      .append("stop")
      .attr("offset", "0%")
      .attr("stop-color", "hsl(var(--muted))")
      .attr("stop-opacity", 0.1);

    gradient
      .append("stop")
      .attr("offset", "100%")
      .attr("stop-color", "hsl(var(--destructive))")
      .attr("stop-opacity", 0.15);

    g.append("rect")
      .attr("width", chartWidth)
      .attr("height", chartHeight)
      .attr("fill", "url(#danger-gradient)");

    // Add quadrant labels
    const quadrantLabelStyle = {
      fill: "hsl(var(--muted-foreground))",
      fontSize: "10px",
      opacity: 0.6,
    };

    // Top-right: High priority (high flips + recent failures)
    g.append("text")
      .attr("x", chartWidth - 10)
      .attr("y", 20)
      .attr("text-anchor", "end")
      .style("fill", quadrantLabelStyle.fill)
      .style("font-size", quadrantLabelStyle.fontSize)
      .style("opacity", quadrantLabelStyle.opacity)
      .text(t("chart.highPriority"));

    // Bottom-left: Low priority (low flips + old failures)
    g.append("text")
      .attr("x", 10)
      .attr("y", chartHeight - 10)
      .attr("text-anchor", "start")
      .style("fill", quadrantLabelStyle.fill)
      .style("font-size", quadrantLabelStyle.fontSize)
      .style("opacity", quadrantLabelStyle.opacity)
      .text(t("chart.lowPriority"));

    // X-axis with date range labels (localized)
    const formatAxisDate = (date: Date) =>
      date.toLocaleDateString(locale, { month: "short", day: "numeric" });
    const oldestLabel = dateRange.minDate
      ? formatAxisDate(dateRange.minDate)
      : t("chart.oldFailures");
    const newestLabel = dateRange.maxDate
      ? formatAxisDate(dateRange.maxDate)
      : t("chart.recentFailures");

    g.append("g")
      .attr("class", "x-axis")
      .attr("transform", `translate(0,${chartHeight})`)
      .call(
        d3
          .axisBottom(xScale)
          .ticks(5)
          .tickFormat((d) => {
            const val = d as number;
            if (val === 0) return oldestLabel;
            if (val === 1) return newestLabel;
            return "";
          })
      )
      .selectAll("text")
      .style("fill", "hsl(var(--muted-foreground))");

    // X-axis label
    g.append("text")
      .attr("x", chartWidth / 2)
      .attr("y", chartHeight + 45)
      .attr("text-anchor", "middle")
      .style("fill", "hsl(var(--foreground))")
      .style("font-size", "12px")
      .text(t("chart.recencyAxis"));

    // Y-axis
    g.append("g")
      .attr("class", "y-axis")
      .call(d3.axisLeft(yScale).ticks(5))
      .selectAll("text")
      .style("fill", "hsl(var(--muted-foreground))");

    // Y-axis label
    g.append("text")
      .attr("transform", "rotate(-90)")
      .attr("x", -chartHeight / 2)
      .attr("y", -50)
      .attr("text-anchor", "middle")
      .style("fill", "hsl(var(--foreground))")
      .style("font-size", "12px")
      .text(t("chart.flipsAxis"));

    // Add grid lines
    g.append("g")
      .attr("class", "grid")
      .attr("opacity", 0.1)
      .call(
        d3
          .axisLeft(yScale)
          .tickSize(-chartWidth)
          .tickFormat(() => "")
      );

    g.append("g")
      .attr("class", "grid")
      .attr("transform", `translate(0,${chartHeight})`)
      .attr("opacity", 0.1)
      .call(
        d3
          .axisBottom(xScale)
          .tickSize(-chartHeight)
          .tickFormat(() => "")
      );

    // Create bubbles
    const bubbles = g
      .selectAll(".bubble")
      .data(bubbleData)
      .enter()
      .append("circle")
      .attr("class", "bubble")
      .attr("cx", (d) => xScale(d.recencyScore))
      .attr("cy", (d) => yScale(d.flipCount))
      .attr("r", 0) // Start at 0 for animation
      .attr("fill", (d) => colorScale(d.priorityScore))
      .attr("stroke", "hsl(var(--border))")
      .attr("stroke-width", 1)
      .style("cursor", "pointer")
      .style("opacity", 0.85);

    // Add hover and click interactions
    bubbles
      .on("mouseover", function (event, d) {
        d3.select(this)
          .transition()
          .duration(150)
          .attr("r", sizeScale(d.failureRate) * 1.2)
          .style("opacity", 1);

        if (tooltipRef.current) {
          const failurePercent = Math.round(d.failureRate * 100);
          const recencyPercent = Math.round(d.recencyScore * 100);
          tooltipRef.current.style.display = "block";
          tooltipRef.current.innerHTML = `
            <div style="font-weight: 600; margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${d.name}</div>
            <div style="display: grid; grid-template-columns: max-content auto; gap: 2px 6px; font-size: 11px;">
              <span style="opacity: 0.7;">${t("flips")}:</span>
              <span style="font-weight: 500;">${d.flipCount}</span>
              <span style="opacity: 0.7;">${t("chart.failureRate")}:</span>
              <span style="font-weight: 500;">${failurePercent}%</span>
              <span style="opacity: 0.7;">${t("chart.recency")}:</span>
              <span style="font-weight: 500;">${recencyPercent}%</span>
            </div>
          `;
        }
      })
      .on("mousemove", (event) => {
        if (tooltipRef.current) {
          tooltipRef.current.style.left = `${event.pageX + 15}px`;
          tooltipRef.current.style.top = `${event.pageY - 10}px`;
        }
      })
      .on("mouseout", function (event, d) {
        d3.select(this)
          .transition()
          .duration(150)
          .attr("r", sizeScale(d.failureRate))
          .style("opacity", 0.85);

        if (tooltipRef.current) {
          tooltipRef.current.style.display = "none";
        }
      })
      .on("click", (event, d) => {
        // Get the project ID - either from the test data (cross-project) or from the prop
        const testData = data.find((t) => t.testCaseId === d.id);
        const testProjectId = testData?.project?.id || projectId;

        if (testProjectId) {
          // Navigate to the test case details page
          router.push(`/projects/repository/${testProjectId}/${d.id}`);
        }

        // Also call the optional callback if provided
        if (onTestClick) {
          onTestClick(d.id, testData?.project?.id);
        }
      });

    // Animate bubbles appearing
    bubbles
      .transition()
      .duration(600)
      .delay((d, i) => i * 30)
      .ease(d3.easeBackOut.overshoot(1.1))
      .attr("r", (d) => sizeScale(d.failureRate));

    // Add backlog bubble if there are more tests than shown
    const notShownCount = (totalCount || data.length) - data.length;
    if (notShownCount > 0) {
      // Scale radius based on digit count to fit the text (+1 for the "+" symbol)
      const textLength = String(notShownCount).length + 1;
      const backlogRadius = 10 + textLength * 4;

      // Position in lower-left area (low priority zone), above the "Lower priority" text
      const backlogX = xScale(0.08);
      const backlogY = yScale(0) - backlogRadius - 35;

      // Create backlog bubble group
      const backlogGroup = g.append("g").attr("class", "backlog-bubble");

      // Add dashed circle for backlog
      backlogGroup
        .append("circle")
        .attr("cx", backlogX)
        .attr("cy", backlogY)
        .attr("r", 0)
        .attr("fill", "hsl(var(--muted))")
        .attr("stroke", "hsl(var(--muted-foreground))")
        .attr("stroke-width", 2)
        .attr("stroke-dasharray", "4,3")
        .style("opacity", 0.6)
        .transition()
        .duration(600)
        .delay(bubbleData.length * 30 + 100)
        .ease(d3.easeBackOut.overshoot(1.1))
        .attr("r", backlogRadius);

      // Add count text inside the bubble
      backlogGroup
        .append("text")
        .attr("x", backlogX)
        .attr("y", backlogY)
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "middle")
        .style("fill", "hsl(var(--muted-foreground))")
        .style("font-size", "12px")
        .style("font-weight", "600")
        .style("opacity", 0)
        .text(`+${notShownCount}`)
        .transition()
        .duration(400)
        .delay(bubbleData.length * 30 + 300)
        .style("opacity", 1);

      // Add hover interaction for backlog bubble
      backlogGroup
        .on("mouseover", function (event) {
          d3.select(this)
            .select("circle")
            .transition()
            .duration(150)
            .attr("r", backlogRadius * 1.15)
            .style("opacity", 0.8);

          if (tooltipRef.current) {
            tooltipRef.current.style.display = "block";
            tooltipRef.current.innerHTML = `
              <div style="font-weight: 600; margin-bottom: 4px;">${t("chart.backlogTitle")}</div>
              <div style="font-size: 11px; opacity: 0.8;">${t("chart.backlogDescription", { count: notShownCount })}</div>
            `;
          }
        })
        .on("mousemove", (event) => {
          if (tooltipRef.current) {
            tooltipRef.current.style.left = `${event.pageX + 15}px`;
            tooltipRef.current.style.top = `${event.pageY - 10}px`;
          }
        })
        .on("mouseout", function () {
          d3.select(this)
            .select("circle")
            .transition()
            .duration(150)
            .attr("r", backlogRadius)
            .style("opacity", 0.6);

          if (tooltipRef.current) {
            tooltipRef.current.style.display = "none";
          }
        });
    }

    // Style axis lines
    g.selectAll(".domain").style("stroke", "hsl(var(--border))");
    g.selectAll(".tick line").style("stroke", "hsl(var(--border))");

    // Add color legend at the bottom left, same row as X-axis label
    const legendWidth = Math.min(220, chartWidth * 0.4);
    const legendHeight = 8;
    const legendX = 30; // Left aligned
    const legendY = chartHeight + 10; // Same row as X-axis label (which is at chartHeight + 45)

    // Create gradient for legend
    const legendGradient = defs
      .append("linearGradient")
      .attr("id", "legend-gradient")
      .attr("x1", "0%")
      .attr("x2", "100%")
      .attr("y1", "0%")
      .attr("y2", "0%");

    // Add color stops (green to yellow to red)
    legendGradient
      .append("stop")
      .attr("offset", "0%")
      .attr("stop-color", d3.interpolateRdYlGn(1)); // Green (low priority)

    legendGradient
      .append("stop")
      .attr("offset", "50%")
      .attr("stop-color", d3.interpolateRdYlGn(0.5)); // Yellow (medium)

    legendGradient
      .append("stop")
      .attr("offset", "100%")
      .attr("stop-color", d3.interpolateRdYlGn(0)); // Red (high priority)

    // Legend background rect
    g.append("rect")
      .attr("x", legendX)
      .attr("y", legendY)
      .attr("width", legendWidth)
      .attr("height", legendHeight)
      .attr("fill", "url(#legend-gradient)")
      .attr("rx", 2)
      .attr("stroke", "hsl(var(--border))")
      .attr("stroke-width", 0.5);

    // Legend labels on either side of the gradient bar (same row)
    g.append("text")
      .attr("x", legendX)
      .attr("y", legendY + legendHeight + 12)
      .attr("text-anchor", "start")
      .style("fill", "hsl(var(--muted-foreground))")
      .style("font-size", "10px")
      .text(t("chart.lowPriority"));

    g.append("text")
      .attr("x", legendX + legendWidth)
      .attr("y", legendY + legendHeight + 12)
      .attr("text-anchor", "end")
      .style("fill", "hsl(var(--muted-foreground))")
      .style("font-size", "10px")
      .text(t("chart.highPriority"));
  }, [
    bubbleData,
    width,
    height,
    consecutiveRuns,
    totalCount,
    projectId,
    onTestClick,
    t,
    data,
    dateRange,
    locale,
    router,
  ]);

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        {t("noFlakyTests")}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%", minHeight: "300px" }}
    >
      <svg ref={svgRef} width={width} height={height} />
    </div>
  );
};
