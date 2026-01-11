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

    return Array.from(issueMap.values());
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

  // Render chart - horizontal stacked bar chart for top issues by test count
  useEffect(() => {
    if (!svgRef.current || width === 0 || height === 0) {
      if (svgRef.current) d3.select(svgRef.current).selectAll("*").remove();
      return;
    }

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const margin = { top: 20, right: 60, bottom: 30, left: 180 };
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;

    // Get top 50 issues by linked test cases (or failed tests first)
    const topIssues = [...aggregatedData]
      .sort((a, b) => {
        // Primary: more failed tests first
        if (b.failedTestCases !== a.failedTestCases) {
          return b.failedTestCases - a.failedTestCases;
        }
        // Secondary: lower pass rate first
        if (a.passRate !== b.passRate) {
          return a.passRate - b.passRate;
        }
        // Tertiary: more linked tests first
        return b.linkedTestCases - a.linkedTestCases;
      })
      .slice(0, 50);

    if (topIssues.length === 0) return;

    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    // Scales
    const maxTests = Math.max(...topIssues.map((d) => d.linkedTestCases), 1);
    const xScale = d3.scaleLinear().domain([0, maxTests]).range([0, chartWidth]);

    const yScale = d3
      .scaleBand()
      .domain(topIssues.map((d) => d.externalKey || d.issueName))
      .range([0, chartHeight])
      .padding(0.25);

    // Draw stacked bars for each issue
    topIssues.forEach((issue) => {
      const y = yScale(issue.externalKey || issue.issueName)!;
      const barHeight = yScale.bandwidth();
      let xOffset = 0;

      // Issue label
      g.append("text")
        .attr("x", -10)
        .attr("y", y + barHeight / 2)
        .attr("text-anchor", "end")
        .attr("dominant-baseline", "middle")
        .style("fill", "hsl(var(--foreground))")
        .style("font-size", "11px")
        .style("font-weight", "500")
        .text(() => {
          const name = issue.externalKey || issue.issueName;
          return name.length > 20 ? name.substring(0, 20) + "..." : name;
        });

      // Passed segment
      if (issue.passedTestCases > 0) {
        g.append("rect")
          .attr("x", xOffset)
          .attr("y", y)
          .attr("width", 0)
          .attr("height", barHeight)
          .attr("fill", statusColors.passed)
          .style("opacity", 0.85)
          .on("mouseover", function (event) {
            d3.select(this).style("opacity", 1);
            if (tooltipRef.current) {
              tooltipRef.current.style.display = "block";
              tooltipRef.current.innerHTML = `
                <div style="font-weight: 600; margin-bottom: 4px;">${issue.externalKey || issue.issueName}</div>
                ${issue.issueTitle ? `<div style="font-size: 11px; opacity: 0.8; margin-bottom: 4px;">${issue.issueTitle}</div>` : ""}
                <div style="font-size: 11px; color: ${statusColors.passed};">
                  ${t("passed")}: ${issue.passedTestCases}
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
          .on("mouseout", function () {
            d3.select(this).style("opacity", 0.85);
            if (tooltipRef.current) tooltipRef.current.style.display = "none";
          })
          .transition()
          .duration(600)
          .attr("width", xScale(issue.passedTestCases));
        xOffset += xScale(issue.passedTestCases);
      }

      // Failed segment
      if (issue.failedTestCases > 0) {
        g.append("rect")
          .attr("x", xOffset)
          .attr("y", y)
          .attr("width", 0)
          .attr("height", barHeight)
          .attr("fill", statusColors.failed)
          .style("opacity", 0.85)
          .on("mouseover", function (event) {
            d3.select(this).style("opacity", 1);
            if (tooltipRef.current) {
              tooltipRef.current.style.display = "block";
              tooltipRef.current.innerHTML = `
                <div style="font-weight: 600; margin-bottom: 4px;">${issue.externalKey || issue.issueName}</div>
                ${issue.issueTitle ? `<div style="font-size: 11px; opacity: 0.8; margin-bottom: 4px;">${issue.issueTitle}</div>` : ""}
                <div style="font-size: 11px; color: ${statusColors.failed};">
                  ${t("failed")}: ${issue.failedTestCases}
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
          .on("mouseout", function () {
            d3.select(this).style("opacity", 0.85);
            if (tooltipRef.current) tooltipRef.current.style.display = "none";
          })
          .transition()
          .duration(600)
          .delay(100)
          .attr("width", xScale(issue.failedTestCases));
        xOffset += xScale(issue.failedTestCases);
      }

      // Untested segment
      if (issue.untestedTestCases > 0) {
        g.append("rect")
          .attr("x", xOffset)
          .attr("y", y)
          .attr("width", 0)
          .attr("height", barHeight)
          .attr("fill", statusColors.untested)
          .style("opacity", 0.85)
          .on("mouseover", function (event) {
            d3.select(this).style("opacity", 1);
            if (tooltipRef.current) {
              tooltipRef.current.style.display = "block";
              tooltipRef.current.innerHTML = `
                <div style="font-weight: 600; margin-bottom: 4px;">${issue.externalKey || issue.issueName}</div>
                ${issue.issueTitle ? `<div style="font-size: 11px; opacity: 0.8; margin-bottom: 4px;">${issue.issueTitle}</div>` : ""}
                <div style="font-size: 11px; color: ${statusColors.untested};">
                  ${t("untested")}: ${issue.untestedTestCases}
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
          .on("mouseout", function () {
            d3.select(this).style("opacity", 0.85);
            if (tooltipRef.current) tooltipRef.current.style.display = "none";
          })
          .transition()
          .duration(600)
          .delay(200)
          .attr("width", xScale(issue.untestedTestCases));
      }

      // Total count on right
      g.append("text")
        .attr("x", xScale(issue.linkedTestCases) + 8)
        .attr("y", y + barHeight / 2)
        .attr("dominant-baseline", "middle")
        .style("fill", "hsl(var(--foreground))")
        .style("font-size", "11px")
        .style("font-weight", "600")
        .style("opacity", 0)
        .text(issue.linkedTestCases)
        .transition()
        .duration(600)
        .delay(300)
        .style("opacity", 1);
    });

    // X-axis
    const xAxis = d3.axisBottom(xScale).ticks(5).tickSize(-chartHeight);
    g.append("g")
      .attr("transform", `translate(0,${chartHeight})`)
      .call(xAxis)
      .call((g) => {
        g.select(".domain").remove();
        g.selectAll(".tick line")
          .attr("stroke", "hsl(var(--border))")
          .attr("stroke-opacity", 0.5);
        g.selectAll(".tick text")
          .style("fill", "hsl(var(--muted-foreground))")
          .style("font-size", "10px");
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
