"use client";
import React, { useEffect, useRef, useMemo, useCallback } from "react";
import * as d3 from "d3";
import useResponsiveSVG from "~/hooks/useResponsiveSVG";
import { useTranslations } from "next-intl";
import type { HealthStatus } from "~/utils/testCaseHealthUtils";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Activity,
  HelpCircle,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface TestCaseHealthData {
  testCaseId: number;
  testCaseName: string;
  testCaseSource: string;
  createdAt: string;
  lastExecutedAt: string | null;
  daysSinceLastExecution: number | null;
  totalExecutions: number;
  passCount: number;
  failCount: number;
  passRate: number;
  healthStatus: HealthStatus;
  isStale: boolean;
  healthScore: number;
  project?: {
    id: number;
    name?: string;
  };
}

interface TestCaseHealthChartProps {
  data: TestCaseHealthData[];
  projectId?: number | string;
  onTestClick?: (testCaseId: number, projectId?: number) => void;
}

// Color mapping for health statuses
const healthStatusColors: Record<HealthStatus, string> = {
  healthy: "#22c55e", // green-500
  never_executed: "#6b7280", // gray-500
  always_passing: "#3b82f6", // blue-500
  always_failing: "#ef4444", // red-500
};

// Order for displaying health statuses (worst first)
const healthStatusOrder: HealthStatus[] = [
  "always_failing",
  "never_executed",
  "always_passing",
  "healthy",
];

