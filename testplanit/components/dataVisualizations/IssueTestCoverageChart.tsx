"use client";
import React, { useEffect, useRef, useMemo, useCallback } from "react";
import * as d3 from "d3";
import useResponsiveSVG from "~/hooks/useResponsiveSVG";
import { useTranslations } from "next-intl";
import {
  Bug,
  CheckCircle2,
  XCircle,
  HelpCircle,
  FileQuestion,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface IssueTestCoverageData {
  issueId: number;
  issueName: string;
  issueTitle: string;
  issueStatus: string | null;
  issuePriority: string | null;
  issueTypeName: string | null;
  externalKey: string | null;
  externalUrl: string | null;
  linkedTestCases: number;
  passedTestCases: number;
  failedTestCases: number;
  untestedTestCases: number;
  passRate: number;
  project?: {
    id: number;
    name?: string;
  };
}

interface IssueTestCoverageChartProps {
  data: IssueTestCoverageData[];
  projectId?: number | string;
  onIssueClick?: (issueId: number, projectId?: number) => void;
}

// Color definitions
const statusColors = {
  passed: "#22c55e", // green-500
  failed: "#ef4444", // red-500
  untested: "#6b7280", // gray-500
};

export const IssueTestCoverageChart: React.FC<IssueTestCoverageChartProps> = ({
  data,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { width, height } = useResponsiveSVG(containerRef);
  const t = useTranslations("reports.ui.issueTestCoverage");

  // Aggregate data by issue (since data is now flat with duplicates)
  const aggregatedData = useMemo(() => {
    const issueMap = new Map<number, IssueTestCoverageData>();

    data.forEach((row) => {
      if (!issueMap.has(row.issueId)) {
        // First time seeing this issue - add it with all its data
        issueMap.set(row.issueId, { ...row });
      }
      // Don't add duplicates - the summary metrics are already duplicated across rows
    });

    const result = Array.from(issueMap.values());
    console.log('Issue Test Coverage Chart - Total issues:', result.length, 'Total rows:', data.length);
    return result;
  }, [data]);

  // Calculate summary stats
  const summaryStats = useMemo(() => {
    const totalIssues = aggregatedData.length;
    const totalLinkedTests = aggregatedData.reduce((sum, d) => sum + d.linkedTestCases, 0);
    const totalPassed = aggregatedData.reduce((sum, d) => sum + d.passedTestCases, 0);
    const totalFailed = aggregatedData.reduce((sum, d) => sum + d.failedTestCases, 0);
    const totalUntested = aggregatedData.reduce((sum, d) => sum + d.untestedTestCases, 0);

    // Issues with at least one failing test
    const issuesWithFailures = aggregatedData.filter((d) => d.failedTestCases > 0).length;
    // Issues with all tests passing
    const issuesAllPassing = aggregatedData.filter(
      (d) => d.passedTestCases > 0 && d.failedTestCases === 0 && d.untestedTestCases === 0
    ).length;
    // Issues with untested cases
    const issuesWithUntested = aggregatedData.filter((d) => d.untestedTestCases > 0).length;

    const overallPassRate =
      totalPassed + totalFailed > 0
        ? Math.round((totalPassed / (totalPassed + totalFailed)) * 100)
        : 0;

    return {
      totalIssues,
      totalLinkedTests,
      totalPassed,
      totalFailed,
      totalUntested,
      issuesWithFailures,
      issuesAllPassing,
      issuesWithUntested,
      overallPassRate,
    };
  }, [aggregatedData]);

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
    tooltipElement.style.maxWidth = "350px";
    document.body.appendChild(tooltipElement);
    tooltipRef.current = tooltipElement;

    return () => {
      if (tooltipRef.current?.parentNode) {
        tooltipRef.current.parentNode.removeChild(tooltipRef.current);
      }
      tooltipRef.current = null;
    };
  }, []);

  // Render chart - bubble chart showing aggregated issues by test coverage and pass rate
  useEffect(() => {
    if (!svgRef.current || width === 0 || height === 0) {
      if (svgRef.current) d3.select(svgRef.current).selectAll("*").remove();
      return;
    }

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    if (aggregatedData.length === 0) {
      svg
        .append("text")
        .attr("x", width / 2)
        .attr("y", height / 2)
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "middle")
        .style("fill", "hsl(var(--muted-foreground))")
        .style("font-size", "14px")
        .text(t("noData"));
      return;
    }

    const margin = { top: 40, right: 40, bottom: 60, left: 70 };
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;

    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    // Group issues by test count buckets and pass rate buckets for aggregation
    // This creates a grid where each cell represents issues with similar characteristics
    interface BubblePoint {
      testCount: number;
      passRate: number;
      count: number;
      status: "failed" | "untested" | "passing";
      issues: typeof aggregatedData;
    }

    const bubbleMap = new Map<string, BubblePoint>();

    // Create buckets: test count buckets and pass rate buckets
    aggregatedData.forEach((issue) => {
      // Bucket test counts (0-5, 6-10, 11-20, 21-50, 51-100, 101+)
      let testBucket: number;
      if (issue.linkedTestCases <= 5) testBucket = 2.5;
      else if (issue.linkedTestCases <= 10) testBucket = 8;
      else if (issue.linkedTestCases <= 20) testBucket = 15;
      else if (issue.linkedTestCases <= 50) testBucket = 35;
      else if (issue.linkedTestCases <= 100) testBucket = 75;
      else if (issue.linkedTestCases <= 200) testBucket = 150;
      else testBucket = Math.round(issue.linkedTestCases / 50) * 50;

      // Bucket pass rates (0%, 10%, 20%, ..., 100%)
      const passRateBucket = Math.round(issue.passRate / 10) * 10;

      // Determine status
      let status: "failed" | "untested" | "passing";
      if (issue.failedTestCases > 0) {
        status = "failed";
      } else if (issue.untestedTestCases > 0) {
        status = "untested";
      } else {
        status = "passing";
      }

      const key = `${testBucket}-${passRateBucket}-${status}`;

      if (!bubbleMap.has(key)) {
        bubbleMap.set(key, {
          testCount: testBucket,
          passRate: passRateBucket,
          count: 0,
          status,
          issues: [],
        });
      }

      const bubble = bubbleMap.get(key)!;
      bubble.count++;
      bubble.issues.push(issue);
    });

    const bubbleData = Array.from(bubbleMap.values());

    // Scales
    const maxTests = Math.max(...aggregatedData.map((d) => d.linkedTestCases), 1);
    const xScale = d3.scaleLinear().domain([0, maxTests]).range([0, chartWidth]).nice();

    const yScale = d3.scaleLinear().domain([0, 100]).range([chartHeight, 0]);

    // Size scale for bubbles (based on number of issues in that bucket)
    const maxCount = Math.max(...bubbleData.map((d) => d.count), 1);
    const sizeScale = d3
      .scaleSqrt()
      .domain([1, maxCount])
      .range([5, 40]); // Min and max bubble radius

    // Color mapping
    const colorMap = {
      failed: statusColors.failed,
      untested: statusColors.untested,
      passing: statusColors.passed,
    };

    // Draw grid lines
    g.append("g")
      .attr("class", "grid")
      .attr("opacity", 0.1)
      .call(
        d3
          .axisLeft(yScale)
          .tickSize(-chartWidth)
          .tickFormat(() => "")
      )
      .call((g) => g.select(".domain").remove());

    g.append("g")
      .attr("class", "grid")
      .attr("opacity", 0.1)
      .attr("transform", `translate(0,${chartHeight})`)
      .call(
        d3
          .axisBottom(xScale)
          .tickSize(-chartHeight)
          .tickFormat(() => "")
      )
      .call((g) => g.select(".domain").remove());

    // Draw bubbles
    const bubbles = g
      .selectAll("circle")
      .data(bubbleData)
      .enter()
      .append("circle")
      .attr("cx", (d) => xScale(d.testCount))
      .attr("cy", (d) => yScale(d.passRate))
      .attr("r", 0)
      .attr("fill", (d) => colorMap[d.status])
      .style("opacity", 0.6)
      .style("stroke", "hsl(var(--background))")
      .style("stroke-width", 2)
      .on("mouseover", function (event, d) {
        d3.select(this).style("opacity", 0.9).style("stroke-width", 3);
        if (tooltipRef.current) {
          const statusLabel =
            d.status === "failed"
              ? "Has Failures"
              : d.status === "untested"
                ? "Has Untested"
                : "All Passing";

          tooltipRef.current.style.display = "block";
          tooltipRef.current.innerHTML = `
            <div style="font-weight: 600; margin-bottom: 4px;">${d.count} Issue${d.count > 1 ? "s" : ""}</div>
            <div style="font-size: 11px; margin-bottom: 2px;">Pass Rate: ~${d.passRate}%</div>
            <div style="font-size: 11px; margin-bottom: 4px;">Linked Tests: ~${d.testCount}</div>
            <div style="font-size: 11px; color: ${colorMap[d.status]};">${statusLabel}</div>
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
        d3.select(this).style("opacity", 0.6).style("stroke-width", 2);
        if (tooltipRef.current) tooltipRef.current.style.display = "none";
      });

    // Animate bubbles
    bubbles
      .transition()
      .duration(800)
      .delay((d, i) => Math.min(i * 20, 500))
      .attr("r", (d) => sizeScale(d.count));

    // X-axis
    g.append("g")
      .attr("transform", `translate(0,${chartHeight})`)
      .call(d3.axisBottom(xScale).ticks(8))
      .call((g) => {
        g.selectAll(".tick text")
          .style("fill", "hsl(var(--muted-foreground))")
          .style("font-size", "10px");
        g.select(".domain").attr("stroke", "hsl(var(--border))");
        g.selectAll(".tick line").attr("stroke", "hsl(var(--border))");
      });

    // X-axis label
    g.append("text")
      .attr("x", chartWidth / 2)
      .attr("y", chartHeight + 45)
      .attr("text-anchor", "middle")
      .style("fill", "hsl(var(--muted-foreground))")
      .style("font-size", "12px")
      .text(t("charts.linkedTestCases"));

    // Y-axis
    g.append("g")
      .call(d3.axisLeft(yScale).ticks(10))
      .call((g) => {
        g.selectAll(".tick text")
          .style("fill", "hsl(var(--muted-foreground))")
          .style("font-size", "10px");
        g.select(".domain").attr("stroke", "hsl(var(--border))");
        g.selectAll(".tick line").attr("stroke", "hsl(var(--border))");
      });

    // Y-axis label
    g.append("text")
      .attr("transform", "rotate(-90)")
      .attr("y", -50)
      .attr("x", -chartHeight / 2)
      .attr("text-anchor", "middle")
      .style("fill", "hsl(var(--muted-foreground))")
      .style("font-size", "12px")
      .text(t("charts.passRate"));

    // Chart title
    svg
      .append("text")
      .attr("x", width / 2)
      .attr("y", 20)
      .attr("text-anchor", "middle")
      .style("fill", "hsl(var(--foreground))")
      .style("font-size", "14px")
      .style("font-weight", "600")
      .text(t("charts.coverageQuality"));

    // Legend
    const legend = svg
      .append("g")
      .attr("transform", `translate(${width - 150}, 40)`);

    const legendItems = [
      { label: t("passed"), color: statusColors.passed },
      { label: t("failed"), color: statusColors.failed },
      { label: t("untested"), color: statusColors.untested },
    ];

    legendItems.forEach((item, i) => {
      const legendRow = legend
        .append("g")
        .attr("transform", `translate(0, ${i * 20})`);

      legendRow
        .append("circle")
        .attr("r", 5)
        .attr("fill", item.color)
        .style("opacity", 0.7);

      legendRow
        .append("text")
        .attr("x", 12)
        .attr("y", 4)
        .style("fill", "hsl(var(--foreground))")
        .style("font-size", "11px")
        .text(item.label);
    });
  }, [aggregatedData, width, height, t]);

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        {t("noData")}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Summary Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 px-2">
        {/* Total Issues */}
        <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border">
          <div className="p-2 rounded-md bg-primary/10">
            <Bug className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="text-2xl font-bold">{summaryStats.totalIssues}</p>
            <p className="text-xs text-muted-foreground">{t("stats.totalIssues")}</p>
          </div>
        </div>

        {/* Issues with Failures */}
        <div className="flex items-center gap-3 p-3 rounded-lg bg-destructive/5 border border-destructive/20">
          <div className="p-2 rounded-md bg-destructive/10">
            <XCircle className="h-4 w-4 text-destructive" />
          </div>
          <div>
            <p className="text-2xl font-bold text-destructive">
              {summaryStats.issuesWithFailures}
            </p>
            <div className="flex items-center gap-1">
              <p className="text-xs text-muted-foreground">{t("stats.issuesWithFailures")}</p>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="h-3 w-3 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs">
                    <div className="text-xs">
                      {t("stats.issuesWithFailuresTooltip")}
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
        </div>

        {/* Issues with Untested */}
        <div className="flex items-center gap-3 p-3 rounded-lg bg-yellow-500/5 border border-yellow-500/20">
          <div className="p-2 rounded-md bg-yellow-500/10">
            <FileQuestion className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
              {summaryStats.issuesWithUntested}
            </p>
            <div className="flex items-center gap-1">
              <p className="text-xs text-muted-foreground">{t("stats.issuesWithUntested")}</p>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="h-3 w-3 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs">
                    <div className="text-xs">
                      {t("stats.issuesWithUntestedTooltip")}
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
        </div>

        {/* Issues All Passing */}
        <div className="flex items-center gap-3 p-3 rounded-lg bg-green-500/5 border border-green-500/20">
          <div className="p-2 rounded-md bg-green-500/10">
            <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-green-600 dark:text-green-400">
              {summaryStats.issuesAllPassing}
            </p>
            <p className="text-xs text-muted-foreground">{t("stats.issuesAllPassing")}</p>
          </div>
        </div>

        {/* Overall Pass Rate */}
        <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border">
          <div className="p-2 rounded-md bg-blue-500/10">
            <CheckCircle2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <p className="text-2xl font-bold">
              {summaryStats.overallPassRate}
              {"%"}
            </p>
            <p className="text-xs text-muted-foreground">{t("stats.overallPassRate")}</p>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-6 text-sm">
        <div className="flex items-center gap-2">
          <div
            className="w-3 h-3 rounded"
            style={{ backgroundColor: statusColors.passed }}
          />
          <span className="text-muted-foreground">{t("passed")}</span>
        </div>
        <div className="flex items-center gap-2">
          <div
            className="w-3 h-3 rounded"
            style={{ backgroundColor: statusColors.failed }}
          />
          <span className="text-muted-foreground">{t("failed")}</span>
        </div>
        <div className="flex items-center gap-2">
          <div
            className="w-3 h-3 rounded"
            style={{ backgroundColor: statusColors.untested }}
          />
          <span className="text-muted-foreground">{t("untested")}</span>
        </div>
      </div>

      {/* Chart Area */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0"
        style={{ minHeight: "200px" }}
      >
        <svg ref={svgRef} width={width} height={height} />
      </div>
    </div>
  );
};
