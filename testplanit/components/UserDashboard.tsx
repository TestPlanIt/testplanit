import { useSession } from "next-auth/react";
import { useTranslations, useLocale } from "next-intl";
import {
  useFindManyTestRuns,
  useFindManyTestRunCases,
  useFindManySessions,
  useFindFirstStatus,
} from "~/lib/hooks";
import { Link, useRouter } from "~/lib/navigation";
import { useQuery } from "@tanstack/react-query";
import type { UserDashboardData } from "~/app/api/users/[userId]/dashboard/route";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { TestRunCasesSummary } from "@/components/TestRunCasesSummary";
import { SessionResultsSummary } from "@/components/SessionResultsSummary";
import { CirclePlay, Compass, LinkIcon, Star } from "lucide-react";
import { useMemo, useCallback } from "react";
import type {
  TestRunCases,
  TestRunResults,
  TestRuns,
  Sessions,
  Projects,
  Prisma,
} from "@prisma/client";
import LoadingSpinner from "./LoadingSpinner";
import UserWorkGanttChart, {
  type PlotTask,
} from "./dataVisualizations/UserWorkGanttChart";
import { DateFormatter } from "~/components/DateFormatter";
import { toHumanReadable } from "~/utils/duration";
// import UserWorkChart from "./dataVisualizations/UserWorkChart"; // Will be replaced

// Updated Helper type for TestRunCases
type TestCaseWithResults = TestRunCases & {
  results?: TestRunResults[];
  testRun: { id: number };
};

// Updated Helper type for Runs with Project
type RunWithProject = TestRuns & {
  project: Projects; // Ensure project is included
};

// Updated Helper type for Sessions with Project
type SessionWithProject = Sessions & {
  project: Projects; // Ensure project is included
};

// Define the new chartable item structure
export type ChartableCase = {
  id: string; // e.g., "case-123"
  name: string; // Test Case name
  timeValue: number;
  link: string;
};

export type ChartableItem =
  | {
      id: string; // e.g., "session-456"
      name: string; // Session name
      type: "Session";
      timeValue: number; // Session's own time value
      projectName: string;
      link: string;
    }
  | {
      id: string; // e.g., "run-789"
      name: string; // Test Run name
      type: "Test Run Group";
      projectName: string;
      cases: ChartableCase[];
      totalTimeValue: number; // Sum of timeValue for all cases in this run
      // Individual case links are within the 'cases' array
    };

// Type for PopulatedTestRunCases from the user query
// (Ensures we have the fields selected in useFindFirstUser)
type PopulatedTestRunCaseFromUser = NonNullable<
  Prisma.UserGetPayload<{
    include: {
      testRunCasesAssigned: {
        where: {
          isCompleted: false;
          testRun: {
            isDeleted: false;
          };
        };
        include: {
          results: {
            where: {
              isDeleted: false;
              status: { isDeleted: false };
            };
            orderBy: { executedAt: "desc" };
            take: 1;
            select: {
              statusId: true;
              status: { select: { name: true; isCompleted: true } };
            };
          };
          repositoryCase: {
            select: {
              id: true;
              name: true;
              estimate: true;
              forecastManual: true;
              forecastAutomated: true;
            };
          };
          testRun: {
            select: {
              id: true;
              isCompleted: true;
              forecastManual: true;
              forecastAutomated: true;
              name: true;
              project: { select: { id: true; name: true } };
            };
          };
        };
      };
    };
  }>["testRunCasesAssigned"]
>[number];

// Type for PopulatedSessions from the user query
type PopulatedSessionFromUser = {
  id: number;
  name: string;
  estimate: number | null;
  forecastManual: number | null;
  forecastAutomated: number | null;
  project: { id: number; name: string };
  sessionResults?: ReadonlyArray<{ readonly elapsed: number | null }>;
};

// --- Helper Types & Functions for Scheduling ---
const WORKDAY_START_HOUR = 9; // 9 AM
const WORKDAY_END_HOUR = 17; // 5 PM (which means 8 working hours if start is 9)
const SECONDS_PER_HOUR = 3600;