export const TestCaseHealthChart: React.FC<TestCaseHealthChartProps> = ({
  data,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { width, height } = useResponsiveSVG(containerRef);
  const t = useTranslations("reports.ui.testCaseHealth");

  // Helper to get translated health status label
  const getHealthStatusLabel = useCallback(
    (status: HealthStatus): string => {
      switch (status) {
        case "healthy":
          return t("healthStatus.healthy");
        case "never_executed":
          return t("healthStatus.neverExecuted");
        case "always_passing":
          return t("healthStatus.alwaysPassing");
        case "always_failing":
          return t("healthStatus.alwaysFailing");
        default:
          return status;
      }
    },
    [t]
  );

  // Calculate summary stats
  const summaryStats = useMemo(() => {
    const counts: Record<HealthStatus, number> = {
      healthy: 0,
      never_executed: 0,
      always_passing: 0,
      always_failing: 0,
    };

    for (const test of data) {
      counts[test.healthStatus]++;
    }

    return counts;
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

  // Render chart - centered donut with horizontal bar breakdown
  useEffect(() => {
    if (!svgRef.current || width === 0 || height === 0) {
      if (svgRef.current) d3.select(svgRef.current).selectAll("*").remove();
      return;
    }

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const margin = { top: 20, right: 20, bottom: 20, left: 20 };
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;

    // Layout: Donut on left, horizontal bars on right
    const donutSize = Math.min(chartHeight, chartWidth * 0.4);
    const donutCenterX = margin.left + donutSize / 2 + 20;
    const donutCenterY = margin.top + chartHeight / 2;

    // ===== DONUT CHART =====
    const donutG = svg
      .append("g")
      .attr("transform", `translate(${donutCenterX},${donutCenterY})`);

    const radius = donutSize / 2 - 10;
    const innerRadius = radius * 0.6;

    const pieData = healthStatusOrder
      .filter((status) => summaryStats[status] > 0)
      .map((status) => ({
        status,
        count: summaryStats[status],
      }));

    const pie = d3
      .pie<{ status: HealthStatus; count: number }>()
      .value((d) => d.count)
      .sort(null);

    const arc = d3
      .arc<d3.PieArcDatum<{ status: HealthStatus; count: number }>>()
      .innerRadius(innerRadius)
      .outerRadius(radius);

    const arcs = donutG
      .selectAll(".arc")
      .data(pie(pieData))
      .enter()
      .append("g")
      .attr("class", "arc");

    arcs
      .append("path")
      .attr("d", arc)
      .attr("fill", (d) => healthStatusColors[d.data.status])
      .attr("stroke", "hsl(var(--background))")
      .attr("stroke-width", 2)
      .style("opacity", 0.9)
      .on("mouseover", function (event, d) {
        d3.select(this).style("opacity", 1);

        if (tooltipRef.current) {
          tooltipRef.current.style.display = "block";
          tooltipRef.current.innerHTML = `
            <div style="font-weight: 600; margin-bottom: 4px;">${getHealthStatusLabel(d.data.status)}</div>
            <div style="font-size: 11px;">
              <span style="opacity: 0.7;">${t("count")}:</span>
              <span style="font-weight: 500;">${d.data.count}</span>
              <span style="opacity: 0.7;"> (${Math.round((d.data.count / data.length) * 100)}%)</span>
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
        d3.select(this).style("opacity", 0.9);
        if (tooltipRef.current) {
          tooltipRef.current.style.display = "none";
        }
      });

    // Center text showing total
    donutG
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .attr("y", -8)
      .style("fill", "hsl(var(--foreground))")
      .style("font-size", `${Math.min(32, radius * 0.4)}px`)
      .style("font-weight", "700")
      .text(data.length);

    donutG
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .attr("y", 16)
      .style("fill", "hsl(var(--muted-foreground))")
      .style("font-size", "12px")
      .text(t("totalTests"));

    // ===== HORIZONTAL BAR CHART =====
    // Position bar chart relative to the donut - start after donut with gap
    const labelWidth = 110; // Space for status labels
    const gapAfterDonut = 30; // Gap between donut and bar section
    const barSectionStart = donutCenterX + radius + gapAfterDonut; // Start after the donut's right edge
    const barStartX = barSectionStart + labelWidth;
    const barWidth = Math.max(chartWidth + margin.left - barStartX - 80, 50); // Leave space for count/percentage on right
    const barHeight = 28;
    const barGap = 12;
    const totalBarsHeight = healthStatusOrder.length * (barHeight + barGap) - barGap;
    const barStartY = margin.top + (chartHeight - totalBarsHeight) / 2;

    const barG = svg.append("g");

    // Scale for bar widths
    const maxCount = Math.max(...Object.values(summaryStats), 1);
    const xScale = d3.scaleLinear().domain([0, maxCount]).range([0, barWidth]);

    healthStatusOrder.forEach((status, i) => {
      const count = summaryStats[status];
      const y = barStartY + i * (barHeight + barGap);

      // Status label
      barG
        .append("text")
        .attr("x", barStartX - 10)
        .attr("y", y + barHeight / 2)
        .attr("text-anchor", "end")
        .attr("dominant-baseline", "middle")
        .style("fill", "hsl(var(--foreground))")
        .style("font-size", "12px")
        .style("font-weight", "500")
        .text(getHealthStatusLabel(status));

      // Background bar
      barG
        .append("rect")
        .attr("x", barStartX)
        .attr("y", y)
        .attr("width", barWidth)
        .attr("height", barHeight)
        .attr("rx", 4)
        .attr("fill", "hsl(var(--muted))")
        .style("opacity", 0.3);

      // Filled bar
      barG
        .append("rect")
        .attr("x", barStartX)
        .attr("y", y)
        .attr("width", 0)
        .attr("height", barHeight)
        .attr("rx", 4)
        .attr("fill", healthStatusColors[status])
        .style("opacity", 0.85)
        .transition()
        .duration(600)
        .delay(i * 100)
        .attr("width", count > 0 ? Math.max(xScale(count), 4) : 0);

      // Count text
      barG
        .append("text")
        .attr("x", barStartX + barWidth + 10)
        .attr("y", y + barHeight / 2)
        .attr("dominant-baseline", "middle")
        .style("fill", "hsl(var(--foreground))")
        .style("font-size", "13px")
        .style("font-weight", "600")
        .text(count);
    });
  }, [summaryStats, data, width, height, getHealthStatusLabel, t]);

  // Calculate additional summary metrics
  const summaryMetrics = useMemo(() => {
    // Count stale tests separately (isStale is now a boolean flag)
    const staleCount = data.filter((d) => d.isStale).length;
    const needsAttention =
      summaryStats.always_failing +
      summaryStats.never_executed +
      staleCount;
    const healthyCount = summaryStats.healthy + summaryStats.always_passing;
    const avgHealthScore =
      data.length > 0
        ? Math.round(data.reduce((sum, d) => sum + d.healthScore, 0) / data.length)
        : 0;

    const needsAttentionPct = data.length > 0 ? Math.round((needsAttention / data.length) * 100) : 0;
    const healthyPct = data.length > 0 ? Math.round((healthyCount / data.length) * 100) : 0;

    const stalePct = data.length > 0 ? Math.round((staleCount / data.length) * 100) : 0;

    return {
      total: data.length,
      needsAttention,
      needsAttentionPct,
      staleCount,
      stalePct,
      healthy: healthyCount,
      healthyPct,
      avgHealthScore,
    };
  }, [data, summaryStats]);

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
        {/* Total Tests */}
        <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border">
          <div className="p-2 rounded-md bg-primary/10">
            <Activity className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="text-2xl font-bold">{summaryMetrics.total}</p>
            <p className="text-xs text-muted-foreground">{t("stats.totalTests")}</p>
          </div>
        </div>

        {/* Needs Attention */}
        <div className="flex items-center gap-3 p-3 rounded-lg bg-destructive/5 border border-destructive/20">
          <div className="p-2 rounded-md bg-destructive/10">
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </div>
          <div>
            <p className="text-2xl font-bold text-destructive">
              {summaryMetrics.needsAttention}
              <span className="text-sm font-normal ml-1">{"("}{summaryMetrics.needsAttentionPct}{"%)"}</span>
            </p>
            <div className="flex items-center gap-1">
              <p className="text-xs text-muted-foreground">{t("stats.needsAttention")}</p>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="h-3 w-3 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs">
                    <div className="text-xs">
                      {t("stats.needsAttentionTooltip")}
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
        </div>

        {/* Stale */}
        <div className="flex items-center gap-3 p-3 rounded-lg bg-yellow-500/5 border border-yellow-500/20">
          <div className="p-2 rounded-md bg-yellow-500/10">
            <Clock className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
              {summaryMetrics.staleCount}
              <span className="text-sm font-normal ml-1">{"("}{summaryMetrics.stalePct}{"%)"}</span>
            </p>
            <p className="text-xs text-muted-foreground">{t("healthStatus.stale")}</p>
          </div>
        </div>

        {/* Healthy */}
        <div className="flex items-center gap-3 p-3 rounded-lg bg-green-500/5 border border-green-500/20">
          <div className="p-2 rounded-md bg-green-500/10">
            <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-green-600 dark:text-green-400">
              {summaryMetrics.healthy}
              <span className="text-sm font-normal ml-1">{"("}{summaryMetrics.healthyPct}{"%)"}</span>
            </p>
            <div className="flex items-center gap-1">
              <p className="text-xs text-muted-foreground">{t("stats.healthy")}</p>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="h-3 w-3 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs">
                    <div className="text-xs">
                      {t("stats.healthyTooltip")}
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
        </div>

        {/* Avg Health Score */}
        <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border">
          <div className="p-2 rounded-md bg-blue-500/10">
            <Activity className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <p className="text-2xl font-bold">{summaryMetrics.avgHealthScore}</p>
            <div className="flex items-center gap-1">
              <p className="text-xs text-muted-foreground">{t("stats.avgScore")}</p>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="h-3 w-3 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs">
                    <div className="text-xs space-y-1">
                      <p className="font-semibold">{t("healthScoreTooltip.title")}</p>
                      <ul className="list-disc pl-3 space-y-0.5">
                        <li>{t("healthScoreTooltip.neverExecuted")}</li>
                        <li>{t("healthScoreTooltip.stale90")}</li>
                        <li>{t("healthScoreTooltip.stale60")}</li>
                        <li>{t("healthScoreTooltip.stale30")}</li>
                        <li>{t("healthScoreTooltip.alwaysPassing")}</li>
                        <li>{t("healthScoreTooltip.alwaysFailing")}</li>
                        <li>{t("healthScoreTooltip.lowPassRate")}</li>
                        <li>{t("healthScoreTooltip.lowExecutions")}</li>
                      </ul>
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
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
