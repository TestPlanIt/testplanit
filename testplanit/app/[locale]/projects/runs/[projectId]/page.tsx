"use client";

import * as React from "react";
import { useEffect, useState, use, useMemo, useCallback } from "react";
import { useRequireAuth } from "~/hooks/useRequireAuth";
import { useRouter, usePathname } from "~/lib/navigation";
import { useSearchParams } from "next/navigation";
import {
  useFindFirstProjects,
  useFindManyTestRuns,
  useFindManyMilestones,
  useFindManyTestRunResults,
  useCreateTestRuns,
} from "~/lib/hooks";
import { useQuery } from "@tanstack/react-query";
import type { CompletedTestRunsResponse } from "~/app/api/test-runs/completed/route";
import TestRunDisplay from "./TestRunDisplay";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProjectIcon } from "@/components/ProjectIcon";
import AddTestRunModal from "./AddTestRunModal";
import { Button } from "@/components/ui/button";
import { CirclePlus, Maximize2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTranslations, useLocale } from "next-intl";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import { ApplicationArea } from "@prisma/client";
import SummarySunburstChart, {
  SunburstHierarchyNode,
  SunburstLegendItem,
} from "@/components/dataVisualizations/SummarySunburstChart";
import { toHumanReadable } from "~/utils/duration";
import RecentResultsDonut from "@/components/dataVisualizations/RecentResultsDonut";
import { DateFormatter } from "@/components/DateFormatter";
import CompletedRunsLineChart from "@/components/dataVisualizations/CompletedRunsLineChart";
import LoadingSpinner from "~/components/LoadingSpinner";
import TestResultsImportDialog from "@/components/TestResultsImportDialog";
import { isAutomatedTestRunType } from "~/utils/testResultTypes";
import DuplicateTestRunDialog, {
  AddTestRunModalInitProps,
} from "./DuplicateTestRunDialog";
import { Filter } from "@/components/tables/Filter";
import { PaginationInfo } from "@/components/tables/PaginationControls";
import { PaginationComponent } from "@/components/tables/Pagination";
import { useDebounce } from "@/components/Debounce";
import {
  PaginationProvider,
  usePagination,
} from "~/lib/contexts/PaginationContext";
import { useTabState } from "~/hooks/useTabState";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Loading } from "~/components/Loading";

