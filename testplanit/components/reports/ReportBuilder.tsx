"use client";
import { DraggableList } from "@/components/DraggableCaseFields";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { HelpPopover } from "@/components/ui/help-popover";
import { MultiAsyncCombobox } from "@/components/ui/multi-async-combobox";
import {
  RequirementScopePicker,
  type RequirementScopeOption,
} from "@/components/reports/RequirementScopePicker";
import { REQUIREMENT_COVERAGE_STATE_ORDER } from "@/components/reports/RequirementCoverageOverview";
import { RequirementSnapshotPicker } from "@/components/reports/RequirementSnapshotPicker";
import { Switch } from "@/components/ui/switch";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import {
  ColumnDef,
  ExpandedState,
  VisibilityState,
} from "@tanstack/react-table";
import {
  Bot,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  CircleDot,
  Filter,
  Flag,
  FolderOpen,
  LayoutTemplate,
  ListChecks,
  Loader2,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations, useLocale } from "next-intl";
import { useTheme } from "next-themes";
import { useSearchParams } from "next/navigation";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { DateRange } from "react-day-picker";
import { useForm } from "react-hook-form";
import MultiSelect from "react-select";
import { z } from "zod/v4";
import { DateFormatter } from "~/components/DateFormatter";
import { DateRangePickerField } from "~/components/forms/DateRangePickerField";
import { DrillDownDrawer } from "~/components/reports/DrillDownDrawer";
import { ReportFilterChips } from "~/components/reports/ReportFilterChips";
import { MatrixFilterPanel } from "@/components/matrix/MatrixFilterPanel";
import { ReportFilters } from "~/components/reports/ReportFilters";
import { ReportRenderer } from "~/components/reports/ReportRenderer";
import { RequirementGapGenerateCases } from "~/components/reports/RequirementGapGenerateCases";
import { ShareButton } from "~/components/reports/ShareButton";
import { useMatrixFilters } from "~/hooks/useMatrixFilters";
import { REQUIREMENT_SCOPE_WHERE } from "~/lib/services/issueRoleScope";
import { ApplicationArea } from "~/zenstack/models";
import type { RequirementCoverageGapReportRow } from "~/utils/requirementCoverageReportUtils";
import { Card, CardContent } from "~/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Form } from "~/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { useAutomationTrendsColumns } from "~/hooks/useAutomationTrendsColumns";
import { useDrillDown } from "~/hooks/useDrillDown";
import { useExecutionLogColumns } from "~/hooks/useExecutionLogColumns";
import { useFlakyTestsColumns } from "~/hooks/useFlakyTestsColumns";
import { useIssueTestCoverageSummaryColumns } from "~/hooks/useIssueTestCoverageColumns";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import { useReportColumns } from "~/hooks/useReportColumns";
import { useReportCsvExport } from "~/hooks/useReportCsvExport";
import {
  useRequirementCoverageChangeColumns,
  useRequirementCoverageGapColumns,
  useRequirementTraceabilityColumns,
} from "~/hooks/useRequirementCoverageReportColumns";
import { useTestCaseHealthColumns } from "~/hooks/useTestCaseHealthColumns";
import {
  getCrossProjectReportTypes,
  getProjectReportTypes,
  sortReportTypesByLabel,
  type ReportType,
} from "~/lib/config/reportTypes";
import { usePathname, useRouter } from "~/lib/navigation";
import { reportRequestSchema } from "~/lib/schemas/reportRequestSchema";
import type {
  DimensionFilters,
  DrillDownContext,
} from "~/lib/types/reportDrillDown";
import { getCustomStyles } from "~/styles/multiSelectStyles";
import { schema } from "~/zenstack/schema";
import {
  dimensionToDraggableField,
  draggableFieldToDimension,
  getReportSummary,
} from "~/utils/reportUtils";
import { sortPreBuiltReportRows } from "~/utils/preBuiltReportSort";
import {
  mergeSeenProjectOptions,
  withLatestProjectCounts,
  type ProjectFilterOption,
} from "~/utils/reportProjectFilterOptions";
import {
  buildCleanReportUrlParams,
  isUrlInSyncWithReportType,
  resolveSyncedActiveTab,
  resolveSyncedReportType,
  resolveTabChange,
} from "./reportUrlUtils";
import { parsePerTypeReportParams } from "./reportShareParams";

interface ReportBuilderProps {
  mode: "project" | "cross-project";
  projectId?: number;
  defaultReportType?: string;
}

// Helper functions for report type matching
// These helpers allow us to write code that works with both project-level and cross-project variants
// without having to explicitly check for both (e.g., "automation-trends" and "cross-project-automation-trends")

/**
 * Strips the "cross-project-" prefix from a report type ID
 * @example getBaseReportType("cross-project-automation-trends") => "automation-trends"
 * @example getBaseReportType("automation-trends") => "automation-trends"
 */
function getBaseReportType(reportType: string): string {
  return reportType.replace(/^cross-project-/, "");
}

/**
 * Checks if a report type matches a base type (handles both project and cross-project variants)
 * @example matchesReportType("automation-trends", "automation-trends") => true
 * @example matchesReportType("cross-project-automation-trends", "automation-trends") => true
 * @example matchesReportType("flaky-tests", "automation-trends") => false
 */
function matchesReportType(reportType: string, baseType: string): boolean {
  return getBaseReportType(reportType) === baseType;
}

/**
 * Checks if a report type is a cross-project variant
 * @example isCrossProjectReport("cross-project-automation-trends") => true
 * @example isCrossProjectReport("automation-trends") => false
 */
function isCrossProjectReport(reportType: string): boolean {
  return reportType.startsWith("cross-project-");
}

// The requirement report ids (D-2, COV-04, plus the snapshot-diff report),
// as BASE types -- `getBaseReportType` strips any "cross-project-" prefix
// before these are consulted, so the gaps and traceability ids cover their
// cross-project twins too. The changes report has no cross-project twin:
// a snapshot is captured from one project and pinned to it.
const REQUIREMENT_REPORT_TYPE_IDS = [
  "requirement-coverage-gaps",
  "requirement-traceability",
  "requirement-coverage-changes",
] as const;

/** Coverage-state labels, the same mapping RequirementCoverageStateFilter
 * used when it stood on its own. */
const COVERAGE_STATE_LABEL_KEYS: Record<string, string> = {
  PASSED: "statusPassed",
  FAILED: "statusFailed",
  NOT_RUN: "statusNotRun",
  UNCOVERED: "uncovered",
};

/** The gaps/traceability reports, which share one filter menu. */
function isFilterableRequirementReport(reportType: string): boolean {
  return (
    matchesReportType(reportType, "requirement-coverage-gaps") ||
    matchesReportType(reportType, "requirement-traceability")
  );
}

/** ...and the cross-project pair of them, which also filter by project. */
function isCrossProjectRequirementReport(reportType: string): boolean {
  return (
    isCrossProjectReport(reportType) &&
    isFilterableRequirementReport(reportType)
  );
}

/**
 * Checks if a report type is a pre-built report (automation-trends, flaky-tests, test-case-health, issue-test-coverage)
 * Pre-built reports have fixed configurations and don't require dimension/metric selection
 */
function isPreBuiltReport(reportType: string): boolean {
  const baseType = getBaseReportType(reportType);
  return [
    "automation-trends",
    "flaky-tests",
    "test-case-health",
    "issue-test-coverage",
    "execution-log",
    ...REQUIREMENT_REPORT_TYPE_IDS,
  ].includes(baseType as (typeof REQUIREMENT_REPORT_TYPE_IDS)[number]);
}

/**
 * Filters the two requirement report ids out of a project-scoped report
 * type list when the project has not opted into the requirements feature
 * (`Projects.requirementsEnabled`).
 *
 * This filters HERE, at the `ReportBuilder.tsx` call site, rather than
 * inside `getProjectReportTypes` in `lib/config/reportTypes.ts`. The
 * alternative -- threading a `requirementsEnabled` flag through that
 * function's signature -- was rejected: `getProjectReportTypes` is also
 * called by `app/api/share/[shareKey]/report/route.ts:138` with an
 * identity translator and no project flag in scope (a share link has no
 * per-viewer project row to read the flag from), and that route's own test
 * mocks the function wholesale. Changing the signature would ripple into a
 * route that cannot satisfy the new parameter. See 26-VALIDATION.md
 * resolution O2.
 *
 * The flag is a PRESENTATION gate, not the security boundary (carve-out 4)
 * -- the report-builder routes for both ids keep their own project
 * authorization regardless of this filter, so a request crafted directly
 * against the endpoint is still correctly scoped even if the picker never
 * offered the report.
 */
export function filterReportTypesForRequirementsFlag(
  reportTypes: ReportType[],
  requirementsEnabled: boolean
): ReportType[] {
  if (requirementsEnabled) return reportTypes;
  return reportTypes.filter(
    (reportType) =>
      !(REQUIREMENT_REPORT_TYPE_IDS as readonly string[]).includes(
        getBaseReportType(reportType.id)
      )
  );
}

// Form schema for date range
const dateRangeSchema = z.object({
  dateRange: z
    .object({
      from: z.date().nullable().optional(),
      to: z.date().nullable().optional(),
    })
    .optional(),
});

type DateRangeFormData = z.infer<typeof dateRangeSchema>;

// Rows fetched per execution-log scroll page. Kept within the server's
// per-request clamp (1–200) so `loaded < total` math stays accurate.
const EXECUTION_LOG_PAGE_SIZE = 100;

