"use client";
import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useSearchParams } from "next/navigation";
import { useRouter, usePathname } from "~/lib/navigation";
import { useSession } from "next-auth/react";
import MultiSelect from "react-select";
import { getCustomStyles } from "~/styles/multiSelectStyles";
import { Button } from "@/components/ui/button";
import { HelpPopover } from "@/components/ui/help-popover";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { DataTable } from "@/components/tables/DataTable";
import {
  VisibilityState,
  ColumnDef,
  ExpandedState,
} from "@tanstack/react-table";
import { PaginationInfo } from "~/components/tables/PaginationControls";
import {
  PaginationProvider,
  usePagination,
  defaultPageSizeOptions,
} from "~/lib/contexts/PaginationContext";
import { PaginationComponent } from "~/components/tables/Pagination";
import { ReportChart } from "@/components/dataVisualizations/ReportChart";
import { DraggableList } from "@/components/DraggableCaseFields";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  AlertCircle,
  LayoutTemplate,
  CircleDashed,
  Bot,
  Filter,
  FolderOpen,
  ChevronDown,
  Loader2,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { reportRequestSchema } from "~/lib/schemas/reportRequestSchema";
import {
  getReportSummary,
  dimensionToDraggableField,
  draggableFieldToDimension,
} from "~/utils/reportUtils";
import { useReportColumns } from "~/hooks/useReportColumns";
import { useAutomationTrendsColumns } from "~/hooks/useAutomationTrendsColumns";
import { useFlakyTestsColumns } from "~/hooks/useFlakyTestsColumns";
import { useTestCaseHealthColumns } from "~/hooks/useTestCaseHealthColumns";
import { useIssueTestCoverageSummaryColumns } from "~/hooks/useIssueTestCoverageColumns";
import {
  getProjectReportTypes,
  getCrossProjectReportTypes,
} from "~/lib/config/reportTypes";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DateRange } from "react-day-picker";
import { DateRangePickerField } from "~/components/forms/DateRangePickerField";
import { DateFormatter } from "~/components/DateFormatter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v4";
import { Form } from "~/components/ui/form";
import { useDrillDown } from "~/hooks/useDrillDown";
import { DrillDownDrawer } from "~/components/reports/DrillDownDrawer";
import { ReportFilters } from "~/components/reports/ReportFilters";
import { ReportFilterChips } from "~/components/reports/ReportFilterChips";
import type {
  DrillDownContext,
  DimensionFilters,
} from "~/lib/types/reportDrillDown";

interface ReportBuilderProps {
  mode: "project" | "cross-project";
  projectId?: number;
  defaultReportType?: string;
}

// Helper to check if a report type is a pre-built report
function isPreBuiltReport(reportType: string): boolean {
  return [
    "automation-trends",
    "cross-project-automation-trends",
    "flaky-tests",
    "cross-project-flaky-tests",
    "test-case-health",
    "cross-project-test-case-health",
    "issue-test-coverage",
    "cross-project-issue-test-coverage",
  ].includes(reportType);
}

// Form schema for date range
const dateRangeSchema = z.object({
  dateRange: z
    .object({
      from: z.date().optional(),
      to: z.date().optional(),
    })
    .optional(),
});

type DateRangeFormData = z.infer<typeof dateRangeSchema>;

