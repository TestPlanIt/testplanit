import { useMemo } from "react";
import { useTranslations, useLocale } from "next-intl";
import { createColumnHelper } from "@tanstack/react-table";
import { format, formatInTimeZone } from "date-fns-tz";
import { getDateFnsLocale } from "~/utils/locales";

interface Project {
  id: number;
  name: string;
}

export function useAutomationTrendsColumns(projects: Project[] = [], dateGrouping: string = "weekly") {
  const t = useTranslations();
  const locale = useLocale();
  const dateFnsLocale = getDateFnsLocale(locale);
  const columnHelper = createColumnHelper<any>();

  return useMemo(() => {
    const columns: any[] = [];
    const isMultiProject = projects.length > 1;

    // Add Period column with date range
    columns.push(
      columnHelper.accessor("periodStart", {
        id: "period",
        header: () => <span>{t("reports.dimensions.period")}</span>,
        cell: (info) => {
          const row = info.row.original;
          const startValue = row.periodStart;
          const endValue = row.periodEnd;

          if (!startValue || !endValue) return "-";

          try {
            const startDate = new Date(startValue);
            const endDate = new Date(endValue);

            if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return "-";

            // Format based on grouping - use UTC to avoid timezone issues
            let formatString = "PPP";
            if (dateGrouping === "daily") {
              formatString = "PPP";
            } else if (dateGrouping === "weekly") {
              formatString = "PP";
            } else if (dateGrouping === "monthly") {
              formatString = "MMM yyyy";
            } else if (dateGrouping === "quarterly") {
              formatString = "QQQ yyyy";
            } else if (dateGrouping === "annually") {
              formatString = "yyyy";
            }

            // Format dates in UTC to match the UTC periods from backend
            const formattedStart = formatInTimeZone(startDate, 'UTC', formatString, {
              locale: dateFnsLocale
            });
            const formattedEnd = formatInTimeZone(endDate, 'UTC', formatString, {
              locale: dateFnsLocale
            });

            // For single-day periods or same format output, show just one date
            if (formattedStart === formattedEnd || dateGrouping === "annually") {
              return <span>{formattedStart}</span>;
            }

            return (
              <span className="whitespace-nowrap">
                {formattedStart} - {formattedEnd}
              </span>
            );
          } catch (error) {
            return "-";
          }
        },
        enableSorting: true,
        enableGrouping: false,
      })
    );

    // For each project, add columns for automated, manual, total, %, and changes
    projects.forEach((project) => {
      const projectPrefix = project.name.replace(/\s+/g, "");

      // Automated Count
      columns.push(
        columnHelper.accessor(`${projectPrefix}_automated`, {
          id: `${projectPrefix}_automated`,
          header: () => (
            <span className="text-xs">
              {isMultiProject ? `${project.name} - ` : ""}
              {t("reports.metrics.automatedCount")}
            </span>
          ),
          cell: (info) => {
            const value = info.getValue();
            return (
              <span className="font-mono text-sm">
                {typeof value === "number" ? value.toLocaleString() : "-"}
              </span>
            );
          },
          enableSorting: true,
          enableGrouping: false,
        })
      );

      // Manual Count
      columns.push(
        columnHelper.accessor(`${projectPrefix}_manual`, {
          id: `${projectPrefix}_manual`,
          header: () => (
            <span className="text-xs">
              {isMultiProject ? `${project.name} - ` : ""}
              {t("reports.metrics.manualCount")}
            </span>
          ),
          cell: (info) => {
            const value = info.getValue();
            return (
              <span className="font-mono text-sm">
                {typeof value === "number" ? value.toLocaleString() : "-"}
              </span>
            );
          },
          enableSorting: true,
          enableGrouping: false,
        })
      );

      // Total Count
      columns.push(
        columnHelper.accessor(`${projectPrefix}_total`, {
          id: `${projectPrefix}_total`,
          header: () => (
            <span className="text-xs">
              {isMultiProject ? `${project.name} - ` : ""}
              {t("reports.metrics.totalCount")}
            </span>
          ),
          cell: (info) => {
            const value = info.getValue();
            return (
              <span className="font-mono text-sm font-semibold">
                {typeof value === "number" ? value.toLocaleString() : "-"}
              </span>
            );
          },
          enableSorting: true,
          enableGrouping: false,
        })
      );

      // Percent Automated
      columns.push(
        columnHelper.accessor(`${projectPrefix}_percentAutomated`, {
          id: `${projectPrefix}_percentAutomated`,
          header: () => (
            <span className="text-xs">
              {isMultiProject ? `${project.name} - ` : ""}
              {"% "}
              {t("common.fields.automated")}
            </span>
          ),
          cell: (info) => {
            const value = info.getValue();
            if (typeof value !== "number") return "-";

            // Color code based on percentage
            let colorClass = "text-red-600";
            if (value >= 70) colorClass = "text-green-600";
            else if (value >= 40) colorClass = "text-yellow-600";

            return (
              <span className={`font-mono text-sm font-semibold ${colorClass}`}>
                {value.toFixed(1)}
                {"% "}
              </span>
            );
          },
          enableSorting: true,
          enableGrouping: false,
        })
      );

      // Automated Change (week over week)
      columns.push(
        columnHelper.accessor(`${projectPrefix}_automatedChange`, {
          id: `${projectPrefix}_automatedChange`,
          header: () => (
            <span className="text-xs">
              {isMultiProject ? `${project.name} - ` : ""}
              {"Δ "}
              {t("common.fields.automated")}
            </span>
          ),
          cell: (info) => {
            const value = info.getValue();
            if (typeof value !== "number") return "-";

            const isPositive = value > 0;
            const isZero = value === 0;
            const colorClass = isZero
              ? "text-gray-500"
              : isPositive
                ? "text-green-600"
                : "text-red-600";
            const sign = isPositive ? "+" : "";

            return (
              <span className={`font-mono text-sm ${colorClass}`}>
                {sign}
                {value}
              </span>
            );
          },
          enableSorting: true,
          enableGrouping: false,
        })
      );

      // Manual Change (week over week)
      columns.push(
        columnHelper.accessor(`${projectPrefix}_manualChange`, {
          id: `${projectPrefix}_manualChange`,
          header: () => (
            <span className="text-xs">
              {isMultiProject ? `${project.name} - ` : ""}
              {"Δ "}
              {t("common.fields.manual")}
            </span>
          ),
          cell: (info) => {
            const value = info.getValue();
            if (typeof value !== "number") return "-";

            const isPositive = value > 0;
            const isZero = value === 0;
            // For manual tests, increase is typically bad (red), decrease is good (green)
            const colorClass = isZero
              ? "text-gray-500"
              : isPositive
                ? "text-red-600"
                : "text-green-600";
            const sign = isPositive ? "+" : "";

            return (
              <span className={`font-mono text-sm ${colorClass}`}>
                {sign}
                {value}
              </span>
            );
          },
          enableSorting: true,
          enableGrouping: false,
        })
      );
    });

    return columns;
  }, [projects, columnHelper, t, dateFnsLocale, dateGrouping]);
}