// Inner component
function ReportBuilderContent({
  mode,
  projectId,
  defaultReportType,
}: ReportBuilderProps) {
  const { theme } = useTheme();
  const { data: session } = useSession();
  const tReports = useTranslations("reports.ui");
  const tCommon = useTranslations("common");
  const tCoverage = useTranslations("requirements.coverage");
  const tAdminMenu = useTranslations("admin.menu");
  const tDimensions = useTranslations("reports.dimensions");
  const tMetrics = useTranslations("reports.metrics");
  const tRuns = useTranslations("runs");
  const tIssues = useTranslations("issues");
  const customStyles = getCustomStyles({ theme });
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Requirements is opt-in per project (Projects.requirementsEnabled).
  // Narrow `select`, `enabled` guard against a NaN/absent id, and an
  // explicit `=== true` read because the generated type is nullable --
  // the identical read `ProjectMenu.tsx:153-165` uses for the same flag.
  const { data: reportBuilderProject } = useClientQueries(
    schema
  ).projects.useFindUnique(
    {
      where: { id: Number(projectId) },
      select: { requirementsEnabled: true },
    },
    {
      enabled:
        mode === "project" && Boolean(projectId) && !isNaN(Number(projectId)),
    }
  );
  const requirementsEnabled =
    reportBuilderProject?.requirementsEnabled === true;

  const appLocale = useLocale();
  // Get report types based on mode - done inside client component to avoid passing functions across server/client boundary
  const reportTypes = useMemo(() => {
    // Alphabetical by localized label in every mode — the picker's order,
    // and (because the default report is the first list entry) the
    // default selection follow the viewer's alphabet.
    if (mode === "cross-project")
      return sortReportTypesByLabel(
        getCrossProjectReportTypes(tReports),
        appLocale
      );
    // The requirements flag is a PROJECT setting, so it only ever filters
    // the project list. The cross-project requirement reports need no such
    // filter: they anchor on whichever projects have requirements enabled,
    // resolved server-side, so they stay offered and simply return nothing
    // when no project has opted in.
    return sortReportTypesByLabel(
      filterReportTypesForRequirementsFlag(
        getProjectReportTypes(tReports),
        requirementsEnabled
      ),
      appLocale
    );
  }, [mode, tReports, requirementsEnabled, appLocale]);

  // Results count for the "Showing X of Y" summary. The table is virtualized
  // and infinite-scrolling now, so there is no page/pageSize state — full-set
  // reports render their whole array and execution-log fetches more on scroll.
  const [totalCount, setTotalCount] = useState(0);
  // A load-more fetch is in flight (execution-log only).
  const [loadingMore, setLoadingMore] = useState(false);

  // Form for date range
  const form = useForm<DateRangeFormData>({
    resolver: standardSchemaResolver(dateRangeSchema),
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
  // Per-type report params (share redirects and deep links) are read ONCE
  // at mount and seed the initializers below — pre-built reports auto-run
  // with mounted state, so hydrating in an effect would race that first
  // run. In-app type switches reset the URL (buildCleanReportUrlParams),
  // so these params can only describe the mounted URL's report type.
  const [initialPerTypeParams] = useState(() =>
    parsePerTypeReportParams(searchParams, initialReportType)
  );
  const [dimensions, setDimensions] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<any[]>([]);
  const [results, setResults] = useState<any[] | null>(null);
  const [allResults, setAllResults] = useState<any[] | null>(null); // Full dataset for charts
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
  >(
    initialPerTypeParams.requirementCoverageStates.length > 0
      ? {
          ...initialPerTypeParams.trendsFilterValues,
          coverage: initialPerTypeParams.requirementCoverageStates,
        }
      : initialPerTypeParams.trendsFilterValues
  );
  const [filterOptions, setFilterOptions] = useState<any>(null);
  // Every project this report has offered, in the order first seen. The trends
  // filter options are re-fetched whenever a selection changes so the counts
  // stay live, and the menu is rebuilt from the response — so without this the
  // list could shrink as the viewer picks, hiding the very options they need
  // to build a multi-project selection. Counts still come from the latest
  // response; a project the current filters exclude simply shows zero.
  const [seenProjectOptions, setSeenProjectOptions] = useState<
    ProjectFilterOption[]
  >([]);
  // The cross-project requirement reports source their Projects filter from
  // their OWN endpoint (requirements-enabled projects, requirement counts),
  // not from the repository-cases view-options the trends filter uses --
  // that list is grouped from test cases, so it would omit a project that
  // has requirements but no cases. It also does not depend on the current
  // selection, so picking one project never removes the others.
  const [requirementFilterOptions, setRequirementFilterOptions] = useState<{
    projects: { id: number; name: string; count: number }[];
    priorities: { id: string; name: string; count: number }[];
    statuses: { id: string; name: string; count: number }[];
  }>({ projects: [], priorities: [], statuses: [] });

  // Legacy state for builder tab priority filter
  const [selectedPriorityValues, setSelectedPriorityValues] = useState<
    string[]
  >([]);
  const [availablePriorityValues, setAvailablePriorityValues] = useState<
    { value: string; label: string }[]
  >([]);

  const [dateGrouping, setDateGrouping] = useState<
    "daily" | "weekly" | "monthly" | "quarterly" | "annually"
  >(initialPerTypeParams.dateGrouping);
  const [lastUsedDateGrouping, setLastUsedDateGrouping] = useState<
    "daily" | "weekly" | "monthly" | "quarterly" | "annually"
  >(initialPerTypeParams.dateGrouping);
  // When the folder dimension is grouped, roll results up into ancestor
  // folders so a parent folder includes its whole subtree.
  const [folderIncludeDescendants, setFolderIncludeDescendants] =
    useState(false);
  // Per-dimension value filters: dimension id -> selected value objects
  // ({ id, name, ... } from the dimension-values lookup). Empty/missing
  // means "all values" for that dimension. The date dimension is excluded
  // (the date-range picker already covers it).
  const [dimensionValueFilters, setDimensionValueFilters] = useState<
    Record<string, any[]>
  >({});
  const [lastUsedDateRange, setLastUsedDateRange] = useState<
    DateRange | undefined
  >(undefined);

  // Automation Candidates state. Snapshot-style report has two knobs:
  //   - how many manual cases to send to the LLM (default 25, max 100)
  //   - which strategy picks the cases when the project has more than that
  // The strategy default is most-executed — the regression-frequency proxy
  // gives the highest automation ROI on average per the standard QA
  // literature (ISTQB risk-based, Mike Cohn / Cohn's test pyramid, etc.).
  const [automationCandidatesCount, setAutomationCandidatesCount] =
    useState(25);
  const [automationCandidatesStrategy, setAutomationCandidatesStrategy] =
    useState<
      | "most_executed"
      | "flakiest_first"
      | "longest_first"
      | "oldest_first"
      | "random"
      | "newest_first"
    >("most_executed");

  // Flaky tests state
  const [consecutiveRuns, setConsecutiveRuns] = useState(
    initialPerTypeParams.consecutiveRuns
  );
  // Requirement report scope (gaps/traceability): the requirements whose
  // subtrees the report is confined to. Empty = whole project. Options are
  // kept whole (not just ids) so the trigger can keep rendering their
  // labels; only ids travel in the request body. Ids restored from the URL
  // start as placeholder options — the run needs only the ids, and the
  // resolution query below swaps in real labels when it lands.
  const [requirementScope, setRequirementScope] = useState<
    RequirementScopeOption[]
  >(() =>
    initialPerTypeParams.requirementIds.map((id) => ({
      id,
      name: `#${id}`,
      title: null,
      externalUrl: null,
    }))
  );
  // Traceability's requirement-level coverage-state filter (empty = all;
  // applied server-side so counts/CSV/viz/share all describe one set) and
  // the coverage-debt report's never-ran tier.
  const [requirementCoverageStates, setRequirementCoverageStates] = useState<
    string[]
  >(initialPerTypeParams.requirementCoverageStates);
  // ON by default (operator direction 2026-08-30): never-run linked cases
  // are as evidence-free as true gaps, so the debt report opens complete.
  const [includeNotRunDebt, setIncludeNotRunDebt] = useState(
    initialPerTypeParams.includeNotRunDebt
  );
  // Gaps/traceability: render a persisted snapshot instead of the live
  // matrix (null = live). Coverage changes: the baseline snapshot the
  // report is REQUIRED to have, what it compares against (null = live),
  // and whether unchanged requirements are listed too.
  const [requirementSnapshotId, setRequirementSnapshotId] = useState<
    number | null
  >(initialPerTypeParams.requirementSnapshotId);
  const [baselineSnapshotId, setBaselineSnapshotId] = useState<number | null>(
    initialPerTypeParams.baselineSnapshotId
  );
  const [compareSnapshotId, setCompareSnapshotId] = useState<number | null>(
    initialPerTypeParams.compareSnapshotId
  );
  const [includeUnchanged, setIncludeUnchanged] = useState(
    initialPerTypeParams.includeUnchanged
  );
  const [flipThreshold, setFlipThreshold] = useState(
    initialPerTypeParams.flipThreshold
  );
  const [flakyAutomatedFilter, setFlakyAutomatedFilter] = useState<
    "all" | "automated" | "manual"
  >(initialPerTypeParams.flakyAutomatedFilter);
  // Track the consecutiveRuns value used when report was last run (for stable chart/table rendering)
  const [lastUsedConsecutiveRuns, setLastUsedConsecutiveRuns] = useState(
    initialPerTypeParams.consecutiveRuns
  );

  // Test case health state
  const [staleDaysThreshold, setStaleDaysThreshold] = useState(
    initialPerTypeParams.staleDaysThreshold
  );
  const [minExecutionsForRate, setMinExecutionsForRate] = useState(
    initialPerTypeParams.minExecutionsForRate
  );
  const [lookbackDays, setLookbackDays] = useState(
    initialPerTypeParams.lookbackDays
  );
  const [healthAutomatedFilter, setHealthAutomatedFilter] = useState<
    "all" | "automated" | "manual"
  >(initialPerTypeParams.healthAutomatedFilter);
  const [healthStatusFilter, setHealthStatusFilter] = useState<
    "all" | "healthy" | "never_executed" | "always_passing" | "always_failing"
  >(initialPerTypeParams.healthStatusFilter);
  const [healthStaleFilter, setHealthStaleFilter] = useState<
    "all" | "stale" | "notStale"
  >(initialPerTypeParams.healthStaleFilter);

  // Resolve display labels for scope options restored from the URL as
  // placeholders. Display-only: the report request already carried the
  // ids, and an id the viewer cannot see (or that was deleted since the
  // share was made) simply keeps its placeholder — the report routes
  // apply their own scope checks regardless.
  const placeholderScopeIds = useMemo(
    () =>
      requirementScope
        .filter(
          (option) => option.title === null && option.name === `#${option.id}`
        )
        .map((option) => option.id),
    [requirementScope]
  );
  const { data: resolvedScopeOptions } = useClientQueries(
    schema
  ).issue.useFindMany(
    {
      where: {
        id: { in: placeholderScopeIds },
        // The ids come straight from the URL — the requirement-role
        // predicate keeps a crafted link from resolving a defect's
        // name/title into the picker (HYG-01).
        ...REQUIREMENT_SCOPE_WHERE,
        isDeleted: false,
      },
      select: { id: true, name: true, title: true, externalUrl: true },
    },
    { enabled: placeholderScopeIds.length > 0 }
  );
  useEffect(() => {
    if (!resolvedScopeOptions || resolvedScopeOptions.length === 0) return;
    const byId = new Map(
      resolvedScopeOptions.map((issue) => [issue.id, issue])
    );
    setRequirementScope((prev) => {
      let changed = false;
      const next = prev.map((option) => {
        const resolved =
          option.title === null && option.name === `#${option.id}`
            ? byId.get(option.id)
            : undefined;
        if (!resolved) return option;
        changed = true;
        return {
          id: resolved.id,
          name: resolved.name,
          title: resolved.title,
          externalUrl: resolved.externalUrl,
        };
      });
      return changed ? next : prev;
    });
  }, [resolvedScopeOptions]);

  // Track when the report was last generated (for display and future export functionality)
  const [reportGeneratedAt, setReportGeneratedAt] = useState<Date | null>(null);

  // Store the last request body used to run the report (for sharing)
  const [lastRequestBody, setLastRequestBody] = useState<any>(null);

  // Matrix filters live in URL state via useMatrixFilters. The iteration-matrix
  // preset's run-report flow short-circuits the standard POST proxy, so its
  // share config has to be assembled directly from the URL — not from
  // lastRequestBody, which stays empty for the matrix preset.
  const { filters: matrixFilters } = useMatrixFilters();

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
  // Track the last report type that was run
  const lastRunReportType = useRef<string | null>(null);
  // Track the last tab change to prevent duplicate calls
  const lastTabChangeRef = useRef<{ tab: string; timestamp: number } | null>(
    null
  );
  // Tab a just-initiated navigation is heading toward. Set when we optimistically
  // switch tabs and fire router.replace; the tab-sync effect leaves activeTab
  // alone until the URL catches up, so it can't revert the click off a stale URL.
  const pendingTabRef = useRef<string | null>(null);
  // reportType counterpart to pendingTabRef — guards the reportType-sync effect
  // against the same stale-URL window so an optimistic report switch isn't reverted.
  const pendingReportTypeRef = useRef<string | null>(null);

  // Track if we're on the client side (for SSR compatibility)
  const [isClient, setIsClient] = useState(false);

  // Drill-down functionality
  const drillDown = useDrillDown();

  // Build filter items for automation trends
  const filterItems = useMemo(() => {
    // The requirement reports put every filter in ONE menu -- coverage
    // included, rather than as a control standing apart from the rest.
    if (isFilterableRequirementReport(reportType)) {
      const items: any[] = [];
      if (isCrossProjectRequirementReport(reportType)) {
        if (requirementFilterOptions.projects.length > 0) {
          items.push({
            id: "projects",
            name: tCommon("fields.projects"),
            icon: FolderOpen,
            options: requirementFilterOptions.projects,
          });
        }
      }
      // Coverage state applies to the matrix, where a row IS a
      // requirement-case pair; the gaps report's two tiers are governed by
      // its own include-never-run toggle instead.
      if (matchesReportType(reportType, "requirement-traceability")) {
        items.push({
          id: "coverage",
          name: tCoverage("title"),
          icon: ListChecks,
          options: REQUIREMENT_COVERAGE_STATE_ORDER.map((state) => ({
            id: state,
            name: tCoverage(COVERAGE_STATE_LABEL_KEYS[state]),
          })),
        });
      }
      if (requirementFilterOptions.priorities.length > 0) {
        items.push({
          id: "priority",
          name: tCommon("fields.priority"),
          icon: Flag,
          options: requirementFilterOptions.priorities,
        });
      }
      if (requirementFilterOptions.statuses.length > 0) {
        items.push({
          id: "status",
          name: tCommon("actions.status"),
          icon: CircleDot,
          options: requirementFilterOptions.statuses,
        });
      }
      return items;
    }

    if (!filterOptions) return [];

    const items: any[] = [];

    // Projects filter (cross-project only)
    if (seenProjectOptions.length > 0) {
      items.push({
        id: "projects",
        name: tCommon("fields.projects"),
        icon: FolderOpen,
        options: withLatestProjectCounts(
          seenProjectOptions,
          filterOptions.projects
        ),
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
  }, [
    filterOptions,
    seenProjectOptions,
    tCommon,
    tCoverage,
    reportType,
    requirementFilterOptions,
  ]);

  // Reset the remembered options whenever the report itself changes — a
  // different report may cover a different set of projects entirely.
  useEffect(() => {
    setSeenProjectOptions([]);
  }, [reportType, mode, projectId]);

  useEffect(() => {
    setSeenProjectOptions((previous) =>
      mergeSeenProjectOptions(previous, filterOptions?.projects)
    );
  }, [filterOptions]);

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

  // Sync activeTab with the URL tab parameter (for browser back/forward), while
  // ignoring the brief window after our own tab click when router.replace is
  // still in flight and the URL is stale — see resolveSyncedActiveTab.
  useEffect(() => {
    const { nextTab, clearPending } = resolveSyncedActiveTab({
      urlTab: searchParams.get("tab"),
      urlReportType: searchParams.get("reportType"),
      pendingTab: pendingTabRef.current,
      activeTab,
      preBuiltReportIds: preBuiltReports.map((r) => r.id),
    });
    if (clearPending) {
      pendingTabRef.current = null;
    }
    if (nextTab !== null) {
      setActiveTab(nextTab);
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
        folderIncludeDescendants,
      };

      drillDown.handleMetricClick(context);
    },
    [
      lastUsedDimensions,
      reportType,
      mode,
      projectId,
      form,
      drillDown,
      folderIncludeDescendants,
    ]
  );

  // The drill-down route has no query builders for LLM usage metrics (its
  // metric fallback reads testRunResults), so metric cells stay plain values.
  const supportsDrillDown = !matchesReportType(reportType, "llm-usage");

  // Use the custom hook for generating columns
  const standardColumns = useReportColumns(
    lastUsedDimensions.map((d) => d.value),
    lastUsedMetrics.map((m) => m.value),
    lastUsedDimensions,
    lastUsedMetrics,
    supportsDrillDown ? handleMetricClick : undefined,
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

  // Use execution log columns for execution-log report
  const executionLogColumns = useExecutionLogColumns(
    projectId,
    mode === "cross-project"
  );

  // Requirement report types (D-2, COV-04) are pre-built and flat — no
  // grouping, no project-dimension branch. Every covering case's row names
  // its project (the report's own included), so the column set needs no
  // project context.
  //
  // "Generate Test Cases" on gap rows: same two-part eligibility as the
  // milestone member-issues flow (MemberIssuesTable) — the viewer can
  // add/edit the Test Case Repository AND the project has an active LLM
  // connection. Project mode only: the wizard resolves its projectId from
  // the route params, which the cross-project reports page does not carry.
  const gapGenerationEligible =
    mode === "project" &&
    Boolean(projectId) &&
    matchesReportType(reportType, "requirement-coverage-gaps");
  const { permissions: tcRepoPermissions } = useProjectPermissions(
    projectId ?? 0,
    ApplicationArea.TestCaseRepository
  );
  const { data: gapLlmIntegrations } = useClientQueries(
    schema
  ).projectLlmIntegration.useFindMany(
    { where: { projectId: Number(projectId), isActive: true } },
    { enabled: gapGenerationEligible }
  );
  const canGenerateFromGap =
    gapGenerationEligible &&
    (tcRepoPermissions?.canAddEdit ?? false) &&
    (gapLlmIntegrations?.length ?? 0) > 0;
  const [gapGenerateRow, setGapGenerateRow] =
    useState<RequirementCoverageGapReportRow | null>(null);
  // Stable identity — this feeds the column hook's useMemo; an inline arrow
  // would regenerate the column defs on every render (the cell-remount trap
  // MemberIssuesTable documents on its own renderRowActions).
  const handleGenerateFromGap = useCallback(
    (row: RequirementCoverageGapReportRow) => setGapGenerateRow(row),
    []
  );
  const requirementCoverageGapColumns = useRequirementCoverageGapColumns(
    results,
    canGenerateFromGap ? handleGenerateFromGap : undefined,
    mode === "cross-project"
  );
  const requirementTraceabilityColumns = useRequirementTraceabilityColumns(
    mode === "cross-project"
  );
  const requirementCoverageChangeColumns =
    useRequirementCoverageChangeColumns();

  // Snapshot capture/delete beside the pickers: the same Reporting
  // add/edit (capture) and delete ladders the snapshot routes enforce,
  // resolved here only so the buttons are hidden from viewers whose
  // write would be refused anyway. Project mode only — snapshots belong
  // to a project.
  const { permissions: reportingPermissions } = useProjectPermissions(
    projectId ?? 0,
    ApplicationArea.Reporting
  );
  const canManageSnapshots =
    mode === "project" &&
    Boolean(projectId) &&
    reportingPermissions?.canAddEdit === true;
  const canDeleteSnapshots =
    mode === "project" &&
    Boolean(projectId) &&
    reportingPermissions?.canDelete === true;
  // The changes report cannot run without a baseline — auto-run and the
  // Run button both wait for one instead of firing a guaranteed 400.
  const changesMissingBaseline =
    matchesReportType(reportType, "requirement-coverage-changes") &&
    baselineSnapshotId === null;

  // Choose which columns to use based on report type
  const columns = matchesReportType(reportType, "automation-trends")
    ? automationTrendsColumns
    : matchesReportType(reportType, "flaky-tests")
      ? flakyTestsColumns
      : matchesReportType(reportType, "test-case-health")
        ? testCaseHealthColumns
        : matchesReportType(reportType, "issue-test-coverage")
          ? issueTestCoverageSummaryColumns
          : matchesReportType(reportType, "execution-log")
            ? executionLogColumns
            : matchesReportType(reportType, "requirement-coverage-gaps")
              ? requirementCoverageGapColumns
              : matchesReportType(reportType, "requirement-traceability")
                ? requirementTraceabilityColumns
                : matchesReportType(reportType, "requirement-coverage-changes")
                  ? requirementCoverageChangeColumns
                  : standardColumns;

  // Single source of truth for row grouping. issue-test-coverage is ALWAYS
  // grouped by issue (issues with expandable test cases) — its last two columns
  // (Test Results, Pass Rate) render only via aggregatedCell, so without this
  // grouping they show blank. This must not be gated on `allResults` (only
  // populated on an explicit Run via updateUrl); doing so left the report
  // ungrouped on every auto-run (URL load, tab switch, shared report). Other
  // report types group by their first dimension when more than one is selected.
  React.useEffect(() => {
    if (matchesReportType(reportType, "issue-test-coverage")) {
      setGrouping(["issueId"]);
    } else if (lastUsedDimensions.length > 1) {
      // Only group by the first dimension when there are multiple dimensions
      const firstDimension = lastUsedDimensions[0];
      const groupingColumn = firstDimension.value;
      setGrouping([groupingColumn]);
      // Don't expand all - let the table handle expansion state
    } else {
      // No grouping when there's only one dimension
      setGrouping([]);
    }
  }, [lastUsedDimensions, reportType]);

  // Reset column visibility when report type changes so stale keys from a
  // previous report type do not hide columns on the new one (DataTable defaults
  // columns missing from a non-empty visibility map to hidden).
  React.useEffect(() => {
    setColumnVisibility({});
  }, [reportType]);

  // Initialize column visibility for issue test coverage report
  React.useEffect(() => {
    if (matchesReportType(reportType, "issue-test-coverage")) {
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

  // Initialize column visibility for test case health report
  React.useEffect(() => {
    if (matchesReportType(reportType, "test-case-health")) {
      // Set all columns to visible for this report
      const visibility: Record<string, boolean> = {
        project: true,
        testCaseName: true,
        healthStatus: true,
        isStale: true,
        healthScore: true,
        lastExecutedAt: true,
        totalExecutions: true,
        passRate: true,
      };
      setColumnVisibility(visibility);
    }
  }, [reportType]);

  // Start the issue-test-coverage report with all issue groups collapsed on
  // entry. Grouping itself is owned by the effect above; this only resets the
  // expansion state when the report becomes active.
  React.useEffect(() => {
    if (matchesReportType(reportType, "issue-test-coverage")) {
      setExpanded({});
    }
  }, [reportType]);

  // Get the current report configuration
  const currentReport = reportTypes.find((r) => r.id === reportType);

  // One stable option-fetcher per selected dimension for the value-filter
  // pickers. Stability matters: MultiAsyncCombobox refetches whenever its
  // fetchOptions identity changes, so these are memoized per dimension.
  const currentReportEndpoint = currentReport?.endpoint;
  const dimensionFilterFetchers = useMemo(() => {
    const fetchers: Record<
      string,
      (
        query: string,
        page: number,
        pageSize: number
      ) => Promise<{ results: any[]; total: number }>
    > = {};
    if (!currentReportEndpoint) return fetchers;
    dimensions.forEach((dimension: any) => {
      fetchers[dimension.value] = async (query, page, pageSize) => {
        const url = new URL(currentReportEndpoint, window.location.origin);
        if (mode === "project" && projectId) {
          url.searchParams.set("projectId", projectId.toString());
        }
        url.searchParams.set("dimensionId", dimension.value);
        if (query) url.searchParams.set("search", query);
        url.searchParams.set("page", String(page));
        url.searchParams.set("pageSize", String(pageSize));
        const response = await fetch(url.toString());
        if (!response.ok) return { results: [], total: 0 };
        return (await response.json()) as { results: any[]; total: number };
      };
    });
    return fetchers;
  }, [currentReportEndpoint, dimensions, mode, projectId]);

  // Set isClient to true when component mounts (for SSR)
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Sync reportType from the URL (back/forward), guarding the in-flight window
  // after our own navigation the same way the tab sync does — see
  // resolveSyncedReportType.
  useEffect(() => {
    const { nextReportType, clearPending } = resolveSyncedReportType({
      urlReportType: searchParams.get("reportType"),
      pendingReportType: pendingReportTypeRef.current,
      currentReportType: reportType,
      validReportTypeIds: reportTypes.map((r) => r.id),
    });
    if (clearPending) {
      pendingReportTypeRef.current = null;
    }
    if (nextReportType !== null) {
      setReportType(nextReportType);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, reportTypes]);

  // Fetch filter options when report type changes to automation-trends or when filters change
  useEffect(() => {
    if (
      reportType === "automation-trends" ||
      (isCrossProjectReport(reportType) &&
        matchesReportType(reportType, "automation-trends"))
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

  // The requirement reports' filter options. Fetched once per report and
  // project, and deliberately NOT re-fetched when a selection changes, so
  // picking one option never removes the others from the menu.
  useEffect(() => {
    if (!isFilterableRequirementReport(reportType) || !currentReportEndpoint) {
      setRequirementFilterOptions({
        projects: [],
        priorities: [],
        statuses: [],
      });
      return;
    }
    const url = new URL(currentReportEndpoint, window.location.origin);
    if (mode === "project" && projectId) {
      url.searchParams.set("projectId", String(projectId));
    }
    let cancelled = false;
    fetch(url.toString())
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setRequirementFilterOptions({
          projects: Array.isArray(data.projects) ? data.projects : [],
          priorities: Array.isArray(data.priorities) ? data.priorities : [],
          statuses: Array.isArray(data.statuses) ? data.statuses : [],
        });
      })
      .catch(() => {
        // Filter options are optional; the report still runs unfiltered.
      });
    return () => {
      cancelled = true;
    };
  }, [reportType, currentReportEndpoint, mode, projectId]);

  // Coverage moved into the shared filter menu, so the menu is its source of
  // truth; this keeps the value the share link serializes in step.
  useEffect(() => {
    const picked = (selectedFilterValues.coverage ?? []) as string[];
    setRequirementCoverageStates((current) =>
      current.length === picked.length &&
      current.every((state, i) => state === picked[i])
        ? current
        : picked
    );
  }, [selectedFilterValues]);

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
    // Ignore spurious empty/unknown onValueChange events. While the tab is
    // switching, the report-type Select can momentarily emit an empty value
    // (its current value is briefly not among the freshly-rendered options).
    // Coercing that to a fallback report type would revert the tab the user
    // just switched to (the "bounce back to Report Builder" bug).
    if (!newReportType || !reportTypes.some((r) => r.id === newReportType)) {
      return;
    }
    const safeReportType = newReportType;

    // Update state immediately for responsive UI
    setReportType(safeReportType);
    // Clear stale results so old-typed rows don't render with new-typed columns
    setResults(null);
    setAllResults(null);
    // Dimension value filters are report-specific
    setDimensionValueFilters({});

    // Determine which tab this report belongs to
    const isPreBuilt = preBuiltReports.some((r) => r.id === safeReportType);
    const newTab = isPreBuilt ? "reports" : "builder";
    // In-flight guards so the sync effects don't revert this off the stale URL.
    pendingTabRef.current = newTab;
    pendingReportTypeRef.current = safeReportType;
    setActiveTab(newTab);

    // Clear URL parameters when changing report type (report-specific params don't apply)
    const newParams = new URLSearchParams();
    newParams.set("reportType", safeReportType);
    newParams.set("tab", newTab);
    router.replace(`${pathname}?${newParams.toString()}`);
  };

  // Handle tab change
  const handleTabChange = (newTab: string) => {
    // Prevent duplicate calls within 100ms (React Strict Mode workaround)
    const now = Date.now();
    if (
      lastTabChangeRef.current &&
      lastTabChangeRef.current.tab === newTab &&
      now - lastTabChangeRef.current.timestamp < 100
    ) {
      return;
    }
    lastTabChangeRef.current = { tab: newTab, timestamp: now };

    // Resolve the target tab AND a valid default report for it. Switching tabs
    // must also switch reportType — otherwise the dropdown and rendered panel
    // keep showing the previous tab's report (e.g. a custom "test-execution"
    // report still selected on the pre-built Reports tab).
    const { tab, reportType: defaultReport } = resolveTabChange({
      newTab,
      preBuiltReportIds: preBuiltReports.map((r) => r.id),
      customReportIds: customReports.map((r) => r.id),
    });

    // Mark the navigation as in flight so the sync effects won't revert these
    // optimistic updates off the still-stale URL before router.replace lands.
    pendingTabRef.current = tab;
    pendingReportTypeRef.current = defaultReport;

    // Update state immediately to prevent race conditions / stale UI
    setActiveTab(tab);
    setReportType(defaultReport);

    // Clear all report data and pagination to prevent displaying stale values
    setTotalCount(0);
    setResults(null);
    setAllResults(null);
    setError(null);
    setCompatWarning(null);

    // Mark the new report as already run to prevent auto-run from interfering
    lastRunReportType.current = defaultReport;

    // Update URL with a CLEAN param set — see reportUrlUtils for rationale.
    const newParams = buildCleanReportUrlParams({
      reportType: defaultReport,
      tab,
    });

    router.replace(`${pathname}?${newParams.toString()}`);
  };

  // When report type changes, clear all selections and results
  useEffect(() => {
    // Skip clearing on initial mount to allow URL parameters to load
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    // Reset the last run report type to allow auto-run
    lastRunReportType.current = null;

    // Reset loading state to allow auto-run to trigger
    setLoading(false);
    setDimensions([]);
    setMetrics([]);
    setResults(null);
    setAllResults(null);
    setError(null);
    setCompatWarning(null);
    setLastUsedDimensions([]);
    setLastUsedMetrics([]);
    setLastUsedDateRange(undefined);
    setLastUsedConsecutiveRuns(10);
    setReportGeneratedAt(null);
  }, [reportType]);

  // Load report metadata and URL parameters
  useEffect(() => {
    async function fetchMetadata() {
      if (!currentReport) return;

      // Guard against URL-state race: when reportType changes, the metadata
      // effect can fire once with stale searchParams (before router.replace's
      // URL update lands). See reportUrlUtils for rationale.
      const urlInSyncWithState = isUrlInSyncWithReportType(
        searchParams.get("reportType"),
        reportType
      );

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

        // Skip loading URL-based selections if the URL is still for the
        // previous report type (see guard above). The dimOpts we just fetched
        // are for the new report, so any URL param values belong to an old
        // report whose selections do not apply here.
        if (!urlInSyncWithState) {
          return;
        }

        // Load from URL parameters if present
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

        // Load dimension value filters from URL if present. Stored as JSON
        // ids only ({ dimId: [id, ...] }); the picker labels are resolved
        // through the dimension-values lookup. Only replace state when the
        // content actually differs — this effect re-runs on every
        // searchParams change, and a fresh-but-equal object would retrigger
        // the filter-change re-run.
        const dimensionFiltersParam = searchParams.get("dimensionFilters");
        if (dimensionFiltersParam) {
          try {
            const parsed = JSON.parse(dimensionFiltersParam);
            const restored: Record<string, any[]> = {};
            if (
              parsed &&
              typeof parsed === "object" &&
              !Array.isArray(parsed)
            ) {
              for (const [dimId, values] of Object.entries(parsed)) {
                if (!Array.isArray(values) || values.length === 0) continue;
                const ids = values
                  .map((v: any) =>
                    typeof v === "object" && v !== null ? v.id : v
                  )
                  .filter((id: any) => id != null && id !== "");
                if (ids.length === 0) continue;
                // Resolve display labels for the picker badges
                const lookupUrl = new URL(
                  currentReport.endpoint,
                  window.location.origin
                );
                if (mode === "project" && projectId) {
                  lookupUrl.searchParams.set("projectId", projectId.toString());
                }
                lookupUrl.searchParams.set("dimensionId", dimId);
                lookupUrl.searchParams.set("ids", ids.join(","));
                lookupUrl.searchParams.set("pageSize", String(ids.length));
                let byId = new Map<string, any>();
                try {
                  const lookupResponse = await fetch(lookupUrl.toString());
                  if (lookupResponse.ok) {
                    const lookup = await lookupResponse.json();
                    byId = new Map(
                      (lookup.results ?? []).map((r: any) => [String(r.id), r])
                    );
                  }
                } catch {
                  // Label lookup failed — fall back to id-as-name below
                }
                restored[dimId] = ids.map(
                  (id: any) => byId.get(String(id)) ?? { id, name: String(id) }
                );
              }
            }
            if (Object.keys(restored).length > 0) {
              setDimensionValueFilters((prev) =>
                JSON.stringify(prev) === JSON.stringify(restored)
                  ? prev
                  : restored
              );
            }
          } catch {
            // Malformed param — ignore and leave filters as they are
          }
        }

        if (dimensionsParam) {
          const dimIds = dimensionsParam.split(",");
          // Preserve order from URL by mapping instead of filtering
          const selectedDims = dimIds
            .map((id) => dimOpts.find((d: any) => d.value === id))
            .filter(Boolean);

          // For cross-project flaky tests, ensure "project" is the first dimension
          if (
            isCrossProjectReport(reportType) &&
            matchesReportType(reportType, "flaky-tests")
          ) {
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
          isCrossProjectReport(reportType) &&
          matchesReportType(reportType, "flaky-tests") &&
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
          if (
            isCrossProjectReport(reportType) &&
            matchesReportType(reportType, "flaky-tests")
          ) {
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

            // Also set the last used date range if present
            if (startDateParam) {
              setLastUsedDateRange({
                from: new Date(startDateParam),
                to: endDateParam ? new Date(endDateParam) : undefined,
              });
            }
          } else {
            // The URL's dimension/metric ids don't resolve for this report
            // type, so no auto-run will fire. Mark the run as completed-empty
            // so the results panel drops its loading state and shows the
            // no-results guidance instead of spinning forever.
            setResults([]);
          }
        }
      } catch (err) {
        console.error("Failed to load report metadata:", err);
        setError(tReports("errors.failedToLoadMetadata"));
      }
    }

    void fetchMetadata();
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
      updateUrl: boolean = false,
      { append = false, page = 1 }: { append?: boolean; page?: number } = {}
    ) => {
      try {
        // Don't attempt to run report if metrics are empty (except for pre-built reports)
        if (selectedMetrics.length === 0 && !currentReport?.isPreBuilt) {
          // Silently return - this is expected when first loading the report builder
          return;
        }

        // Iteration matrix is self-fetching (MatrixReportPreset uses
        // useMatrixAggregation directly to inherit cell-cap typing). Skip
        // the proxy POST so "Run Report" doesn't throw on the matrix's
        // 422 cell-cap path; just stamp the generated-at timestamp so the
        // shell's chrome stays consistent.
        if (matchesReportType(reportType, "iteration-matrix")) {
          setReportGeneratedAt(new Date());
          if (updateUrl) {
            setLastUsedDimensions(selectedDimensions);
          }
          return;
        }

        // Only execution-log is truly server-paginated (real DB skip/take); it
        // fetches a window per scroll. Every other report returns its full set,
        // so we ask for everything in one request and virtualize it client-side.
        const isExecLog = matchesReportType(reportType, "execution-log");
        const dateRange = form.getValues("dateRange");
        const body: any = {
          dimensions: selectedDimensions.map((d) => d.value),
          metrics: selectedMetrics.map((m) => m.value),
          page: isExecLog ? page : 1,
          pageSize: isExecLog ? EXECUTION_LOG_PAGE_SIZE : "All",
        };

        if (mode === "project" && projectId) {
          body.projectId = projectId;
        }

        // When grouping by folder, carry the subtree roll-up choice so a parent
        // folder can include its descendants.
        if (selectedDimensions.some((d) => d.value === "folder")) {
          body.folderIncludeDescendants = folderIncludeDescendants;
        }

        // Per-dimension value filters (only for dimensions still selected;
        // empty selections mean "all values" and are omitted).
        const activeDimensionFilters: Record<
          string,
          Array<string | number>
        > = {};
        Object.entries(dimensionValueFilters).forEach(([dimId, values]) => {
          if (!values || values.length === 0) return;
          if (!selectedDimensions.some((d) => d.value === dimId)) return;
          activeDimensionFilters[dimId] = values.map((v: any) => v.id);
        });
        if (Object.keys(activeDimensionFilters).length > 0) {
          body.dimensionFilters = activeDimensionFilters;
        }

        // For automation trends, add selected filter values and date grouping
        if (matchesReportType(reportType, "automation-trends")) {
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
        if (matchesReportType(reportType, "flaky-tests")) {
          body.consecutiveRuns = consecutiveRuns;
          body.flipThreshold = flipThreshold;
          body.automatedFilter = flakyAutomatedFilter;
          // Always include dimensions for cross-project reports (project should be auto-added)
          if (
            isCrossProjectReport(reportType) &&
            matchesReportType(reportType, "flaky-tests")
          ) {
            const dimValues = selectedDimensions.map((d) => d.value);
            // Ensure project is included if it's not already there
            if (!dimValues.includes("project")) {
              dimValues.unshift("project");
            }
            body.dimensions = dimValues;
          }
        }

        // For test case health, add health parameters and dimensions
        if (matchesReportType(reportType, "test-case-health")) {
          body.staleDaysThreshold = staleDaysThreshold;
          body.minExecutionsForRate = minExecutionsForRate;
          body.lookbackDays = lookbackDays;
          body.automatedFilter = healthAutomatedFilter;
          body.healthStatusFilter = healthStatusFilter;
          body.staleFilter = healthStaleFilter;
          // Always include dimensions for cross-project reports (project should be auto-added)
          if (
            isCrossProjectReport(reportType) &&
            matchesReportType(reportType, "test-case-health")
          ) {
            const dimValues = selectedDimensions.map((d) => d.value);
            // Ensure project is included if it's not already there
            if (!dimValues.includes("project")) {
              dimValues.unshift("project");
            }
            body.dimensions = dimValues;
          }
        }

        // For issue test coverage, add dimensions for cross-project
        if (matchesReportType(reportType, "issue-test-coverage")) {
          // Always include dimensions for cross-project reports (project should be auto-added)
          if (
            isCrossProjectReport(reportType) &&
            matchesReportType(reportType, "issue-test-coverage")
          ) {
            const dimValues = selectedDimensions.map((d) => d.value);
            // Ensure project is included if it's not already there
            if (!dimValues.includes("project")) {
              dimValues.unshift("project");
            }
            body.dimensions = dimValues;
          }
        }

        // For the requirement reports, confine the matrix to the selected
        // requirements' subtrees. Empty selection = whole project, and the
        // key is omitted entirely so older share configs and new ones read
        // the same way.
        if (
          matchesReportType(reportType, "requirement-coverage-gaps") ||
          matchesReportType(reportType, "requirement-traceability") ||
          matchesReportType(reportType, "requirement-coverage-changes")
        ) {
          if (requirementScope.length > 0) {
            body.requirementIds = requirementScope.map((option) => option.id);
          }
          // Cross-project only: narrow the anchor set to the picked
          // projects. Empty = every requirements-enabled project, matching
          // the scope picker's own empty-means-all convention.
          if (mode === "cross-project") {
            const picked = selectedFilterValues.projects;
            if (picked && picked.length > 0) {
              body.projectIds = picked;
            }
          }
          const pickedPriorities = selectedFilterValues.priority;
          if (pickedPriorities && pickedPriorities.length > 0) {
            body.priorities = pickedPriorities;
          }
          const pickedStatuses = selectedFilterValues.status;
          if (pickedStatuses && pickedStatuses.length > 0) {
            body.statuses = pickedStatuses;
          }
        }
        if (
          matchesReportType(reportType, "requirement-coverage-gaps") ||
          matchesReportType(reportType, "requirement-traceability")
        ) {
          // Omitted when live, so a share of the live report stays a
          // share of the live report.
          if (requirementSnapshotId !== null) {
            body.snapshotId = requirementSnapshotId;
          }
        }
        if (matchesReportType(reportType, "requirement-traceability")) {
          if (requirementCoverageStates.length > 0) {
            body.coverageStates = requirementCoverageStates;
          }
        }
        if (matchesReportType(reportType, "requirement-coverage-gaps")) {
          // Always explicit: the config a share stores must distinguish
          // "toggled off" from "predates the toggle", or the redirect
          // would restore the default instead of the shared state.
          body.includeNotRun = includeNotRunDebt;
        }
        if (matchesReportType(reportType, "requirement-coverage-changes")) {
          if (baselineSnapshotId !== null) {
            body.baselineSnapshotId = baselineSnapshotId;
          }
          if (compareSnapshotId !== null) {
            body.compareSnapshotId = compareSnapshotId;
          }
          body.includeUnchanged = includeUnchanged;
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
        // Note: reportType IDs now include the "cross-project-" prefix for cross-project reports,
        // so we don't need to add it here anymore
        const validation = reportRequestSchema.safeParse({
          ...body,
          reportType: reportType,
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
          // Execution log uses true server-side pagination — accumulate pages
          // as the user scrolls instead of replacing the visible page.
          if (isExecLog) {
            const tableData = data.data || data.results || [];
            setResults((prev) => {
              if (!append || !prev) return tableData;
              // De-dupe by row id in case a page boundary overlaps.
              const seen = new Set(prev.map((r: any) => r.id));
              const fresh = tableData.filter((r: any) => !seen.has(r.id));
              return fresh.length ? [...prev, ...fresh] : prev;
            });
            setTotalCount(data.total ?? tableData.length);
            // Only on a fresh run (never on append): store the status breakdown
            // for the chart so scrolling doesn't disturb it.
            if (updateUrl && !append) {
              setAllResults(data.statusBreakdown || []);
              setLastUsedDimensions(selectedDimensions);
            }
            setReportGeneratedAt(new Date());
            setLastRequestBody(body);
            return;
          }

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
            // Set lastUsedDimensions for flaky tests so columns can access them
            setLastUsedDimensions(selectedDimensions);

            // Set initial sort order for flaky tests: Flips Desc
            if (
              (reportType === "flaky-tests" ||
                (isCrossProjectReport(reportType) &&
                  matchesReportType(reportType, "flaky-tests"))) &&
              !sortConfig
            ) {
              setSortConfig({ column: "flipCount", direction: "desc" });
            }
          }

          // Apply sorting if configured
          const effectiveSortConfig =
            updateUrl &&
            (reportType === "flaky-tests" ||
              (isCrossProjectReport(reportType) &&
                matchesReportType(reportType, "flaky-tests"))) &&
            !sortConfig
              ? { column: "flipCount", direction: "desc" as const }
              : sortConfig;

          // Render the full sorted set; the table virtualizes it (no paging).
          // The shared utility sorts by what each column DISPLAYS — see its
          // doc comment for the id-vs-property overrides.
          setResults(
            sortPreBuiltReportRows(reportType, allData, effectiveSortConfig)
          );
        } else {
          // Custom reports return the entire result set in `allResults` on the
          // first POST — render that full set and virtualize it (no paging).
          const fullData = data.allResults || data.data || data.results || [];

          setResults(fullData);

          // Store projects for automation trends report
          if (
            matchesReportType(reportType, "automation-trends") &&
            data.projects
          ) {
            setAutomationTrendsProjects(data.projects);
          }

          // Chart shows the full dataset; only refresh it on a new run.
          if (updateUrl) {
            setAllResults(fullData);
          }

          setTotalCount(data.total || data.totalCount || fullData.length);
        }

        // Store the request body for sharing on every successful fetch —
        // auto-runs (URL load, tab switch, filter re-run) must produce a
        // shareable config too. Exclude paging/sorting: shares show all data.
        {
          const {
            page: _page,
            pageSize: _pageSize,
            sortColumn: _sortColumn,
            sortDirection: _sortDirection,
            ...shareableBody
          } = body;
          setLastRequestBody(shareableBody);
        }

        // Only update these when running a new report (not just sorting/paginating)
        if (updateUrl) {
          setLastUsedDimensions(selectedDimensions);
          setLastUsedMetrics(selectedMetrics);
          setLastUsedDateRange(
            dateRange?.from ? (dateRange as DateRange) : undefined
          );
          // Update last used date grouping for automation trends
          if (matchesReportType(reportType, "automation-trends")) {
            setLastUsedDateGrouping(dateGrouping);
          }
          // Update last used consecutive runs for flaky tests
          if (matchesReportType(reportType, "flaky-tests")) {
            setLastUsedConsecutiveRuns(consecutiveRuns);
          }
          // Record when the report was generated
          setReportGeneratedAt(new Date());

          // Only persist selections to the URL on an explicit run (the Run
          // Report button). Auto-runs / sort / filter re-runs must NOT write the
          // URL: during a tab switch the auto-run re-runs the previous report and
          // its URL write would clobber the new tab/reportType (the bounce). The
          // selections are already in the URL from the explicit run, so auto-runs
          // don't need to rewrite them.
          if (updateUrl && !currentReport?.isPreBuilt) {
            // Update URL with selections - start with existing params to preserve tab parameter
            const newParams = new URLSearchParams(searchParams.toString());
            // Safety check: ensure reportType is never empty
            const safeReportType =
              reportType && reportType.trim() !== ""
                ? reportType
                : "test-execution";
            newParams.set("reportType", safeReportType);
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

            // Persist dimension value filters as ids only (names are
            // display-only and resolved on load via the values lookup) or
            // drop the param when none.
            const urlDimensionFilters: Record<
              string,
              Array<string | number>
            > = {};
            Object.entries(dimensionValueFilters).forEach(([dimId, values]) => {
              if (!values || values.length === 0) return;
              if (!selectedDimensions.some((d) => d.value === dimId)) return;
              urlDimensionFilters[dimId] = values.map((v: any) => v.id);
            });
            if (Object.keys(urlDimensionFilters).length > 0) {
              newParams.set(
                "dimensionFilters",
                JSON.stringify(urlDimensionFilters)
              );
            } else {
              newParams.delete("dimensionFilters");
            }

            router.replace(`${pathname}?${newParams.toString()}`);
          }
        }
      } catch (err: any) {
        console.error("Report error:", err);
        setError(err.message || tReports("errors.failedToRunReport"));
      }
    },
    [
      form,
      mode,
      projectId,
      sortConfig,
      reportType,
      currentReport,
      setTotalCount,
      router,
      pathname,
      searchParams,
      tReports,
      dateGrouping,
      selectedFilterValues,
      folderIncludeDescendants,
      dimensionValueFilters,
      consecutiveRuns,
      flipThreshold,
      flakyAutomatedFilter,
      staleDaysThreshold,
      minExecutionsForRate,
      lookbackDays,
      healthAutomatedFilter,
      healthStatusFilter,
      healthStaleFilter,
      requirementScope,
      requirementCoverageStates,
      includeNotRunDebt,
      requirementSnapshotId,
      baselineSnapshotId,
      compareSnapshotId,
      includeUnchanged,
    ]
  );

  const runReport = useCallback(
    async (
      selectedDimensions: any[],
      selectedMetrics: any[],
      { persistUrl = false }: { persistUrl?: boolean } = {}
    ) => {
      setLoading(true);
      setError(null);

      try {
        await fetchReportData(selectedDimensions, selectedMetrics, persistUrl);
      } finally {
        setLoading(false);
      }
    },
    [fetchReportData]
  );

  // Infinite scroll only applies to execution-log (the one truly server-paged
  // report). Every other report has its full set loaded, so hasMore stays false.
  const isExecutionLog = matchesReportType(reportType, "execution-log");
  const loadedCount = results?.length ?? 0;
  const hasMore = isExecutionLog && loadedCount < totalCount;

  // The first report run is in flight or guaranteed to fire (URL selections
  // awaiting resolution, or a pre-built report's mount auto-run) and none has
  // completed yet — `results` stays null until a run lands and is reset to
  // null on report-type switches. While true, the results panel shows a
  // loading state instead of a premature "No results found".
  // The changes report is the one pre-built type whose first run is NOT
  // guaranteed: without a baseline nothing fires, so the panel must show
  // its prompt rather than spin forever.
  const awaitingFirstRun =
    results === null &&
    !error &&
    !changesMissingBaseline &&
    (loading ||
      Boolean(currentReport?.isPreBuilt) ||
      Boolean(searchParams.get("dimensions") && searchParams.get("metrics")));

  const handleLoadMore = useCallback(() => {
    if (!isExecutionLog || loadingMore) return;
    const loaded = results?.length ?? 0;
    if (loaded >= totalCount) return;
    const nextPage = Math.floor(loaded / EXECUTION_LOG_PAGE_SIZE) + 1;
    setLoadingMore(true);
    void fetchReportData(lastUsedDimensions, lastUsedMetrics, false, {
      append: true,
      page: nextPage,
    }).finally(() => setLoadingMore(false));
  }, [
    isExecutionLog,
    loadingMore,
    results,
    totalCount,
    fetchReportData,
    lastUsedDimensions,
    lastUsedMetrics,
  ]);

  // CSV export. Full-set reports serialize the in-memory `allResults`;
  // execution-log (truly server-paged) fetches every page first so the export
  // is complete.
  const { isExporting: isExportingCsv, exportCsv } = useReportCsvExport();
  const handleExportCsv = useCallback(() => {
    const getRows = async (): Promise<any[]> => {
      if (!isExecutionLog) return allResults ?? results ?? [];
      const all: any[] = [];
      const seen = new Set<number | string>();
      let page = 1;
      // Loop the report endpoint until every row is fetched (no truncation).
      while (currentReport?.endpoint) {
        const response = await fetch(currentReport.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(lastRequestBody || {}),
            page,
            pageSize: EXECUTION_LOG_PAGE_SIZE,
          }),
        });
        if (!response.ok) throw new Error("Failed to fetch report for export");
        const data = await response.json();
        const batch: any[] = data.data || data.results || [];
        for (const r of batch) {
          if (!seen.has(r.id)) {
            seen.add(r.id);
            all.push(r);
          }
        }
        const total = data.total ?? all.length;
        if (batch.length < EXECUTION_LOG_PAGE_SIZE || all.length >= total)
          break;
        page += 1;
      }
      return all;
    };

    void exportCsv({
      reportType,
      isCrossProject: mode === "cross-project",
      getRows,
      dimensions: lastUsedDimensions,
      metrics: lastUsedMetrics,
      projects: automationTrendsProjects,
      consecutiveRuns: lastUsedConsecutiveRuns,
      projectId: mode === "project" ? projectId : undefined,
    });
  }, [
    exportCsv,
    isExecutionLog,
    allResults,
    results,
    currentReport,
    lastRequestBody,
    reportType,
    mode,
    lastUsedDimensions,
    lastUsedMetrics,
    automationTrendsProjects,
    lastUsedConsecutiveRuns,
    projectId,
  ]);

  // Auto-run report if we have stored selections
  useEffect(() => {
    // Check if we need to run report for current reportType
    const hasRunForCurrentType = lastRunReportType.current === reportType;

    // Snapshot-style LLM reports (automation-candidates) own their own
    // generate trigger via the Run Report CustomEvent dispatch; auto-running
    // them on mount would either fire a wasted LLM call or hit a wrong-shape
    // route handler and stick the button in loading. Skip them here.
    const isSnapshotStyleReport = matchesReportType(
      reportType,
      "automation-candidates"
    );

    // For pre-built reports, auto-run even without dimensions/metrics.
    // The coverage-changes report waits for a baseline snapshot — once
    // one is chosen this effect re-evaluates and fires the first run.
    const shouldAutoRun =
      isSnapshotStyleReport || changesMissingBaseline
        ? false
        : currentReport?.isPreBuilt
          ? !hasRunForCurrentType && !loading && !error
          : lastUsedDimensions.length > 0 &&
            lastUsedMetrics.length > 0 &&
            !hasRunForCurrentType &&
            !loading &&
            !error;

    if (shouldAutoRun) {
      lastRunReportType.current = reportType;
      void runReport(lastUsedDimensions, lastUsedMetrics);
    }
  }, [
    reportType,
    lastUsedDimensions,
    lastUsedMetrics,
    results,
    loading,
    error,
    runReport,
    currentReport,
    changesMissingBaseline,
  ]);

  // Pre-built (non-execution-log) reports hold their full set client-side and
  // re-sort it in place — no server round-trip, no paging.
  useEffect(() => {
    if (!currentReport?.isPreBuilt) return;
    if (matchesReportType(reportType, "execution-log")) return;
    if (!allResults || allResults.length === 0) return;

    setResults(sortPreBuiltReportRows(reportType, allResults, sortConfig));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortConfig, reportType, allResults]);

  // Server-sorted reports (custom + execution-log) refetch the full sorted set
  // when sort changes. Execution-log restarts its accumulation from page 1
  // (append:false replaces the rows) since the whole list reorders.
  useEffect(() => {
    if (
      (!currentReport?.isPreBuilt ||
        matchesReportType(reportType, "execution-log")) &&
      results
    ) {
      void fetchReportData(lastUsedDimensions, lastUsedMetrics, false, {
        append: false,
        page: 1,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortConfig]);

  // Re-fetch data when filters or date grouping change for automation trends
  useEffect(() => {
    if (
      matchesReportType(reportType, "automation-trends") &&
      lastUsedDimensions.length > 0 &&
      lastUsedMetrics.length > 0 &&
      results
    ) {
      // Automatically re-run report when filters or date grouping change
      void runReport(lastUsedDimensions, lastUsedMetrics);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFilterValues, dateGrouping]);

  // Re-run custom reports when dimension value filters change, once a report
  // has been run (mirrors the automation-trends filter behavior above).
  useEffect(() => {
    if (
      !isPreBuiltReport(reportType) &&
      lastUsedDimensions.length > 0 &&
      lastUsedMetrics.length > 0 &&
      results
    ) {
      void runReport(lastUsedDimensions, lastUsedMetrics);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dimensionValueFilters]);

  // Filter options based on selections
  useEffect(() => {
    // For now, no compatibility rules - just use all options
    setFilteredDimensionOptions(dimensionOptions);
    setFilteredMetricOptions(metricOptions);
    setCompatWarning(null);
  }, [dimensionOptions, metricOptions]);

  // Drop value filters for dimensions that are no longer selected (covers
  // both the multi-select and the draggable list's remove button).
  useEffect(() => {
    setDimensionValueFilters((prev) => {
      const staleKeys = Object.keys(prev).filter(
        (dimId) => !dimensions.some((d: any) => d.value === dimId)
      );
      if (staleKeys.length === 0) return prev;
      const next = { ...prev };
      staleKeys.forEach((key) => delete next[key]);
      return next;
    });
  }, [dimensions]);

  // Automatically add "project" as first dimension for cross-project flaky tests
  useEffect(() => {
    if (
      isCrossProjectReport(reportType) &&
      matchesReportType(reportType, "flaky-tests") &&
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
    // Snapshot-style reports (LLM-generated) own their own data path and
    // need an explicit "go" trigger to fire a new generation. We piggyback
    // on Run Report so the user has one mental model: pick a report on the
    // left, configure it on the left, click Run Report. The preset listens
    // for this event and starts streaming.
    if (matchesReportType(reportType, "automation-candidates")) {
      window.dispatchEvent(
        new CustomEvent("automation-candidates:run", {
          detail: {
            maxCases: automationCandidatesCount,
            selectionStrategy: automationCandidatesStrategy,
          },
        })
      );
      return;
    }
    // A changes report without a baseline has nothing to diff against.
    if (changesMissingBaseline) return;
    // Explicit user run — persist the selections to the URL (for refresh/share).
    void runReport(dimensions, metrics, { persistUrl: true });
  };

  const handleDimensionsChange = (newDimensions: any[]) => {
    setDimensions(newDimensions);
  };

  const handleMetricsChange = (newMetrics: any[]) => {
    setMetrics(newMetrics);
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

  return (
    <div>
      <ResizablePanelGroup
        direction="horizontal"
        autoSaveId="report-builder-panels"
      >
        <ResizablePanel
          id="report-builder-left"
          order={1}
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
            className="rounded-none border-y-0 border-s-0 flex flex-col"
          >
            <CardContent className="grow overflow-y-auto pb-6">
              <Tabs
                value={activeTab}
                onValueChange={handleTabChange}
                className="h-full flex flex-col"
              >
                <TabsList className="grid w-full grid-cols-2 mb-4 min-w-60">
                  <TabsTrigger
                    value="reports"
                    data-testid="reports-tab"
                    className="min-w-0 truncate"
                  >
                    {tAdminMenu("reports")}
                  </TabsTrigger>
                  <TabsTrigger
                    value="builder"
                    data-testid="report-builder-tab"
                    className="min-w-0 truncate"
                  >
                    {tReports("title")}
                  </TabsTrigger>
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
                          <SelectTrigger
                            data-testid="report-type-select"
                            aria-label={tReports("reportType")}
                          >
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

                      {/* Date Range Selection. Snapshot-style LLM reports
                          (automation-candidates) don't accept a date range —
                          the LLM ranks the current state of every manual
                          case, so a range would be meaningless. The two
                          requirement reports don't either: coverage is
                          defined as each case's LATEST-EVER result (the
                          milestone's recorded latest-result decision,
                          deliberately not windowed), so their handler
                          ignores dates — showing the control would imply a
                          filter that cannot exist. */}
                      {!matchesReportType(
                        reportType,
                        "automation-candidates"
                      ) &&
                        !matchesReportType(
                          reportType,
                          "requirement-coverage-gaps"
                        ) &&
                        !matchesReportType(
                          reportType,
                          "requirement-traceability"
                        ) &&
                        !matchesReportType(
                          reportType,
                          "requirement-coverage-changes"
                        ) && (
                          <div className="grid gap-2">
                            <DateRangePickerField
                              control={form.control}
                              name="dateRange"
                              label={tReports("dateRange.selectDateRange")}
                              helpKey="reportBuilder.dateRange"
                            />
                          </div>
                        )}

                      {/* Date Grouping Selection for Automation Trends */}
                      {(reportType === "automation-trends" ||
                        (isCrossProjectReport(reportType) &&
                          matchesReportType(
                            reportType,
                            "automation-trends"
                          ))) && (
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
                        (isCrossProjectReport(reportType) &&
                          matchesReportType(reportType, "automation-trends")) ||
                        isFilterableRequirementReport(reportType)) &&
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
                        (isCrossProjectReport(reportType) &&
                          matchesReportType(reportType, "flaky-tests"))) && (
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
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="w-full justify-between"
                                >
                                  {flakyAutomatedFilter === "all"
                                    ? tRuns("typeFilter.both")
                                    : flakyAutomatedFilter === "manual"
                                      ? tCommon("fields.manual")
                                      : tCommon("fields.automated")}
                                  <ChevronDown className="ms-2 h-4 w-4 opacity-50" />
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

                      {/* Requirement Report Scope (gaps/traceability/changes) */}
                      {(matchesReportType(
                        reportType,
                        "requirement-coverage-gaps"
                      ) ||
                        matchesReportType(
                          reportType,
                          "requirement-traceability"
                        ) ||
                        matchesReportType(
                          reportType,
                          "requirement-coverage-changes"
                        )) &&
                        mode === "project" &&
                        projectId && (
                          <RequirementScopePicker
                            projectId={projectId}
                            value={requirementScope}
                            onValueChange={setRequirementScope}
                          />
                        )}

                      {/* Snapshot to render (gaps/traceability): live or a
                          saved point-in-time record. */}
                      {(matchesReportType(
                        reportType,
                        "requirement-coverage-gaps"
                      ) ||
                        matchesReportType(
                          reportType,
                          "requirement-traceability"
                        )) &&
                        mode === "project" &&
                        projectId && (
                          <RequirementSnapshotPicker
                            projectId={Number(projectId)}
                            value={requirementSnapshotId}
                            onValueChange={setRequirementSnapshotId}
                            label={tReports(
                              "requirementCoverage.snapshotLabel"
                            )}
                            nullMode="live"
                            canManage={canManageSnapshots}
                            canDelete={canDeleteSnapshots}
                            requirementIds={requirementScope.map(
                              (option) => option.id
                            )}
                            testIdPrefix="requirement-snapshot"
                          />
                        )}

                      {/* Coverage changes: baseline (required) vs. comparison. */}
                      {matchesReportType(
                        reportType,
                        "requirement-coverage-changes"
                      ) &&
                        mode === "project" &&
                        projectId && (
                          <>
                            <RequirementSnapshotPicker
                              projectId={Number(projectId)}
                              value={baselineSnapshotId}
                              onValueChange={setBaselineSnapshotId}
                              label={tReports(
                                "requirementCoverage.baselineLabel"
                              )}
                              nullMode="none"
                              canManage={canManageSnapshots}
                              canDelete={canDeleteSnapshots}
                              requirementIds={requirementScope.map(
                                (option) => option.id
                              )}
                              testIdPrefix="requirement-baseline-snapshot"
                            />
                            {changesMissingBaseline ? (
                              <p
                                className="text-xs text-muted-foreground"
                                data-testid="requirement-baseline-required"
                              >
                                {tReports(
                                  "requirementCoverage.baselineRequired"
                                )}
                              </p>
                            ) : null}
                            <RequirementSnapshotPicker
                              projectId={Number(projectId)}
                              value={compareSnapshotId}
                              onValueChange={setCompareSnapshotId}
                              label={tReports(
                                "requirementCoverage.compareLabel"
                              )}
                              nullMode="live"
                              testIdPrefix="requirement-compare-snapshot"
                            />
                            <div className="flex items-center gap-2">
                              <Switch
                                id="requirement-changes-include-unchanged"
                                checked={includeUnchanged}
                                onCheckedChange={setIncludeUnchanged}
                                data-testid="requirement-changes-include-unchanged"
                              />
                              <label
                                htmlFor="requirement-changes-include-unchanged"
                                className="text-sm font-medium"
                              >
                                {tReports(
                                  "requirementCoverage.includeUnchanged"
                                )}
                              </label>
                            </div>
                          </>
                        )}

                      {matchesReportType(
                        reportType,
                        "requirement-coverage-gaps"
                      ) && (
                        <div className="flex items-center gap-2">
                          <Switch
                            id="requirement-debt-include-not-run"
                            checked={includeNotRunDebt}
                            onCheckedChange={setIncludeNotRunDebt}
                            data-testid="requirement-debt-include-not-run"
                          />
                          <label
                            htmlFor="requirement-debt-include-not-run"
                            className="text-sm font-medium"
                          >
                            {tReports("requirementCoverage.includeNotRun")}
                          </label>
                        </div>
                      )}

                      {/* Test Case Health Parameters */}
                      {(reportType === "test-case-health" ||
                        (isCrossProjectReport(reportType) &&
                          matchesReportType(
                            reportType,
                            "test-case-health"
                          ))) && (
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
                                  setMinExecutionsForRate(
                                    Number(e.target.value)
                                  )
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
                                  type="button"
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
                                  <ChevronDown className="ms-2 h-4 w-4" />
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
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="w-full justify-between"
                                >
                                  {healthAutomatedFilter === "all"
                                    ? tRuns("typeFilter.both")
                                    : healthAutomatedFilter === "manual"
                                      ? tCommon("fields.manual")
                                      : tCommon("fields.automated")}
                                  <ChevronDown className="ms-2 h-4 w-4 opacity-50" />
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

                          {/* Health Status Filter */}
                          <div className="grid gap-2">
                            <label className="text-sm font-medium">
                              {tReports("testCaseHealth.status")}
                            </label>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="w-full justify-between"
                                >
                                  {healthStatusFilter === "all"
                                    ? tIssues("filterAll")
                                    : healthStatusFilter === "healthy"
                                      ? tReports(
                                          "testCaseHealth.healthStatus.healthy"
                                        )
                                      : healthStatusFilter === "always_passing"
                                        ? tReports(
                                            "testCaseHealth.healthStatus.alwaysPassing"
                                          )
                                        : healthStatusFilter ===
                                            "always_failing"
                                          ? tReports(
                                              "testCaseHealth.healthStatus.alwaysFailing"
                                            )
                                          : tReports(
                                              "testCaseHealth.healthStatus.neverExecuted"
                                            )}
                                  <ChevronDown className="ms-2 h-4 w-4 opacity-50" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent
                                align="start"
                                className="w-full"
                              >
                                <DropdownMenuGroup>
                                  <DropdownMenuItem
                                    onClick={() => setHealthStatusFilter("all")}
                                  >
                                    {tIssues("filterAll")}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() =>
                                      setHealthStatusFilter("healthy")
                                    }
                                  >
                                    {tReports(
                                      "testCaseHealth.healthStatus.healthy"
                                    )}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() =>
                                      setHealthStatusFilter("always_passing")
                                    }
                                  >
                                    {tReports(
                                      "testCaseHealth.healthStatus.alwaysPassing"
                                    )}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() =>
                                      setHealthStatusFilter("always_failing")
                                    }
                                  >
                                    {tReports(
                                      "testCaseHealth.healthStatus.alwaysFailing"
                                    )}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() =>
                                      setHealthStatusFilter("never_executed")
                                    }
                                  >
                                    {tReports(
                                      "testCaseHealth.healthStatus.neverExecuted"
                                    )}
                                  </DropdownMenuItem>
                                </DropdownMenuGroup>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>

                          {/* Staleness Filter */}
                          <div className="grid gap-2">
                            <label className="text-sm font-medium">
                              {tReports("testCaseHealth.staleFilter")}
                            </label>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="w-full justify-between"
                                >
                                  {healthStaleFilter === "all"
                                    ? tIssues("filterAll")
                                    : healthStaleFilter === "stale"
                                      ? tReports("testCaseHealth.stale")
                                      : tReports("testCaseHealth.notStale")}
                                  <ChevronDown className="ms-2 h-4 w-4 opacity-50" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent
                                align="start"
                                className="w-full"
                              >
                                <DropdownMenuGroup>
                                  <DropdownMenuItem
                                    onClick={() => setHealthStaleFilter("all")}
                                  >
                                    {tIssues("filterAll")}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() =>
                                      setHealthStaleFilter("stale")
                                    }
                                  >
                                    {tReports("testCaseHealth.stale")}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() =>
                                      setHealthStaleFilter("notStale")
                                    }
                                  >
                                    {tReports("testCaseHealth.notStale")}
                                  </DropdownMenuItem>
                                </DropdownMenuGroup>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                      )}

                      {matchesReportType(reportType, "iteration-matrix") &&
                        mode === "project" &&
                        projectId && (
                          <MatrixFilterPanel projectId={projectId} />
                        )}

                      {/* Automation Candidates: selection strategy + how many cases to rank */}
                      {matchesReportType(
                        reportType,
                        "automation-candidates"
                      ) && (
                        <div className="grid gap-4">
                          <div className="grid gap-2">
                            <div className="flex items-center gap-2">
                              <label
                                htmlFor="automation-candidates-strategy"
                                className="text-sm font-medium"
                              >
                                {tReports(
                                  "automationCandidates.selectionStrategy"
                                )}
                              </label>
                              <HelpPopover
                                helpKey={`## ${tReports("automationCandidates.selectionStrategy")}\n${tReports("automationCandidates.selectionStrategyHelp")}`}
                              />
                            </div>
                            <Select
                              value={automationCandidatesStrategy}
                              onValueChange={(v) =>
                                setAutomationCandidatesStrategy(
                                  v as typeof automationCandidatesStrategy
                                )
                              }
                            >
                              <SelectTrigger
                                id="automation-candidates-strategy"
                                data-testid="automation-candidates-strategy"
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="most_executed">
                                  {tReports(
                                    "automationCandidates.strategies.most_executed"
                                  )}
                                </SelectItem>
                                <SelectItem value="flakiest_first">
                                  {tReports(
                                    "automationCandidates.strategies.flakiest_first"
                                  )}
                                </SelectItem>
                                <SelectItem value="longest_first">
                                  {tReports(
                                    "automationCandidates.strategies.longest_first"
                                  )}
                                </SelectItem>
                                <SelectItem value="oldest_first">
                                  {tReports(
                                    "automationCandidates.strategies.oldest_first"
                                  )}
                                </SelectItem>
                                <SelectItem value="newest_first">
                                  {tReports(
                                    "automationCandidates.strategies.newest_first"
                                  )}
                                </SelectItem>
                                <SelectItem value="random">
                                  {tReports(
                                    "automationCandidates.strategies.random"
                                  )}
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="grid gap-2">
                            <div className="flex items-center gap-2">
                              <label
                                htmlFor="automation-candidates-count"
                                className="text-sm font-medium"
                              >
                                {tReports("automationCandidates.casesToRank")}
                              </label>
                              <HelpPopover
                                helpKey={`## ${tReports("automationCandidates.casesToRank")}\n${tReports("automationCandidates.casesToRankHelp")}`}
                              />
                            </div>
                            <div className="flex items-center gap-3">
                              <input
                                id="automation-candidates-count"
                                data-testid="automation-candidates-count"
                                type="range"
                                min={5}
                                max={100}
                                step={5}
                                value={automationCandidatesCount}
                                onChange={(e) =>
                                  setAutomationCandidatesCount(
                                    Number(e.target.value)
                                  )
                                }
                                className="flex-1 h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                              />
                              <span className="w-10 text-sm font-mono text-center">
                                {automationCandidatesCount}
                              </span>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Run Report Button */}
                      <Button
                        type="button"
                        onClick={handleRunReport}
                        disabled={loading || changesMissingBaseline}
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
                          <SelectTrigger
                            data-testid="report-type-select"
                            aria-label={tReports("reportType")}
                          >
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

                      {/* Folder subtree roll-up — only relevant when grouping
                          by folder. */}
                      {dimensions.some((d) => d.value === "folder") && (
                        <label className="flex items-start gap-2">
                          <Checkbox
                            checked={folderIncludeDescendants}
                            onCheckedChange={(checked) =>
                              setFolderIncludeDescendants(checked === true)
                            }
                            data-testid="folder-include-descendants"
                          />
                          <span className="grid gap-0.5">
                            <span className="text-sm font-medium">
                              {tReports("folderDescendants.label")}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {tReports("folderDescendants.description")}
                            </span>
                          </span>
                        </label>
                      )}

                      {/* Per-dimension value filters. The date dimension is
                          covered by the date-range picker above. */}
                      {!isPreBuiltReport(reportType) &&
                        dimensions.some((d) => d.value !== "date") && (
                          <div className="grid gap-2">
                            <div className="flex items-center gap-2">
                              <label className="text-sm font-medium">
                                {tCommon("ui.search.filters")}
                              </label>
                              <HelpPopover helpKey="reportBuilder.dimensionFilters" />
                            </div>
                            {dimensions
                              .filter((d: any) => d.value !== "date")
                              .map((dimension: any) => (
                                <div
                                  key={dimension.value}
                                  className="grid gap-1"
                                >
                                  <label className="text-xs text-muted-foreground">
                                    {dimension.label}
                                  </label>
                                  <MultiAsyncCombobox
                                    value={
                                      dimensionValueFilters[dimension.value] ??
                                      []
                                    }
                                    onValueChange={(values) =>
                                      setDimensionValueFilters((prev) => ({
                                        ...prev,
                                        [dimension.value]: values,
                                      }))
                                    }
                                    fetchOptions={
                                      dimensionFilterFetchers[dimension.value]
                                    }
                                    renderOption={(option: any) => (
                                      <span className="truncate">
                                        {option.name}
                                      </span>
                                    )}
                                    getOptionValue={(option: any) => option.id}
                                    getOptionLabel={(option: any) =>
                                      String(option.name ?? option.id)
                                    }
                                    placeholder={tReports(
                                      "dimensionFilters.allValues"
                                    )}
                                    pageSize={25}
                                    className="min-h-9"
                                  />
                                </div>
                              ))}
                          </div>
                        )}

                      {/* Priority Filter for Automation Trends */}
                      {matchesReportType(reportType, "automation-trends") &&
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
                              placeholder={tCommon(
                                "placeholders.selectPriorityValuesOrEmpty"
                              )}
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
                        type="button"
                        onClick={handleRunReport}
                        disabled={
                          loading ||
                          changesMissingBaseline ||
                          (isPreBuiltReport(reportType)
                            ? false // No requirements for pre-built reports
                            : dimensions.length === 0 || metrics.length === 0)
                        }
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
            className="p-0 -ms-1 rounded-s-none"
            aria-label={
              isCollapsed
                ? tCommon("actions.expand")
                : tCommon("actions.collapse")
            }
          >
            {isCollapsed ? <ChevronRight /> : <ChevronLeft />}
          </Button>
        </div>

        <ResizablePanel
          id="report-builder-right"
          order={2}
          defaultSize={75}
          collapsedSize={0}
          collapsible
          className="min-h-[calc(100vh-14rem)]"
        >
          {/* Results Display */}
          <ReportRenderer
            results={results || []}
            awaitingFirstRun={awaitingFirstRun}
            emptyPrompt={
              changesMissingBaseline
                ? tReports("requirementCoverage.baselineRequired")
                : undefined
            }
            chartData={allResults ?? undefined}
            reportType={reportType}
            dimensions={lastUsedDimensions}
            metrics={lastUsedMetrics}
            preGeneratedColumns={columns as ColumnDef<any>[]}
            projectId={projectId}
            mode={mode}
            projects={automationTrendsProjects}
            consecutiveRuns={lastUsedConsecutiveRuns}
            staleDaysThreshold={staleDaysThreshold}
            minExecutionsForRate={minExecutionsForRate}
            lookbackDays={lookbackDays}
            dateGrouping={lastUsedDateGrouping}
            totalFlakyTests={
              matchesReportType(reportType, "flaky-tests") && allResults
                ? allResults.length
                : undefined
            }
            loadedCount={loadedCount}
            totalCount={totalCount}
            hasMore={hasMore}
            isLoading={loadingMore}
            onLoadMore={handleLoadMore}
            onExportCsv={handleExportCsv}
            isExportingCsv={isExportingCsv}
            sortConfig={sortConfig}
            onSortChange={(columnId: string) => {
              setSortConfig((prev) => ({
                column: columnId,
                direction:
                  prev?.column === columnId && prev.direction === "asc"
                    ? "desc"
                    : "asc",
              }));
            }}
            // Explicit-direction sort from the header column menu; `null`
            // (Remove sort) restores the default order.
            onSortColumn={(column, direction) => {
              if (direction === null) {
                setSortConfig(null);
              } else {
                setSortConfig({ column, direction });
              }
            }}
            columnVisibility={columnVisibility}
            onColumnVisibilityChange={setColumnVisibility}
            grouping={grouping}
            onGroupingChange={setGrouping}
            expanded={expanded}
            onExpandedChange={setExpanded}
            reportSummary={
              typeof enhancedReportSummary === "string"
                ? enhancedReportSummary
                : (reportSummary ?? undefined)
            }
            reportGeneratedAt={reportGeneratedAt || undefined}
            userTimezone={session?.user?.preferences?.timezone}
            readOnly={false}
            headerActions={
              <ShareButton
                projectId={mode === "project" ? projectId : undefined}
                reportConfig={
                  matchesReportType(reportType, "iteration-matrix")
                    ? {
                        reportType,
                        projectId,
                        filters: matrixFilters,
                      }
                    : matchesReportType(reportType, "automation-candidates")
                      ? {
                          reportType,
                          projectId,
                          // Capture the snapshot the user is currently
                          // viewing — the preset mirrors selection to
                          // `?snapshotId=N` so the share resolves to
                          // that specific snapshot, not whichever one
                          // happens to be latest later.
                          ...(searchParams.get("snapshotId")
                            ? {
                                snapshotId: Number.parseInt(
                                  searchParams.get("snapshotId")!,
                                  10
                                ),
                              }
                            : {}),
                        }
                      : {
                          reportType,
                          // Use the last request body which contains ALL parameters
                          ...(lastRequestBody || {}),
                        }
                }
                reportTitle={
                  reportTypes.find((r) => r.id === reportType)?.label
                }
              />
            }
          />
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
      {gapGenerateRow && projectId != null && (
        <RequirementGapGenerateCases
          projectId={Number(projectId)}
          requirementId={gapGenerateRow.requirementId}
          requirementKey={gapGenerateRow.requirementKey}
          requirementTitle={
            gapGenerateRow.requirementTitle ?? gapGenerateRow.requirementKey
          }
          onClose={() => setGapGenerateRow(null)}
          onImportComplete={() => {
            // The imported cases are linked back to the requirement — re-run
            // the report so the closed gap leaves the list without a manual
            // re-run.
            void fetchReportData(lastUsedDimensions, lastUsedMetrics, false, {
              append: false,
              page: 1,
            });
          }}
        />
      )}
    </div>
  );
}

export function ReportBuilder(props: ReportBuilderProps) {
  return <ReportBuilderContent {...props} />;
}
