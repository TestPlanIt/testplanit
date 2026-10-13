"use client";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import * as d3 from "d3";
import {
  AlertTriangle,
  FolderOpen,
  HelpCircle,
  ListChecks,
  MapPin,
} from "lucide-react";
import { useTranslations } from "next-intl";
import React, { useEffect, useMemo, useRef } from "react";
import useResponsiveSVG from "~/hooks/useResponsiveSVG";
import {
  ROOT_DIRECTORY,
  type CodePinCoverageRow,
} from "~/utils/codePinCoverageShared";

interface CodePinCoverageChartProps {
  data: CodePinCoverageRow[];
}

const PIN_COLOR = "#3b82f6";
const UNCOVERED_COLOR = "#ef4444";

/** Tile figures; exported so tests can pin them. */
export function summarizeCodePinCoverage(data: CodePinCoverageRow[]) {
  const pinCount = data.reduce((sum, r) => sum + r.pinCount, 0);
  const stalePinCount = data.reduce((sum, r) => sum + r.stalePinCount, 0);
  const uncoveredFileCount = data.reduce(
    (sum, r) => sum + r.uncoveredFileCount,
    0
  );
  const gapDirectories = data.filter(
    (r) => r.pinCount === 0 && r.uncoveredFileCount > 0
  ).length;
  // The project-wide figures are repeated on every row; read each project once.
  const perProject = new Map<number, { withPins: number; total: number }>();
  for (const row of data) {
    const key = row.project?.id ?? 0;
    if (!perProject.has(key)) {
      perProject.set(key, {
        withPins: row.projectCasesWithPins,
        total: row.projectCaseTotal,
      });
    }
  }
  let casesWithPins = 0;
  let caseTotal = 0;
  for (const p of perProject.values()) {
    casesWithPins += p.withPins;
    caseTotal += p.total;
  }
  return {
    pinCount,
    stalePinCount,
    uncoveredFileCount,
    gapDirectories,
    casesWithPins,
    caseTotal,
    casesWithPinsPct:
      caseTotal > 0 ? Math.round((casesWithPins / caseTotal) * 100) : 0,
  };
}

