import { useMemo } from "react";
import { useTranslations, useLocale } from "next-intl";
import { createColumnHelper } from "@tanstack/react-table";
import { Compass } from "lucide-react";
import {
  DIMENSION_LABEL_KEYS,
  getMetricHelpKey,
  getDimensionHelpKey,
} from "~/lib/constants/reportConstants";
import { getUserIdFromRow } from "~/utils/reportUtils";
import { toHumanReadable } from "~/utils/duration";
import { getDateFnsLocale } from "~/utils/locales";

// Component imports - only using existing components
import { HelpPopover } from "~/components/ui/help-popover";
import StatusDotDisplay from "~/components/StatusDotDisplay";
import { UserNameCell } from "~/components/tables/UserNameCell";
import { GroupNameCell } from "~/components/tables/GroupNameCell";
import { WorkflowStateDisplay } from "~/components/WorkflowStateDisplay";
import { TemplateNameDisplay } from "~/components/TemplateNameDisplay";
import { MilestoneIconAndName } from "~/components/MilestoneIconAndName";
import { RelativeTimeTooltip } from "~/components/RelativeTimeTooltip";
import { TestCaseNameDisplay } from "~/components/TestCaseNameDisplay";
import { ConfigurationNameDisplay } from "~/components/ConfigurationNameDisplay";
import { TestRunNameDisplay } from "~/components/TestRunNameDisplay";
import { FolderNameDisplay } from "~/components/FolderNameDisplay";
import { RoleNameDisplay } from "~/components/RoleNameDisplay";
import { IssueTypeNameDisplay } from "~/components/IssueTypeNameDisplay";

// Generic helper to check if all subrows have the same dimension value
function getAggregatedDimensionDisplay(
  subRows: any[],
  dimensionAccessor: (row: any) => any,
  renderSingleValue: (value: any) => React.ReactNode,
  mixedText: string = "Mixed"
) {
  if (!subRows || subRows.length === 0) return "-";

  const firstValue = dimensionAccessor(subRows[0]);
  if (!firstValue) return "-";

  // For objects, compare by ID if available, otherwise by reference
  const getComparisonKey = (value: any) => {
    if (!value) return null;
    if (typeof value === "object" && value.id !== undefined) return value.id;
    if (typeof value === "object" && value.name !== undefined)
      return value.name;
    return value;
  };

  const firstKey = getComparisonKey(firstValue);
  const allSameValue = subRows.every((subRow) => {
    const value = dimensionAccessor(subRow);
    return getComparisonKey(value) === firstKey;
  });

  if (allSameValue) {
    return renderSingleValue(firstValue);
  } else {
    return mixedText;
  }
}

// Helper to check if all subrows have the same user ID and return appropriate display
function getAggregatedUserDisplay(
  subRows: any[],
  userAccessor: (row: any) => any,
  allUsersText: string,
  t: any
) {
  return getAggregatedDimensionDisplay(
    subRows,
    userAccessor,
    (user) => {
      // Handle None/null case explicitly
      if (!user || user.id === null) {
        // Check if the name is "None" from the API and translate it
        const displayName =
          user?.name === "None" ? t("common.fields.none") : user?.name;
        return <span>{displayName || t("common.fields.none")}</span>;
      }
      return <UserNameCell userId={user.id} hideLink={true} />;
    },
    allUsersText
  );
}