interface ProjectTestRunsProps {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

interface ZoomedChartDetails {
  type: "sunburst" | "donut" | "line";
  data: any;
  title: string;
  projectId?: string;
  isZoomed?: boolean;
  onTestRunClick?: (testRunId: string) => void;
  onLegendDataGenerated?: (items: SunburstLegendItem[]) => void;
  onTotalCalculated?: (total: number) => void;
}

const ProjectTestRuns: React.FC<ProjectTestRunsProps> = ({ params }) => {
  const t = useTranslations("runs");
  const tCommon = useTranslations("common");
  const { projectId } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [isLoading, setIsLoading] = useState(true);
  const {
    session,
    isLoading: isAuthLoading,
    isAuthenticated,
  } = useRequireAuth();
  const locale = useLocale();

  // Tab State - persisted in URL
  const [activeTab, setActiveTab] = useTabState("tab", "active");

  // Pagination from context (URL-persisted and respects user preferences)
  const {
    currentPage: completedRunsPage,
    setCurrentPage: setCompletedRunsPage,
    pageSize: completedRunsPageSize,
    setPageSize: setCompletedRunsPageSize,
    setTotalItems,
    startIndex: completedRunsStartIndex,
    endIndex: completedRunsEndIndex,
    totalPages: totalCompletedRunsPages,
  } = usePagination();

  // Filter State for Completed Runs
  const [completedRunsSearchString, setCompletedRunsSearchString] =
    useState("");
  const debouncedCompletedRunsSearchString = useDebounce(
    completedRunsSearchString,
    500
  );

  // Test Run Type Filter State (for both Active and Completed tabs)
  type RunTypeFilter = "both" | "manual" | "automated";
  const [runTypeFilter, setRunTypeFilter] = useState<RunTypeFilter>("both");

  // Calculate pagination for completed runs
  const effectiveCompletedPageSize =
    typeof completedRunsPageSize === "number" ? completedRunsPageSize : 999999; // Large number for "All"
  const completedRunsSkip =
    (completedRunsPage - 1) * effectiveCompletedPageSize;

  // State for Sunburst Legend
  const [sunburstLegendItems, setSunburstLegendItems] = useState<
    SunburstLegendItem[]
  >([]);

  // New state for the total remaining estimate to be displayed below sunburst
  const [
    totalRemainingEstimateForDisplay,
    setTotalRemainingEstimateForDisplay,
  ] = useState<number>(0);

  // State for new recent results chart
  const [recentResultsChartData, setRecentResultsChartData] = useState<any[]>(
    []
  ); // Data for donut
  const [recentResultsSuccessRate, setRecentResultsSuccessRate] =
    useState<number>(0);
  const [recentResultsDateRange, setRecentResultsDateRange] = useState<{
    first?: Date;
    last?: Date;
  }>({});

  // State for new line chart
  const [completedRunsMonthlyData, setCompletedRunsMonthlyData] = useState<
    Array<{ month: string; count: number; manual: number; automated: number }>
  >([]);

  // State for chart overlay
  const [isChartDialogOpen, setIsChartDialogOpen] = useState(false);
  const [zoomedChartDetails, setZoomedChartDetails] =
    useState<ZoomedChartDetails | null>(null);

  // State for the existing AddTestRunModal (for new runs)
  const [isAddTestRunModalOpen, setIsAddTestRunModalOpen] = useState(false);
  const [modalSelectedTestCases, setModalSelectedTestCases] = useState<
    number[]
  >([]);

  // Debug: Log when modalSelectedTestCases changes
  useEffect(() => {
    // console.log("modalSelectedTestCases updated to:", modalSelectedTestCases);
  }, [modalSelectedTestCases]);

  // New handler for the main "Add Test Run" modal open state change
  const handleAddNewTestRunModalOpenChange = useCallback(
    (open: boolean) => {
      setIsAddTestRunModalOpen(open);
      if (!open) {
        // Clear URL params when closing this specific modal
        router.replace(pathname, { scroll: false });
        // Clear sessionStorage when modal closes
        sessionStorage.removeItem("createTestRun_selectedCases");
        // Clear selected test cases
        setModalSelectedTestCases([]);
      }
    },
    [router, setIsAddTestRunModalOpen, pathname]
  );

  // New state for DuplicateTestRunDialog and subsequent AddTestRunModal for duplication
  const [isDuplicateDialogOpen, setIsDuplicateDialogOpen] = useState(false);
  const [runDetailsForDuplicateDialog, setRunDetailsForDuplicateDialog] =
    useState<{
      testRunId: number;
      projectId: number; // Already available as numericProjectId
      testRunName: string;
    } | null>(null);
  const [isAddRunModalOpenForDuplicate, setIsAddRunModalOpenForDuplicate] =
    useState(false);
  const [
    addRunModalInitPropsForDuplicate,
    setAddRunModalInitPropsForDuplicate,
  ] = useState<AddTestRunModalInitProps | null>(null);

  // Callback for legend data from Sunburst chart - Memoized
  const handleLegendDataGenerated = useCallback(
    (items: SunburstLegendItem[]) => {
      // Prevent unnecessary state updates if items haven't actually changed
      // This is a shallow comparison, for deep comparison a library or custom logic would be needed
      // but for simple legend items (id, name, color strings) this might be sufficient.
      setSunburstLegendItems((currentItems) => {
        if (
          currentItems.length === items.length &&
          currentItems.every(
            (item, index) =>
              item.id === items[index].id &&
              item.name === items[index].name &&
              item.color === items[index].color
          )
        ) {
          return currentItems; // No change, return current state to avoid re-render
        }
        return items; // New items, update state
      });
    },
    [setSunburstLegendItems]
  ); // setSunburstLegendItems is stable

  // Callback for total calculated by Sunburst chart
  const handleSunburstTotalCalculated = useCallback(
    (totalValue: number) => {
      setTotalRemainingEstimateForDisplay(totalValue);
    },
    [setTotalRemainingEstimateForDisplay]
  );

  // Callback for Sunburst Test Run clicks
  const handleTestRunSunburstClick = useCallback(
    (testRunId: string) => {
      if (projectId && testRunId) {
        const href = `/projects/runs/${projectId}/${testRunId}`;
        router.push(href);
      } else {
        console.error("Missing projectId or testRunId for navigation", {
          projectId,
          testRunId,
        });
      }
    },
    [router, projectId]
  );

  const openAddRunParam = searchParams.get("openAddRun");

  useEffect(() => {
    const shouldOpenByUrl = openAddRunParam === "true";

    if (shouldOpenByUrl) {
      // Read selected cases from sessionStorage instead of URL to avoid length limits
      const storedCases = sessionStorage.getItem("createTestRun_selectedCases");
      // console.log("Reading from sessionStorage:", storedCases);
      const casesFromStorage = storedCases ? JSON.parse(storedCases) : [];

      // console.log("Parsed cases from storage:", casesFromStorage);
      setModalSelectedTestCases(casesFromStorage);

      // Don't clear sessionStorage here - clear it when modal closes to avoid fast refresh issues
    }

    // Open modal after setting the cases to ensure they're available
    setIsAddTestRunModalOpen(shouldOpenByUrl);
  }, [openAddRunParam]);

  const numericProjectId = useMemo(() => {
    const id = parseInt(projectId, 10);
    return isNaN(id) ? null : id;
  }, [projectId]);

  // Function to open the DuplicateTestRunDialog
  // This would be called from a UI element (e.g., a button in a TestRunItem context menu)
  const handleOpenDuplicateDialog = useCallback(
    (run: { id: number; name: string }) => {
      if (!numericProjectId) return;
      setRunDetailsForDuplicateDialog({
        testRunId: run.id,
        projectId: numericProjectId, // Use the existing numericProjectId
        testRunName: run.name,
      });
      setIsDuplicateDialogOpen(true);
    },
    [numericProjectId]
  );

  // Callback for DuplicateTestRunDialog to pass data and proceed to AddTestRunModal
  const handlePrepareCloneDataAndProceed = useCallback(
    (props: AddTestRunModalInitProps) => {
      setAddRunModalInitPropsForDuplicate(props);
      setIsAddRunModalOpenForDuplicate(true);
      setIsDuplicateDialogOpen(false);
      setRunDetailsForDuplicateDialog(null);
    },
    []
  );

  // Define the selection structure explicitly (incompleteTestRuns needs to be defined before donutChartData)
  const querySelect = {
    id: true,
    name: true,
    isCompleted: true,
    testRunType: true,
    completedAt: true,
    createdAt: true,
    note: true,
    docs: true,
    projectId: true,
    configId: true,
    configurationGroupId: true,
    milestoneId: true,
    stateId: true,
    forecastManual: true,
    forecastAutomated: true,
    configuration: true,
    milestone: {
      include: {
        milestoneType: {
          include: {
            icon: true,
          },
        },
        children: {
          include: {
            milestoneType: true,
          },
        },
      },
    },
    state: {
      include: {
        icon: true,
        color: true,
      },
    },
    createdBy: true,
    project: true,
    testCases: {
      select: {
        id: true,
        repositoryCaseId: true,
        assignedTo: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
        status: {
          select: {
            isCompleted: true,
          },
        },
        repositoryCase: {
          select: {
            estimate: true,
          },
        },
      },
    },
    tags: {
      select: {
        id: true,
        name: true,
      },
    },
    issues: {
      select: {
        id: true,
        name: true,
        externalId: true,
        externalUrl: true,
        title: true,
        externalStatus: true,
        issueTypeName: true,
        issueTypeIconUrl: true,
        integrationId: true,
        lastSyncedAt: true,
        integration: {
          select: {
            id: true,
            provider: true,
            name: true,
          },
        },
      },
    },
    results: {
      select: {
        id: true,
      },
    },
  };

  const {
    data: allIncompleteTestRuns,
    isLoading: isLoadingIncompleteRuns,
    refetch: refetchIncompleteTestRuns,
  } = useFindManyTestRuns({
    where: {
      AND: [
        { projectId: numericProjectId ?? undefined },
        { isCompleted: false },
        { isDeleted: false },
      ],
    },
    orderBy: [{ createdAt: "asc" }, { completedAt: "asc" }],
    select: querySelect,
  }) ?? { data: [], isLoading: false, refetch: () => {} };

  // Apply type filter to incomplete (active) runs
  const incompleteTestRuns = useMemo(() => {
    if (!allIncompleteTestRuns) return [];
    if (runTypeFilter === "both") return allIncompleteTestRuns;

    if (runTypeFilter === "manual") {
      return allIncompleteTestRuns.filter(
        (run) => !isAutomatedTestRunType(run.testRunType)
      );
    } else {
      // automated filter
      return allIncompleteTestRuns.filter((run) =>
        isAutomatedTestRunType(run.testRunType)
      );
    }
  }, [allIncompleteTestRuns, runTypeFilter]);

  // Prepare data for Sunburst Chart
  const sunburstChartData: SunburstHierarchyNode = useMemo(() => {
    const root: SunburstHierarchyNode = {
      id: "root",
      name: t("summary.allActiveRuns"),
      itemType: "root",
      children: [],
    };

    const activeRuns = incompleteTestRuns || [];

    root.children = activeRuns
      .map((run) => {
        let remainingEstimateForRun = 0;
        const pendingCasesForRun: Array<(typeof run.testCases)[0]> = [];
        run.testCases?.forEach((tc) => {
          if (!tc.status?.isCompleted) {
            remainingEstimateForRun += tc.repositoryCase?.estimate || 0;
            pendingCasesForRun.push(tc);
          }
        });

        if (remainingEstimateForRun === 0) {
          return null; // No pending estimate for this run, skip it
        }

        const runNode: SunburstHierarchyNode = {
          id: `run-${run.id}`,
          name: run.name,
          originalValue: remainingEstimateForRun,
          itemType: "testRun",
          children: [],
        };

        const assignedUsersToPending = new Map<
          string,
          { id: string; name: string; image: string | null }
        >();
        pendingCasesForRun.forEach((tc) => {
          if (tc.assignedTo) {
            assignedUsersToPending.set(tc.assignedTo.id, {
              id: tc.assignedTo.id,
              name: tc.assignedTo.name,
              image: tc.assignedTo.image,
            });
          }
        });

        const uniqueUsersArray = Array.from(assignedUsersToPending.values());

        if (uniqueUsersArray.length > 0) {
          const forecastPerUser =
            remainingEstimateForRun / uniqueUsersArray.length;
          runNode.children = uniqueUsersArray.map((user) => ({
            id: `user-${run.id}-${user.id}`,
            name: user.name,
            value: forecastPerUser,
            originalValue: forecastPerUser,
            itemType: "user",
            imageUrl: user.image ?? undefined,
          }));
        } else {
          runNode.value = remainingEstimateForRun; // Run itself is a leaf if no users on pending tasks
        }
        return runNode;
      })
      .filter(Boolean) as SunburstHierarchyNode[]; // Filter out nulls and assert type

    return root;
  }, [incompleteTestRuns, t]);

  const { permissions, isLoading: isLoadingPermissions } =
    useProjectPermissions(numericProjectId ?? -1, ApplicationArea.TestRuns);

  const { data: project, isLoading: isProjectLoading } = useFindFirstProjects(
    {
      where: {
        AND: [
          {
            isDeleted: false,
          },
          { id: numericProjectId ?? undefined },
        ],
      },
    },
    {
      enabled: isAuthenticated, // Only query when authenticated
      retry: 3,
      retryDelay: 1000,
    }
  );

  const createTestRun = useCreateTestRuns();

  const numNotStartedActiveTestRuns =
    incompleteTestRuns?.filter((run) => run.results?.length === 0).length || 0;

  // Updated: Calculate total estimated time remaining for the *first card* (stacked bar summary)
  // This sums estimates of individual PENDING repository cases across ALL active runs.
  const totalEstimatedTimeRemainingFirstCard = useMemo(() => {
    let total = 0;
    incompleteTestRuns?.forEach((run) => {
      run.testCases?.forEach((tc) => {
        if (!tc.status?.isCompleted) {
          total += tc.repositoryCase?.estimate || 0;
        }
      });
    });
    return total;
  }, [incompleteTestRuns]);

  const totalEstimatedTime =
    incompleteTestRuns?.reduce(
      (sum, run) => sum + (run.forecastManual || 0),
      0
    ) || 0;

  const responsibleUsers = new Set<string>();
  incompleteTestRuns?.forEach((run) => {
    run.testCases?.forEach((tc) => {
      if (tc.assignedTo?.name) {
        responsibleUsers.add(tc.assignedTo.name);
      }
    });
  });

  // Query for completed test runs with server-side pagination and filtering
  const {
    data: completedRunsData,
    isLoading: isLoadingCompletedRuns,
    refetch: refetchCompletedRuns,
  } = useQuery<CompletedTestRunsResponse | null>({
    queryKey: [
      "completedTestRuns",
      numericProjectId,
      completedRunsPage,
      effectiveCompletedPageSize,
      debouncedCompletedRunsSearchString,
      runTypeFilter,
    ],
    queryFn: async () => {
      if (!numericProjectId) return null;

      const params = new URLSearchParams({
        projectId: numericProjectId.toString(),
        page: completedRunsPage.toString(),
        pageSize: effectiveCompletedPageSize.toString(),
        search: debouncedCompletedRunsSearchString,
        runType: runTypeFilter,
      });

      const response = await fetch(`/api/test-runs/completed?${params}`);
      if (!response.ok) {
        throw new Error("Failed to fetch completed test runs");
      }
      return response.json();
    },
    enabled: !!numericProjectId && activeTab === "completed",
    staleTime: 30000, // Cache for 30 seconds
  });

  const completedTestRuns = completedRunsData?.runs || [];
  const totalCompletedRunsCount = completedRunsData?.totalCount || 0;

  // Update pagination context with total count
  useEffect(() => {
    setTotalItems(totalCompletedRunsCount);
  }, [totalCompletedRunsCount, setTotalItems]);

  // Reset to first page when search changes
  useEffect(() => {
    setCompletedRunsPage(1);
  }, [debouncedCompletedRunsSearchString, setCompletedRunsPage]);

  // Reset to first page when page size or run type filter changes
  useEffect(() => {
    setCompletedRunsPage(1);
  }, [completedRunsPageSize, runTypeFilter, setCompletedRunsPage]);

  const { data: milestones } = useFindManyMilestones({
    where: {
      projectId: numericProjectId ?? undefined,
      isDeleted: false,
    },
    include: {
      milestoneType: {
        include: {
          icon: true,
        },
      },
      children: {
        include: {
          milestoneType: {
            include: {
              icon: true,
            },
          },
        },
      },
    },
  });

  // --- Calculate Date Range for Completed Runs ---
  const sixMonthsAgo = useMemo(() => {
    const date = new Date();
    date.setMonth(date.getMonth() - 6);
    date.setDate(1); // Start from beginning of the month
    date.setHours(0, 0, 0, 0); // Start from midnight
    return date;
  }, []);

  // --- Fetch Completed Test Runs in the Last 6 Months ---
  const {
    data: completedRunsLast6Months,
    isLoading: isLoadingCompletedRunsData,
  } = useFindManyTestRuns({
    where: {
      projectId: numericProjectId ?? undefined,
      isCompleted: true,
      completedAt: { gte: sixMonthsAgo }, // Filter by date
    },
    select: {
      completedAt: true,
      testRunType: true, // Need type to separate manual vs automated
    },
    orderBy: { completedAt: "asc" }, // Order for easier processing
  }) ?? { data: [], isLoading: false };

  // --- Fetch Recent Test Run Results ---
  const { data: rawRecentResults, isLoading: isLoadingRecentResults } =
    useFindManyTestRunResults({
      where: {
        testRun: { projectId: numericProjectId ?? undefined },
        status: {
          systemName: { not: "untested" }, // Exclude untested results
        },
      },
      orderBy: { executedAt: "desc" },
      select: {
        id: true,
        executedAt: true,
        status: {
          select: {
            id: true,
            name: true,
            isSuccess: true,
            color: { select: { value: true } },
          },
        },
      },
    }) ?? { data: [], isLoading: false };

  // --- Process Recent Results ---
  useMemo(() => {
    if (!rawRecentResults || rawRecentResults.length === 0) {
      setRecentResultsChartData([]);
      setRecentResultsSuccessRate(0);
      setRecentResultsDateRange({});
      return;
    }

    // Find the latest date from the fetched set
    const latestDate = new Date(rawRecentResults[0].executedAt);
    const sevenDaysInMillis = 7 * 24 * 60 * 60 * 1000;
    const startDate = new Date(latestDate.getTime() - sevenDaysInMillis);

    // Filter results within the date range
    const filteredResults = rawRecentResults.filter((result) => {
      const executedDate = new Date(result.executedAt);
      return executedDate >= startDate && executedDate <= latestDate;
    });

    if (filteredResults.length === 0) {
      setRecentResultsChartData([]);
      setRecentResultsSuccessRate(0);
      setRecentResultsDateRange({});
      return;
    }

    // Group by status and calculate metrics
    const statusSummary: {
      [key: string]: {
        id: number;
        name: string;
        color: string;
        isSuccess: boolean;
        count: number;
        value: number;
      };
    } = {};
    let successfulCount = 0;
    let firstResultDate: Date | undefined = undefined;
    let lastResultDate: Date | undefined = undefined;

    filteredResults.forEach((result) => {
      const status = result.status;
      if (!status) return; // Skip results without status

      const executedAtDate = new Date(result.executedAt);
      if (!firstResultDate || executedAtDate < firstResultDate) {
        firstResultDate = executedAtDate;
      }
      if (!lastResultDate || executedAtDate > lastResultDate) {
        lastResultDate = executedAtDate;
      }

      const statusId = status.id;
      if (!statusSummary[statusId]) {
        statusSummary[statusId] = {
          id: statusId,
          name: status.name,
          color: status.color?.value || "#888888", // Default color if none
          isSuccess: status.isSuccess || false,
          count: 0,
          value: 0, // value for chart is count
        };
      }
      statusSummary[statusId].count++;
      statusSummary[statusId].value++; // Use count as the value for the donut chart
      if (status.isSuccess) {
        successfulCount++;
      }
    });

    const chartData = Object.values(statusSummary);
    const totalDisplayed = filteredResults.length;
    const successRate =
      totalDisplayed > 0 ? (successfulCount / totalDisplayed) * 100 : 0;

    setRecentResultsChartData(chartData);
    setRecentResultsSuccessRate(successRate);
    setRecentResultsDateRange({ first: firstResultDate, last: lastResultDate });
  }, [rawRecentResults]);

  // --- Process Completed Runs for Line Chart ---
  useMemo(() => {
    const monthCounts: {
      [key: string]: {
        total: number;
        manual: number;
        automated: number;
      };
    } = {};

    // Count runs per month, separated by type
    completedRunsLast6Months?.forEach((run) => {
      if (run.completedAt) {
        const date = new Date(run.completedAt);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`; // Format YYYY-MM

        if (!monthCounts[monthKey]) {
          monthCounts[monthKey] = { total: 0, manual: 0, automated: 0 };
        }

        monthCounts[monthKey].total++;

        if (isAutomatedTestRunType(run.testRunType)) {
          monthCounts[monthKey].automated++;
        } else {
          monthCounts[monthKey].manual++;
        }
      }
    });

    // Generate month keys for the last 6 months
    const monthsData: Array<{
      month: string;
      count: number;
      manual: number;
      automated: number;
    }> = [];
    const today = new Date();
    for (let i = 0; i < 6; i++) {
      const targetDate = new Date(today);
      targetDate.setMonth(today.getMonth() - i);
      const monthKey = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, "0")}`;
      const counts = monthCounts[monthKey] || {
        total: 0,
        manual: 0,
        automated: 0,
      };
      monthsData.push({
        month: monthKey,
        count: counts.total,
        manual: counts.manual,
        automated: counts.automated,
      });
    }

    // Reverse to chronological order
    setCompletedRunsMonthlyData(monthsData.reverse());
  }, [completedRunsLast6Months]);

  const handleOpenChartOverlay = (details: ZoomedChartDetails) => {
    setZoomedChartDetails(details);
    setIsChartDialogOpen(true);
  };

  const handleDialogCloseOrOpenChange = (open: boolean) => {
    setIsChartDialogOpen(open);
    if (!open) {
      setZoomedChartDetails(null);
    }
  };

  useEffect(() => {
    // Don't make routing decisions until session is loaded
    if (isAuthLoading) {
      return;
    }

    if (
      numericProjectId !== null &&
      !isProjectLoading &&
      !isLoadingPermissions &&
      !isLoadingIncompleteRuns &&
      !isLoadingCompletedRuns
    ) {
      if (project) {
        setIsLoading(false);
      } else if (isAuthenticated) {
        // Only redirect if we're sure the user is authenticated but doesn't have access
        router.push("/404");
      }
    } else if (numericProjectId === null) {
      router.push("/404");
    }
  }, [
    numericProjectId,
    project,
    isProjectLoading,
    isLoadingPermissions,
    isLoadingIncompleteRuns,
    isLoadingCompletedRuns,
    router,
    isAuthLoading,
    isAuthenticated,
  ]);

  // Wait for ALL data to load before making any decisions
  if (isAuthLoading || isLoading || isProjectLoading || isLoadingPermissions) {
    return <Loading />;
  }

  // NOW we can check if project exists - after everything is loaded
  if (!project) {
    return (
      <Card className="flex flex-col w-full min-w-[400px] h-full">
        <CardContent className="flex flex-col items-center justify-center h-full">
          <h2 className="text-2xl font-semibold mb-2">
            {tCommon("errors.projectNotFound")}
          </h2>
          <p className="text-muted-foreground">
            {tCommon("errors.projectNotFoundDescription")}
          </p>
        </CardContent>
      </Card>
    );
  }

  // Combine loading states
  const isSummaryLoading =
    isLoading ||
    isLoadingIncompleteRuns ||
    isLoadingRecentResults ||
    isLoadingPermissions ||
    isProjectLoading ||
    isLoadingCompletedRunsData;

  // Early returns for loading or missing project
  if (isSummaryLoading) {
    return <LoadingSpinner />;
  }

  if (session && session.user.access !== "NONE") {
    const canAddEdit = permissions?.canAddEdit ?? false;

    return (
      <>
        <Card className="flex w-full min-w-[400px]">
          <div className="flex-1 w-full">
            <CardHeader id="test-runs-page-header">
              <CardTitle>
                <div className="flex items-center justify-between text-primary text-xl md:text-2xl">
                  <div>
                    <CardTitle>{t("title")}</CardTitle>
                  </div>
                  <div>
                    {canAddEdit && (
                      <div className="flex flex-row gap-2">
                        <TestResultsImportDialog
                          projectId={parseInt(projectId)}
                          onSuccess={() => {
                            router.refresh();
                            refetchIncompleteTestRuns();
                          }}
                        />
                        <AddTestRunModal
                          trigger={
                            <Button
                              type="button"
                              variant="default"
                              data-testid="new-run-button"
                            >
                              <CirclePlus className="h-4 w-4" />
                              <span className="hidden md:inline">
                                {t("add.title")}
                              </span>
                            </Button>
                          }
                          open={isAddTestRunModalOpen}
                          onOpenChange={handleAddNewTestRunModalOpenChange}
                          initialSelectedCaseIds={modalSelectedTestCases}
                          onSelectedCasesChange={setModalSelectedTestCases}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </CardTitle>
              <CardDescription className="uppercase">
                <span className="flex items-center gap-2 uppercase shrink-0">
                  <ProjectIcon iconUrl={project?.iconUrl} />
                  {project?.name}
                </span>
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col">
              {/* Summary Metrics Display */}
              <div className="mb-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* Card 1: Work Distribution - Conditional Render */}
                {(isLoadingIncompleteRuns ||
                  (sunburstChartData.children &&
                    sunburstChartData.children.length > 0)) && (
                  <Card>
                    <CardHeader className="pb-2 flex flex-row items-start justify-between">
                      <div>
                        <CardTitle className="font-medium">
                          {t("summary.workDistribution")}
                        </CardTitle>
                        <CardDescription>
                          <div className="flex flex-row gap-1">
                            <p>{t("summary.totalEstTimeRemainingSunburst")}</p>
                            <p>
                              {toHumanReadable(
                                totalRemainingEstimateForDisplay,
                                {
                                  isSeconds: true,
                                  locale,
                                }
                              )}
                            </p>
                          </div>
                        </CardDescription>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() =>
                          handleOpenChartOverlay({
                            type: "sunburst",
                            title: t("summary.workDistribution"),
                            data: sunburstChartData,
                            projectId: projectId,
                            onLegendDataGenerated: handleLegendDataGenerated,
                            onTotalCalculated: handleSunburstTotalCalculated,
                            onTestRunClick: handleTestRunSunburstClick,
                          })
                        }
                      >
                        <Maximize2 className="h-4 w-4" />
                        <span className="sr-only">
                          {tCommon("actions.expand")}
                        </span>
                      </Button>
                    </CardHeader>
                    <CardContent>
                      {isLoadingIncompleteRuns ? (
                        <LoadingSpinner />
                      ) : sunburstChartData.children &&
                        sunburstChartData.children.length > 0 ? (
                        <SummarySunburstChart
                          data={sunburstChartData}
                          projectId={projectId}
                          onLegendDataGenerated={handleLegendDataGenerated}
                          onTotalCalculated={handleSunburstTotalCalculated}
                          onTestRunClick={handleTestRunSunburstClick}
                        />
                      ) : (
                        <p className="text-sm text-muted-foreground text-center w-full h-[210px] flex items-center justify-center">
                          {t("summary.noForecastData")}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Card 2: Recent Results - Conditional Render */}
                {(isLoadingRecentResults ||
                  recentResultsChartData.length > 0) && (
                  <Card>
                    <CardHeader className="pb-2 flex flex-row items-start justify-between">
                      <div className="w-full">
                        <CardTitle className="font-medium">
                          {t("summary.recentResultsTitle")}
                        </CardTitle>
                        <CardDescription>
                          {!isLoadingRecentResults &&
                            recentResultsDateRange.first &&
                            recentResultsDateRange.last && (
                              <span>
                                <DateFormatter
                                  date={recentResultsDateRange.first}
                                  formatString={
                                    session?.user.preferences?.dateFormat +
                                    " " +
                                    session?.user.preferences?.timeFormat
                                  }
                                  timezone={session?.user.preferences?.timezone}
                                />
                                {" – "}
                                <DateFormatter
                                  date={recentResultsDateRange.last}
                                  formatString={
                                    session?.user.preferences?.dateFormat +
                                    " " +
                                    session?.user.preferences?.timeFormat
                                  }
                                  timezone={session?.user.preferences?.timezone}
                                />
                              </span>
                            )}
                        </CardDescription>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() =>
                          handleOpenChartOverlay({
                            type: "donut",
                            title: t("summary.recentResultsTitle"),
                            data: recentResultsChartData,
                          })
                        }
                      >
                        <Maximize2 className="h-4 w-4" />
                        <span className="sr-only">
                          {tCommon("actions.expand")}
                        </span>
                      </Button>
                    </CardHeader>
                    <CardContent className="flex justify-center items-center p-2">
                      {isLoadingRecentResults ? (
                        <LoadingSpinner />
                      ) : recentResultsChartData.length > 0 ? (
                        <RecentResultsDonut data={recentResultsChartData} />
                      ) : (
                        <p className="text-sm text-muted-foreground text-center px-4 h-[210px] flex items-center justify-center">
                          {t("summary.noRecentResults")}
                        </p>
                      )}
                    </CardContent>
                    <CardFooter className="flex flex-row items-center justify-center">
                      {!isLoadingRecentResults &&
                        recentResultsChartData.length > 0 && (
                          <span className="font-semibold">{`${recentResultsSuccessRate.toFixed(1)}% ${tCommon("labels.successRate")}`}</span>
                        )}
                    </CardFooter>
                  </Card>
                )}

                {/* Card 3: Completion Trend - Conditional Render Updated Check */}
                {(isLoadingCompletedRunsData ||
                  completedRunsMonthlyData.some(
                    (monthData) => monthData.count > 0
                  )) && (
                  <Card>
                    <CardHeader className="pb-2 flex flex-row items-start justify-between">
                      <div>
                        <CardTitle className="font-medium">
                          {t("summary.completionTrendTitle")}
                        </CardTitle>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() =>
                          handleOpenChartOverlay({
                            type: "line",
                            title: t("summary.completionTrendTitle"),
                            data: completedRunsMonthlyData,
                          })
                        }
                      >
                        <Maximize2 className="h-4 w-4" />
                        <span className="sr-only">
                          {tCommon("actions.expand")}
                        </span>
                      </Button>
                    </CardHeader>
                    <CardContent className="p-2">
                      {isLoadingCompletedRunsData ? (
                        <LoadingSpinner />
                      ) : completedRunsMonthlyData.some(
                          (monthData) => monthData.count > 0
                        ) ? (
                        <CompletedRunsLineChart
                          data={completedRunsMonthlyData}
                        />
                      ) : (
                        <p className="text-sm text-muted-foreground text-center px-4 h-[210px] flex items-center justify-center">
                          {t("summary.noCompletedRuns")}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                )}
              </div>

              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="w-full">
                  <TabsTrigger value="active" className="w-1/2">
                    {tCommon("status.active")}
                  </TabsTrigger>
                  <TabsTrigger value="completed" className="w-1/2">
                    {tCommon("status.completed")}
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="active">
                  <div className="flex flex-col">
                    {/* Test Run Type Filter */}
                    <div className="mb-4 flex flex-row items-center gap-2">
                      <span className="text-sm text-muted-foreground">
                        {t("typeFilter.label")}:
                      </span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm">
                            {runTypeFilter === "both"
                              ? t("typeFilter.both")
                              : runTypeFilter === "manual"
                                ? t("typeFilter.manual")
                                : t("typeFilter.automated")}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          <DropdownMenuLabel>
                            {t("typeFilter.label")}
                          </DropdownMenuLabel>
                          <DropdownMenuGroup>
                            <DropdownMenuItem
                              onClick={() => setRunTypeFilter("both")}
                            >
                              {t("typeFilter.both")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setRunTypeFilter("manual")}
                            >
                              {t("typeFilter.manual")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setRunTypeFilter("automated")}
                            >
                              {t("typeFilter.automated")}
                            </DropdownMenuItem>
                          </DropdownMenuGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    {incompleteTestRuns?.length === 0 ? (
                      <div className="mt-4 flex flex-col items-center justify-center gap-4">
                        <p className="text-center text-muted-foreground">
                          {tCommon("messages.emptyActive")}
                        </p>
                        {canAddEdit && (
                          <AddTestRunModal
                            trigger={
                              <Button variant="default">
                                <CirclePlus className="h-4 w-4" />
                                <span className="hidden md:inline">
                                  {t("add.title")}
                                </span>
                              </Button>
                            }
                            open={isAddTestRunModalOpen}
                            onOpenChange={handleAddNewTestRunModalOpenChange}
                            initialSelectedCaseIds={modalSelectedTestCases}
                            onSelectedCasesChange={setModalSelectedTestCases}
                          />
                        )}
                      </div>
                    ) : (
                      <TestRunDisplay
                        testRuns={incompleteTestRuns || []}
                        milestones={milestones || []}
                        onDuplicateTestRun={handleOpenDuplicateDialog}
                      />
                    )}
                  </div>
                </TabsContent>
                <TabsContent value="completed">
                  <div className="flex flex-col">
                    {/* Test Run Type Filter */}
                    <div className="mb-4 flex flex-row items-center gap-2">
                      <span className="text-sm text-muted-foreground">
                        {t("typeFilter.label")}:
                      </span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm">
                            {runTypeFilter === "both"
                              ? t("typeFilter.both")
                              : runTypeFilter === "manual"
                                ? t("typeFilter.manual")
                                : t("typeFilter.automated")}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          <DropdownMenuLabel>
                            {t("typeFilter.label")}
                          </DropdownMenuLabel>
                          <DropdownMenuGroup>
                            <DropdownMenuItem
                              onClick={() => setRunTypeFilter("both")}
                            >
                              {t("typeFilter.both")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setRunTypeFilter("manual")}
                            >
                              {t("typeFilter.manual")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setRunTypeFilter("automated")}
                            >
                              {t("typeFilter.automated")}
                            </DropdownMenuItem>
                          </DropdownMenuGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    {/* Filter and Pagination Controls */}
                    <div className="flex flex-row items-start mb-4">
                      <div className="flex flex-col grow w-full sm:w-1/3 min-w-[150px]">
                        <Filter
                          key="completed-runs-filter"
                          placeholder={t("filter.placeholder")}
                          initialSearchString={completedRunsSearchString}
                          onSearchChange={setCompletedRunsSearchString}
                        />
                      </div>
                      <div className="flex flex-col w-full sm:w-2/3 items-end">
                        {totalCompletedRunsCount > 0 && (
                          <>
                            <div className="justify-end">
                              <PaginationInfo
                                key="completed-runs-pagination-info"
                                startIndex={completedRunsStartIndex}
                                endIndex={completedRunsEndIndex}
                                totalRows={totalCompletedRunsCount}
                                searchString={completedRunsSearchString}
                                pageSize={
                                  typeof completedRunsPageSize === "number"
                                    ? completedRunsPageSize
                                    : "All"
                                }
                                pageSizeOptions={[10, 25, 50, 100, "All"]}
                                handlePageSizeChange={(size) =>
                                  setCompletedRunsPageSize(size)
                                }
                              />
                            </div>
                            <div className="justify-end -mx-4">
                              <PaginationComponent
                                currentPage={completedRunsPage}
                                totalPages={totalCompletedRunsPages}
                                onPageChange={setCompletedRunsPage}
                              />
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                    {/* Test Runs Display */}
                    {completedTestRuns?.length === 0 ? (
                      <div className="mt-4 text-center text-muted-foreground">
                        {completedRunsSearchString
                          ? t("empty.noMatchingCompleted")
                          : tCommon("messages.emptyCompleted")}
                      </div>
                    ) : (
                      <TestRunDisplay
                        testRuns={(completedTestRuns as any) || []}
                        milestones={(milestones as any) || []}
                        onDuplicateTestRun={handleOpenDuplicateDialog}
                      />
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </div>
        </Card>

        <Dialog
          open={isChartDialogOpen}
          onOpenChange={handleDialogCloseOrOpenChange}
        >
          <DialogContent className="max-w-[80vw] h-[80vh] flex flex-col p-0 sm:p-6">
            <DialogHeader className="px-4 pt-4 sm:px-0 sm:pt-0">
              <DialogTitle>
                {zoomedChartDetails
                  ? zoomedChartDetails.title
                  : t("summary.completionTrendTitle")}
              </DialogTitle>
              <DialogDescription className="sr-only">
                {zoomedChartDetails
                  ? zoomedChartDetails.title
                  : t("summary.completionTrendTitle")}
              </DialogDescription>
            </DialogHeader>
            {zoomedChartDetails && (
              <>
                <div className="flex-1 overflow-hidden p-4 sm:p-0">
                  <div className="w-full h-full">
                    {zoomedChartDetails.type === "sunburst" && (
                      <SummarySunburstChart
                        data={zoomedChartDetails.data}
                        projectId={zoomedChartDetails.projectId!}
                        onLegendDataGenerated={
                          zoomedChartDetails.onLegendDataGenerated
                        }
                        onTotalCalculated={zoomedChartDetails.onTotalCalculated}
                        onTestRunClick={zoomedChartDetails.onTestRunClick}
                        isZoomed={true}
                      />
                    )}
                    {zoomedChartDetails.type === "donut" && (
                      <RecentResultsDonut data={zoomedChartDetails.data} />
                    )}
                    {zoomedChartDetails.type === "line" && (
                      <CompletedRunsLineChart data={zoomedChartDetails.data} />
                    )}
                  </div>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>

        {/* Render DuplicateTestRunDialog */}
        {isDuplicateDialogOpen &&
          runDetailsForDuplicateDialog &&
          numericProjectId && (
            <DuplicateTestRunDialog
              open={isDuplicateDialogOpen}
              onOpenChange={setIsDuplicateDialogOpen} // Standard close handler
              testRunId={runDetailsForDuplicateDialog.testRunId}
              testRunName={runDetailsForDuplicateDialog.testRunName}
              onPrepareCloneDataAndProceed={handlePrepareCloneDataAndProceed}
            />
          )}

        {/* Render AddTestRunModal for Duplication */}
        {isAddRunModalOpenForDuplicate && addRunModalInitPropsForDuplicate && (
          <AddTestRunModal
            open={isAddRunModalOpenForDuplicate}
            onOpenChange={(open) => {
              setIsAddRunModalOpenForDuplicate(open);
              if (!open) {
                setAddRunModalInitPropsForDuplicate(null); // Clear duplication specific props
              }
            }}
            initialSelectedCaseIds={
              addRunModalInitPropsForDuplicate.initialSelectedCaseIds
            }
            onSelectedCasesChange={(cases) => {
              // If needed, update the props for duplication, though typically static after init
              setAddRunModalInitPropsForDuplicate((prev) =>
                prev ? { ...prev, initialSelectedCaseIds: cases } : null
              );
            }}
            duplicationPreset={
              addRunModalInitPropsForDuplicate.duplicationPreset
            }
            defaultMilestoneId={
              addRunModalInitPropsForDuplicate.defaultMilestoneId
            }
          />
        )}

        {/* Existing AddTestRunModal for creating new runs */}
        {isAddTestRunModalOpen && (
          <AddTestRunModal
            open={isAddTestRunModalOpen}
            onOpenChange={handleAddNewTestRunModalOpenChange}
            initialSelectedCaseIds={modalSelectedTestCases}
            onSelectedCasesChange={setModalSelectedTestCases}
          />
        )}
      </>
    );
  }

  return null;
};

// Wrapper component to provide pagination context
export default function ProjectTestRunsPage(props: ProjectTestRunsProps) {
  return (
    <PaginationProvider defaultPageSize={25}>
      <ProjectTestRuns
        params={props.params}
        searchParams={props.searchParams}
      />
    </PaginationProvider>
  );
}