export const CodePinCoverageChart: React.FC<CodePinCoverageChartProps> = ({
  data,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { width, height } = useResponsiveSVG(containerRef);
  const t = useTranslations("reports.ui.codePinCoverage");
  const tGlobal = useTranslations();
  const tReports = useTranslations("reports.ui");

  const summary = useMemo(() => summarizeCodePinCoverage(data), [data]);
  const top = useMemo(
    () =>
      [...data]
        .sort(
          (a, b) =>
            b.uncoveredFileCount +
            b.pinCount -
            (a.uncoveredFileCount + a.pinCount)
        )
        .slice(0, 12),
    [data]
  );

  useEffect(() => {
    if (!svgRef.current || width === 0 || height === 0) {
      if (svgRef.current) d3.select(svgRef.current).selectAll("*").remove();
      return;
    }
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    if (top.length === 0) return;

    const margin = { top: 24, right: 16, bottom: 24, left: 220 };
    const innerWidth = Math.max(0, width - margin.left - margin.right);
    const innerHeight = Math.max(0, height - margin.top - margin.bottom);
    // Rows keep a fixed height, so the axis sits under the last row
    // instead of at the bottom of whatever room the panel offers.
    const plotHeight = Math.min(innerHeight, top.length * 34);
    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);
    // Directory first: it is the part that differs between rows.
    const label = (row: CodePinCoverageRow) =>
      `${
        row.directory === ROOT_DIRECTORY ? t("rootDirectory") : row.directory
      } · ${row.repository.name}`;
    const y = d3
      .scaleBand<string>()
      .domain(top.map(label))
      .range([0, plotHeight])
      .padding(0.25);
    const ySub = d3
      .scaleBand<string>()
      .domain(["pins", "uncovered"])
      .range([0, y.bandwidth()])
      .padding(0.1);
    const x = d3
      .scaleLinear()
      .domain([
        0,
        d3.max(top, (r) => Math.max(r.pinCount, r.uncoveredFileCount)) ?? 1,
      ])
      .nice()
      .range([0, innerWidth]);

    g.append("g")
      .call(d3.axisLeft(y).tickSize(0))
      .selectAll("text")
      .attr("class", "fill-muted-foreground text-[10px]")
      .each(function () {
        const el = d3.select(this);
        const text = el.text();
        if (text.length > 34) el.text(`${text.slice(0, 33)}…`);
      });
    g.append("g")
      .attr("transform", `translate(0,${plotHeight})`)
      .call(d3.axisBottom(x).ticks(5).tickFormat(d3.format("d")))
      .selectAll("text")
      .attr("class", "fill-muted-foreground text-[10px]");

    const rows = g
      .selectAll("g.row")
      .data(top)
      .join("g")
      .attr("class", "row")
      .attr("transform", (r) => `translate(0,${y(label(r)) ?? 0})`);
    rows
      .append("rect")
      .attr("y", ySub("pins") ?? 0)
      .attr("height", ySub.bandwidth())
      .attr("width", (r) => x(r.pinCount))
      .attr("fill", PIN_COLOR)
      .append("title")
      .text((r) => `${tGlobal("repository.codePins.title")}: ${r.pinCount}`);
    rows
      .append("rect")
      .attr("y", ySub("uncovered") ?? 0)
      .attr("height", ySub.bandwidth())
      .attr("width", (r) => x(r.uncoveredFileCount))
      .attr("fill", UNCOVERED_COLOR)
      .append("title")
      .text((r) => `${t("uncoveredFiles")}: ${r.uncoveredFileCount}`);

    const legend = svg
      .append("g")
      .attr("transform", `translate(${margin.left},8)`);
    [
      {
        key: "pins",
        color: PIN_COLOR,
        text: tGlobal("repository.codePins.title"),
      },
      { key: "uncovered", color: UNCOVERED_COLOR, text: t("uncoveredFiles") },
    ].forEach((item, i) => {
      const gItem = legend
        .append("g")
        .attr("transform", `translate(${i * 170},0)`);
      gItem
        .append("rect")
        .attr("width", 10)
        .attr("height", 10)
        .attr("rx", 2)
        .attr("fill", item.color);
      gItem
        .append("text")
        .attr("x", 14)
        .attr("y", 9)
        .attr("class", "fill-muted-foreground text-[10px]")
        .text(item.text);
    });
  }, [top, width, height, t, tGlobal]);

  if (data.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        {tReports("noDataAvailable")}
      </div>
    );
  }

  const tile = (
    icon: React.ReactNode,
    value: React.ReactNode,
    label: string,
    tooltip?: string,
    className = "bg-muted/50 border"
  ) => (
    <div className={`flex items-center gap-3 rounded-lg p-3 ${className}`}>
      <div className="rounded-md bg-primary/10 p-2">{icon}</div>
      <div>
        <p className="text-2xl font-bold">{value}</p>
        <div className="flex items-center gap-1">
          <p className="text-xs text-muted-foreground">{label}</p>
          {tooltip && (
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="h-3 w-3 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">
                <div className="text-xs">{tooltip}</div>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div
      className="flex h-full flex-col gap-4"
      data-testid="code-pin-coverage-chart"
    >
      <div className="grid grid-cols-2 gap-3 px-2 md:grid-cols-5">
        {tile(
          <MapPin className="h-4 w-4 text-primary" />,
          summary.pinCount,
          tGlobal("repository.codePins.title")
        )}
        {tile(
          <ListChecks className="h-4 w-4 text-primary" />,
          <>
            {summary.casesWithPins}
            <span className="ms-1 text-sm font-normal">
              {"("}
              {summary.casesWithPinsPct}
              {"%)"}
            </span>
          </>,
          t("casesWithPins"),
          t("stats.casesWithPinsTooltip")
        )}
        {tile(
          <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />,
          summary.stalePinCount,
          t("stalePins"),
          t("stalePinsHelp"),
          "bg-yellow-500/5 border border-yellow-500/20"
        )}
        {tile(
          <AlertTriangle className="h-4 w-4 text-destructive" />,
          summary.uncoveredFileCount,
          t("uncoveredFiles"),
          t("uncoveredFilesHelp"),
          "bg-destructive/5 border border-destructive/20"
        )}
        {tile(
          <FolderOpen className="h-4 w-4 text-destructive" />,
          summary.gapDirectories,
          t("stats.gapDirectories"),
          t("stats.gapDirectoriesTooltip"),
          "bg-destructive/5 border border-destructive/20"
        )}
      </div>
      <div className="px-2 text-sm font-medium">{t("chart.byDirectory")}</div>
      <div ref={containerRef} className="min-h-[320px] w-full flex-1">
        <svg ref={svgRef} width={width} height={height} />
      </div>
    </div>
  );
};