// New function to find the next available start time for a task
function findNextWorkdayStartTime(markerDate: Date): Date {
  const nextSlot = new Date(markerDate);

  // Loop to find the next valid start slot
  while (true) {
    const day = nextSlot.getDay(); // 0 = Sunday, 6 = Saturday
    const hour = nextSlot.getHours();

    if (day === 0) {
      // Sunday
      nextSlot.setDate(nextSlot.getDate() + 1); // Move to Monday
      nextSlot.setHours(WORKDAY_START_HOUR, 0, 0, 0);
      // Continue loop to re-evaluate (should be Monday 9 AM)
    } else if (day === 6) {
      // Saturday
      nextSlot.setDate(nextSlot.getDate() + 2); // Move to Monday
      nextSlot.setHours(WORKDAY_START_HOUR, 0, 0, 0);
      // Continue loop to re-evaluate
    } else {
      // Weekday (Monday to Friday)
      if (hour < WORKDAY_START_HOUR) {
        nextSlot.setHours(WORKDAY_START_HOUR, 0, 0, 0);
        return nextSlot;
      } else if (hour >= WORKDAY_END_HOUR) {
        // Task ended at or after end of workday, move to next day
        nextSlot.setDate(nextSlot.getDate() + 1);
        nextSlot.setHours(WORKDAY_START_HOUR, 0, 0, 0);
        // Continue loop to re-evaluate if the new day is a weekend
      } else {
        // It's a weekday, and within WORKDAY_START_HOUR and WORKDAY_END_HOUR
        return nextSlot;
      }
    }
  }
}

// Revised function to calculate precise scheduled end date
function calculateScheduledEndDate(
  preciseStartDate: Date,
  durationInSeconds: number
): Date {
  const currentWorkTime = new Date(preciseStartDate);
  let remainingTaskSeconds = durationInSeconds;

  if (remainingTaskSeconds <= 0) {
    return new Date(currentWorkTime);
  }

  while (remainingTaskSeconds > 0) {
    const dayOfWeek = currentWorkTime.getDay();

    // Skip weekends
    if (dayOfWeek === 0) {
      // Sunday
      currentWorkTime.setDate(currentWorkTime.getDate() + 1); // Move to Monday
      currentWorkTime.setHours(WORKDAY_START_HOUR, 0, 0, 0);
      continue;
    }
    if (dayOfWeek === 6) {
      // Saturday
      currentWorkTime.setDate(currentWorkTime.getDate() + 2); // Move to Monday
      currentWorkTime.setHours(WORKDAY_START_HOUR, 0, 0, 0);
      continue;
    }

    let currentHour = currentWorkTime.getHours();

    // Adjust if current time is before workday starts or after it ends
    if (currentHour < WORKDAY_START_HOUR) {
      currentWorkTime.setHours(WORKDAY_START_HOUR, 0, 0, 0);
      currentHour = WORKDAY_START_HOUR;
    } else if (currentHour >= WORKDAY_END_HOUR) {
      currentWorkTime.setDate(currentWorkTime.getDate() + 1); // Move to next day
      currentWorkTime.setHours(WORKDAY_START_HOUR, 0, 0, 0);
      // Loop again to handle if new day is weekend
      continue;
    }

    // Calculate seconds available in the current workday slot
    const secondsAvailableThisSlot =
      (WORKDAY_END_HOUR - currentWorkTime.getHours()) * SECONDS_PER_HOUR -
      currentWorkTime.getMinutes() * 60 -
      currentWorkTime.getSeconds();

    const secondsToWorkThisSlot = Math.min(
      remainingTaskSeconds,
      secondsAvailableThisSlot
    );

    currentWorkTime.setSeconds(
      currentWorkTime.getSeconds() + secondsToWorkThisSlot
    );
    remainingTaskSeconds -= secondsToWorkThisSlot;

    // If task is not finished but the current day's work slot is used up
    if (remainingTaskSeconds > 0) {
      currentWorkTime.setDate(currentWorkTime.getDate() + 1); // Move to start of next potential workday
      currentWorkTime.setHours(WORKDAY_START_HOUR, 0, 0, 0);
    }
  }
  return currentWorkTime;
}