export function useReportColumns(
  dimensions: string[],
  metrics: string[],
  dimensionOptions?: any[], // Keep for compatibility but not used currently
  metricOptions?: any[],
  onMetricClick?: (context: {
    metricId: string;
    metricLabel: string;
    metricValue: number;
    row: any;
  }) => void
) {
  const t = useTranslations();
  const tReportsMetrics = useTranslations("reports.metrics");
  const locale = useLocale();
  const dateFnsLocale = getDateFnsLocale(locale);
  const columnHelper = createColumnHelper<any>();

  return useMemo(() => {
    const columns: any[] = [];

    // Add dimension columns
    dimensions.forEach((dimensionId) => {
      const labelKey = DIMENSION_LABEL_KEYS[dimensionId];
      const label = labelKey ? t(labelKey as any) : dimensionId;
      const helpKey = getDimensionHelpKey(dimensionId);

      // Most dimensions return objects, so we need a custom accessor for proper grouping
      // The accessor should return a primitive value (string/number) for comparison
      const accessor = (row: any) => {
        const value = row[dimensionId];

        // Handle null/undefined
        if (!value) return null;

        // If already a primitive, return as-is
        if (typeof value === "string" || typeof value === "number")
          return value;

        // For objects, try to get a unique identifier
        if (typeof value === "object") {
          // For date objects
          if (value instanceof Date) return value.getTime();

          // For objects with id property (most common case)
          if ("id" in value) {
            // Special handling for "None" values that have id: null
            if (value.id === null && value.name === "None") {
              return "$$none$$"; // Special marker for None values
            }
            return value.id;
          }

          // For objects with name property (fallback)
          if ("name" in value) return value.name;

          // For template objects with templateName property
          if ("templateName" in value) return value.templateName;

          // For date dimensions with executedAt or createdAt
          if ("executedAt" in value) return value.executedAt;
          if ("createdAt" in value) return value.createdAt;
        }

        // Fallback to string representation
        return String(value);
      };

      columns.push(
        columnHelper.accessor(accessor, {
          id: dimensionId,
          header: () => (
            <div className="flex items-center gap-2">
              <span>{label}</span>
              {helpKey && helpKey.trim() !== "" && (
                <HelpPopover helpKey={helpKey} />
              )}
            </div>
          ),
          enableSorting: true,
          enableGrouping: true,
          cell: (info) => {
            const value = info.getValue();

            // Handle different dimension types with simplified display
            switch (dimensionId) {
              case "user":
              case "creator":
              case "assignedTo": {
                // Get the full assignedTo object from the row data
                const assignedToData = info.row.original[dimensionId];

                // Extract userId from the dimension value or assignedToData
                let userId: string | undefined;
                let userName: string | undefined;
                let userEmail: string | undefined;

                // Handle different value formats
                if (assignedToData && typeof assignedToData === "object") {
                  // If we have the full object from the API
                  userId = assignedToData.id;
                  userName = assignedToData.name;
                  userEmail = assignedToData.email;
                } else if (typeof value === "string") {
                  // If value is already a string ID
                  userId = value;
                } else if (
                  value &&
                  typeof value === "object" &&
                  "id" in value
                ) {
                  // If value is an object with an id property
                  userId = value.id;
                  userName = value.name;
                  userEmail = value.email;
                } else {
                  // Try to get it from the row as fallback
                  userId = getUserIdFromRow(info.row);
                }

                // Ensure userId is a string, not an object
                if (userId && typeof userId !== "string") {
                  console.error("Invalid userId type:", typeof userId, userId);
                  userId = undefined;
                }

                // Handle None/null case
                if (!userId || userId === null) {
                  // Check if the name is "None" from the API and translate it
                  const displayName =
                    userName === "None"
                      ? t("common.placeholders.none")
                      : userName;
                  return (
                    <span>{displayName || t("common.placeholders.none")}</span>
                  );
                }

                return userId ? (
                  <UserNameCell userId={userId} hideLink={true} />
                ) : (
                  <span>
                    {userName || userEmail || t("common.placeholders.unknown")}
                  </span>
                );
              }
              case "status": {
                // Get the full status object from the row data
                const statusData = info.row.original[dimensionId];
                return (
                  <StatusDotDisplay
                    name={statusData?.name || t("common.placeholders.unknown")}
                    color={statusData?.color}
                  />
                );
              }
              case "date":
                // Check for executedAt first (most common), then other date fields
                const dateValue =
                  value?.executedAt || value?.createdAt || value;

                // Ensure we have a valid date string
                if (!dateValue || dateValue === "Invalid Date") {
                  return <span>-</span>;
                }

                try {
                  const date = new Date(dateValue);
                  if (isNaN(date.getTime())) {
                    return <span>-</span>;
                  }
                  // Use UTC components to avoid timezone conversion issues
                  // The backend normalizes dates to UTC midnight for grouping
                  const year = date.getUTCFullYear();
                  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
                  const day = String(date.getUTCDate()).padStart(2, '0');
                  const formattedDate = new Date(`${year}-${month}-${day}T12:00:00.000Z`);
                  return <span>{formattedDate.toLocaleDateString(locale)}</span>;
                } catch (error) {
                  return <span>-</span>;
                }
              case "project": {
                // Get the full project object from the row data
                const projectData = info.row.original[dimensionId];
                return (
                  <span className="font-medium">
                    {projectData?.name ||
                      projectData?.title ||
                      t("common.placeholders.unknown")}
                  </span>
                );
              }
              case "state": {
                // Get the full state object from the row data
                const stateData = info.row.original[dimensionId];

                // Handle workflow state with icon and color
                if (!stateData || typeof stateData !== "object") {
                  return <span>-</span>;
                }

                // Transform the API response to match WorkflowStateDisplay's expected structure
                // API returns: { name: string, icon: string, color: string }
                // WorkflowStateDisplay expects: { name: string, icon: { name: string }, color: { value: string } }
                const transformedState = {
                  name: stateData.name,
                  icon: { name: stateData.icon },
                  color: { value: stateData.color },
                };

                return (
                  <WorkflowStateDisplay state={transformedState} size="sm" />
                );
              }
              case "source":
                // Translate source values
                const sourceValue = value?.name || value;
                if (sourceValue === "MANUAL") {
                  return <span>{t("common.fields.MANUAL")}</span>;
                } else if (sourceValue === "JUNIT") {
                  return <span>{t("common.fields.JUNIT")}</span>;
                } else if (sourceValue === "API") {
                  return <span>{t("common.fields.API")}</span>;
                }
                return (
                  <span>{sourceValue || t("common.placeholders.unknown")}</span>
                );
              case "template": {
                // Get the full template object from the row data
                const templateData = info.row.original[dimensionId];
                return (
                  <TemplateNameDisplay
                    name={
                      templateData?.name || templateData?.templateName || ""
                    }
                  />
                );
              }
              case "group": {
                // Get the group ID from the accessor
                const groupId = value;
                if (!groupId) {
                  return <span>{t("common.placeholders.unknown")}</span>;
                }
                return <GroupNameCell groupId={String(groupId)} />;
              }
              case "configuration": {
                // Get the full object from the row data
                const configData = info.row.original[dimensionId];
                return <ConfigurationNameDisplay configuration={configData} />;
              }
              case "milestone": {
                // Get the full milestone object from the row data
                const milestoneData = info.row.original[dimensionId];
                if (!milestoneData || !milestoneData.id) {
                  return <span>{t("common.placeholders.unknown")}</span>;
                }

                // Ensure milestoneType exists with proper structure
                const milestoneWithType = {
                  ...milestoneData,
                  milestoneType: milestoneData.milestoneType || { icon: null }
                };

                // Get project ID from the row if available
                const projectId = info.row.original.projectId || info.row.original.project?.id;
                return (
                  <MilestoneIconAndName
                    milestone={milestoneWithType}
                    projectId={projectId}
                  />
                );
              }
              case "testRun": {
                // Get the full object from the row data
                const testRunData = info.row.original[dimensionId];
                return <TestRunNameDisplay testRun={testRunData} />;
              }
              case "testCase": {
                // Get the full object from the row data
                const testCaseData = info.row.original[dimensionId];
                return <TestCaseNameDisplay testCase={testCaseData} />;
              }
              case "folder": {
                // Get the full object from the row data
                const folderData = info.row.original[dimensionId];
                return <FolderNameDisplay folder={folderData} />;
              }
              case "role": {
                // Get the full object from the row data
                const roleData = info.row.original[dimensionId];
                return <RoleNameDisplay role={roleData} />;
              }
              case "session": {
                // Get the full object from the row data
                const sessionData = info.row.original[dimensionId];
                return (
                  <span className="flex items-center gap-1">
                    <Compass className="h-4 w-4" />
                    {sessionData?.name || t("common.placeholders.unknown")}
                  </span>
                );
              }
              case "issueType": {
                // Get the full object from the row data
                const issueTypeData = info.row.original[dimensionId];
                return <IssueTypeNameDisplay issueType={issueTypeData} />;
              }
              default:
                // Generic display for other dimension types
                return (
                  <span>
                    {value?.name ||
                      value?.title ||
                      value ||
                      t("common.placeholders.unknown")}
                  </span>
                );
            }
          },
          aggregatedCell: (info) => {
            // Special handling for user, creator, and assignedTo dimensions
            if (
              dimensionId === "user" ||
              dimensionId === "creator" ||
              dimensionId === "assignedTo"
            ) {
              return getAggregatedUserDisplay(
                info.row.subRows,
                (subRow) => {
                  const value = subRow.getValue(dimensionId);

                  // Handle special "None" marker
                  if (value === "$$none$$") {
                    return { id: null, name: "None" };
                  }

                  // For assignedTo, we need to get the full object from row.original
                  const fullValue = subRow.original[dimensionId];
                  if (
                    fullValue &&
                    typeof fullValue === "object" &&
                    "id" in fullValue
                  ) {
                    return fullValue;
                  }

                  // Handle different value formats
                  if (typeof value === "string") {
                    return { id: value, name: value };
                  } else if (
                    value &&
                    typeof value === "object" &&
                    "id" in value
                  ) {
                    return value;
                  } else {
                    // Try to get it from the row as fallback
                    const userId = getUserIdFromRow(subRow);
                    return userId ? { id: userId, name: userId } : null;
                  }
                },
                t("common.fields.multipleValues" as any),
                t
              );
            }

            // Special handling for status dimension
            if (dimensionId === "status") {
              return getAggregatedDimensionDisplay(
                info.row.subRows,
                (subRow) => subRow.original[dimensionId],
                (status) => (
                  <StatusDotDisplay
                    name={status?.name || t("common.placeholders.unknown")}
                    color={status?.color}
                  />
                ),
                t("common.fields.multipleValues" as any)
              );
            }

            // Special handling for date dimension
            if (dimensionId === "date") {
              return getAggregatedDimensionDisplay(
                info.row.subRows,
                (subRow) => {
                  const date = subRow.getValue(dimensionId);
                  return (
                    (date as any)?.executedAt ||
                    (date as any)?.createdAt ||
                    date
                  );
                },
                (dateValue) => {
                  if (!dateValue) return "-";
                  try {
                    const date = new Date(dateValue);
                    if (isNaN(date.getTime())) return "-";
                    // Use UTC components to avoid timezone conversion issues
                    const year = date.getUTCFullYear();
                    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
                    const day = String(date.getUTCDate()).padStart(2, '0');
                    const formattedDate = new Date(`${year}-${month}-${day}T12:00:00.000Z`);
                    return <span>{formattedDate.toLocaleDateString(locale)}</span>;
                  } catch (error) {
                    return "-";
                  }
                },
                t("common.fields.multipleValues" as any)
              );
            }

            // Special handling for state dimension
            if (dimensionId === "state") {
              return getAggregatedDimensionDisplay(
                info.row.subRows,
                (subRow) => subRow.original[dimensionId],
                (state) => {
                  if (!state || typeof state !== "object") return "-";
                  const transformedState = {
                    name: state.name,
                    icon: { name: state.icon },
                    color: { value: state.color },
                  };
                  return (
                    <WorkflowStateDisplay state={transformedState} size="sm" />
                  );
                },
                t("common.fields.multipleValues" as any)
              );
            }

            // Special handling for source dimension
            if (dimensionId === "source") {
              return getAggregatedDimensionDisplay(
                info.row.subRows,
                (subRow) => subRow.getValue(dimensionId),
                (source) => {
                  const sourceValue = source?.name || source;
                  if (sourceValue === "MANUAL") {
                    return <span>{t("common.fields.MANUAL")}</span>;
                  } else if (sourceValue === "JUNIT") {
                    return <span>{t("common.fields.JUNIT")}</span>;
                  } else if (sourceValue === "API") {
                    return <span>{t("common.fields.API")}</span>;
                  }
                  return (
                    <span>
                      {sourceValue || t("common.placeholders.unknown")}
                    </span>
                  );
                },
                t("common.fields.multipleValues" as any)
              );
            }

            // Special handling for template dimension
            if (dimensionId === "template") {
              return getAggregatedDimensionDisplay(
                info.row.subRows,
                (subRow) => subRow.original[dimensionId],
                (value) => (
                  <TemplateNameDisplay
                    name={value?.name || value?.templateName || ""}
                  />
                ),
                t("common.fields.multipleValues" as any)
              );
            }

            // Special handling for group dimension
            if (dimensionId === "group") {
              return getAggregatedDimensionDisplay(
                info.row.subRows,
                (subRow) => subRow.getValue(dimensionId),
                (groupId) => {
                  if (!groupId) {
                    return <span>{t("common.placeholders.unknown")}</span>;
                  }
                  return <GroupNameCell groupId={String(groupId)} />;
                },
                t("common.fields.multipleValues" as any)
              );
            }

            // Special handling for configuration dimension
            if (dimensionId === "configuration") {
              return getAggregatedDimensionDisplay(
                info.row.subRows,
                (subRow) => subRow.original[dimensionId],
                (configData) => <ConfigurationNameDisplay configuration={configData} />,
                t("common.fields.multipleValues" as any)
              );
            }

            // Special handling for milestone dimension
            if (dimensionId === "milestone") {
              return getAggregatedDimensionDisplay(
                info.row.subRows,
                (subRow) => subRow.original[dimensionId],
                (milestoneData) => {
                  if (!milestoneData || !milestoneData.id) {
                    return <span>{t("common.placeholders.unknown")}</span>;
                  }
                  // Try to get project ID from the first subrow that has it
                  const projectId = info.row.subRows[0]?.original?.projectId ||
                                   info.row.subRows[0]?.original?.project?.id;
                  return (
                    <MilestoneIconAndName
                      milestone={milestoneData}
                      projectId={projectId}
                    />
                  );
                },
                t("common.fields.multipleValues" as any)
              );
            }

            // Special handling for testRun dimension
            if (dimensionId === "testRun") {
              return getAggregatedDimensionDisplay(
                info.row.subRows,
                (subRow) => subRow.original[dimensionId],
                (testRunData) => <TestRunNameDisplay testRun={testRunData} />,
                t("common.fields.multipleValues" as any)
              );
            }

            // Special handling for testCase dimension
            if (dimensionId === "testCase") {
              return getAggregatedDimensionDisplay(
                info.row.subRows,
                (subRow) => subRow.original[dimensionId],
                (testCaseData) => <TestCaseNameDisplay testCase={testCaseData} />,
                t("common.fields.multipleValues" as any)
              );
            }

            // Generic aggregated cell for other dimensions
            return getAggregatedDimensionDisplay(
              info.row.subRows,
              (subRow) => subRow.original[dimensionId],
              (value) => {
                // Generic display for other dimension types
                return (
                  <span>
                    {value?.name ||
                      value?.title ||
                      value ||
                      t("common.placeholders.unknown")}
                  </span>
                );
              },
              t("common.fields.multipleValues" as any)
            );
          },
          sortingFn: (rowA, rowB) => {
            const aVal = rowA.getValue(dimensionId) as any;
            const bVal = rowB.getValue(dimensionId) as any;

            // Handle date sorting
            if (dimensionId === "date") {
              const aDate = new Date(
                aVal?.executedAt || aVal?.createdAt || aVal
              ).getTime();
              const bDate = new Date(
                bVal?.executedAt || bVal?.createdAt || bVal
              ).getTime();
              return aDate - bDate;
            }

            // Handle object sorting by name
            const aStr = aVal?.name || aVal?.title || String(aVal || "");
            const bStr = bVal?.name || bVal?.title || String(bVal || "");
            return aStr.localeCompare(bStr);
          },
        })
      );
    });

    // Add metric columns
    metrics.forEach((metricId) => {
      // Get translated metric label
      const metricLabel = tReportsMetrics(metricId as any) || metricId;

      // Get help key for this metric using the helper function
      const helpKey = getMetricHelpKey(metricId);

      // Find the metric option to get the apiLabel
      const metricOption = metricOptions?.find((m) => m.value === metricId);
      const apiLabel = metricOption?.apiLabel;

      // Map specific metric IDs to their labels used in the data
      // Use apiLabel if available, otherwise fall back to the hardcoded mapping
      const metricAccessor =
        apiLabel ||
        (metricId === "testResults"
          ? "Test Results Count"
          : metricId === "passRate"
            ? "Pass Rate (%)"
            : metricId === "avgElapsedTime"
              ? "Avg. Elapsed Time"
              : metricId === "totalElapsedTime"
                ? "Total Elapsed Time"
                : metricId === "testRuns"
                  ? "Test Runs Count"
                  : metricId === "testCases"
                    ? "Test Cases Count"
                    : metricLabel);

      columns.push(
        columnHelper.accessor((row) => row[metricAccessor], {
          id: metricId,
          header: () => (
            <div className="flex items-center gap-2">
              <span>{metricLabel}</span>
              {helpKey && helpKey.trim() !== "" && (
                <HelpPopover helpKey={helpKey} />
              )}
            </div>
          ),
          enableSorting: true,
          enableGrouping: false, // Metrics should not be groupable
          aggregationFn: "sum", // Default to sum for metrics
          aggregatedCell: (info) => {
            // For aggregated rows, sum up the values from subRows
            const subRows = info.row.subRows;
            if (!subRows || subRows.length === 0) {
              return info.getValue();
            }

            const total = subRows.reduce((sum: number, subRow: any) => {
              const value = subRow.getValue(metricId);
              return sum + (typeof value === "number" ? value : 0);
            }, 0);

            // For percentages, calculate the average
            if (
              metricId.includes("Rate") ||
              metricId.includes("Percentage") ||
              metricLabel.includes("Rate") ||
              metricLabel.includes("%")
            ) {
              const avg = total / subRows.length;
              return (
                <span className="inline-flex items-center px-2 py-1 text-xs font-bold rounded-full">
                  {avg.toFixed(1)}
                  {"%"}
                </span>
              );
            }

            // For time metrics, show the total or average based on the metric type
            if (
              metricId.includes("Time") ||
              metricId.includes("Duration") ||
              metricId.includes("Elapsed") ||
              metricLabel.includes("Time") ||
              metricLabel.includes("Duration") ||
              metricLabel.includes("Elapsed")
            ) {
              // For "average" metrics, calculate average; for "total" metrics, use sum
              const isAverage =
                metricId.toLowerCase().includes("avg") ||
                metricId.toLowerCase().includes("average") ||
                metricLabel.toLowerCase().includes("avg") ||
                metricLabel.toLowerCase().includes("average");
              const value = isAverage ? total / subRows.length : total;

              if (value === 0) {
                return (
                  <span className="inline-flex items-center px-2 py-1 text-xs font-bold bg-primary/10 text-primary rounded-full">
                    -
                  </span>
                );
              }

              // averageElapsed is returned in seconds, not milliseconds
              const isSecondsFormat = metricId === "averageElapsed";

              const humanReadableDuration = toHumanReadable(value, {
                isSeconds: isSecondsFormat,
                locale: locale,
                largest: 2,
                round: true,
              });
              return (
                <span className="inline-flex items-center px-2 py-1 text-xs bg-primary/10 text-primary rounded-full font-bold">
                  {humanReadableDuration}
                </span>
              );
            }

            // Format averageSteps to 2 decimal places (calculate average for aggregated rows)
            if (
              metricId === "averageSteps" ||
              metricId === "avgStepsPerCase" ||
              metricLabel.includes("Average Steps per Case") ||
              metricLabel.includes("Avg. Steps per Case")
            ) {
              const avg = subRows.length > 0 ? total / subRows.length : 0;
              return (
                <span className="inline-flex items-center px-2 py-1 text-xs font-bold rounded-full">
                  {avg.toFixed(2)}
                </span>
              );
            }

            // Default numeric display - show sum
            return (
              <span className="inline-flex items-center px-2 py-1 text-xs font-bold rounded-full">
                {total}
              </span>
            );
          },
          cell: (info) => {
            const value = info.getValue();
            const numericValue = typeof value === "number" ? value : 0;

            // Create click handler for drill-down
            const handleClick = () => {
              if (onMetricClick && numericValue >= 0) {
                onMetricClick({
                  metricId,
                  metricLabel,
                  metricValue: numericValue,
                  row: info.row.original,
                });
              }
            };

            // Handle different metric types with simplified display
            if (
              metricId.includes("Rate") ||
              metricId.includes("Percentage") ||
              metricLabel.includes("Rate") ||
              metricLabel.includes("%")
            ) {
              const percentage = typeof value === "number" ? value : 0;
              const isClickable = onMetricClick && percentage >= 0;

              return (
                <span
                  className={`inline-flex items-center px-2 py-1 text-xs font-medium rounded-full ${
                    isClickable ? "text-primary hover:underline cursor-pointer" : ""
                  }`}
                  onClick={isClickable ? handleClick : undefined}
                >
                  {percentage.toFixed(1)}
                  {"%"}
                </span>
              );
            }

            if (
              metricId.includes("Time") ||
              metricId.includes("Duration") ||
              metricId.includes("Elapsed") ||
              metricLabel.includes("Time") ||
              metricLabel.includes("Duration") ||
              metricLabel.includes("Elapsed")
            ) {
              const timeValue = typeof value === "number" ? value : 0;

              // Display "-" for zero duration values
              if (timeValue === 0) {
                return (
                  <span className="inline-flex items-center px-2 py-1 text-xs font-medium bg-primary/10 text-primary rounded-full">
                    -
                  </span>
                );
              }

              // averageElapsed is returned in seconds, not milliseconds
              const isSecondsFormat = metricId === "averageElapsed";

              const humanReadableDuration = toHumanReadable(timeValue, {
                isSeconds: isSecondsFormat,
                locale: locale,
                largest: 2,
                round: true,
              });

              const isClickable = onMetricClick && timeValue > 0;

              return (
                <span
                  className={`inline-flex items-center px-2 py-1 text-xs font-medium bg-primary/10 rounded-full ${
                    isClickable ? "text-primary hover:underline cursor-pointer" : "text-primary"
                  }`}
                  onClick={isClickable ? handleClick : undefined}
                >
                  {humanReadableDuration}
                </span>
              );
            }

            if (metricId === "lastActiveDate" || metricLabel.includes("Date")) {
              return value ? (
                <RelativeTimeTooltip
                  date={value}
                  dateFnsLocale={dateFnsLocale}
                />
              ) : (
                <span>-</span>
              );
            }

            // Format averageSteps to 2 decimal places
            if (
              metricId === "averageSteps" ||
              metricId === "avgStepsPerCase" ||
              metricLabel.includes("Average Steps per Case") ||
              metricLabel.includes("Avg. Steps per Case")
            ) {
              const isClickable = onMetricClick && numericValue > 0;
              return (
                <span
                  className={`inline-flex items-center px-2 py-1 text-xs font-medium rounded-full ${
                    isClickable ? "text-primary hover:underline cursor-pointer" : ""
                  }`}
                  onClick={isClickable ? handleClick : undefined}
                >
                  {numericValue.toFixed(2)}
                </span>
              );
            }

            // Default numeric display
            const isClickable = onMetricClick && numericValue > 0;
            return (
              <span
                className={`inline-flex items-center px-2 py-1 text-xs font-medium rounded-full ${
                  isClickable ? "text-primary hover:underline cursor-pointer" : ""
                }`}
                onClick={isClickable ? handleClick : undefined}
              >
                {numericValue}
              </span>
            );
          },
          sortingFn: (rowA, rowB) => {
            const aVal = Number(rowA.getValue(metricId)) || 0;
            const bVal = Number(rowB.getValue(metricId)) || 0;
            return aVal - bVal;
          },
        })
      );
    });

    return columns;
  }, [
    dimensions,
    metrics,
    metricOptions,
    columnHelper,
    locale,
    dateFnsLocale,
    t,
    tReportsMetrics,
    onMetricClick,
  ]);
}
