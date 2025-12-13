"use client";

import * as React from "react";
import { useEffect, useState, use, useMemo, useCallback } from "react";
import { useRequireAuth } from "~/hooks/useRequireAuth";
import { useRouter } from "~/lib/navigation";
import {
  useFindFirstProjects,
  useFindManySessions,
  useFindManyMilestones,
  useFindManySessionResults,
} from "~/lib/hooks";
import { useQueryClient } from "@tanstack/react-query";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import { useTabState } from "~/hooks/useTabState";
import SessionDisplay from "./SessionDisplay";
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
import { AddSessionModal } from "./AddSessionModal";
import { Button } from "@/components/ui/button";
import { CirclePlus, Maximize2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { ApplicationArea } from "@prisma/client";
import { Filter } from "@/components/tables/Filter";
import { PaginationInfo } from "@/components/tables/PaginationControls";
import { PaginationComponent } from "@/components/tables/Pagination";
import { useDebounce } from "@/components/Debounce";
import {
  PaginationProvider,
  usePagination,
} from "~/lib/contexts/PaginationContext";

import RecentResultsDonut, {
  type RecentResultStatusItem,
} from "@/components/dataVisualizations/RecentResultsDonut";
import CompletedRunsLineChart, {
  type MonthlyCount,
} from "@/components/dataVisualizations/CompletedRunsLineChart";
import SummarySunburstChart, {
  type SunburstHierarchyNode,
  type SunburstLegendItem,
} from "@/components/dataVisualizations/SummarySunburstChart";
import { DateFormatter } from "@/components/DateFormatter";
import LoadingSpinner from "~/components/LoadingSpinner";
import { toHumanReadable } from "~/utils/duration";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ProjectSessionsProps {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

// Interface for Zoomed Chart Details (adapted for Sessions page)
interface ZoomedChartDetails {
  type: "sunburst" | "donut" | "line";
  data: any;
  title: string;
  projectId?: string;
  isZoomed?: boolean;
  // Sunburst specific for Sessions page
  onSessionClick?: (sessionId: string) => void;
  onLegendDataGenerated?: (items: SunburstLegendItem[]) => void;
  onTotalCalculated?: (total: number) => void;
  // Add other chart-specific props as needed
}

const ProjectSessions: React.FC<ProjectSessionsProps> = ({ params }) => {
  const t = useTranslations();
  const tCommon = useTranslations("common");
  const { projectId } = use(params);

  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const {
    session: sessionData,
    isLoading: isAuthLoading,
    isAuthenticated,
  } = useRequireAuth();

  // Tab State - persisted in URL
  const [activeTab, setActiveTab] = useTabState("tab", "active");
  const queryClient = useQueryClient();

  // Dialog State
  const [isChartDialogOpen, setIsChartDialogOpen] = useState(false);
  const [zoomedChartDetails, setZoomedChartDetails] =
    useState<ZoomedChartDetails | null>(null);

  // Pagination from context (URL-persisted and respects user preferences)
  const {
    currentPage: completedSessionsPage,
    setCurrentPage: setCompletedSessionsPage,
    pageSize: completedSessionsPageSize,
    setPageSize: setCompletedSessionsPageSize,
    setTotalItems,
    startIndex: completedSessionsStartIndex,
    endIndex: completedSessionsEndIndex,
    totalPages: totalCompletedSessionsPages,
  } = usePagination();

  // Filter State for Completed Sessions
  const [completedSessionsSearchString, setCompletedSessionsSearchString] =
    useState("");
  const debouncedCompletedSessionsSearchString = useDebounce(
    completedSessionsSearchString,
    500
  );

  // Calculate pagination for completed sessions
  const effectiveCompletedPageSize =
    typeof completedSessionsPageSize === "number"
      ? completedSessionsPageSize
      : 999999; // Large number for "All"
  const completedSessionsSkip =
    (completedSessionsPage - 1) * effectiveCompletedPageSize;

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

  const numericProjectId = useMemo(() => {
    const id = parseInt(projectId, 10);
    return isNaN(id) ? null : id;
  }, [projectId]);

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
      enabled: isAuthenticated, // Only query when session is authenticated
      retry: 3, // Retry a few times in case of race conditions
      retryDelay: 1000, // Wait 1 second between retries
    }
  );

  const { permissions, isLoading: isLoadingPermissions } =
    useProjectPermissions(numericProjectId ?? -1, ApplicationArea.Sessions);
  const canAddEditSession = permissions?.canAddEdit ?? false;
  const canCloseSession = permissions?.canClose ?? false;
  const isSuperAdmin = sessionData?.user?.access === "ADMIN";

  const showAddButtonPerm = canAddEditSession || isSuperAdmin;
  const showCompleteOptionPerm = canCloseSession || isSuperAdmin;

  const queryInclude = {
    template: true,
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
    assignedTo: true,
    createdBy: true,
    project: true,
  };

  const {
    data: incompleteSessions,
    isLoading: isLoadingIncomplete,
    refetch: refetchIncompleteSessions,
  } = useFindManySessions(
    {
      where: {
        AND: [
          { projectId: numericProjectId ?? undefined },
          { isCompleted: false },
          { isDeleted: false },
        ],
      },
      orderBy: [{ createdAt: "asc" }, { completedAt: "asc" }],
      include: queryInclude,
    },
    {
      refetchInterval: activeTab === "active" ? 30000 : false, // Refetch every 30s when on active tab
    }
  ) ?? { data: [], isLoading: false, refetch: () => {} };

  // Query for ALL completed sessions (used ONLY for summary cards and initial data)
  // This query runs once and is never affected by filtering
  const {
    data: allCompletedSessions,
    isLoading: isLoadingAllCompleted,
    refetch: refetchCompletedSessions,
  } = useFindManySessions(
    {
      where: {
        AND: [
          { projectId: numericProjectId ?? undefined },
          { isCompleted: true },
          { isDeleted: false },
        ],
      },
      orderBy: [{ completedAt: "desc" }],
      include: queryInclude,
    },
    {
      refetchInterval: activeTab === "completed" ? 30000 : false, // Refetch every 30s when on completed tab
    }
  ) ?? { data: [], isLoading: false, refetch: () => {} };

  // Optimized query ONLY for completion trend chart (last 6 months)
  // Only fetches completedAt field to minimize data transfer
  const sixMonthsAgo = useMemo(() => {
    const date = new Date();
    date.setMonth(date.getMonth() - 6);
    date.setDate(1);
    date.setHours(0, 0, 0, 0);
    return date;
  }, []);

  const { data: completedSessionsForChart, isLoading: isLoadingChartData } =
    useFindManySessions({
      where: {
        AND: [
          { projectId: numericProjectId ?? undefined },
          { isCompleted: true },
          { isDeleted: false },
          { completedAt: { gte: sixMonthsAgo } },
        ],
      },
      select: {
        id: true,
        completedAt: true,
      },
    }) ?? { data: [], isLoading: false };

  // Determine if we need to filter
  const hasFilter = debouncedCompletedSessionsSearchString.trim().length > 0;

  // Client-side filtering when filter is active (avoids extra query on every keystroke)
  const filteredData = useMemo(() => {
    if (!hasFilter || !allCompletedSessions) {
      return allCompletedSessions || [];
    }
    const searchLower = debouncedCompletedSessionsSearchString.toLowerCase();
    return allCompletedSessions.filter((session) =>
      session.name.toLowerCase().includes(searchLower)
    );
  }, [allCompletedSessions, debouncedCompletedSessionsSearchString, hasFilter]);

  // Pagination on filtered data
  const totalCompletedSessionsCount = filteredData.length;
  const completedSessions = filteredData.slice(
    completedSessionsSkip,
    completedSessionsSkip + effectiveCompletedPageSize
  );

  // Update pagination context with total count
  useEffect(() => {
    setTotalItems(totalCompletedSessionsCount);
  }, [totalCompletedSessionsCount, setTotalItems]);

  // Use the all completed sessions loading state for summary cards
  const isLoadingCompleted = isLoadingAllCompleted;

  // Handle tab change with query invalidation
  const handleTabChange = useCallback(
    (newTab: string) => {
      setActiveTab(newTab);
      if (newTab === "completed") {
        // Refetch completed sessions when switching to completed tab
        refetchCompletedSessions();
      } else if (newTab === "active") {
        // Refetch active sessions when switching to active tab
        refetchIncompleteSessions();
      }
    },
    [setActiveTab, refetchCompletedSessions, refetchIncompleteSessions]
  );

  const { data: milestones, isLoading: isLoadingMilestones } =
    useFindManyMilestones({
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

  // Reset to first page when search changes
  useEffect(() => {
    setCompletedSessionsPage(1);
  }, [debouncedCompletedSessionsSearchString, setCompletedSessionsPage]);

  // Reset to first page when page size changes
  useEffect(() => {
    setCompletedSessionsPage(1);
  }, [completedSessionsPageSize, setCompletedSessionsPage]);

  useEffect(() => {
    const isDataLoading =
      isAuthLoading ||
      isProjectLoading ||
      isLoadingPermissions ||
      isLoadingIncomplete ||
      isLoadingCompleted ||
      isLoadingMilestones;

    setIsLoading(isDataLoading);

    // Don't make routing decisions until session is loaded
    if (isAuthLoading) {
      return;
    }

    // Only redirect to 404 if we're sure the user doesn't have access
    if (
      !isDataLoading &&
      numericProjectId !== null &&
      !project &&
      isAuthenticated
    ) {
      router.push("/404");
    }
    if (numericProjectId === null) {
      router.push("/404");
    }
  }, [
    isAuthLoading,
    isAuthenticated,
    isProjectLoading,
    isLoadingPermissions,
    isLoadingIncomplete,
    isLoadingCompleted,
    isLoadingMilestones,
    project,
    numericProjectId,
    router,
  ]);

  const transformedMilestones =
    milestones?.map((milestone) => ({
      ...milestone,
      children: milestone.children.map((child) => ({
        ...child,
        children: [],
      })),
    })) || [];

  // --- Data for Work Distribution Sunburst Chart (Replaces Session States) ---
  const [sunburstLegendData, setSunburstLegendData] = useState<
    SunburstLegendItem[]
  >([]);
  const [totalSunburstEstimate, setTotalSunburstEstimate] = useState(0);

  const workDistributionChartData = useMemo(() => {
    if (!incompleteSessions || incompleteSessions.length === 0) {
      return {
        name: t("sessions.summary.noWorkDistributionData", {
          defaultValue:
            "No active sessions with assignees or estimates to display.",
        }),
        id: "root-empty-work-distribution",
        itemType: "root",
        children: [],
      } as SunburstHierarchyNode;
    }

    const filteredSessions = incompleteSessions.filter(
      (s) => s.estimate && s.estimate > 0
    );
    if (filteredSessions.length === 0) {
      return {
        name: t("sessions.summary.noWorkDistributionData", {
          defaultValue:
            "No active sessions with assignees or estimates to display.",
        }),
        id: "root-empty-filtered-work-distribution",
        itemType: "root",
        children: [],
      } as SunburstHierarchyNode;
    }

    const rootNode: SunburstHierarchyNode = {
      name: t("sessions.title", { count: filteredSessions.length }),
      id: "root-sessions-work-distribution",
      itemType: "root",
      children: [],
      // value will be calculated by D3's .sum()
    };

    filteredSessions.forEach((session) => {
      // We've already filtered, so session.estimate is guaranteed to be > 0
      const currentSessionEstimate = session.estimate as number;

      const sessionNodeChildren: SunburstHierarchyNode[] = [];
      let valueForSessionNodeItself: number | undefined = undefined;

      if (session.assignedTo && session.assignedTo.id) {
        const assigneeName =
          session.assignedTo.name ||
          t("sessions.placeholders.unassigned", { defaultValue: "Unassigned" });
        const assigneeId = `user-${session.assignedTo.id}`;

        sessionNodeChildren.push({
          name: assigneeName,
          id: `session-${session.id}-assignee-${assigneeId}`, // More unique ID
          value: currentSessionEstimate,
          originalValue: currentSessionEstimate,
          itemType: "user",
          imageUrl: session.assignedTo.image ?? undefined,
        });
        // valueForSessionNodeItself remains undefined; D3 will sum from child.
      } else {
        // This session is unassigned, so it acts as a leaf for D3 summation.
        valueForSessionNodeItself = currentSessionEstimate;
      }

      const sessionNode: SunburstHierarchyNode = {
        name: session.name,
        id: `session-${session.id}`,
        originalValue: session.estimate ?? undefined,
        itemType: "testRun",
        children:
          sessionNodeChildren.length > 0 ? sessionNodeChildren : undefined,
        // value is set below only if it's a leaf node for sum(), otherwise D3 calculates it
      };

      if (valueForSessionNodeItself !== undefined) {
        sessionNode.value = valueForSessionNodeItself;
      }

      rootNode.children?.push(sessionNode);
    });

    return rootNode;
  }, [incompleteSessions, t]);

  const handleSunburstLegend = useCallback(
    (legendItems: SunburstLegendItem[]) => {
      setSunburstLegendData(legendItems);
    },
    []
  );

  const handleSunburstTotal = useCallback((total: number) => {
    setTotalSunburstEstimate(total);
  }, []);

  const handleSessionSunburstClick = useCallback(
    (sessionId: string) => {
      if (projectId && sessionId) {
        router.push(`/projects/sessions/${projectId}/${sessionId}`);
      }
    },
    [router, projectId]
  );

  // --- Data for Recent Session Results Donut Chart ---
  // Add state for chart data
  const [recentSessionResultsChartData, setRecentSessionResultsChartData] =
    useState<any[]>([]);
  // Add state for success rate and date range
  const [recentSessionResultsSuccessRate, setRecentSessionResultsSuccessRate] =
    useState<number>(0);
  const [recentSessionResultsDateRange, setRecentSessionResultsDateRange] =
    useState<{ first?: Date; last?: Date }>({});

  const thirtyDaysAgo = useMemo(() => {
    const date = new Date();
    date.setDate(date.getDate() - 90);
    return date;
  }, []);

  const {
    data: recentRawSessionResults,
    isLoading: isLoadingRecentSessionResults,
  } = useFindManySessionResults({
    // Fetches SessionResult, not TestRunResult
    where: {
      session: { projectId: numericProjectId ?? undefined },
      createdAt: { gte: thirtyDaysAgo },
      isDeleted: false,
      status: {
        systemName: { not: "untested" }, // Exclude untested results
      },
    },
    include: {
      status: {
        // Use select to ensure isSuccess is included
        select: {
          id: true,
          name: true,
          isSuccess: true, // <-- Ensure this is included
          color: { select: { value: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Renamed useMemo hook for clarity and added calculations
  const processedRecentSessionResults = useMemo(() => {
    if (!recentRawSessionResults) {
      setRecentSessionResultsChartData([]);
      setRecentSessionResultsSuccessRate(0);
      setRecentSessionResultsDateRange({});
      return;
    }

    const summary: { [statusId: string]: RecentResultStatusItem } = {};
    let successfulCount = 0;
    let firstResultDate: Date | undefined = undefined;
    let lastResultDate: Date | undefined = undefined;
    let totalResults = 0;

    recentRawSessionResults.forEach((result) => {
      const status = result.status;
      if (status) {
        totalResults++;
        const statusId = status.id.toString();

        // Track date range
        const createdAtDate = new Date(result.createdAt);
        if (!firstResultDate || createdAtDate < firstResultDate) {
          firstResultDate = createdAtDate;
        }
        if (!lastResultDate || createdAtDate > lastResultDate) {
          lastResultDate = createdAtDate;
        }

        // Aggregate status for chart
        if (!summary[statusId]) {
          summary[statusId] = {
            id: status.id,
            name: status.name,
            value: 0,
            color: status.color?.value || "#888888",
          };
        }
        summary[statusId].value++;

        // Count successes
        if (status.isSuccess) {
          successfulCount++;
        }
      }
    });

    const chartData = Object.values(summary).filter((item) => item.value > 0);
    const successRate =
      totalResults > 0 ? (successfulCount / totalResults) * 100 : 0;

    // Update all relevant states
    setRecentSessionResultsChartData(chartData);
    setRecentSessionResultsSuccessRate(successRate);
    setRecentSessionResultsDateRange({
      first: firstResultDate,
      last: lastResultDate,
    });
  }, [recentRawSessionResults]);

  // --- Data for Completed Sessions Line Chart (Last 6 Months) ---
  // Uses dedicated chart query (not affected by filtering/pagination)
  const completedSessionsMonthlyData = useMemo(() => {
    if (!completedSessionsForChart) return [];
    const monthlySummary: { [month: string]: MonthlyCount } = {};

    completedSessionsForChart.forEach((session) => {
      if (session.completedAt) {
        const completedDate = new Date(session.completedAt);
        const monthKey = `${completedDate.getFullYear()}-${String(
          completedDate.getMonth() + 1
        ).padStart(2, "0")}`;
        if (!monthlySummary[monthKey]) {
          monthlySummary[monthKey] = {
            month: monthKey,
            count: 0,
          };
        }
        monthlySummary[monthKey].count++;
      }
    });
    return Object.values(monthlySummary).sort((a, b) =>
      a.month.localeCompare(b.month)
    );
  }, [completedSessionsForChart]);

  // Add overall loading state check for clarity
  const isOverallLoading =
    isAuthLoading ||
    isLoading ||
    isLoadingRecentSessionResults ||
    isLoadingIncomplete ||
    isLoadingCompleted;

  // Wait for session to load
  // Wait for all data to load - this prevents the flash
  if (isOverallLoading) {
    return <LoadingSpinner />;
  }

  // NOW check if project exists - only after loading is complete
  if (!project) {
    return (
      <Card className="flex flex-col w-full min-w-[400px] h-full">
        <CardContent className="flex flex-col items-center justify-center h-full">
          <h2 className="text-2xl font-semibold mb-2">
            {t("common.errors.projectNotFound")}
          </h2>
          <p className="text-muted-foreground">
            {t("common.errors.projectNotFoundDescription")}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (sessionData && sessionData.user.access !== "NONE") {
    return (
      <>
        <Card className="flex w-full min-w-[400px]">
          <div className="flex-1 w-full">
            <CardHeader id="sessions-page-header">
              <CardTitle>
                <div className="flex items-center justify-between text-primary text-xl md:text-2xl">
                  <div>
                    <CardTitle>{t("sessions.title", { count: 2 })}</CardTitle>
                  </div>
                  <div>
                    {canAddEditSession && (
                      <AddSessionModal
                        trigger={
                          <Button
                            variant="default"
                            data-testid="new-session-button"
                          >
                            <CirclePlus className="h-4 w-4" />
                            <span className="hidden md:inline">
                              {t("sessions.actions.add")}
                            </span>
                          </Button>
                        }
                      />
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
              {/* --- Summary Metrics Display --- */}
              <div className="mb-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* Card 1: Work Distribution - (Modified above) */}
                {(isLoadingIncomplete ||
                  (workDistributionChartData.children &&
                    workDistributionChartData.children.length > 0)) && (
                  <Card>
                    <CardHeader className="pb-2 flex flex-row items-start justify-between">
                      <div>
                        <CardTitle className="font-medium">
                          {t("sessions.summary.workDistributionTitle")}
                        </CardTitle>
                        <CardDescription>
                          <div className="flex flex-row gap-1">
                            <p>
                              {t(
                                "sessions.summary.workDistributionDescription"
                              )}
                            </p>
                            <p>
                              {toHumanReadable(totalSunburstEstimate, {
                                isSeconds: true,
                              })}
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
                            title: t("sessions.summary.workDistributionTitle"),
                            data: workDistributionChartData,
                            projectId: projectId,
                            onLegendDataGenerated: handleSunburstLegend,
                            onTotalCalculated: handleSunburstTotal,
                            onSessionClick: handleSessionSunburstClick,
                            isZoomed: true,
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
                      {isLoadingIncomplete ? (
                        <LoadingSpinner />
                      ) : workDistributionChartData.children &&
                        workDistributionChartData.children.length > 0 ? (
                        <SummarySunburstChart
                          data={workDistributionChartData}
                          projectId={projectId}
                          onLegendDataGenerated={handleSunburstLegend}
                          onTotalCalculated={handleSunburstTotal}
                          onSessionClick={handleSessionSunburstClick}
                        />
                      ) : (
                        <p className="text-sm text-muted-foreground text-center px-4 h-[210px] flex items-center justify-center">
                          {t("sessions.summary.noWorkDistributionData", {
                            defaultValue:
                              "No active sessions with assignees or estimates to display.",
                          })}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Card 2: Recent Session Results - Conditional Render */}
                {(isLoadingRecentSessionResults ||
                  recentSessionResultsChartData.length > 0) && (
                  <Card>
                    <CardHeader className="pb-2 flex flex-row items-start justify-between">
                      <div>
                        <CardTitle className="font-medium">
                          {t("sessions.summary.recentResultsTitle")}
                        </CardTitle>
                        <CardDescription className="flex flex-col">
                          {!isLoadingRecentSessionResults &&
                            recentSessionResultsDateRange.first &&
                            recentSessionResultsDateRange.last && (
                              <span>
                                <DateFormatter
                                  date={recentSessionResultsDateRange.first}
                                  formatString={
                                    sessionData?.user.preferences?.dateFormat +
                                    " " +
                                    sessionData?.user.preferences?.timeFormat
                                  }
                                  timezone={
                                    sessionData?.user.preferences?.timezone
                                  }
                                />
                                {" – "}
                                <DateFormatter
                                  date={recentSessionResultsDateRange.last}
                                  formatString={
                                    sessionData?.user.preferences?.dateFormat +
                                    " " +
                                    sessionData?.user.preferences?.timeFormat
                                  }
                                  timezone={
                                    sessionData?.user.preferences?.timezone
                                  }
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
                            title: t("sessions.summary.recentResultsTitle"),
                            data: recentSessionResultsChartData,
                            isZoomed: true,
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
                      {isLoadingRecentSessionResults ? (
                        <LoadingSpinner />
                      ) : recentSessionResultsChartData.length > 0 ? (
                        <RecentResultsDonut
                          data={recentSessionResultsChartData}
                        />
                      ) : (
                        <p className="text-sm text-muted-foreground text-center px-4 h-[210px] flex items-center justify-center">
                          {t("sessions.summary.noRecentResults")}
                        </p>
                      )}
                    </CardContent>
                    <CardFooter className="flex justify-center items-center">
                      {!isLoadingRecentSessionResults &&
                        recentSessionResultsChartData.length > 0 && (
                          <span className="font-semibold">{`${recentSessionResultsSuccessRate.toFixed(1)}% ${tCommon("labels.successRate")}`}</span>
                        )}
                    </CardFooter>
                  </Card>
                )}

                {/* Card 3: Session Completion Trend - Conditional Render */}
                {(isLoadingChartData ||
                  completedSessionsMonthlyData.length > 0) && (
                  <Card>
                    <CardHeader className="pb-2 flex flex-row items-start justify-between">
                      <div>
                        <CardTitle className="font-medium">
                          {t("sessions.summary.completionTrendTitle6Mo")}
                        </CardTitle>
                        <CardDescription>
                          {t("sessions.summary.completionTrendDescription")}
                        </CardDescription>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() =>
                          handleOpenChartOverlay({
                            type: "line",
                            title: t(
                              "sessions.summary.completionTrendTitle6Mo"
                            ),
                            data: completedSessionsMonthlyData,
                            isZoomed: true,
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
                      {isLoadingChartData ? (
                        <LoadingSpinner />
                      ) : completedSessionsMonthlyData.length > 0 ? (
                        <CompletedRunsLineChart
                          data={completedSessionsMonthlyData}
                        />
                      ) : (
                        <p className="text-sm text-muted-foreground text-center px-4 h-[210px] flex items-center justify-center">
                          {t("sessions.summary.noCompletedSessions6Mo")}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                )}
              </div>
              {/* --- End Summary Metrics Display --- */}

              {/* --- Start Restored Tabs Component --- */}
              <Tabs value={activeTab} onValueChange={handleTabChange}>
                <TabsList className="w-full">
                  <TabsTrigger value="active" className="w-1/2">
                    {t("common.status.active")}
                  </TabsTrigger>
                  <TabsTrigger value="completed" className="w-1/2">
                    {t("common.status.completed")}
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="active">
                  <div className="flex flex-col">
                    {incompleteSessions?.length === 0 ? (
                      <div className="mt-4 flex flex-col items-center justify-center gap-4">
                        <p className="text-center text-muted-foreground">
                          {t("sessions.empty.active")}
                        </p>
                        {canAddEditSession && (
                          <AddSessionModal
                            trigger={
                              <Button variant="default">
                                <CirclePlus className="h-4 w-4" />
                                <span className="hidden md:inline">
                                  {t("sessions.actions.create")}
                                </span>
                              </Button>
                            }
                          />
                        )}
                      </div>
                    ) : (
                      <SessionDisplay
                        testSessions={incompleteSessions || []}
                        milestones={transformedMilestones}
                        canAddEdit={showAddButtonPerm}
                        canCloseSession={showCompleteOptionPerm}
                      />
                    )}
                  </div>
                </TabsContent>
                <TabsContent value="completed">
                  <div className="flex flex-col">
                    {/* Filter and Pagination Controls */}
                    <div className="flex flex-row items-start mb-4">
                      <div className="flex flex-col grow w-full sm:w-1/3 min-w-[150px]">
                        <Filter
                          key="completed-sessions-filter"
                          placeholder={t("sessions.filter.placeholder")}
                          initialSearchString={completedSessionsSearchString}
                          onSearchChange={setCompletedSessionsSearchString}
                        />
                      </div>
                      <div className="flex flex-col w-full sm:w-2/3 items-end">
                        {totalCompletedSessionsCount > 0 && (
                          <>
                            <div className="justify-end">
                              <PaginationInfo
                                key="completed-sessions-pagination-info"
                                startIndex={completedSessionsStartIndex}
                                endIndex={completedSessionsEndIndex}
                                totalRows={totalCompletedSessionsCount}
                                searchString={completedSessionsSearchString}
                                pageSize={
                                  typeof completedSessionsPageSize === "number"
                                    ? completedSessionsPageSize
                                    : "All"
                                }
                                pageSizeOptions={[10, 25, 50, 100, "All"]}
                                handlePageSizeChange={(size) =>
                                  setCompletedSessionsPageSize(size)
                                }
                              />
                            </div>
                            <div className="justify-end -mx-4">
                              <PaginationComponent
                                currentPage={completedSessionsPage}
                                totalPages={totalCompletedSessionsPages}
                                onPageChange={setCompletedSessionsPage}
                              />
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                    {/* Sessions Display */}
                    {completedSessions?.length === 0 ? (
                      <div className="mt-4 text-center text-muted-foreground">
                        {completedSessionsSearchString
                          ? t("sessions.empty.noMatchingCompleted")
                          : t("sessions.empty.completed")}
                      </div>
                    ) : (
                      <SessionDisplay
                        testSessions={completedSessions || []}
                        milestones={transformedMilestones}
                        canAddEdit={showAddButtonPerm}
                        canCloseSession={showCompleteOptionPerm}
                      />
                    )}
                  </div>
                </TabsContent>
              </Tabs>
              {/* --- End Restored Tabs Component --- */}
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
                  : t("sessions.summary.workDistributionTitle")}
              </DialogTitle>
              <DialogDescription className="sr-only">
                {zoomedChartDetails
                  ? zoomedChartDetails.title
                  : t("sessions.summary.workDistributionTitle")}
              </DialogDescription>
            </DialogHeader>
            {zoomedChartDetails && (
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
                      onSessionClick={zoomedChartDetails.onSessionClick}
                      isZoomed={true}
                    />
                  )}
                  {zoomedChartDetails.type === "donut" && (
                    <RecentResultsDonut
                      data={zoomedChartDetails.data}
                      // Pass isZoomed if RecentResultsDonut implements it
                      // isZoomed={zoomedChartDetails.isZoomed}
                    />
                  )}
                  {zoomedChartDetails.type === "line" && (
                    <CompletedRunsLineChart
                      data={zoomedChartDetails.data}
                      // Pass isZoomed if CompletedRunsLineChart implements it
                      // isZoomed={zoomedChartDetails.isZoomed}
                    />
                  )}
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return null;
};

// Wrapper component to provide pagination context
export default function ProjectSessionsPage(props: ProjectSessionsProps) {
  return (
    <PaginationProvider defaultPageSize={25}>
      <ProjectSessions
        params={props.params}
        searchParams={props.searchParams}
      />
    </PaginationProvider>
  );
}