// Define the new calendar item structure
export type CalendarWorkItem = {
  id: string;
  name: string;
  type: "Session" | "Test Run Group";
  projectName: string;
  originalDurationInSeconds: number;
  scheduledStartDate: Date;
  scheduledEndDate: Date;
  link?: string;
  cases?: ChartableCase[]; // Still useful for Test Run Group tooltips
};

export function UserDashboard() {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const { data: session } = useSession();
  const userId = session?.user?.id;

  // Fetch dashboard data from API
  const { data: dashboardData, isLoading: isLoadingUser } =
    useQuery<UserDashboardData>({
      queryKey: ["userDashboard", userId],
      queryFn: async () => {
        const response = await fetch(`/api/users/${userId}/dashboard`);
        if (!response.ok) {
          throw new Error("Failed to fetch user dashboard data");
        }
        return response.json();
      },
      enabled: !!userId,
      staleTime: 30000, // Cache for 30 seconds
    });

  // Transform API data to match component expectations
  const user = useMemo(() => {
    if (!dashboardData) return null;

    return {
      testRunCasesAssigned: dashboardData.testRunCasesAssigned.map((tc) => ({
        id: tc.id,
        repositoryCaseId: tc.repositoryCaseId,
        results: tc.latestResultStatusId
          ? [
              {
                statusId: tc.latestResultStatusId,
                status: {
                  isCompleted: tc.latestResultIsCompleted || false,
                },
              },
            ]
          : [],
        repositoryCase: {
          id: tc.repositoryCaseId,
          name: tc.caseName,
          estimate: tc.caseEstimate,
          forecastManual: tc.caseForecastManual,
          forecastAutomated: tc.caseForecastAutomated,
        },
        testRun: {
          id: tc.testRunId,
          isCompleted: tc.runIsCompleted,
          forecastManual: tc.runForecastManual,
          forecastAutomated: tc.runForecastAutomated,
          name: tc.runName,
          project: {
            id: tc.projectId,
            name: tc.projectName,
          },
        },
      })),
      assignedSessions: dashboardData.assignedSessions.map((s) => ({
        id: s.id,
        name: s.name,
        estimate: s.estimate,
        forecastManual: s.forecastManual,
        forecastAutomated: s.forecastAutomated,
        project: {
          id: s.projectId,
          name: s.projectName,
        },
        sessionResults: [{ elapsed: s.totalElapsed }],
      })),
    };
  }, [dashboardData]);

  const untestedStatus = useMemo(
    () =>
      dashboardData?.untestedStatusId
        ? { id: dashboardData.untestedStatusId }
        : null,
    [dashboardData]
  );

  const isLoadingUntestedStatus = isLoadingUser;

  // --- New: Combine assigned test cases and sessions for visualization ---
  const scheduledWorkItems = useMemo(() => {
    if (!user || !untestedStatus?.id) {
      return [];
    }

    // Step 1: Group Test Cases by Run and prepare Session items (similar to before)
    const intermediateItems: Array<
      | Extract<ChartableItem, { type: "Test Run Group" }>
      | Extract<ChartableItem, { type: "Session" }>
    > = [];

    if (user.testRunCasesAssigned) {
      const casesByRun = new Map<
        string,
        {
          runName: string;
          projectName: string;
          runId: number;
          projectId: number;
          cases: ChartableCase[];
        }
      >();
      (user.testRunCasesAssigned as PopulatedTestRunCaseFromUser[]).forEach(
        (tc) => {
          if (
            !tc.repositoryCase ||
            !tc.testRun ||
            !tc.testRun.project ||
            tc.testRun.isCompleted
          )
            return;
          const latestResult = tc.results?.[0];
          const isPendingByStatus =
            !latestResult || latestResult.statusId === untestedStatus.id;
          if (isPendingByStatus) {
            const runKey = `run-${tc.testRun.id}`;
            if (!casesByRun.has(runKey)) {
              casesByRun.set(runKey, {
                runName: tc.testRun.name,
                projectName: tc.testRun.project.name,
                runId: tc.testRun.id,
                projectId: tc.testRun.project.id,
                cases: [],
              });
            }
            const caseTimeValue =
              tc.repositoryCase.forecastManual ??
              tc.repositoryCase.estimate ??
              0;
            if (caseTimeValue > 0) {
              // Only add cases with time to the group
              casesByRun.get(runKey)!.cases.push({
                id: `case-${tc.id}`,
                name: tc.repositoryCase.name,
                timeValue: caseTimeValue,
                link: `/projects/runs/${tc.testRun.project.id}/${tc.testRun.id}?selectedCase=${tc.repositoryCase.id}`,
              });
            }
          }
        }
      );
      casesByRun.forEach((runGroup, runKey) => {
        const totalTimeValue = runGroup.cases.reduce(
          (sum, c) => sum + c.timeValue,
          0
        );
        if (totalTimeValue > 0) {
          intermediateItems.push({
            id: runKey,
            name: runGroup.runName,
            type: "Test Run Group",
            projectName: runGroup.projectName,
            cases: runGroup.cases,
            totalTimeValue,
          });
        }
      });
    }
    if (user.assignedSessions) {
      (user.assignedSessions as PopulatedSessionFromUser[]).forEach(
        (session) => {
          if (!session.project) return;

          // Calculate total elapsed time for the session
          const totalElapsedSeconds =
            session.sessionResults?.reduce?.((sum, result) => {
              return sum + (result.elapsed ?? 0);
            }, 0) ?? 0;

          const sessionTotalEstimateSeconds = session.estimate ?? 0;

          const sessionRemainingTimeValue = Math.max(
            0,
            sessionTotalEstimateSeconds - totalElapsedSeconds
          );

          if (sessionRemainingTimeValue > 0) {
            intermediateItems.push({
              id: `session-${session.id}`,
              name: session.name,
              type: "Session",
              timeValue: sessionRemainingTimeValue, // Use remaining time
              projectName: session.project.name,
              link: `/projects/sessions/${session.project.id}/${session.id}`,
            });
          }
        }
      );
    }

    // Step 2: Schedule these items sequentially
    const finalCalendarItems: CalendarWorkItem[] = [];
    // Initialize currentScheduleMarker to the soonest available work slot from now
    let currentScheduleMarker = findNextWorkdayStartTime(new Date());

    for (const item of intermediateItems) {
      const durationSeconds =
        item.type === "Test Run Group" ? item.totalTimeValue : item.timeValue;
      if (durationSeconds <= 0) continue;

      // The currentScheduleMarker is already a valid start time/slot
      const actualStartDate = new Date(currentScheduleMarker);
      const actualEndDate = calculateScheduledEndDate(
        actualStartDate,
        durationSeconds
      );

      finalCalendarItems.push({
        id: item.id,
        name: item.name,
        type: item.type,
        projectName: item.projectName,
        originalDurationInSeconds: durationSeconds,
        scheduledStartDate: actualStartDate, // This is now precise
        scheduledEndDate: actualEndDate, // This is now precise
        link: item.type === "Session" ? item.link : undefined,
        cases: item.type === "Test Run Group" ? item.cases : undefined,
      });

      // The next task starts where the current one ended, find the next valid slot.
      // Pass a new Date object from actualEndDate to avoid modifying it.
      currentScheduleMarker = findNextWorkdayStartTime(
        new Date(actualEndDate.getTime())
      );
    }
    return finalCalendarItems;
  }, [user, untestedStatus]);

  const scheduleSummary = useMemo(() => {
    if (!scheduledWorkItems || scheduledWorkItems.length === 0) {
      return null;
    }

    const overallStartDate = scheduledWorkItems.reduce((earliest, item) => {
      return item.scheduledStartDate < earliest
        ? item.scheduledStartDate
        : earliest;
    }, scheduledWorkItems[0].scheduledStartDate);

    const overallEndDate = scheduledWorkItems.reduce((latest, item) => {
      return item.scheduledEndDate > latest ? item.scheduledEndDate : latest;
    }, scheduledWorkItems[0].scheduledEndDate);

    const totalScheduledDurationInSeconds = scheduledWorkItems.reduce(
      (sum, item) => sum + item.originalDurationInSeconds,
      0
    );

    return {
      overallStartDate,
      overallEndDate,
      totalScheduledDurationInSeconds,
    };
  }, [scheduledWorkItems]);

  // --- 2. Fetch Open Test Runs (include project) ---
  const { data: allOpenRuns, isLoading: isLoadingRuns } = useFindManyTestRuns(
    {
      where: {
        isDeleted: false,
        isCompleted: false,
        project: {
          isDeleted: false,
        },
      },
      include: {
        project: true, // Include the full project object
      },
      orderBy: { createdAt: "desc" },
    },
    { enabled: !!userId }
  );

  const allOpenRunIds = useMemo(
    () => allOpenRuns?.map((run) => run.id) || [],
    [allOpenRuns]
  );

  // --- 3. Fetch Test Cases assigned to the user for those Runs ---
  const { data: userTestCasesForRuns, isLoading: isLoadingTestCases } =
    useFindManyTestRunCases(
      {
        where: {
          testRunId: { in: allOpenRunIds },
          assignedToId: userId, // Correct field from schema
          // No isDeleted field on TestRunCases per schema
        },
        include: {
          results: {
            orderBy: { executedAt: "desc" },
            take: 1,
            select: { statusId: true },
          },
          testRun: { select: { id: true } }, // Link back to run ID
        },
      },
      { enabled: !!userId && allOpenRunIds.length > 0 }
    );

  // --- 4. Filter Runs based on Fetched Cases ---
  const runsRequiringAttention = useMemo(() => {
    if (!allOpenRuns || !userTestCasesForRuns || !untestedStatus) return [];

    // Create a Set of run IDs that have cases needing attention for quick lookup
    const runsWithCasesNeedingAttention = new Set<number>();
    (userTestCasesForRuns as TestCaseWithResults[]).forEach((testCase) => {
      const latestResult = testCase.results?.[0];
      if (!latestResult || latestResult.statusId === untestedStatus.id) {
        runsWithCasesNeedingAttention.add(testCase.testRun.id);
      }
    });

    // Filter the original list of open runs
    return (allOpenRuns as RunWithProject[]).filter((run) =>
      runsWithCasesNeedingAttention.has(run.id)
    );
  }, [allOpenRuns, userTestCasesForRuns, untestedStatus]);

  // --- New: Derive untested assigned test run cases from the user object ---
  const untestedAssignedTestRunCases = useMemo(() => {
    if (!user?.testRunCasesAssigned || !untestedStatus?.id) {
      return [];
    }

    // Define a type for the elements in user.testRunCasesAssigned after the include
    type PopulatedTestRunCase = TestRunCases & {
      results: Array<{ statusId: number }>;
      repositoryCase: { id: number; name: string };
      testRun: {
        id: number;
        name: string;
        project: { id: number; name: string };
      };
      // id from TestRunCases is implicitly part of TestRunCases type
    };

    return user.testRunCasesAssigned.filter((tc) => {
      const latestResult = tc.results?.[0];
      return latestResult && latestResult.statusId === untestedStatus.id;
    });
  }, [user, untestedStatus]);

  // --- 5. Fetch Active Sessions assigned to the user (include project) ---
  const { data: userActiveSessions, isLoading: isLoadingSessions } =
    useFindManySessions(
      {
        where: {
          assignedToId: userId, // Correct field from schema
          isDeleted: false,
          isCompleted: false, // Use isCompleted: false for active sessions
          project: {
            isDeleted: false,
          },
        },
        include: {
          project: true, // Include the full project object
        },
        orderBy: { createdAt: "desc" },
      },
      { enabled: !!userId }
    );

  // --- New: Transform scheduledWorkItems to PlotTasks for Gantt Chart ---
  const plotTasks: PlotTask[] = useMemo(() => {
    if (!scheduledWorkItems || scheduledWorkItems.length === 0) {
      return [];
    }

    // Get computed Tailwind colors once
    let sessionColor = "#3498db"; // Default fallback
    let testRunColor = "#3498db"; // Default fallback
    if (typeof window !== "undefined") {
      const styles = getComputedStyle(document.documentElement);
      sessionColor =
        styles.getPropertyValue("--tp-primary-color").trim() || sessionColor;
      // Make testRunColor also use the primary color variable
      testRunColor =
        styles.getPropertyValue("--tp-primary-color").trim() || testRunColor;
    }

    const generatedPlotTasks: PlotTask[] = [];
    // Maintain a marker for the end of the last processed case within a Test Run Group
    let groupInternalScheduleMarker: Date | null = null;

    for (const item of scheduledWorkItems) {
      if (item.type === "Session") {
        generatedPlotTasks.push({
          id: item.id, // e.g., "session-123"
          name: item.name, // Session name
          groupName: item.name, // For sessions, groupName is the same as name
          start: item.scheduledStartDate,
          end: item.scheduledEndDate,
          color: sessionColor, // Use themed color
          projectName: item.projectName,
          link: item.link,
          opacity: 0.7, // Set opacity for sessions
          originalDurationInSeconds: item.originalDurationInSeconds,
        });
        // Reset group marker as sessions are independent groups
        groupInternalScheduleMarker = null;
      } else if (
        item.type === "Test Run Group" &&
        item.cases &&
        item.cases.length > 0
      ) {
        // The Test Run Group itself has a scheduledStartDate which is the earliest start for its first case
        // Initialize the marker for this new group
        groupInternalScheduleMarker = findNextWorkdayStartTime(
          new Date(item.scheduledStartDate)
        );

        for (const caseItem of item.cases) {
          if (caseItem.timeValue <= 0) continue; // Skip cases with no duration

          // Ensure groupInternalScheduleMarker is not null (should be set by group start)
          if (!groupInternalScheduleMarker) {
            // This should ideally not happen if group logic is correct
            // Fallback to the group's overall start time if somehow null
            groupInternalScheduleMarker = findNextWorkdayStartTime(
              new Date(item.scheduledStartDate)
            );
          }

          const caseActualStartDate = new Date(groupInternalScheduleMarker);
          const caseActualEndDate = calculateScheduledEndDate(
            caseActualStartDate,
            caseItem.timeValue // caseItem.timeValue is in seconds
          );

          generatedPlotTasks.push({
            id: caseItem.id, // e.g., "case-abc"
            name: caseItem.name, // Test Case name
            groupName: item.name, // Group name is the Test Run Group's name
            start: caseActualStartDate,
            end: caseActualEndDate,
            color: testRunColor, // Use themed color (which is now primary for all)
            projectName: item.projectName,
            link: caseItem.link,
            opacity: 1.0, // Set opacity for test run cases
            originalDurationInSeconds: caseItem.timeValue,
          });
          // Update the marker for the next case in this group
          groupInternalScheduleMarker = findNextWorkdayStartTime(
            new Date(caseActualEndDate)
          );
        }
        // After processing all cases in a group, reset the marker for the next independent item/group
        groupInternalScheduleMarker = null;
      }
    }

    return generatedPlotTasks;
  }, [scheduledWorkItems]); // Removed dependency on 'locale' as it's not directly used here

  // Memoize the click handler before any early returns
  const handleGanttTaskClick = useCallback(
    (task: PlotTask) => {
      if (task.link) {
        router.push(task.link);
      }
    },
    [router]
  );

  // --- Loading and Rendering ---
  const isLoading =
    isLoadingUntestedStatus ||
    isLoadingRuns ||
    isLoadingTestCases ||
    isLoadingUser ||
    isLoadingSessions;

  if (!userId) return null;
  if (isLoading) return <LoadingSpinner className="h-20" />;

  const hasRuns = runsRequiringAttention.length > 0;
  // userActiveSessions is already filtered, check its length directly
  const hasSessions = userActiveSessions && userActiveSessions.length > 0;

  // Condition for showing the chart (now calendar)
  const showCalendar = scheduledWorkItems && scheduledWorkItems.length > 0;

  const showGanttChart = plotTasks && plotTasks.length > 0; // This is the correct one using plotTasks

  if (!hasRuns && !hasSessions && !showGanttChart) {
    return (
      <div
        data-testid="no-items-message"
        id="dashboard-header"
        className="text-primary text-center py-8 flex flex-col items-center justify-start gap-3 h-full w-full"
      >
        <Star className="h-12 w-12 animate-bounce fill-primary/20" />
        <span>{t("home.dashboard.noItems")}</span>
      </div>
    );
  }
  return (
    <Card className="w-full" data-testid="dashboard-card">
      <CardHeader id="dashboard-header">
        <CardTitle>
          <div className="flex items-center justify-between text-primary text-xl md:text-2xl">
            {t("home.dashboard.yourAssignments")}
          </div>
        </CardTitle>
        {showCalendar && scheduleSummary && (
          <CardDescription className="text-xs text-muted-foreground mt-1 flex flex-col gap-0.5">
            <div>
              <span className="font-semibold">
                {t("home.dashboard.totalWorkEffort")}
              </span>
              {toHumanReadable(
                scheduleSummary.totalScheduledDurationInSeconds,
                {
                  isSeconds: true,
                  locale,
                  units: ["d", "h", "m", "s"],
                }
              )}
            </div>
            <div>
              <span className="font-semibold">
                {t("home.dashboard.scheduleSpan")}
              </span>
              <DateFormatter
                date={scheduleSummary.overallStartDate}
                formatString={
                  session?.user.preferences?.dateFormat +
                  " " +
                  session?.user.preferences?.timeFormat
                }
                timezone={session?.user.preferences?.timezone}
              />
              <span className="mx-1">{"—"}</span>
              <DateFormatter
                date={scheduleSummary.overallEndDate}
                formatString={
                  session?.user.preferences?.dateFormat +
                  " " +
                  session?.user.preferences?.timeFormat
                }
                timezone={session?.user.preferences?.timezone}
              />
            </div>
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-6">
        {/* --- User Work Chart/Calendar --- */}
        {showGanttChart && (
          <div className="mb-6 max-h-[500px] overflow-y-auto">
            <UserWorkGanttChart
              tasks={plotTasks} // Changed from ganttTasks
              locale={locale}
              onTaskClick={handleGanttTaskClick}
            />
          </div>
        )}

        {hasRuns && (
          <div className="space-y-2">
            <h3 className="flex items-center gap-1 font-semibold">
              <CirclePlay className="w-5 h-5 text-muted-foreground" />
              {t("home.dashboard.yourPendingRuns", {
                count: runsRequiringAttention.length,
              })}
            </h3>
            <div className="space-y-4 pl-6">
              {runsRequiringAttention.map((run) => (
                <div key={run.id} className="border p-3 rounded-md">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    {/* Access project directly as it's included */}
                    <Link
                      href={`/projects/runs/${run.project.id}/${run.id}`}
                      className="font-medium hover:underline flex items-center gap-1 group max-w-[75%]"
                    >
                      <span className="truncate">{run.name}</span>
                      <LinkIcon className="w-4 h-4 inline ml-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                    </Link>
                    <span className="text-xs text-muted-foreground ml-2 max-w-[25%] truncate">
                      {run.project.name}
                    </span>
                  </div>
                  <TestRunCasesSummary
                    testRunId={run.id}
                    projectId={run.project.id}
                    testRunType={run.testRunType}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {hasSessions && (
          <div className="space-y-2">
            <h3 className="flex items-center gap-1 font-semibold">
              <Compass className="w-5 h-5 text-muted-foreground" />
              {t("home.dashboard.yourActiveSessions", {
                count: userActiveSessions.length,
              })}
            </h3>
            <div className="space-y-4 pl-6">
              {(userActiveSessions as SessionWithProject[])?.map((session) => (
                <div key={session.id} className="border p-3 rounded-md">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    {/* Access project directly as it's included */}
                    <Link
                      href={`/projects/sessions/${session.project.id}/${session.id}`}
                      className="font-medium hover:underline flex items-center gap-1 group max-w-[75%]"
                    >
                      <span className="truncate">{session.name}</span>
                      <LinkIcon className="w-4 h-4 inline ml-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                    </Link>
                    <span className="text-xs text-muted-foreground ml-2 max-w-[25%] truncate">
                      {session.project.name}
                    </span>
                  </div>
                  <SessionResultsSummary
                    sessionId={session.id}
                    className="mt-1"
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default UserDashboard;
