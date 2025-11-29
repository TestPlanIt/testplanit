import React, { useEffect, useRef } from "react";
import * as d3 from "d3";
import type { CalendarWorkItem } from "../UserDashboard";
import { toHumanReadable, toBusinessHours } from "../../utils/duration";
import useResponsiveSVG from "~/hooks/useResponsiveSVG";
import { format } from "date-fns";
import { useTranslations } from "next-intl";
import { getDateFnsLocale } from "~/utils/locales";

interface UserWorkCalendarProps {
  data: CalendarWorkItem[];
  locale?: string;
  onItemClick?: (path: string) => void;
}

const DAY_CELL_HEIGHT = 30;
const DAY_CELL_PADDING = 2; // Padding between task tracks
const MONTH_HEADER_HEIGHT = 30;
const DAY_TEXT_PADDING = 5;

const UserWorkCalendar: React.FC<UserWorkCalendarProps> = ({
  data,
  locale = "en",
  onItemClick,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { width } = useResponsiveSVG(containerRef);
  const [dynamicHeight, setDynamicHeight] = React.useState(300);
  const dateLocale = getDateFnsLocale(locale);
  const t = useTranslations();

  useEffect(() => {
    if (!data || !svgRef.current || width <= 0) {
      // Data can be empty, still draw calendar structure
      if (svgRef.current) d3.select(svgRef.current).selectAll("*").remove();
      return;
    }

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const margin = { top: 10, right: 20, bottom: 20, left: 20 }; // Left margin for Y-axis labels like task names (future)
    const chartWidth = width - margin.left - margin.right;

    if (chartWidth <= 0) return;

    const today = d3.timeDay.floor(new Date());

    // Determine date range: from first task start to last task end, or default period if no tasks
    const firstTaskDate = d3.min(data, (d) => d.scheduledStartDate);
    const lastTaskDate = d3.max(data, (d) => d.scheduledEndDate);

    const calendarStartDate = d3.timeMonday.floor(firstTaskDate || today);
    const calendarEndDate = d3.timeSunday.ceil(
      lastTaskDate || d3.timeDay.offset(today, 30)
    );

    /* Commenting out to allow calendar to fit tasks more tightly
    const minCalendarWeeks = 4;
    if (
      d3.timeWeek.count(calendarStartDate, calendarEndDate) < minCalendarWeeks
    ) {
      calendarEndDate = d3.timeWeek.offset(calendarStartDate, minCalendarWeeks);
    }
    */

    const allDaysInView = d3.timeDays(calendarStartDate, calendarEndDate);
    const weeksInView = d3.timeMondays(calendarStartDate, calendarEndDate);

    // Calculate dynamic height
    const taskTracksHeight = data.length * (DAY_CELL_HEIGHT + DAY_CELL_PADDING);
    const calendarGridHeight =
      MONTH_HEADER_HEIGHT + weeksInView.length * DAY_CELL_HEIGHT;
    // Height should be enough for tasks or the calendar grid, whichever is larger, plus margins.
    const calculatedChartHeight = Math.max(
      taskTracksHeight,
      calendarGridHeight - MONTH_HEADER_HEIGHT
    );
    const newDynamicHeight =
      calculatedChartHeight + MONTH_HEADER_HEIGHT + margin.top + margin.bottom;
    setDynamicHeight(newDynamicHeight);

    if (calculatedChartHeight <= 0) return;

    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);
    const calendarArea = g
      .append("g")
      .attr("transform", `translate(0, ${MONTH_HEADER_HEIGHT})`);

    const xScale = d3
      .scaleTime()
      .domain([calendarStartDate, calendarEndDate])
      .range([0, chartWidth]);
    const dayWidth = chartWidth / allDaysInView.length;

    // Month headers
    const months = d3.timeMonths(
      d3.timeMonth.floor(calendarStartDate),
      calendarEndDate
    );
    g.append("g") // Month headers go above the calendar area
      .selectAll(".month-header")
      .data(months)
      .enter()
      .append("text")
      .attr("class", "month-header")
      .attr("x", (d) => {
        const monthStartPos = xScale(d);
        const monthEndPos = xScale(
          d3.timeMonth.offset(d, 1) > calendarEndDate
            ? calendarEndDate
            : d3.timeMonth.offset(d, 1)
        );
        return monthStartPos + (monthEndPos - monthStartPos) / 2;
      })
      .attr("y", MONTH_HEADER_HEIGHT / 2)
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .style("font-size", "12px")
      .style("font-weight", "bold")
      .text((d) => format(d, "MMMM yyyy", { locale: dateLocale }));

    // Week rows for day cells
    calendarArea
      .selectAll(".week-row")
      .data(weeksInView)
      .enter()
      .append("g")
      .attr("class", "week-row")
      .attr("transform", (d, i) => `translate(0, ${i * DAY_CELL_HEIGHT})`)
      .each(function (weekDate) {
        const daysInWeek = d3
          .timeDays(weekDate, d3.timeWeek.offset(weekDate, 1))
          .filter((d) => d >= calendarStartDate && d < calendarEndDate); // only days in view
        d3.select(this)
          .selectAll(".day-cell")
          .data(daysInWeek)
          .enter()
          .append("rect")
          .attr("class", "day-cell")
          .attr("x", (d) => xScale(d))
          .attr("y", 0)
          .attr("width", dayWidth - 0.5) // Small gap
          .attr("height", DAY_CELL_HEIGHT - 0.5) // Small gap
          .attr("fill", (d) => {
            if (d3.timeDay.count(today, d) === 0) return "#e6f7ff"; // Today's color
            return d.getDay() === 0 || d.getDay() === 6 ? "#f5f5f5" : "#ffffff"; // Weekend/weekday
          })
          .attr("stroke", "#d9d9d9");

        // Day text will be drawn in a separate pass, after tasks
      });

    // Render task bars (tasks are drawn over the calendar grid)
    const taskArea = calendarArea.append("g").attr("class", "task-area");
    taskArea
      .selectAll(".task-item-group")
      .data(data)
      .enter()
      .append("g")
      .attr("class", "task-item-group")
      .attr(
        "transform",
        (item, index) =>
          `translate(0, ${index * (DAY_CELL_HEIGHT + DAY_CELL_PADDING)})`
      )
      .each(function (item) {
        const itemGroup = d3.select(this);
        const itemStartDatePos = xScale(item.scheduledStartDate);
        const itemEndDatePos = xScale(item.scheduledEndDate);
        const totalItemWidth = Math.max(
          dayWidth * 0.8,
          itemEndDatePos - itemStartDatePos
        );

        if (item.type === "Session") {
          itemGroup
            .append("rect")
            .attr("x", itemStartDatePos + DAY_CELL_PADDING / 2)
            .attr("y", DAY_CELL_PADDING / 2)
            .attr("width", totalItemWidth - DAY_CELL_PADDING)
            .attr("height", DAY_CELL_HEIGHT - DAY_CELL_PADDING)
            .attr("fill", "rgba(255, 165, 0, 0.7)") // Orange for Session
            .attr("rx", 3)
            .attr("ry", 3)
            .style("cursor", "pointer")
            .on("click", () => {
              if (onItemClick && item.link) {
                onItemClick(item.link);
              }
            })
            .append("title")
            .text(
              `${item.name} (${t("sessions.title", { count: 1 })})\n${t("navigation.projects.sections.project")}: ${item.projectName}\n${t("common.fields.elapsed")}: ${toBusinessHours(item.scheduledStartDate, item.scheduledEndDate).toFixed(1)} business hours\n${t("common.fields.started")}: ${format(item.scheduledStartDate, "PP", { locale: dateLocale })}\n${t("common.fields.completedOn")}: ${format(item.scheduledEndDate, "PP", { locale: dateLocale })}`
            );

          itemGroup
            .append("text")
            .attr("x", itemStartDatePos + 5)
            .attr("y", DAY_CELL_HEIGHT / 2)
            .attr("dy", "0.35em")
            .style("font-size", "10px")
            .style("fill", "#503000") // Darker text for session
            .style("pointer-events", "none")
            .text(
              item.name.length > totalItemWidth / 6
                ? item.name.substring(0, Math.floor(totalItemWidth / 6) - 2) +
                    "..."
                : item.name
            );
        } else if (
          item.type === "Test Run Group" &&
          item.cases &&
          item.cases.length > 0
        ) {
          let currentXOffset = itemStartDatePos + DAY_CELL_PADDING / 2;
          const groupTotalDuration = item.originalDurationInSeconds;

          item.cases.forEach((caseItem) => {
            const caseProportion =
              groupTotalDuration > 0
                ? caseItem.timeValue / groupTotalDuration
                : 0;
            const caseWidth =
              (totalItemWidth - DAY_CELL_PADDING) * caseProportion;

            if (caseWidth > 0) {
              itemGroup
                .append("rect")
                .attr("x", currentXOffset)
                .attr("y", DAY_CELL_PADDING / 2)
                .attr("width", caseWidth)
                .attr("height", DAY_CELL_HEIGHT - DAY_CELL_PADDING)
                .attr("fill", "rgba(70, 130, 180, 0.7)") // Steelblue for Test Run Case
                .style("cursor", "pointer")
                .on("click", (event) => {
                  event.stopPropagation(); // Prevent any parent click if there was one
                  if (onItemClick && caseItem.link) {
                    onItemClick(caseItem.link);
                  }
                })
                .append("title")
                .text(
                  `${caseItem.name} (${t("repository.cases.title")})\n${t("runs.title")}: ${item.name}\n${t("navigation.projects.sections.project")}: ${item.projectName}\n${t("common.fields.elapsed")}: ${toBusinessHours(item.scheduledStartDate, item.scheduledEndDate).toFixed(1)} business hours\n(${t("common.fields.started")}: ${format(item.scheduledStartDate, "PP", { locale: dateLocale })}, ${t("common.fields.completedOn")}: ${format(item.scheduledEndDate, "PP", { locale: dateLocale })})`
                );
              currentXOffset += caseWidth;
            }
          });

          // Optional: Add a text label for the Test Run Group itself, if space permits
          // This text might be on top of the segmented bar or next to it.
          // For now, the primary interaction is with the cases.
          // We can add a group label if needed later.
          // If we add a group label, it should not obscure the case segments.

          // Add a single, non-interactive border around the entire group to delineate it
          itemGroup
            .append("rect")
            .attr("x", itemStartDatePos + DAY_CELL_PADDING / 2)
            .attr("y", DAY_CELL_PADDING / 2)
            .attr("width", totalItemWidth - DAY_CELL_PADDING)
            .attr("height", DAY_CELL_HEIGHT - DAY_CELL_PADDING)
            .attr("fill", "none")
            .attr("stroke", "rgba(70, 130, 180, 0.9)") // Slightly darker/more opaque border for the group
            .attr("stroke-width", 0.5)
            .attr("rx", 3)
            .attr("ry", 3)
            .style("pointer-events", "none"); // Make sure this border doesn't interfere with clicks on cases

          // Text for the Test Run Group Name (can be tricky with segments)
          // Displaying it similarly to sessions, but it might overlap with case segments.
          // A better approach might be to show it only if there are no cases or if it fits well.
          itemGroup
            .append("text")
            .attr("x", itemStartDatePos + 5)
            .attr("y", DAY_CELL_HEIGHT / 2)
            .attr("dy", "0.35em")
            .style("font-size", "10px")
            .style("fill", "#ffffff") // White text for test run group
            .style("pointer-events", "none")
            .text(
              item.name.length > totalItemWidth / 7 // Adjust divisor for better fit on segmented bar
                ? item.name.substring(0, Math.floor(totalItemWidth / 7) - 2) +
                    "..."
                : item.name
            );
        }
      });

    // Pass 3: Draw Day Text (on top of grid and tasks)
    calendarArea
      .selectAll(".week-row") // Selects the <g> elements with class "week-row" created in Pass 1
      .each(function (weekDate, i) {
        // weekDate is the datum bound to the .week-row <g>
        const daysInWeek = d3
          .timeDays(weekDate as Date, d3.timeWeek.offset(weekDate as Date, 1))
          .filter((d) => d >= calendarStartDate && d < calendarEndDate);

        d3.select(this) // 'this' is the current .week-row <g> element
          .selectAll(".day-text")
          .data(daysInWeek)
          .join("text") // Creates/updates text elements within the group
          .attr("class", "day-text")
          .attr("x", (d) => xScale(d) + DAY_TEXT_PADDING)
          .attr("y", DAY_TEXT_PADDING) // Position relative to the week-row group's top
          .attr("dy", "0.71em") // Vertical alignment
          .style("font-size", "9px")
          .style("pointer-events", "none")
          .style("fill", "#555")
          .text((d) => format(d, "d", { locale: dateLocale }));
      });
  }, [data, width, locale, onItemClick, dateLocale, t]);

  return (
    <div ref={containerRef} style={{ width: "100%", minHeight: "200px" }}>
      <svg
        ref={svgRef}
        width={width}
        height={dynamicHeight}
        className="user-work-calendar"
      />
    </div>
  );
};

export default UserWorkCalendar;