// Inner component that uses pagination context
function ReportBuilderContent({
  mode,
  projectId,
  defaultReportType,
}: ReportBuilderProps) {
  const { theme } = useTheme();
  const { data: session } = useSession();
  const t = useTranslations();
  const tReports = useTranslations("reports.ui");
  const tCommon = useTranslations("common");
  const tAdminMenu = useTranslations("admin.menu");
  const tDimensions = useTranslations("reports.dimensions");
  const tMetrics = useTranslations("reports.metrics");
  const tRuns = useTranslations("runs");
  const customStyles = getCustomStyles({ theme });
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Get report types based on mode - done inside client component to avoid passing functions across server/client boundary
  const reportTypes = useMemo(() => {
    return mode === "cross-project"
      ? getCrossProjectReportTypes(tReports)
      : getProjectReportTypes(tReports);
  }, [mode, tReports]);

  // Use pagination context
  const {
    currentPage,
    setCurrentPage,
    pageSize,
    setPageSize,
    totalItems: totalCount,
    setTotalItems: setTotalCount,
    startIndex,
    endIndex,
  } = usePagination();

  // Form for date range
  const form = useForm<DateRangeFormData>({
    resolver: zodResolver(dateRangeSchema),
    defaultValues: {
      dateRange: undefined,
    },
  });

  // Panel state
  const panelRef = useRef<any>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);

  const toggleCollapse = () => {
    setIsTransitioning(true);
    if (panelRef.current) {
      if (isCollapsed) {
        panelRef.current.expand();
      } else {
        panelRef.current.collapse();
      }
      setIsCollapsed(!isCollapsed);
    }
    setTimeout(() => setIsTransitioning(false), 300);
  };

  // Split report types into pre-built reports and custom reports
  const preBuiltReports = useMemo(
    () => reportTypes.filter((r) => r.isPreBuilt),
    [reportTypes]
  );
  const customReports = useMemo(
    () => reportTypes.filter((r) => !r.isPreBuilt),
    [reportTypes]
  );

  // Determine the default report type based on the tab and available reports
  // If no defaultReportType provided, use first pre-built report if on "reports" tab,
  // otherwise use first custom report
  const computedDefaultReportType = useMemo(() => {
    if (defaultReportType) return defaultReportType;

    // Check which tab we're on (from URL or default to "reports")
    const tabParam = searchParams.get("tab") || "reports";

    // Default to first pre-built report if on reports tab, otherwise first custom report
    if (tabParam === "reports") {
      return preBuiltReports.length > 0
        ? preBuiltReports[0].id
        : customReports.length > 0
          ? customReports[0].id
          : "test-execution";
    } else {
      return customReports.length > 0
        ? customReports[0].id
        : preBuiltReports.length > 0
          ? preBuiltReports[0].id
          : "test-execution";
    }
  }, [defaultReportType, searchParams, preBuiltReports, customReports]);

  // Report type state - initialize from URL if available
  const initialReportType =
    searchParams.get("reportType") || computedDefaultReportType;
  const [reportType, setReportType] = useState<string>(initialReportType);
  const [dimensions, setDimensions] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<any[]>([]);
  const [results, setResults] = useState<any[] | null>(null);
  const [allResults, setAllResults] = useState<any[] | null>(null); // Full dataset for charts
  const chartDataRef = useRef<any[] | null>(null); // Stable reference for chart data
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [compatWarning, setCompatWarning] = useState<string | null>(null);

  // UI state
  const [dimensionOptions, setDimensionOptions] = useState<any[]>([]);
  const [metricOptions, setMetricOptions] = useState<any[]>([]);
  const [filteredDimensionOptions, setFilteredDimensionOptions] = useState<
    any[]
  >([]);
  const [filteredMetricOptions, setFilteredMetricOptions] = useState<any[]>([]);
  const [lastUsedDimensions, setLastUsedDimensions] = useState<any[]>([]);
  const [lastUsedMetrics, setLastUsedMetrics] = useState<any[]>([]);
  const [automationTrendsProjects, setAutomationTrendsProjects] = useState<
    any[]
  >([]);

  // Filter state for automation trends
  const [selectedFilterType, setSelectedFilterType] = useState<string>("");
  const [selectedFilterValues, setSelectedFilterValues] = useState<
    Record<string, Array<string | number>>
  >({});
  const [filterOptions, setFilterOptions] = useState<any>(null);

  // Legacy state for builder tab priority filter
  const [selectedPriorityValues, setSelectedPriorityValues] = useState<
    string[]
  >([]);
  const [availablePriorityValues, setAvailablePriorityValues] = useState<
    { value: string; label: string }[]
  >([]);

  const [dateGrouping, setDateGrouping] = useState<
    "daily" | "weekly" | "monthly" | "quarterly" | "annually"
  >("weekly");
  const [lastUsedDateGrouping, setLastUsedDateGrouping] = useState<
    "daily" | "weekly" | "monthly" | "quarterly" | "annually"
  >("weekly");
  const lastUsedDimensionsRef = useRef<any[]>([]); // Stable reference for chart
  const lastUsedMetricsRef = useRef<any[]>([]); // Stable reference for chart
  const [chartDataVersion, setChartDataVersion] = useState(0); // Version counter for chart updates
  const [lastUsedDateRange, setLastUsedDateRange] = useState<
    DateRange | undefined
  >(undefined);

  // Flaky tests state
  const [consecutiveRuns, setConsecutiveRuns] = useState(10);
  const [flipThreshold, setFlipThreshold] = useState(5);
  const [flakyAutomatedFilter, setFlakyAutomatedFilter] = useState<
    "all" | "automated" | "manual"
  >("all");
  // Track the consecutiveRuns value used when report was last run (for stable chart/table rendering)
  const [lastUsedConsecutiveRuns, setLastUsedConsecutiveRuns] = useState(10);

  // Test case health state
  const [staleDaysThreshold, setStaleDaysThreshold] = useState(30);
  const [minExecutionsForRate, setMinExecutionsForRate] = useState(5);
  const [lookbackDays, setLookbackDays] = useState(90);
  const [healthAutomatedFilter, setHealthAutomatedFilter] = useState<
    "all" | "automated" | "manual"
  >("all");

  // Track when the report was last generated (for display and future export functionality)
  const [reportGeneratedAt, setReportGeneratedAt] = useState<Date | null>(null);

  // Table state
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [sortConfig, setSortConfig] = useState<{
    column: string;
    direction: "asc" | "desc";
  } | null>(null);
  const [grouping, setGrouping] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<ExpandedState>({});

  // Track if this is the initial mount
  const isInitialMount = useRef(true);

  // Track if we're on the client side (for SSR compatibility)
  const [isClient, setIsClient] = useState(false);

  // Drill-down functionality
  const drillDown = useDrillDown();

  // Build filter items for automation trends
  const filterItems = useMemo(() => {
    if (!filterOptions) return [];

    const items: any[] = [];

    // Projects filter (cross-project only)
    if (filterOptions.projects && filterOptions.projects.length > 0) {
      items.push({
        id: "projects",
        name: tCommon("fields.projects"),
        icon: FolderOpen,
        options: filterOptions.projects.map((p: any) => ({
          id: p.id,
          name: p.name,
          count: p.count,
        })),
      });
    }

    // Templates filter
    if (filterOptions.templates && filterOptions.templates.length > 0) {
      items.push({
        id: "templates",
        name: tCommon("fields.templates"),
        icon: LayoutTemplate,
        options: filterOptions.templates.map((t: any) => ({
          id: t.id,
          name: t.name,
          count: t.count,
        })),
      });
    }

    // States filter
    if (filterOptions.states && filterOptions.states.length > 0) {
      items.push({
        id: "states",
        name: tCommon("ui.search.states"),
        icon: CircleDashed,
        options: filterOptions.states.map((s: any) => ({
          id: s.id,
          name: s.name,
          icon: s.icon,
          iconColor: s.iconColor,
          count: s.count,
        })),
      });
    }

    // Automated filter
    if (filterOptions.automated && filterOptions.automated.length > 0) {
      items.push({
        id: "automated",
        name: tCommon("fields.automated"),
        icon: Bot,
        options: filterOptions.automated.map((a: any) => ({
          id: a.value ? 1 : 0,
          name: a.value
            ? tCommon("fields.automated")
            : tCommon("fields.manual"),
          count: a.count,
        })),
      });
    }

    // Dynamic fields (Priority, etc.)
    if (filterOptions.dynamicFields) {
      Object.entries(filterOptions.dynamicFields).forEach(
        ([fieldName, field]: [string, any]) => {
          if (field.type === "Dropdown" || field.type === "Multi-Select") {
            items.push({
              id: `dynamic_${field.fieldId}`,
              name: fieldName,
              icon: Filter,
              field: {
                type: field.type,
                fieldId: field.fieldId,
                options: field.options,
              },
            });
          }
        }
      );
    }

    return items;
  }, [filterOptions, tCommon]);

  // Build active filter chips from selectedFilterValues
  const activeFilterChips = useMemo(() => {
    const chips: Array<{
      filterType: string;
      filterName: string;
      valueId: string | number;
      valueName: string;
      icon?: { name: string } | null;
      iconColor?: { value: string } | null;
    }> = [];

    Object.entries(selectedFilterValues).forEach(([filterType, values]) => {
      const filterItem = filterItems.find((item) => item.id === filterType);
      if (!filterItem || !values || values.length === 0) return;

      values.forEach((valueId) => {
        let valueName = "";
        let icon: { name: string } | null = null;
        let iconColor: { value: string } | null = null;

        // Find the value in the filter options
        if (filterItem.options) {
          const option = filterItem.options.find(
            (opt: any) => opt.id === valueId
          );
          if (option) {
            valueName = option.name;
            icon = option.icon || null;
            iconColor = option.iconColor || null;
          }
        } else if (filterItem.field?.options) {
          if (valueId === "none") {
            valueName = tCommon("access.none");
          } else {
            const option = filterItem.field.options.find(
              (opt: any) => opt.id === valueId
            );
            if (option) {
              valueName = option.name;
              icon = option.icon || null;
              iconColor = option.iconColor || null;
            }
          }
        }

        if (valueName) {
          chips.push({
            filterType,
            filterName: filterItem.name,
            valueId,
            valueName,
            icon,
            iconColor,
          });
        }
      });
    });

    return chips;
  }, [selectedFilterValues, filterItems, tCommon]);

  // Handler to remove a single filter
  const handleRemoveFilter = useCallback(
    (filterType: string, valueId: string | number) => {
      setSelectedFilterValues((prev) => {
        const currentValues = prev[filterType] || [];
        const newValues = currentValues.filter((v) => v !== valueId);

        if (newValues.length === 0) {
          const { [filterType]: _, ...rest } = prev;
          return rest;
        }

        return { ...prev, [filterType]: newValues };
      });
    },
    []
  );

  // Handler to clear all filters
  const handleClearAllFilters = useCallback(() => {
    setSelectedFilterValues({});
  }, []);

  // Tab state - initialize from URL or determine from reportType
  const initialTab = useMemo(() => {
    const urlTab = searchParams.get("tab");
    if (urlTab) return urlTab;

    // If no tab in URL, determine it from the reportType
    const urlReportType = searchParams.get("reportType");
    if (urlReportType) {
      const isPreBuilt = preBuiltReports.some((r) => r.id === urlReportType);
      return isPreBuilt ? "reports" : "builder";
    }

    // Default to "reports"
    return "reports";
  }, [searchParams, preBuiltReports]);
  const [activeTab, setActiveTab] = useState<string>(initialTab);

  // Sync activeTab with URL tab parameter (for browser back/forward navigation)
  useEffect(() => {
    const urlTab = searchParams.get("tab");
    if (urlTab) {
      if (urlTab !== activeTab) {
        setActiveTab(urlTab);
      }
    } else {
      // If no tab in URL, determine it from reportType
      const urlReportType = searchParams.get("reportType");
      if (urlReportType) {
        const isPreBuilt = preBuiltReports.some((r) => r.id === urlReportType);
        const correctTab = isPreBuilt ? "reports" : "builder";
        if (correctTab !== activeTab) {
          setActiveTab(correctTab);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, preBuiltReports]);

  // Handler for metric clicks to open drill-down
  const handleMetricClick = useCallback(
    ({
      metricId,
      metricLabel,
      metricValue,
      row,
    }: {
      metricId: string;
      metricLabel: string;
      metricValue: number;
      row: any;
    }) => {
      // Extract dimension filters from the row
      const dimensionFilters: DimensionFilters = {};

      lastUsedDimensions.forEach((dim) => {
        const dimValue = row[dim.value];
        if (dimValue) {
          dimensionFilters[dim.value] = dimValue;
        }
      });

      // Get date range from form
      const dateRange = form.getValues("dateRange");

      // Create drill-down context
      const context: DrillDownContext = {
        metricId,
        metricLabel,
        metricValue,
        reportType,
        mode,
        projectId,
        dimensions: dimensionFilters,
        startDate: dateRange?.from?.toISOString(),
        endDate: dateRange?.to?.toISOString(),
      };

      drillDown.handleMetricClick(context);
    },
    [lastUsedDimensions, reportType, mode, projectId, form, drillDown]
  );

  // Use the custom hook for generating columns
  const standardColumns = useReportColumns(
    lastUsedDimensions.map((d) => d.value),
    lastUsedMetrics.map((m) => m.value),
    lastUsedDimensions,
    lastUsedMetrics,
    handleMetricClick,
    projectId
  );

  // Use automation trends columns for automation-trends report
  const automationTrendsColumns = useAutomationTrendsColumns(
    automationTrendsProjects,
    lastUsedDateGrouping
  );

  // Use flaky tests columns for flaky-tests report
  // Use lastUsedConsecutiveRuns to prevent table re-renders when form values change
  const flakyTestsColumns = useFlakyTestsColumns(
    lastUsedConsecutiveRuns,
    projectId,
    lastUsedDimensions.map((d) => d.value),
    mode === "cross-project"
  );

  // Use test case health columns for test-case-health report
  const testCaseHealthColumns = useTestCaseHealthColumns(
    projectId,
    lastUsedDimensions.map((d) => d.value),
    mode === "cross-project"
  );

  // Use issue test coverage columns for issue-test-coverage report
  const issueTestCoverageSummaryColumns = useIssueTestCoverageSummaryColumns(
    projectId,
    lastUsedDimensions.map((d) => d.value),
    mode === "cross-project"
  );

  // Choose which columns to use based on report type
  const columns =
    reportType === "automation-trends" || reportType === "cross-project-automation-trends"
      ? automationTrendsColumns
      : reportType === "flaky-tests" || reportType === "cross-project-flaky-tests"
        ? flakyTestsColumns
        : reportType === "test-case-health" || reportType === "cross-project-test-case-health"
          ? testCaseHealthColumns
          : reportType === "issue-test-coverage" || reportType === "cross-project-issue-test-coverage"
            ? issueTestCoverageSummaryColumns
            : standardColumns;

  // When lastUsedDimensions change (after running a report), update grouping
  React.useEffect(() => {
    if (lastUsedDimensions.length > 1) {
      // Only group by the first dimension when there are multiple dimensions
      const firstDimension = lastUsedDimensions[0];
      const groupingColumn = firstDimension.value;
      setGrouping([groupingColumn]);
      // Don't expand all - let the table handle expansion state
    } else {
      // No grouping when there's only one dimension
      setGrouping([]);
    }
  }, [lastUsedDimensions]);

  // Initialize column visibility for issue test coverage report
  React.useEffect(() => {
    if (reportType === "issue-test-coverage" || reportType === "cross-project-issue-test-coverage") {
      // Set all columns to visible for this report
      const visibility: Record<string, boolean> = {
        issueId: true,
        testCaseId: true,
        issueStatus: true,
        issuePriority: true,
        lastStatusName: true,
        lastExecutedAt: true,
        linkedTestCases: true,
        testResults: true,
        passRate: true,
      };
      setColumnVisibility(visibility);
    }
  }, [reportType]);

  // Set grouping for issue test coverage report when data loads
  React.useEffect(() => {
    if ((reportType === "issue-test-coverage" || reportType === "cross-project-issue-test-coverage") && allResults && allResults.length > 0) {
      // Group by issueId to show issues with expandable test cases
      setGrouping(["issueId"]);
      // Start with all groups collapsed
      setExpanded({});
    }
  }, [reportType, allResults]);

  // Get the current report configuration
  const currentReport = reportTypes.find((r) => r.id === reportType);

  // Set isClient to true when component mounts (for SSR)
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Fetch filter options when report type changes to automation-trends or when filters change
  useEffect(() => {
    if (
      reportType === "automation-trends" ||
      reportType === "cross-project-automation-trends"
    ) {
      // Build filter payload to send to view-options API
      const filterPayload: any = {};

      // For project-specific mode, include projectId
      if (mode === "project" && projectId) {
        filterPayload.projectId = projectId;
      }

      // Add active filters to get updated counts based on current selection
      if (Object.keys(selectedFilterValues).length > 0) {
        // Collect all dynamic field filters
        const dynamicFieldFilters: Record<number, (string | number)[]> = {};

        Object.entries(selectedFilterValues).forEach(([key, values]) => {
          if (!values || values.length === 0) return;

          if (key === "projects") {
            filterPayload.projectIds = values;
          } else if (key === "templates") {
            filterPayload.templateIds = values;
          } else if (key === "states") {
            filterPayload.stateIds = values;
          } else if (key === "automated") {
            filterPayload.automated = values;
          } else if (key.startsWith("dynamic_")) {
            // Extract fieldId from the key (format: "dynamic_<fieldId>")
            const fieldId = parseInt(key.split("_")[1]);
            if (!isNaN(fieldId)) {
              dynamicFieldFilters[fieldId] = values;
            }
          }
        });

        // Add dynamic field filters to payload if any exist
        if (Object.keys(dynamicFieldFilters).length > 0) {
          filterPayload.dynamicFieldFilters = dynamicFieldFilters;
        }
      }

      // Use different API endpoints for project-specific vs cross-project
      const apiEndpoint =
        mode === "project"
          ? "/api/repository-cases/view-options"
          : "/api/repository-cases/cross-project-view-options";

      // Only fetch for project mode if we have a projectId
      if (mode === "cross-project" || (mode === "project" && projectId)) {
        // Fetch filter options from the appropriate API
        fetch(apiEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(filterPayload),
        })
          .then((res) => res.json())
          .then((data) => {
            setFilterOptions(data);
          })
          .catch(() => {
            // Failed to fetch filter options - ignore
          });
      }
    }
  }, [reportType, projectId, mode, selectedFilterValues]);

  // Note: No default filter type selection - user must explicitly choose a filter

  // Fetch priority values for builder tab (legacy)
  useEffect(() => {
    if (
      reportType === "automation-trends" &&
      dimensions.some((d) => d.value === "priority") &&
      projectId &&
      mode === "project"
    ) {
      // Fetch priority values from the backend
      fetch(`/api/case-fields/priority/values?projectId=${projectId}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.values) {
            setAvailablePriorityValues(
              data.values.map((v: string) => ({ value: v, label: v }))
            );
          }
        })
        .catch(() => {
          // Failed to fetch priority values - ignore
        });
    }
  }, [reportType, dimensions, projectId, mode]);

  // Handle report type change
  const handleReportTypeChange = (newReportType: string) => {
    // Update state immediately for responsive UI
    setReportType(newReportType);

    // Determine which tab this report belongs to
    const isPreBuilt = preBuiltReports.some((r) => r.id === newReportType);
    const newTab = isPreBuilt ? "reports" : "builder";
    setActiveTab(newTab);

    const newParams = new URLSearchParams();
    newParams.set("reportType", newReportType);
    newParams.set("tab", newTab);
    router.replace(`${pathname}?${newParams.toString()}`);
  };

  // Handle tab change
  const handleTabChange = (newTab: string) => {
    // When switching tabs, select a default report from that tab
    const targetReports =
      newTab === "reports" ? preBuiltReports : customReports;
    if (targetReports.length > 0) {
      const defaultReport = targetReports[0].id;

      // Update URL - this will trigger useEffect to sync state
      const newParams = new URLSearchParams(searchParams.toString());
      newParams.set("reportType", defaultReport);
      newParams.set("tab", newTab);
      newParams.set("page", "1");
      newParams.set("pageSize", "10");
      router.replace(`${pathname}?${newParams.toString()}`);
    }
  };

  // When report type changes, clear all selections and results
  useEffect(() => {
    // Skip clearing on initial mount to allow URL parameters to load
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    setDimensions([]);
    setMetrics([]);
    setResults(null);
    setAllResults(null);
    setError(null);
    setCompatWarning(null);
    setLastUsedDimensions([]);
    setLastUsedMetrics([]);
    lastUsedDimensionsRef.current = [];
    lastUsedMetricsRef.current = [];
    chartDataRef.current = null;
    setChartDataVersion(0);
    setLastUsedDateRange(undefined);
    setLastUsedConsecutiveRuns(10);
    setReportGeneratedAt(null);
  }, [reportType]);

  // Load report metadata and URL parameters
  useEffect(() => {
    async function fetchMetadata() {
      if (!currentReport) return;

      try {
        const url = new URL(currentReport.endpoint, window.location.origin);
        if (mode === "project" && projectId) {
          url.searchParams.set("projectId", projectId.toString());
        }

        const response = await fetch(url.toString(), {
          method: "GET",
        });

        if (!response.ok) {
          throw new Error("Failed to fetch report metadata");
        }

        const data = await response.json();

        // Transform to react-select format with translations for display
        // Sort alphabetically by translated label
        const dimOpts = data.dimensions
          .map((d: any) => ({
            value: d.id,
            label: tDimensions(d.id) || d.label, // Translated label for display
            apiLabel: d.label, // Keep English label for API data access
          }))
          .sort((a: any, b: any) => a.label.localeCompare(b.label));
        const metOpts = data.metrics
          .map((m: any) => ({
            value: m.id,
            label: tMetrics(m.id) || m.label, // Translated label for display
            apiLabel: m.label, // Keep English label for API data access
          }))
          .sort((a: any, b: any) => a.label.localeCompare(b.label));

        setDimensionOptions(dimOpts);
        setMetricOptions(metOpts);
        setFilteredDimensionOptions(dimOpts);
        setFilteredMetricOptions(metOpts);

        // Load from URL parameters if present
        const reportTypeParam = searchParams.get("reportType");
        if (
          reportTypeParam &&
          reportTypes.some((r) => r.id === reportTypeParam)
        ) {
          setReportType(reportTypeParam);
        }

        const dimensionsParam = searchParams.get("dimensions");
        const metricsParam = searchParams.get("metrics");
        const startDateParam = searchParams.get("startDate");
        const endDateParam = searchParams.get("endDate");

        // Load date range from URL if present
        if (startDateParam) {
          const dateRange: DateRange = {
            from: new Date(startDateParam),
            to: endDateParam ? new Date(endDateParam) : undefined,
          };
          form.setValue("dateRange", dateRange);
        }

        if (dimensionsParam) {
          const dimIds = dimensionsParam.split(",");
          // Preserve order from URL by mapping instead of filtering
          const selectedDims = dimIds
            .map((id) => dimOpts.find((d: any) => d.value === id))
            .filter(Boolean);

          // For cross-project flaky tests, ensure "project" is the first dimension
          if (mode === "cross-project" && reportType === "flaky-tests") {
            const projectDim = dimOpts.find((d: any) => d.value === "project");
            if (projectDim) {
              // Remove project if it exists, then add it as first
              const otherDims = selectedDims.filter(
                (d: any) => d.value !== "project"
              );
              setDimensions([projectDim, ...otherDims]);
            } else {
              setDimensions(selectedDims);
            }
          } else {
            setDimensions(selectedDims);
          }
        } else if (
          mode === "cross-project" &&
          reportType === "flaky-tests" &&
          dimOpts.length > 0
        ) {
          // Automatically add "project" as the first dimension for cross-project flaky tests
          const projectDim = dimOpts.find((d: any) => d.value === "project");
          if (projectDim) {
            setDimensions([projectDim]);
          }
        }

        if (metricsParam) {
          const metIds = metricsParam.split(",");
          // Preserve order from URL by mapping instead of filtering
          const selectedMets = metIds
            .map((id) => metOpts.find((m: any) => m.value === id))
            .filter(Boolean);
          setMetrics(selectedMets);
        }

        // Store selections for auto-run
        if (dimensionsParam && metricsParam) {
          const dimIds = dimensionsParam.split(",");
          const metIds = metricsParam.split(",");
          // Preserve order from URL by mapping instead of filtering
          let selectedDims = dimIds
            .map((id) => dimOpts.find((d: any) => d.value === id))
            .filter(Boolean);

          // For cross-project flaky tests, ensure "project" is the first dimension
          if (mode === "cross-project" && reportType === "flaky-tests") {
            const projectDim = dimOpts.find((d: any) => d.value === "project");
            if (projectDim) {
              // Remove project if it exists, then add it as first
              const otherDims = selectedDims.filter(
                (d: any) => d.value !== "project"
              );
              selectedDims = [projectDim, ...otherDims];
            }
          }

          const selectedMets = metIds
            .map((id) => metOpts.find((m: any) => m.value === id))
            .filter(Boolean);

          if (selectedDims.length > 0 && selectedMets.length > 0) {
            // Set flag to auto-run after state updates
            setDimensions(selectedDims);
            setMetrics(selectedMets);
            setLastUsedDimensions(selectedDims);
            setLastUsedMetrics(selectedMets);
            lastUsedDimensionsRef.current = selectedDims; // Update stable ref
            lastUsedMetricsRef.current = selectedMets; // Update stable ref

            // Also set the last used date range if present
            if (startDateParam) {
              setLastUsedDateRange({
                from: new Date(startDateParam),
                to: endDateParam ? new Date(endDateParam) : undefined,
              });
            }
          }
        }
      } catch (err) {
        console.error("Failed to load report metadata:", err);
        setError(tReports("errors.failedToLoadMetadata"));
      }
    }

    fetchMetadata();
  }, [
    reportType,
    currentReport,
    mode,
    projectId,
    searchParams,
    reportTypes,
    tReports,
    tDimensions,
    tMetrics,
    form,
  ]);

  // Fetch data with current filters, pagination, and sorting
  const fetchReportData = useCallback(
    async (
      selectedDimensions: any[],
      selectedMetrics: any[],
      updateUrl: boolean = false
    ) => {
      try {
        const dateRange = form.getValues("dateRange");
        const body: any = {
          dimensions: selectedDimensions.map((d) => d.value),
          metrics: selectedMetrics.map((m) => m.value),
          page: currentPage,
          pageSize: pageSize,
        };

        if (mode === "project" && projectId) {
          body.projectId = projectId;
        }

        // For automation trends, add selected filter values and date grouping
        if (reportType === "automation-trends") {
          // Build filters object from selectedFilterValues
          const dynamicFieldFilters: Record<number, (string | number)[]> = {};

          Object.entries(selectedFilterValues).forEach(([key, values]) => {
            if (!values || values.length === 0) return;

            if (key === "projects") {
              body.projectIds = values;
            } else if (key === "templates") {
              body.templateIds = values;
            } else if (key === "states") {
              body.stateIds = values;
            } else if (key === "automated") {
              body.automated = values;
            } else if (key.startsWith("dynamic_")) {
              // Extract fieldId from the key (format: "dynamic_<fieldId>")
              const fieldId = parseInt(key.split("_")[1]);
              if (!isNaN(fieldId)) {
                dynamicFieldFilters[fieldId] = values;
              }
            }
          });

          // Add dynamic field filters to body if any exist
          if (Object.keys(dynamicFieldFilters).length > 0) {
            body.dynamicFieldFilters = dynamicFieldFilters;
          }

          body.dateGrouping = dateGrouping;
        }

        // For flaky tests, add consecutive runs, flip threshold, automated filter, and dimensions
        if (reportType === "flaky-tests") {
          body.consecutiveRuns = consecutiveRuns;
          body.flipThreshold = flipThreshold;
          body.automatedFilter = flakyAutomatedFilter;
          // Always include dimensions for cross-project reports (project should be auto-added)
          if (mode === "cross-project") {
            const dimValues = selectedDimensions.map((d) => d.value);
            // Ensure project is included if it's not already there
            if (!dimValues.includes("project")) {
              dimValues.unshift("project");
            }
            body.dimensions = dimValues;
          }
        }

        // For test case health, add health parameters and dimensions
        if (reportType === "test-case-health") {
          body.staleDaysThreshold = staleDaysThreshold;
          body.minExecutionsForRate = minExecutionsForRate;
          body.lookbackDays = lookbackDays;
          body.automatedFilter = healthAutomatedFilter;
          // Always include dimensions for cross-project reports (project should be auto-added)
          if (mode === "cross-project") {
            const dimValues = selectedDimensions.map((d) => d.value);
            // Ensure project is included if it's not already there
            if (!dimValues.includes("project")) {
              dimValues.unshift("project");
            }
            body.dimensions = dimValues;
          }
        }

        // For issue test coverage, add dimensions for cross-project
        if (reportType === "issue-test-coverage") {
          // Always include dimensions for cross-project reports (project should be auto-added)
          if (mode === "cross-project") {
            const dimValues = selectedDimensions.map((d) => d.value);
            // Ensure project is included if it's not already there
            if (!dimValues.includes("project")) {
              dimValues.unshift("project");
            }
            body.dimensions = dimValues;
          }
        }

        // Add sorting parameters if configured
        if (sortConfig) {
          // Map frontend column IDs to backend metric IDs
          const columnIdMap: Record<string, string> = {
            testResults: "testResultCount",
            testRuns: "testRunCount",
            testCases: "testCaseCount",
            passRate: "passRate",
            avgElapsedTime: "avgElapsed",
            totalElapsedTime: "sumElapsed",
          };

          const backendColumnId =
            columnIdMap[sortConfig.column] || sortConfig.column;
          body.sortColumn = backendColumnId;
          body.sortDirection = sortConfig.direction;
        }

        // Add date range if specified
        if (dateRange?.from) {
          // Convert local date to UTC date string (YYYY-MM-DD format then to ISO)
          const year = dateRange.from.getFullYear();
          const month = String(dateRange.from.getMonth() + 1).padStart(2, "0");
          const day = String(dateRange.from.getDate()).padStart(2, "0");
          body.startDate = `${year}-${month}-${day}T00:00:00.000Z`;

          if (dateRange.to) {
            const endYear = dateRange.to.getFullYear();
            const endMonth = String(dateRange.to.getMonth() + 1).padStart(
              2,
              "0"
            );
            const endDay = String(dateRange.to.getDate()).padStart(2, "0");
            body.endDate = `${endYear}-${endMonth}-${endDay}T23:59:59.999Z`;
          }
        }

        // Validate request
        const validation = reportRequestSchema.safeParse({
          ...body,
          reportType:
            mode === "project" ? reportType : `cross-project-${reportType}`,
        });

        if (!validation.success) {
          throw new Error(validation.error.issues[0].message);
        }

        const response = await fetch(currentReport!.endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to run report");
        }

        const data = await response.json();

        // Handle client-side pagination for pre-built reports
        if (currentReport?.isPreBuilt) {
          const allData = data.data || data.results;

          // Store projects for automation trends report
          if (data.projects) {
            setAutomationTrendsProjects(data.projects);
          }

          // Set total count to all data length
          setTotalCount(allData.length);

          // Store all data when running a new report
          if (updateUrl) {
            setAllResults(allData);
            chartDataRef.current = allData;
            setChartDataVersion((prev) => prev + 1);
            // Set lastUsedDimensions for flaky tests so columns can access them
            setLastUsedDimensions(selectedDimensions);
            lastUsedDimensionsRef.current = selectedDimensions;

            // Set initial sort order for flaky tests: Flips Desc
            if (
              (reportType === "flaky-tests" ||
                reportType === "cross-project-flaky-tests") &&
              !sortConfig
            ) {
              setSortConfig({ column: "flipCount", direction: "desc" });
            }
          }

          // Apply sorting if configured
          let sortedData = [...allData];
          const effectiveSortConfig =
            updateUrl &&
            (reportType === "flaky-tests" ||
              reportType === "cross-project-flaky-tests") &&
            !sortConfig
              ? { column: "flipCount", direction: "desc" as const }
              : sortConfig;

          if (effectiveSortConfig) {
            sortedData.sort((a, b) => {
              let aVal = a[effectiveSortConfig.column];
              let bVal = b[effectiveSortConfig.column];

              // Handle project column - extract name from object
              if (effectiveSortConfig.column === "project") {
                aVal = aVal?.name || "";
                bVal = bVal?.name || "";
              }

              if (aVal === bVal) return 0;
              if (aVal === null || aVal === undefined) return 1;
              if (bVal === null || bVal === undefined) return -1;

              // For strings, use localeCompare for proper alphabetical sorting
              if (typeof aVal === "string" && typeof bVal === "string") {
                const comparison = aVal.localeCompare(bVal);
                return effectiveSortConfig.direction === "asc"
                  ? comparison
                  : -comparison;
              }

              // For numbers or other types, use standard comparison
              const comparison = aVal < bVal ? -1 : 1;
              return effectiveSortConfig.direction === "asc"
                ? comparison
                : -comparison;
            });
          }

          // Slice data for current page
          if (pageSize === "All") {
            // Show all data when pageSize is "All"
            setResults(sortedData);
          } else {
            const startIndex = (currentPage - 1) * (pageSize as number);
            const endIndex = startIndex + (pageSize as number);
            setResults(sortedData.slice(startIndex, endIndex));
          }
        } else {
          // Standard server-side pagination for other reports
          setResults(data.data || data.results); // Support both formats

          // Store projects for automation trends report
          if (reportType === "automation-trends" && data.projects) {
            setAutomationTrendsProjects(data.projects);
          }

          // Only update allResults and chartDataRef when running a new report (not for pagination/sorting)
          if (updateUrl) {
            const newAllResults = data.allResults || data.data || data.results;
            setAllResults(newAllResults);
            chartDataRef.current = newAllResults; // Update ref with stable reference
            setChartDataVersion((prev) => prev + 1); // Increment version to trigger chart update
          }
          setTotalCount(
            data.total || data.totalCount || (data.data || data.results).length
          );
        }

        // Only update these when running a new report (not just sorting/paginating)
        if (updateUrl) {
          setLastUsedDimensions(selectedDimensions);
          setLastUsedMetrics(selectedMetrics);
          lastUsedDimensionsRef.current = selectedDimensions; // Update stable ref
          lastUsedMetricsRef.current = selectedMetrics; // Update stable ref
          setLastUsedDateRange(
            dateRange?.from ? (dateRange as DateRange) : undefined
          );
          // Update last used date grouping for automation trends
          if (reportType === "automation-trends") {
            setLastUsedDateGrouping(dateGrouping);
          }
          // Update last used consecutive runs for flaky tests
          if (reportType === "flaky-tests") {
            setLastUsedConsecutiveRuns(consecutiveRuns);
          }
          // Record when the report was generated
          setReportGeneratedAt(new Date());

          // Update URL with selections
          const newParams = new URLSearchParams();
          newParams.set("reportType", reportType);
          newParams.set(
            "dimensions",
            selectedDimensions.map((d) => d.value).join(",")
          );
          newParams.set(
            "metrics",
            selectedMetrics.map((m) => m.value).join(",")
          );

          // Add date range to URL if specified, or remove if cleared
          if (dateRange?.from) {
            newParams.set("startDate", dateRange.from.toISOString());
            if (dateRange.to) {
              newParams.set("endDate", dateRange.to.toISOString());
            } else {
              newParams.delete("endDate");
            }
          } else {
            // Remove date parameters when cleared
            newParams.delete("startDate");
            newParams.delete("endDate");
          }

          router.replace(`${pathname}?${newParams.toString()}`);
        }
      } catch (err: any) {
        console.error("Report error:", err);
        setError(err.message || tReports("errors.failedToRunReport"));
      }
    },
    [
      form,
      currentPage,
      pageSize,
      mode,
      projectId,
      sortConfig,
      reportType,
      currentReport,
      setTotalCount,
      router,
      pathname,
      tReports,
      dateGrouping,
      selectedFilterValues,
      consecutiveRuns,
      flipThreshold,
      flakyAutomatedFilter,
      staleDaysThreshold,
      minExecutionsForRate,
      lookbackDays,
      healthAutomatedFilter,
    ]
  );

  const runReport = useCallback(
    async (selectedDimensions: any[], selectedMetrics: any[]) => {
      setLoading(true);
      setError(null);

      try {
        await fetchReportData(selectedDimensions, selectedMetrics, true);
      } finally {
        setLoading(false);
      }
    },
    [fetchReportData]
  );

  // Auto-run report if we have stored selections
  useEffect(() => {
    if (
      lastUsedDimensions.length > 0 &&
      lastUsedMetrics.length > 0 &&
      !results &&
      !loading &&
      !error
    ) {
      runReport(lastUsedDimensions, lastUsedMetrics);
    }
  }, [lastUsedDimensions, lastUsedMetrics, results, loading, error, runReport]);

  // Re-fetch data when pagination changes (without full loading state)
  useEffect(() => {
    // For pre-built reports, handle client-side pagination
    if (currentReport?.isPreBuilt && allResults && allResults.length > 0) {
      // Apply client-side sorting first
      let sortedResults = [...allResults];
      if (sortConfig) {
        sortedResults.sort((a, b) => {
          let aVal = a[sortConfig.column];
          let bVal = b[sortConfig.column];

          // Handle project column - extract name from object
          if (sortConfig.column === "project") {
            aVal = aVal?.name || "";
            bVal = bVal?.name || "";
          }

          if (aVal === bVal) return 0;
          if (aVal === null || aVal === undefined) return 1;
          if (bVal === null || bVal === undefined) return -1;

          // For strings, use localeCompare for proper alphabetical sorting
          if (typeof aVal === "string" && typeof bVal === "string") {
            const comparison = aVal.localeCompare(bVal);
            return sortConfig.direction === "asc" ? comparison : -comparison;
          }

          // For numbers or other types, use standard comparison
          const comparison = aVal < bVal ? -1 : 1;
          return sortConfig.direction === "asc" ? comparison : -comparison;
        });
      }

      // Then apply pagination
      if (pageSize === "All") {
        setResults(sortedResults);
      } else {
        const startIdx = (currentPage - 1) * pageSize;
        const endIdx = startIdx + pageSize;
        setResults(sortedResults.slice(startIdx, endIdx));
      }
    } else if (
      lastUsedDimensions.length > 0 &&
      lastUsedMetrics.length > 0 &&
      results &&
      !currentReport?.isPreBuilt
    ) {
      // Standard server-side pagination for other reports
      fetchReportData(lastUsedDimensions, lastUsedMetrics, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, pageSize, sortConfig, reportType]);

  // Re-fetch data when sort changes for non-prebuilt reports (without full loading state)
  useEffect(() => {
    if (
      !currentReport?.isPreBuilt &&
      lastUsedDimensions.length > 0 &&
      lastUsedMetrics.length > 0 &&
      results
    ) {
      fetchReportData(lastUsedDimensions, lastUsedMetrics, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortConfig]);

  // Re-fetch data when filters or date grouping change for automation trends
  useEffect(() => {
    if (
      reportType === "automation-trends" &&
      lastUsedDimensions.length > 0 &&
      lastUsedMetrics.length > 0 &&
      results
    ) {
      // Automatically re-run report when filters or date grouping change
      runReport(lastUsedDimensions, lastUsedMetrics);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFilterValues, dateGrouping]);

  // Filter options based on selections
  useEffect(() => {
    // For now, no compatibility rules - just use all options
    setFilteredDimensionOptions(dimensionOptions);
    setFilteredMetricOptions(metricOptions);
    setCompatWarning(null);
  }, [dimensionOptions, metricOptions]);

  // Automatically add "project" as first dimension for cross-project flaky tests
  useEffect(() => {
    if (
      mode === "cross-project" &&
      reportType === "flaky-tests" &&
      dimensionOptions.length > 0
    ) {
      const projectDim = dimensionOptions.find(
        (d: any) => d.value === "project"
      );
      if (projectDim) {
        // Always ensure project is first dimension
        const hasProject = dimensions.some((d: any) => d.value === "project");
        if (!hasProject) {
          setDimensions([projectDim, ...dimensions]);
        } else if (dimensions[0]?.value !== "project") {
          // Project exists but not first - move it to first
          const otherDims = dimensions.filter(
            (d: any) => d.value !== "project"
          );
          setDimensions([projectDim, ...otherDims]);
        }
      }
    }
  }, [mode, reportType, dimensionOptions, dimensions]);

  const handleRunReport = () => {
    setCurrentPage(1); // Reset to first page when running new report
    runReport(dimensions, metrics);
  };

  const handleDimensionsChange = (newDimensions: any[]) => {
    setDimensions(newDimensions);
    setCurrentPage(1); // Reset to first page when dimensions change
  };

  const handleMetricsChange = (newMetrics: any[]) => {
    setMetrics(newMetrics);
    setCurrentPage(1); // Reset to first page when metrics change
  };

  // Note: Sorting is now done server-side, so we use results directly
  // Client-side sorting has been removed for better performance with large datasets

  const reportSummary = getReportSummary(lastUsedDimensions, lastUsedMetrics);

  // Create enhanced summary with date range
  const enhancedReportSummary = React.useMemo(() => {
    if (!reportSummary) return null;

    if (!lastUsedDateRange?.from) return reportSummary;

    const dateFormatString = session?.user?.preferences?.dateFormat;
    const timezone = session?.user?.preferences?.timezone;

    return (
      <span>
        {reportSummary}
        {" • "}
        <DateFormatter
          date={lastUsedDateRange.from}
          formatString={dateFormatString}
          timezone={timezone}
        />
        {lastUsedDateRange.to && (
          <>
            {" - "}
            <DateFormatter
              date={lastUsedDateRange.to}
              formatString={dateFormatString}
              timezone={timezone}
            />
          </>
        )}
      </span>
    );
  }, [reportSummary, lastUsedDateRange, session]);

  // Memoize chart props to prevent unnecessary re-renders when pagination/sorting changes
  // Use refs for stable references that don't change on re-renders
  const chartDimensions = useMemo(
    () => {
      const result = lastUsedDimensionsRef.current.map((d) => ({
        value: d.value,
        label: d.label,
      }));
      return result;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chartDataVersion] // Only recompute when chart data version changes
  );

  const chartMetrics = useMemo(
    () => {
      const result = lastUsedMetricsRef.current.map((m) => ({
        value: m.value,
        label: m.label,
        originalLabel: m.apiLabel,
      }));
      return result;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chartDataVersion] // Only recompute when chart data version changes
  );

  const chartKey = useMemo(
    () => {
      const result = chartDataRef.current
        ? JSON.stringify(chartDataRef.current.slice(0, 5))
        : null;
      return result;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chartDataVersion, allResults] // Only recompute when chart data version changes
  );

  // Maximum number of data points to render in charts
  // Keep this low enough for charts to remain readable and useful
  const MAX_CHART_DATA_POINTS = 50;

  // Memoize the chart component to prevent re-renders when parent re-renders
  // Use chartDataRef.current for stable reference that doesn't change on pagination
  const memoizedChart = useMemo(() => {
    const chartData = chartDataRef.current;

    // For pre-built reports (automation trends, flaky tests, test case health, issue test coverage),
    // we don't need traditional dimensions/metrics as the chart uses specialized data structures
    const isAutomationTrends =
      reportType === "automation-trends" ||
      reportType === "cross-project-automation-trends";
    const isFlakyTests =
      reportType === "flaky-tests" ||
      reportType === "cross-project-flaky-tests";
    const isTestCaseHealth =
      reportType === "test-case-health" ||
      reportType === "cross-project-test-case-health";
    const isIssueTestCoverage =
      reportType === "issue-test-coverage" ||
      reportType === "cross-project-issue-test-coverage";

    if (
      !chartData ||
      (!isAutomationTrends &&
        !isFlakyTests &&
        !isTestCaseHealth &&
        !isIssueTestCoverage &&
        (chartDimensions.length === 0 || chartMetrics.length === 0))
    ) {
      return { chart: null, isTruncated: false, totalDataPoints: 0 };
    }

    // Limit the number of data points to prevent browser crashes
    // For flaky tests, prioritize tests with highest attention score (flip count + recency)
    let dataToLimit = chartData;
    if (isFlakyTests && chartData.length > MAX_CHART_DATA_POINTS) {
      // Calculate priority score for each test and sort by it
      dataToLimit = [...chartData]
        .map((test: any) => {
          // Calculate recency score using exponential decay
          let recencyScore = 0;
          let weight = 1;
          const decayFactor = 0.7;
          const executions = test.executions || [];

          for (const execution of executions) {
            if (!execution.isSuccess) {
              recencyScore += weight;
            }
            weight *= decayFactor;
          }

          // Normalize recency score
          const maxScore =
            executions.length > 0
              ? (1 - Math.pow(decayFactor, executions.length)) /
                (1 - decayFactor)
              : 1;
          const normalizedRecency = maxScore > 0 ? recencyScore / maxScore : 0;

          // Priority combines flip count and recency
          const normalizedFlips =
            test.flipCount / (lastUsedConsecutiveRuns - 1 || 1);
          const priorityScore = normalizedFlips * 0.5 + normalizedRecency * 0.5;

          return { ...test, _priorityScore: priorityScore };
        })
        .sort((a: any, b: any) => b._priorityScore - a._priorityScore);
    }

    const isTruncated = dataToLimit.length > MAX_CHART_DATA_POINTS;
    const limitedChartData = isTruncated
      ? dataToLimit.slice(0, MAX_CHART_DATA_POINTS)
      : dataToLimit;

    // For Test Case Health and Issue Test Coverage, pass all data so the chart can show accurate summary stats
    // These charts handle aggregation internally and need the full dataset
    const chartResults = isTestCaseHealth || isIssueTestCoverage ? chartData : limitedChartData;

    return {
      chart: (
        <ReportChart
          key={chartKey}
          results={chartResults}
          dimensions={chartDimensions}
          metrics={chartMetrics}
          reportType={reportType}
          projects={automationTrendsProjects}
          consecutiveRuns={lastUsedConsecutiveRuns}
          totalFlakyTests={isFlakyTests ? chartData.length : undefined}
          projectId={projectId}
        />
      ),
      isTruncated: isTestCaseHealth || isIssueTestCoverage ? false : isTruncated,
      totalDataPoints: chartData.length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    chartKey,
    chartDimensions,
    chartMetrics,
    chartDataVersion,
    reportType,
    automationTrendsProjects,
    lastUsedConsecutiveRuns,
  ]); // Depend on version instead of array lengths

  return (
    <div>
      <ResizablePanelGroup
        direction="horizontal"
        autoSaveId="report-builder-panels"
      >
        <ResizablePanel
          ref={panelRef}
          defaultSize={25}
          collapsedSize={0}
          minSize={20}
          maxSize={75}
          collapsible
          onCollapse={() => setIsCollapsed(true)}
          onExpand={() => setIsCollapsed(false)}
          className={`p-0 m-0 ${
            isTransitioning ? "transition-all duration-300 ease-in-out" : ""
          }`}
        >
          <Card
            shadow="none"
            className="rounded-none border-y-0 border-l-0 flex flex-col"
          >
            <CardContent className="grow overflow-y-auto pb-6">
              <Tabs
                value={activeTab}
                onValueChange={handleTabChange}
                className="h-full flex flex-col"
              >
                <TabsList className="grid w-full grid-cols-2 mb-4">
                  <TabsTrigger value="reports">
                    {tAdminMenu("reports")}
                  </TabsTrigger>
                  <TabsTrigger value="builder">{tReports("title")}</TabsTrigger>
                </TabsList>

                <TabsContent
                  value="reports"
                  className="flex-1 overflow-y-auto mt-0"
                >
                  <div className="mb-4">
                    <h2 className="text-lg font-semibold">
                      {tAdminMenu("reports")}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {tReports("reportsTabDescription")}
                    </p>
                  </div>
                  <Form {...form}>
                    <form className="grid gap-4 relative px-0.5">
                      {/* Pre-built Report Selection */}
                      <div className="grid gap-2">
                        <label className="text-sm font-medium">
                          {tReports("selectReport")}
                        </label>
                        <Select
                          value={reportType}
                          onValueChange={handleReportTypeChange}
                        >
                          <SelectTrigger data-testid="report-type-select">
                            <SelectValue>
                              {currentReport && (
                                <div className="flex items-center gap-2">
                                  <currentReport.icon className="h-4 w-4" />
                                  <span>{currentReport.label}</span>
                                </div>
                              )}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {preBuiltReports.map((report) => (
                              <SelectItem key={report.id} value={report.id}>
                                <div className="flex items-center gap-2">
                                  <report.icon className="h-4 w-4" />
                                  <span>{report.label}</span>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Date Range Selection */}
                      <div className="grid gap-2">
                        <DateRangePickerField
                          control={form.control}
                          name="dateRange"
                          label={tReports("dateRange.selectDateRange")}
                          helpKey="reportBuilder.dateRange"
                        />
                      </div>

                      {/* Date Grouping Selection for Automation Trends */}
                      {(reportType === "automation-trends" ||
                        reportType === "cross-project-automation-trends") && (
                        <div className="grid gap-2">
                          <label className="text-sm font-medium">
                            {tReports("dateGrouping.label")}
                          </label>
                          <Select
                            value={dateGrouping}
                            onValueChange={(value: any) =>
                              setDateGrouping(value)
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="daily">
                                {tReports("dateGrouping.daily")}
                              </SelectItem>
                              <SelectItem value="weekly">
                                {tReports("dateGrouping.weekly")}
                              </SelectItem>
                              <SelectItem value="monthly">
                                {tReports("dateGrouping.monthly")}
                              </SelectItem>
                              <SelectItem value="quarterly">
                                {tReports("dateGrouping.quarterly")}
                              </SelectItem>
                              <SelectItem value="annually">
                                {tReports("dateGrouping.annually")}
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      )}

                      {/* Filters Section for Automation Trends */}
                      {(reportType === "automation-trends" ||
                        reportType === "cross-project-automation-trends") &&
                        filterItems.length > 0 && (
                          <div className="grid gap-2">
                            <div className="flex items-center gap-2">
                              <label className="text-sm font-medium">
                                {tCommon("ui.search.filters")}
                              </label>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {tReports("filtersDescription")}
                            </p>
                            <ReportFilterChips
                              activeFilters={activeFilterChips}
                              onRemoveFilter={handleRemoveFilter}
                              onClearAll={handleClearAllFilters}
                            />
                            <ReportFilters
                              selectedFilter={selectedFilterType}
                              onFilterChange={setSelectedFilterType}
                              filterItems={filterItems}
                              selectedValues={selectedFilterValues}
                              onValuesChange={(filterType, values) => {
                                setSelectedFilterValues((prev) => {
                                  if (!values || values.length === 0) {
                                    const { [filterType]: _, ...rest } = prev;
                                    return rest;
                                  }
                                  return { ...prev, [filterType]: values };
                                });
                              }}
                              totalCount={filterOptions?.totalCount || 0}
                            />
                          </div>
                        )}

                      {/* Flaky Tests Parameters */}
                      {(reportType === "flaky-tests" ||
                        reportType === "cross-project-flaky-tests") && (
                        <div className="grid gap-4">
                          {/* Consecutive Runs */}
                          <div className="grid gap-2">
                            <div className="flex items-center gap-2">
                              <label className="text-sm font-medium">
                                {tReports("flakyTests.consecutiveRuns")}
                              </label>
                              <HelpPopover
                                helpKey={`## ${tReports("flakyTests.consecutiveRuns")}\n${tReports("flakyTests.consecutiveRunsHelp")}`}
                              />
                            </div>
                            <div className="flex items-center gap-3">
                              <input
                                type="range"
                                min={5}
                                max={30}
                                step={1}
                                value={consecutiveRuns}
                                onChange={(e) => {
                                  const value = Number(e.target.value);
                                  setConsecutiveRuns(value);
                                  // Ensure flip threshold doesn't exceed consecutive runs - 1
                                  if (flipThreshold >= value) {
                                    setFlipThreshold(value - 1);
                                  }
                                }}
                                className="flex-1 h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                              />
                              <span className="w-8 text-sm font-mono text-center">
                                {consecutiveRuns}
                              </span>
                            </div>
                          </div>

                          {/* Flip Threshold */}
                          <div className="grid gap-2">
                            <div className="flex items-center gap-2">
                              <label className="text-sm font-medium">
                                {tReports("flakyTests.flipThreshold")}
                              </label>
                              <HelpPopover
                                helpKey={`## ${tReports("flakyTests.flipThreshold")}\n${tReports("flakyTests.flipThresholdHelp")}`}
                              />
                            </div>
                            <div className="flex items-center gap-3">
                              <input
                                type="range"
                                min={2}
                                max={consecutiveRuns - 1}
                                step={1}
                                value={flipThreshold}
                                onChange={(e) =>
                                  setFlipThreshold(Number(e.target.value))
                                }
                                className="flex-1 h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                              />
                              <span className="w-8 text-sm font-mono text-center">
                                {flipThreshold}
                              </span>
                            </div>
                          </div>

                          {/* Test Case Type Filter */}
                          <div className="grid gap-2">
                            <label className="text-sm font-medium">
                              {tReports("flakyTests.includeFilter")}
                            </label>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="w-full justify-between"
                                >
                                  {flakyAutomatedFilter === "all"
                                    ? tRuns("typeFilter.both")
                                    : flakyAutomatedFilter === "manual"
                                      ? tCommon("fields.manual")
                                      : tCommon("fields.automated")}
                                  <ChevronDown className="ml-2 h-4 w-4 opacity-50" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent
                                align="start"
                                className="w-full"
                              >
                                <DropdownMenuGroup>
                                  <DropdownMenuItem
                                    onClick={() =>
                                      setFlakyAutomatedFilter("all")
                                    }
                                  >
                                    {tRuns("typeFilter.both")}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() =>
                                      setFlakyAutomatedFilter("manual")
                                    }
                                  >
                                    {tCommon("fields.manual")}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() =>
                                      setFlakyAutomatedFilter("automated")
                                    }
                                  >
                                    {tCommon("fields.automated")}
                                  </DropdownMenuItem>
                                </DropdownMenuGroup>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                      )}

                      {/* Test Case Health Parameters */}
                      {(reportType === "test-case-health" ||
                        reportType === "cross-project-test-case-health") && (
                        <div className="grid gap-4">
                          {/* Stale Days Threshold */}
                          <div className="grid gap-2">
                            <div className="flex items-center gap-2">
                              <label className="text-sm font-medium">
                                {tReports("testCaseHealth.staleDaysThreshold")}
                              </label>
                              <HelpPopover
                                helpKey={`## ${tReports("testCaseHealth.staleDaysThreshold")}\n${tReports("testCaseHealth.staleDaysThresholdHelp")}`}
                              />
                            </div>
                            <div className="flex items-center gap-3">
                              <input
                                type="range"
                                min={7}
                                max={90}
                                step={1}
                                value={staleDaysThreshold}
                                onChange={(e) =>
                                  setStaleDaysThreshold(Number(e.target.value))
                                }
                                className="flex-1 h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                              />
                              <span className="w-8 text-sm font-mono text-center">
                                {staleDaysThreshold}
                              </span>
                            </div>
                          </div>

                          {/* Min Executions for Rate */}
                          <div className="grid gap-2">
                            <div className="flex items-center gap-2">
                              <label className="text-sm font-medium">
                                {tReports("testCaseHealth.minExecutions")}
                              </label>
                              <HelpPopover
                                helpKey={`## ${tReports("testCaseHealth.minExecutions")}\n${tReports("testCaseHealth.minExecutionsHelp")}`}
                              />
                            </div>
                            <div className="flex items-center gap-3">
                              <input
                                type="range"
                                min={3}
                                max={20}
                                step={1}
                                value={minExecutionsForRate}
                                onChange={(e) =>
                                  setMinExecutionsForRate(Number(e.target.value))
                                }
                                className="flex-1 h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                              />
                              <span className="w-8 text-sm font-mono text-center">
                                {minExecutionsForRate}
                              </span>
                            </div>
                          </div>

                          {/* Lookback Days */}
                          <div className="grid gap-2">
                            <div className="flex items-center gap-2">
                              <label className="text-sm font-medium">
                                {tReports("testCaseHealth.lookbackDays")}
                              </label>
                              <HelpPopover
                                helpKey={`## ${tReports("testCaseHealth.lookbackDays")}\n${tReports("testCaseHealth.lookbackDaysHelp")}`}
                              />
                            </div>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="w-full justify-between"
                                >
                                  {lookbackDays === 0
                                    ? tReports("dateRange.allTime")
                                    : lookbackDays === 30
                                      ? tReports("dateRange.last30Days")
                                      : lookbackDays === 90
                                        ? tReports("dateRange.last3Months")
                                        : tReports("dateRange.last12Months")}
                                  <ChevronDown className="ml-2 h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="start">
                                <DropdownMenuItem
                                  onClick={() => setLookbackDays(30)}
                                >
                                  {tReports("dateRange.last30Days")}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => setLookbackDays(90)}
                                >
                                  {tReports("dateRange.last3Months")}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => setLookbackDays(365)}
                                >
                                  {tReports("dateRange.last12Months")}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => setLookbackDays(0)}
                                >
                                  {tReports("dateRange.allTime")}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>

                          {/* Test Case Type Filter */}
                          <div className="grid gap-2">
                            <label className="text-sm font-medium">
                              {tReports("testCaseHealth.includeFilter")}
                            </label>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="w-full justify-between"
                                >
                                  {healthAutomatedFilter === "all"
                                    ? tRuns("typeFilter.both")
                                    : healthAutomatedFilter === "manual"
                                      ? tCommon("fields.manual")
                                      : tCommon("fields.automated")}
                                  <ChevronDown className="ml-2 h-4 w-4 opacity-50" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent
                                align="start"
                                className="w-full"
                              >
                                <DropdownMenuGroup>
                                  <DropdownMenuItem
                                    onClick={() =>
                                      setHealthAutomatedFilter("all")
                                    }
                                  >
                                    {tRuns("typeFilter.both")}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() =>
                                      setHealthAutomatedFilter("manual")
                                    }
                                  >
                                    {tCommon("fields.manual")}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() =>
                                      setHealthAutomatedFilter("automated")
                                    }
                                  >
                                    {tCommon("fields.automated")}
                                  </DropdownMenuItem>
                                </DropdownMenuGroup>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                      )}

                      {/* Run Report Button */}
                      <Button
                        onClick={handleRunReport}
                        disabled={loading}
                        className="w-full"
                        data-testid="run-report-button"
                      >
                        {loading ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            {tCommon("loading")}
                          </>
                        ) : (
                          tReports("runReport")
                        )}
                      </Button>

                      {error && (
                        <div className="rounded-md p-4 text-sm text-destructive bg-destructive/10 border border-destructive/40">
                          {error}
                        </div>
                      )}
                    </form>
                  </Form>
                </TabsContent>

                <TabsContent
                  value="builder"
                  className="flex-1 overflow-y-auto mt-0 m-1"
                >
                  <div className="mb-4">
                    <h2 className="text-lg font-semibold">
                      {tReports("title")}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {mode === "cross-project"
                        ? tReports("crossProjectDescription")
                        : tReports("description")}
                    </p>
                  </div>
                  <Form {...form}>
                    <form className="grid gap-4 relative px-0.5">
                      {/* Custom Report Type Selection */}
                      <div className="grid gap-2">
                        <label className="text-sm font-medium">
                          {tReports("reportType")}
                        </label>
                        <Select
                          value={reportType}
                          onValueChange={handleReportTypeChange}
                        >
                          <SelectTrigger data-testid="report-type-select">
                            <SelectValue>
                              {currentReport && (
                                <div className="flex items-center gap-2">
                                  <currentReport.icon className="h-4 w-4" />
                                  <span>{currentReport.label}</span>
                                </div>
                              )}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {customReports.map((report) => (
                              <SelectItem key={report.id} value={report.id}>
                                <div className="flex items-center gap-2">
                                  <report.icon className="h-4 w-4" />
                                  <span>{report.label}</span>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Date Range Selection */}
                      <div className="grid gap-2">
                        <DateRangePickerField
                          control={form.control}
                          name="dateRange"
                          label={tReports("dateRange.selectDateRange")}
                          helpKey="reportBuilder.dateRange"
                        />
                      </div>

                      {/* Dimensions Selection */}
                      <div className="grid gap-2">
                        <div className="flex items-center gap-2">
                          <label className="text-sm font-medium">
                            {tReports("dimensions")}
                          </label>
                          <HelpPopover helpKey="reportBuilder.dimensions" />
                        </div>

                        {/* Dimension Order - shown when multiple dimensions selected */}
                        {dimensions.length > 1 && (
                          <div className="mb-2">
                            <label className="text-xs text-muted-foreground mb-1 block">
                              {tReports("dimensionOrder")}
                            </label>
                            <DraggableList
                              items={dimensions.map(dimensionToDraggableField)}
                              setItems={(items) =>
                                setDimensions(
                                  items.map(draggableFieldToDimension)
                                )
                              }
                              onRemove={(id) =>
                                setDimensions(
                                  dimensions.filter((d) => d.value !== id)
                                )
                              }
                            />
                          </div>
                        )}

                        <MultiSelect
                          isMulti
                          value={dimensions}
                          onChange={handleDimensionsChange as any}
                          options={filteredDimensionOptions}
                          styles={customStyles}
                          placeholder={tReports("selectDimensions")}
                          className="basic-multi-select"
                          classNamePrefix="select"
                          menuPortalTarget={
                            isClient ? document.body : undefined
                          }
                          menuPosition="fixed"
                          inputId="dimensions-select"
                          data-testid="dimensions-select"
                        />
                      </div>

                      {/* Priority Filter for Automation Trends */}
                      {reportType === "automation-trends" &&
                        dimensions.some((d) => d.value === "priority") && (
                          <div className="grid gap-2">
                            <div className="flex items-center gap-2">
                              <label className="text-sm font-medium">
                                {tCommon("ui.search.filters")} {" - "}{" "}
                                {tCommon("fields.priority")}
                              </label>
                            </div>
                            <MultiSelect
                              isMulti
                              value={selectedPriorityValues.map((v) => ({
                                value: v,
                                label: v,
                              }))}
                              onChange={(selected: any) => {
                                setSelectedPriorityValues(
                                  selected
                                    ? selected.map((s: any) => s.value)
                                    : []
                                );
                              }}
                              options={availablePriorityValues}
                              styles={customStyles}
                              placeholder="Select priority values (or leave empty for all)"
                              className="basic-multi-select"
                              classNamePrefix="select"
                              menuPortalTarget={
                                isClient ? document.body : undefined
                              }
                              menuPosition="fixed"
                            />
                          </div>
                        )}

                      {/* Metrics Selection - Hidden for automation trends and flaky tests */}
                      {reportType !== "automation-trends" &&
                        reportType !== "flaky-tests" && (
                          <div className="grid gap-2">
                            <div className="flex items-center gap-2">
                              <label className="text-sm font-medium">
                                {tReports("metrics")}
                              </label>
                              <HelpPopover helpKey="reportBuilder.metrics" />
                            </div>

                            {/* Metric Order - shown when multiple metrics selected */}
                            {metrics.length > 1 && (
                              <div className="mb-2">
                                <label className="text-xs text-muted-foreground mb-1 block">
                                  {tReports("metricOrder")}
                                </label>
                                <DraggableList
                                  items={metrics.map(dimensionToDraggableField)}
                                  setItems={(items) =>
                                    setMetrics(
                                      items.map(draggableFieldToDimension)
                                    )
                                  }
                                  onRemove={(id) =>
                                    setMetrics(
                                      metrics.filter((m) => m.value !== id)
                                    )
                                  }
                                />
                              </div>
                            )}

                            <MultiSelect
                              isMulti
                              value={metrics}
                              onChange={handleMetricsChange as any}
                              options={filteredMetricOptions}
                              styles={customStyles}
                              placeholder={tReports("selectMetrics")}
                              className="basic-multi-select"
                              classNamePrefix="select"
                              menuPortalTarget={
                                isClient ? document.body : undefined
                              }
                              menuPosition="fixed"
                              inputId="metrics-select"
                              data-testid="metrics-select"
                            />
                          </div>
                        )}

                      {compatWarning && (
                        <div className="rounded-md bg-yellow-50 p-4 text-sm text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-200">
                          {compatWarning}
                        </div>
                      )}

                      {/* Run Report Button */}
                      <Button
                        onClick={handleRunReport}
                        disabled={
                          loading ||
                          (isPreBuiltReport(reportType)
                            ? false // No requirements for pre-built reports
                            : dimensions.length === 0 || metrics.length === 0)
                        }
                        className="w-full"
                        data-testid="run-report-button"
                      >
                        {loading ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            {tCommon("loading")}
                          </>
                        ) : (
                          tReports("runReport")
                        )}
                      </Button>

                      {error && (
                        <div className="rounded-md p-4 text-sm text-destructive bg-destructive/10 border border-destructive/40">
                          {error}
                        </div>
                      )}
                    </form>
                  </Form>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </ResizablePanel>

        <ResizableHandle withHandle className="w-1" />
        <div>
          <Button
            type="button"
            onClick={toggleCollapse}
            variant="secondary"
            className="p-0 -ml-1 rounded-l-none"
          >
            {isCollapsed ? <ChevronRight /> : <ChevronLeft />}
          </Button>
        </div>

        <ResizablePanel
          defaultSize={75}
          collapsedSize={0}
          collapsible
          className="min-h-[calc(100vh-14rem)]"
        >
          {/* Results Display */}
          {results && results.length > 0 ? (
            <ResizablePanelGroup direction="vertical" className="h-full">
              {/* Visualization Panel */}
              <ResizablePanel
                defaultSize={50}
                minSize={20}
                collapsedSize={0}
                collapsible
              >
                <Card className="h-full rounded-none border-0 overflow-hidden">
                  <CardHeader className="pt-2 pb-2">
                    <CardTitle>{t("common.visualization")}</CardTitle>
                    {enhancedReportSummary && (
                      <CardDescription>{enhancedReportSummary}</CardDescription>
                    )}
                    {reportGeneratedAt && (
                      <p className="text-xs text-muted-foreground">
                        {tReports("generatedAt")}{" "}
                        <DateFormatter
                          date={reportGeneratedAt}
                          formatString="PPp"
                          timezone={session?.user?.preferences?.timezone}
                        />
                      </p>
                    )}
                    {memoizedChart.isTruncated && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {tReports("chartDataTruncated.message", {
                          shown: MAX_CHART_DATA_POINTS.toLocaleString(),
                          total: memoizedChart.totalDataPoints.toLocaleString(),
                        })}
                      </p>
                    )}
                  </CardHeader>
                  <CardContent className="h-[calc(100%-4rem)] p-6 flex flex-col">
                    <div className="flex-1 min-h-0 w-full">
                      {memoizedChart.chart}
                    </div>
                  </CardContent>
                </Card>
              </ResizablePanel>

              <ResizableHandle withHandle />

              {/* Results Table Panel */}
              <ResizablePanel
                defaultSize={50}
                minSize={20}
                collapsedSize={0}
                collapsible
              >
                <Card className="h-full rounded-none border-0 overflow-hidden">
                  <CardHeader className="pt-2 pb-2">
                    <div className="flex flex-row items-end justify-between">
                      <CardTitle>{t("common.results")}</CardTitle>
                      {totalCount > 0 && (
                        <div className="flex flex-col items-end">
                          <div className="justify-end">
                            <PaginationInfo
                              startIndex={startIndex}
                              endIndex={endIndex}
                              totalRows={totalCount}
                              searchString=""
                              pageSize={pageSize}
                              pageSizeOptions={defaultPageSizeOptions}
                              handlePageSizeChange={setPageSize}
                            />
                          </div>
                          {pageSize !== "All" &&
                            totalCount > (pageSize as number) && (
                              <div className="justify-end -mx-4">
                                <PaginationComponent
                                  currentPage={currentPage}
                                  totalPages={Math.ceil(
                                    totalCount / (pageSize as number)
                                  )}
                                  onPageChange={setCurrentPage}
                                />
                              </div>
                            )}
                        </div>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="h-[calc(100%-4rem)] overflow-y-auto p-6 pt-0">
                    <DataTable
                      columns={columns as ColumnDef<any>[]}
                      data={results || []}
                      columnVisibility={columnVisibility}
                      onColumnVisibilityChange={setColumnVisibility}
                      sortConfig={sortConfig || undefined}
                      onSortChange={(columnId: string) => {
                        setSortConfig((prev) => ({
                          column: columnId,
                          direction:
                            prev?.column === columnId &&
                            prev.direction === "asc"
                              ? "desc"
                              : "asc",
                        }));
                      }}
                      grouping={grouping}
                      onGroupingChange={setGrouping}
                      expanded={expanded}
                      onExpandedChange={setExpanded}
                    />
                  </CardContent>
                </Card>
              </ResizablePanel>
            </ResizablePanelGroup>
          ) : (
            <div className="flex items-center justify-center h-full">
              <Card className="max-w-md">
                <CardHeader>
                  <CardTitle>{tReports("noResultsFound")}</CardTitle>
                  <CardDescription>
                    {lastUsedDimensions.length > 0 && lastUsedMetrics.length > 0
                      ? lastUsedDateRange?.from
                        ? tReports("noDataMatchingCriteriaWithDateFilter")
                        : tReports("noDataMatchingCriteria")
                      : currentReport?.isPreBuilt
                        ? tReports("noDataAvailable")
                        : tReports("selectAtLeastOneDimensionAndMetric")}
                  </CardDescription>
                </CardHeader>
              </Card>
            </div>
          )}
        </ResizablePanel>
      </ResizablePanelGroup>
      {/* Drill-down drawer */}
      <DrillDownDrawer
        isOpen={drillDown.isOpen}
        onClose={drillDown.closeDrawer}
        context={drillDown.context}
        records={drillDown.records}
        total={drillDown.total}
        hasMore={drillDown.hasMore}
        isLoading={drillDown.isLoading}
        isLoadingMore={drillDown.isLoadingMore}
        error={drillDown.error}
        onLoadMore={drillDown.loadMore}
        aggregates={drillDown.aggregates}
      />
    </div>
  );
}

// Wrapper component with PaginationProvider
export function ReportBuilder(props: ReportBuilderProps) {
  return (
    <PaginationProvider defaultPageSize={50}>
      <ReportBuilderContent {...props} />
    </PaginationProvider>
  );
}
