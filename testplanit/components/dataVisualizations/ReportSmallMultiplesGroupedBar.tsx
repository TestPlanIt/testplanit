"use client";
import React, { useEffect, useRef } from "react";
import * as d3 from "d3";
import { toHumanReadable } from "~/utils/duration";
import { useLocale } from "next-intl";
import { format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { getDateFnsLocale } from "~/utils/locales";
import { mapDateTimeFormatString } from "~/utils/mapDateTimeFormat";
import { useSession } from "next-auth/react";
import useResponsiveSVG from "~/hooks/useResponsiveSVG";

// Data structure for a single small multiple
export interface SmallMultipleData {
  groupName: string; // Name of the group from the first dimension
  data: GroupedBarDataPoint[]; // Data for the grouped bar chart
}

// Data for a single group in the bar chart
export interface GroupedBarDataPoint {
  name: string; // Name of the group from the second dimension
  [key: string]: number | string; // Metrics as key-value pairs
}

interface ReportSmallMultiplesGroupedBarProps {
  data: SmallMultipleData[];
  metrics: { value: string; label: string }[];
  isElapsedTimeMetric: (metric: { value: string; label: string }) => boolean;
}

const METRIC_COLORS = ["#8884d8", "#82ca9d", "#ffc658", "#ff8042"];

export const ReportSmallMultiplesGroupedBar: React.FC<
  ReportSmallMultiplesGroupedBarProps
> = ({ data, metrics, isElapsedTimeMetric }) => {
  const locale = useLocale();
  const { data: session } = useSession();
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  // Effect to create and remove the tooltip element from the DOM
  useEffect(() => {
    const tooltip = d3
      .select("body")
      .append("div")
      .attr("class", "d3-tooltip")
      .style("position", "absolute")
      .style("z-index", "10")
      .style("visibility", "hidden")
      .style("background", "rgba(0,0,0,0.7)")
      .style("color", "#fff")
      .style("padding", "5px 10px")
      .style("border-radius", "4px")
      .style("font-size", "12px")
      .style("pointer-events", "none");

    tooltipRef.current = tooltip.node();

    return () => {
      tooltip.remove();
    };
  }, []);

  useEffect(() => {
    if (!data || data.length === 0) return;

    const isPercentageMetric = (metric: {
      value: string;
      label: string;
    }): boolean => {
      const label = metric.label.toLowerCase();
      return (
        label.includes("rate") ||
        label.includes("percentage") ||
        label.includes("(%)") ||
        label.includes("%") ||
        metric.value === "passRate" ||
        metric.value === "automationRate" ||
        metric.label === "Pass Rate (%)" ||
        metric.label === "Automation Rate (%)"
      );
    };

    const formatValue = (value: number, metricLabel: string) => {
      const metric = metrics.find((m) => m.label === metricLabel);
      if (metric && isElapsedTimeMetric(metric)) {
        return toHumanReadable(value, { isSeconds: true, locale });
      }
      if (metric && isPercentageMetric(metric)) {
        return `${value.toFixed(2)}%`;
      }
      return value.toLocaleString();
    };

    const formatGroupName = (groupName: string) => {
      // Only try to parse as date if it looks like a date string
      // Check for ISO date format (YYYY-MM-DD) or common date patterns
      const datePattern = /^\d{4}-\d{2}-\d{2}/; // ISO format
      const isLikelyDate = datePattern.test(groupName);

      if (isLikelyDate) {
        const dateObject = new Date(groupName);
        if (!isNaN(dateObject.getTime())) {
          // It's a valid date, format it
          const dateLocale = getDateFnsLocale(locale);
          const formatString =
            session?.user.preferences?.dateFormat || "MM-dd-yyyy";
          const finalFormatString = mapDateTimeFormatString(formatString);

          try {
            if (session?.user.preferences?.timezone) {
              const ianaTimezone = session.user.preferences.timezone.replace(
                /_/g,
                "/"
              );
              return formatInTimeZone(
                dateObject,
                ianaTimezone,
                finalFormatString,
                { locale: dateLocale }
              );
            } else {
              return format(dateObject, finalFormatString, {
                locale: dateLocale,
              });
            }
          } catch (error) {
            console.warn(`Error formatting date "${groupName}":`, error);
            return format(dateObject, finalFormatString, { locale: dateLocale });
          }
        }
      }
      // Not a date, return as-is
      return groupName;
    };

    data.forEach((multiple, index) => {
      const container = refs.current[index];
      if (!container) return;

      // Clear previous SVG
      d3.select(container).select("svg").remove();

      const margin = { top: 30, right: 30, bottom: 40, left: 60 };
      const width = container.clientWidth - margin.left - margin.right;
      const height = 300 - margin.top - margin.bottom;

      const svg = d3
        .select(container)
        .append("svg")
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
        .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

      const metricLabels = metrics.map((m) => m.label);

      const x0 = d3
        .scaleBand()
        .domain(multiple.data.map((d) => d.name))
        .range([0, width])
        .padding(0.2);

      const x1 = d3
        .scaleBand()
        .domain(metricLabels)
        .range([0, x0.bandwidth()])
        .padding(0.05);

      const y = d3
        .scaleLinear()
        .domain([
          0,
          d3.max(multiple.data, (d) =>
            d3.max(metricLabels, (key) => d[key] as number)
          ) ?? 0,
        ])
        .nice()
        .range([height, 0]);

      const bars = svg
        .append("g")
        .selectAll("g")
        .data(multiple.data)
        .enter()
        .append("g")
        .attr("transform", (d) => `translate(${x0(d.name)},0)`)
        .selectAll("rect")
        .data((d) =>
          metricLabels.map((key) => ({
            groupName: d.name,
            key,
            value: d[key] as number,
          }))
        )
        .enter()
        .append("rect")
        .attr("x", (d) => x1(d.key)!)
        .attr("y", height) // Start at bottom
        .attr("width", x1.bandwidth())
        .attr("height", 0) // Start with no height
        .attr("fill", (d, i) => METRIC_COLORS[i % METRIC_COLORS.length])
        .style("opacity", 0); // Start invisible

      // Add event handlers before animation
      bars
        .on("mouseover", function (event, d) {
          d3.select(this).style("opacity", 0.7);
          if (tooltipRef.current) {
            d3.select(tooltipRef.current)
              .style("visibility", "visible")
              .html(
                `<strong>${d.groupName}</strong><br/>${d.key}: ${formatValue(
                  d.value,
                  d.key
                )}`
              );
          }
        })
        .on("mousemove", (event) => {
          if (tooltipRef.current) {
            d3.select(tooltipRef.current)
              .style("top", `${event.pageY - 10}px`)
              .style("left", `${event.pageX + 10}px`);
          }
        })
        .on("mouseout", function () {
          d3.select(this).style("opacity", 1);
          if (tooltipRef.current) {
            d3.select(tooltipRef.current).style("visibility", "hidden");
          }
        });

      // Animate bars growing up and fading in
      bars
        .transition()
        .duration(800)
        .delay((d, i) => i * 50) // Stagger animation
        .ease(d3.easeBackOut.overshoot(1.2))
        .attr("y", (d) => y(d.value))
        .attr("height", (d) => height - y(d.value))
        .style("opacity", 1);

      svg
        .append("g")
        .attr("transform", `translate(0,${height})`)
        .call(d3.axisBottom(x0));

      svg.append("g").call(d3.axisLeft(y));

      svg
        .append("text")
        .attr("x", width / 2)
        .attr("y", 0 - margin.top / 2)
        .attr("text-anchor", "middle")
        .style("font-size", "16px")
        .style("font-weight", "bold")
        .style("fill", "hsl(var(--primary))")
        .text(formatGroupName(multiple.groupName));
    });
  }, [
    data,
    metrics,
    isElapsedTimeMetric,
    locale,
    session?.user.preferences?.dateFormat,
    session?.user.preferences?.timezone,
  ]);

  return (
    <div
      className="grid gap-8 w-full"
      style={{
        gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))",
      }}
    >
      {data.map((_, index) => (
        <div
          key={index}
          ref={(el) => {
            refs.current[index] = el;
          }}
          className="p-2 border rounded-lg shadow-sm bg-primary-foreground max-w-lg"
        />
      ))}
    </div>
  );
};
