import React, { useEffect, useRef } from "react";
import * as Plot from "@observablehq/plot";
import useResponsiveSVG from "~/hooks/useResponsiveSVG"; // Import the hook
import { toHumanReadable, toBusinessHours } from "~/utils/duration"; // Import the utility
import { useTranslations } from "next-intl"; // Added import

// Define the new structure for a plottable item
export type PlotTask = {
  id: string; // Unique ID (session-id or original test case id from DB)
  name: string; // Display name for the bar (Session name or Test Case name)
  groupName: string; // Name for Y-axis grouping (Session name or Test Run name)
  start: Date;
  end: Date;
  color: string; // Color for the bar
  projectName: string;
  link?: string; // Link for navigation
  opacity?: number; // Opacity for the bar (0.0 to 1.0)
  originalDurationInSeconds?: number; // Actual work effort in seconds
};

// Define the props for the Gantt chart component
export interface UserWorkGanttChartProps {
  tasks: PlotTask[]; // Changed from GanttTask[]
  locale: string; // For date formatting or other localization
  onTaskClick?: (task: PlotTask) => void; // Optional: Handler for task clicks, changed to PlotTask
}

const UserWorkGanttChart: React.FC<UserWorkGanttChartProps> = ({
  tasks,
  locale,
  onTaskClick,
}) => {
  const t = useTranslations(); // Added useTranslations hook
  const chartRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const { width, height: containerHeight } = useResponsiveSVG(chartRef);
  const prevGanttRenderKey = useRef<string>("");

  // Constants for dynamic height calculation
  const ROW_HEIGHT_ESTIMATE = 35; // px per task group on Y axis
  const PLOT_TOP_MARGIN = 30;
  const PLOT_BOTTOM_MARGIN = 40;

  // Effect to manage the tooltip div element
  useEffect(() => {
    const ttElement = document.createElement("div");
    ttElement.className = "gantt-tooltip"; // Add a class for styling
    ttElement.style.position = "fixed";
    ttElement.style.display = "none";
    ttElement.style.pointerEvents = "none";
    // ttElement.style.backgroundColor = "white"; // Remove inline style
    // ttElement.style.border = "1px solid #ccc"; // Remove inline style
    ttElement.style.padding = "8px";
    ttElement.style.borderRadius = "4px";
    ttElement.style.zIndex = "1000";
    ttElement.style.fontSize = "12px";
    ttElement.style.lineHeight = "1.4";
    ttElement.style.maxWidth = "300px";
    // Color will be handled by CSS variable via the gantt-tooltip class

    document.body.appendChild(ttElement);
    tooltipRef.current = ttElement;

    return () => {
      if (tooltipRef.current) {
        document.body.removeChild(tooltipRef.current);
        tooltipRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    // --- NEW DIAGNOSTIC LOG IN UserWorkGanttChart.tsx ---
    // if (tasks && tasks.length > 0) {
    //   const taskToLog = tasks.find(task => task.id === "session-44") || tasks[0];
    //   if (taskToLog && taskToLog.start instanceof Date) { // Ensure start is a Date object
    //     console.log(
    //       `UserWorkGanttChart - RECEIVED PROPS for task ID ${taskToLog.id}:`,
    //       {
    //         rawStartDate: taskToLog.start,
    //         rawEndDate: taskToLog.end,
    //         startDateToString: taskToLog.start.toString(),
    //         endDateToString: taskToLog.end.toString(),
    //         startDateToISO: taskToLog.start.toISOString(),
    //         endDateToISO: taskToLog.end.toISOString(),
    //         startGetHours: taskToLog.start.getHours(),
    //         startGetUTCHours: taskToLog.start.getUTCHours(),
    //       }
    //     );
    //   } else if (taskToLog) {
    //     console.log(
    //       `UserWorkGanttChart - RECEIVED PROPS for task ID ${taskToLog.id} - start is NOT a Date object:`,
    //       taskToLog.start
    //     );
    //   }
    // }
    // --- END NEW DIAGNOSTIC LOG ---

    let tasksKey;
    try {
      tasksKey = JSON.stringify(
        tasks.map(
          (t) =>
            `${t.id}-${t.start.toISOString()}-${t.end.toISOString()}-${t.name}-${t.groupName}` // Added groupName to key
        )
      );
    } catch (e) {
      tasksKey = "tasks-error-stringifying";
    }

    // Determine unique group names for height calculation & y-axis domain
    const uniqueGroupNames = tasks.reduce((acc, task) => {
      if (!acc.includes(task.groupName)) {
        acc.push(task.groupName);
      }
      return acc;
    }, [] as string[]);

    const calculatedPlotHeight =
      uniqueGroupNames.length > 0
        ? uniqueGroupNames.length * ROW_HEIGHT_ESTIMATE +
          PLOT_TOP_MARGIN +
          PLOT_BOTTOM_MARGIN
        : 200;

    const currentGanttRenderKey = `${tasksKey}-${locale}-${onTaskClick ? "handler-present" : "handler-absent"}-${width}-${calculatedPlotHeight}`;

    if (
      prevGanttRenderKey.current === currentGanttRenderKey &&
      chartRef.current?.querySelector("svg")
    )
      return;

    if (width === 0 || !tasks || tasks.length === 0) {
      if (chartRef.current) {
        chartRef.current.innerHTML = "";
      }
      prevGanttRenderKey.current = currentGanttRenderKey;
      return;
    }

    if (chartRef.current) {
      chartRef.current.innerHTML = "";

      const ganttPlot = Plot.plot({
        width: width,
        height: calculatedPlotHeight,
        marginTop: PLOT_TOP_MARGIN,
        marginLeft: 150,
        marginRight: 20,
        marginBottom: PLOT_BOTTOM_MARGIN,
        style: {
          // Rely on Plot's default font or set via CSS if needed globally
          // color: "var(--tp-axis-label-text)", // This would be for default text color in plot
          // backgroundColor: "var(--tp-chart-background)" // If you have a chart background variable
        },
        x: {
          // type: "utc", // Ensure this is commented out or removed for local time axis
          grid: true,
          label: "Timeline", // General label, ticks will show local time
          tickFormat: (d) => {
            // d is a Date object representing a tick value
            // Format for local time. Example: "5/22, 3:00 PM"
            // Adjust options as needed for desired verbosity/format.
            if (d instanceof Date) {
              return d.toLocaleString(locale, {
                month: "numeric",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              });
            }
            return String(d); // Fallback for non-Date values
          },
        },
        y: {
          domain: uniqueGroupNames,
          label: null,
          grid: false,
          reverse: false,
          // Removed color from here
          tickFormat: (groupName: string) => {
            const maxLength = 25;
            if (typeof groupName === "string" && groupName.length > maxLength) {
              return groupName.substring(0, maxLength) + "...";
            }
            return groupName;
          },
        },
        marks: [
          Plot.gridX({
            stroke: "var(--tp-grid-line-color)",
            strokeOpacity: 0.5,
          }),
          // Y grid is intentionally off based on y: { grid: false }
          Plot.barX(tasks, {
            x1: (d: PlotTask) => {
              // --- DIAGNOSTIC LOG INSIDE Plot.barX for x1 ---
              // if (d.id === (tasks.find(task => task.id === "session-44") || tasks[0]).id) {
              //   console.log(`Plot.barX - Task ID ${d.id} - x1 (start date) being processed:`, d.start);
              //   console.log(`Plot.barX - Task ID ${d.id} - x1 (start date) toString():`, d.start.toString());
              //   console.log(`Plot.barX - Task ID ${d.id} - x1 (start date) getHours():`, d.start.getHours());
              //   console.log(`Plot.barX - Task ID ${d.id} - x1 (start date) getUTCHours():`, d.start.getUTCHours());
              // }
              return d.start;
            },
            x2: "end",
            y: "groupName",
            fill: "color",
            fillOpacity: "opacity",
            ariaLabel: (d: PlotTask) => `task-bar-${d.id}`,
          }),
          Plot.text(tasks, {
            x: "start",
            y: "groupName",
            text: (d: PlotTask) => {
              const maxLength = 30;
              if (d.name.length > maxLength) {
                return d.name.substring(0, maxLength) + "...";
              }
              return d.name;
            },
            dx: 5,
            textAnchor: "start",
            fill: "var(--tp-text-on-primary)", // Changed to use text-on-primary for better contrast
            fontSize: 10,
            title: (d: PlotTask) => d.name,
            pointerEvents: "none",
            className: "gantt-task-label",
          }),
        ],
      });

      // Add a style element to the plot to customize specific SVG parts
      const styleElement = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "style"
      );
      styleElement.textContent = `
        .plot .plot-axis-label {
          fill: var(--tp-axis-label-text);
          color: var(--tp-axis-label-text);
        }
        .plot .tick text {
          fill: var(--tp-axis-label-text);
          color: var(--tp-axis-label-text);
        }
      `;
      // Prepend to ensure it's there but Plot's own styles can also apply
      if (ganttPlot.firstChild && ganttPlot.firstChild.nodeName === "style") {
        ganttPlot.insertBefore(styleElement, ganttPlot.firstChild.nextSibling);
      } else {
        ganttPlot.prepend(styleElement);
      }

      chartRef.current.append(ganttPlot);
      const currentChartRef = chartRef.current;

      if (onTaskClick && currentChartRef) {
        const handleClick = (event: MouseEvent) => {
          let targetElement = event.target as SVGElement;
          while (
            targetElement &&
            targetElement.parentNode &&
            currentChartRef.contains(targetElement)
          ) {
            if (
              targetElement instanceof HTMLDivElement &&
              targetElement === currentChartRef
            )
              break;
            if (targetElement.nodeName === "rect") {
              const taskBarLabel = targetElement.getAttribute("aria-label");
              if (taskBarLabel && taskBarLabel.startsWith("task-bar-")) {
                const taskId = taskBarLabel.replace("task-bar-", "");
                const clickedTask = tasks.find((t) => t.id === taskId);
                if (clickedTask && clickedTask.link) {
                  onTaskClick(clickedTask);
                  return;
                }
              }
            }
            targetElement = targetElement.parentNode as SVGElement;
            if (!targetElement) break;
          }
        };
        currentChartRef.addEventListener("click", handleClick as EventListener);
        const clickableRects = currentChartRef.querySelectorAll(
          'rect[aria-label^="task-bar-"]'
        );
        clickableRects.forEach((rectNode) => {
          const task = tasks.find(
            (t) => `task-bar-${t.id}` === rectNode.getAttribute("aria-label")
          );
          if (task && task.link) {
            (rectNode as SVGRectElement).style.cursor = "pointer";
          }
        });
      }

      if (tooltipRef.current && currentChartRef) {
        const bars = currentChartRef.querySelectorAll(
          'rect[aria-label^="task-bar-"]'
        );
        bars.forEach((barNode: Element) => {
          const barElement = barNode as SVGRectElement;
          const taskBarLabel = barElement.getAttribute("aria-label");
          if (!taskBarLabel) return;

          const taskId = taskBarLabel.replace("task-bar-", "");
          const taskData = tasks.find((t) => t.id === taskId);
          if (!taskData) return;

          const handleMouseOver = (event: MouseEvent) => {
            if (!tooltipRef.current || !taskData) return;

            const businessHours = toBusinessHours(taskData.start, taskData.end);
            const readableWorkEffort = `${businessHours.toFixed(1)} business hours`;

            // Format dates using browser's local timezone for the tooltip
            const startDateStr = taskData.start.toLocaleDateString(locale, {
              year: "numeric",
              month: "short",
              day: "numeric",
            });
            const startTimeStr = taskData.start.toLocaleTimeString(locale, {
              hour: "numeric",
              minute: "2-digit",
              // timeZoneName: "short", // Optional: shows timezone like PST, CDT
            });

            const endDateStr = taskData.end.toLocaleDateString(locale, {
              year: "numeric",
              month: "short",
              day: "numeric",
            });
            const endTimeStr = taskData.end.toLocaleTimeString(locale, {
              hour: "numeric",
              minute: "2-digit",
              // timeZoneName: "short",
            });

            tooltipRef.current.innerHTML = `
              <div style="font-weight: bold; margin-bottom: 4px; color: var(--tp-primary-color);">${taskData.name}</div>
              <div style="font-weight: light; color: var(--tp-muted);"><strong>${t("ganttTooltip.group")}</strong> ${taskData.groupName}</div>
              <div style="font-weight: light; color: var(--tp-muted);"><strong>${t("ganttTooltip.project")}</strong> ${taskData.projectName}</div>
              <div style="margin-top: 6px;"><strong>${t("ganttTooltip.starts")}</strong> ${startDateStr} ${startTimeStr}</div>
              <div><strong>${t("ganttTooltip.scheduledCompletion")}</strong> ${endDateStr} ${endTimeStr}</div>
              <div><strong>${t("ganttTooltip.estWorkEffort")}</strong> ${readableWorkEffort}</div>
            `;
            tooltipRef.current.style.display = "block";
            tooltipRef.current.style.left = `${event.clientX + 15}px`;
            tooltipRef.current.style.top = `${event.clientY + 15}px`;
          };

          const handleMouseMove = (event: MouseEvent) => {
            if (!tooltipRef.current) return;
            tooltipRef.current.style.left = `${event.clientX + 15}px`;
            tooltipRef.current.style.top = `${event.clientY + 15}px`;
          };

          const handleMouseOut = () => {
            if (!tooltipRef.current) return;
            tooltipRef.current.style.display = "none";
          };

          barElement.addEventListener(
            "mouseover",
            handleMouseOver as EventListener
          );
          barElement.addEventListener(
            "mousemove",
            handleMouseMove as EventListener
          );
          barElement.addEventListener(
            "mouseout",
            handleMouseOut as EventListener
          );
        });
      }
      prevGanttRenderKey.current = currentGanttRenderKey;
    }
  }, [tasks, locale, onTaskClick, width, containerHeight, t]);

  if (!tasks || tasks.length === 0) {
    return <div className="text-center p-4">{t("ganttTooltip.noTasks")}</div>;
  }

  return (
    <div
      ref={chartRef}
      className="gantt-chart-container p-4 border rounded-md min-h-[200px] w-full"
    >
      {/* Chart will be rendered here by Plot */}
    </div>
  );
};

export default UserWorkGanttChart;
