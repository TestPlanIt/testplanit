/**
 * Query builders for report drill-down functionality
 * These functions construct database queries to fetch underlying records for each metric type
 */

import { Prisma } from "@prisma/client";
import type { DrillDownContext } from "~/lib/types/reportDrillDown";

/**
 * Normalize date to start of day in UTC
 */
function startOfDayUTC(date: Date | string): Date {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0)
  );
}

/**
 * Normalize date to end of day in UTC
 */
function endOfDayUTC(date: Date | string): Date {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Date(
    Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth(),
      d.getUTCDate(),
      23,
      59,
      59,
      999
    )
  );
}

/**
 * Build base date filter from report-level date range
 */
function buildDateFilter(
  startDate?: string,
  endDate?: string,
  dateField: string = "executedAt"
): Record<string, any> {
  const filter: Record<string, any> = {};

  if (startDate || endDate) {
    filter[dateField] = {};
    if (startDate) {
      filter[dateField].gte = new Date(startDate);
    }
    if (endDate) {
      filter[dateField].lte = new Date(endDate);
    }
  }

  return filter;
}

/**
 * Build query for test execution (testRunResults) drill-down
 */
export function buildTestExecutionQuery(
  context: DrillDownContext,
  offset: number,
  limit: number
): Prisma.TestRunResultsFindManyArgs {
  const where: Prisma.TestRunResultsWhereInput = {};

  // Build testRun filter with all conditions
  const testRunFilter: any = {};

  // Apply project filter
  if (context.projectId) {
    testRunFilter.projectId = context.projectId;
  } else if (context.mode === "cross-project" && context.dimensions.project) {
    testRunFilter.projectId = Number(context.dimensions.project.id);
  }

  // Configuration filtering
  if (context.dimensions.configuration) {
    // Handle "None" case where configuration ID is null
    if (context.dimensions.configuration.id === null) {
      testRunFilter.configId = null;
    } else {
      testRunFilter.configId = Number(context.dimensions.configuration.id);
    }
  }

  // Milestone filtering
  if (context.dimensions.milestone) {
    testRunFilter.milestone = {
      id: Number(context.dimensions.milestone.id),
    };
  }

  // TestRun filtering - handle in testRunFilter to avoid conflicts
  if (context.dimensions.testRun) {
    // Handle "None" case where testRun ID is null
    // "None" means test results where the test run is deleted or doesn't exist
    if (context.dimensions.testRun.id === null) {
      testRunFilter.isDeleted = true;
    } else {
      testRunFilter.id = Number(context.dimensions.testRun.id);
    }
  }

  // Apply testRun filter if we have any conditions
  if (Object.keys(testRunFilter).length > 0) {
    where.testRun = testRunFilter;
  }

  // Apply dimension filters
  if (context.dimensions.user) {
    where.executedById = String(context.dimensions.user.id);
  }

  if (context.dimensions.status) {
    where.statusId = Number(context.dimensions.status.id);
  }

  if (context.dimensions.testCase) {
    where.testRunCaseId = Number(context.dimensions.testCase.id);
  }

  // Apply date filter
  if (context.dimensions.date?.executedAt) {
    const date = new Date(context.dimensions.date.executedAt);
    where.executedAt = {
      gte: startOfDayUTC(date),
      lt: endOfDayUTC(date),
    };
  }

  // Apply report-level date range
  const dateRangeFilter = buildDateFilter(
    context.startDate,
    context.endDate,
    "executedAt"
  );
  if (
    dateRangeFilter.executedAt &&
    typeof dateRangeFilter.executedAt === "object"
  ) {
    const existing = where.executedAt as any;
    where.executedAt = existing
      ? { ...existing, ...(dateRangeFilter.executedAt as any) }
      : dateRangeFilter.executedAt;
  }

  // Exclude untested status - only show actual test results
  // But preserve any existing status filter (e.g., from status dimension)
  if (!where.statusId) {
    where.status = {
      systemName: { not: "untested" },
    } as any;
  }

  return {
    where,
    include: {
      status: {
        include: {
          color: true,
        },
      },
      executedBy: true,
      testRun: {
        select: {
          id: true,
          name: true,
          configId: true,
          configuration: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
      testRunCase: {
        select: {
          id: true,
          repositoryCase: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
    skip: offset,
    take: limit,
    orderBy: {
      executedAt: Prisma.SortOrder.desc,
    } as Prisma.TestRunResultsOrderByWithRelationInput,
  };
}

/**
 * Build query for test runs drill-down
 */
export function buildTestRunsQuery(
  context: DrillDownContext,
  offset: number,
  limit: number
): Prisma.TestRunsFindManyArgs {
  const where: Prisma.TestRunsWhereInput = {};

  // Apply project filter
  if (context.projectId) {
    where.projectId = context.projectId;
  } else if (context.dimensions.project) {
    where.projectId = Number(context.dimensions.project.id);
  }

  // Apply dimension filters
  const resultsFilter: any = {};

  if (context.dimensions.user) {
    // For test run count, we want test runs where the user executed tests, not created them
    resultsFilter.executedById = String(context.dimensions.user.id);
  }

  // Apply status filter to results
  // Note: status is a property of TestRunResults, not TestRuns!
  // We want test runs that have results with this status
  if (context.dimensions.status) {
    resultsFilter.statusId = Number(context.dimensions.status.id);
  }

  // Apply date filter to results
  if (context.dimensions.date?.executedAt) {
    const date = new Date(context.dimensions.date.executedAt);
    resultsFilter.executedAt = {
      gte: startOfDayUTC(date),
      lt: endOfDayUTC(date),
    };
  }

  // Apply report-level date range to results
  const dateRangeFilter = buildDateFilter(
    context.startDate,
    context.endDate,
    "executedAt"
  );
  if (
    dateRangeFilter.executedAt &&
    typeof dateRangeFilter.executedAt === "object"
  ) {
    const existing = resultsFilter.executedAt as any;
    resultsFilter.executedAt = existing
      ? { ...existing, ...(dateRangeFilter.executedAt as any) }
      : dateRangeFilter.executedAt;
  }

  // Apply results filter if any criteria exist
  if (Object.keys(resultsFilter).length > 0) {
    where.results = {
      some: resultsFilter,
    };
  }

  // Apply configuration filter
  // Note: configuration is a property of TestRuns (configId field)
  if (context.dimensions.configuration) {
    // Handle "None" case where configuration ID is null
    if (context.dimensions.configuration.id === null) {
      where.configId = null;
    } else {
      where.configId = Number(context.dimensions.configuration.id);
    }
  }

  if (context.dimensions.milestone) {
    // Handle "None" case where milestone ID is null
    if (context.dimensions.milestone.id === null) {
      where.milestoneId = null;
    } else {
      where.milestone = {
        id: Number(context.dimensions.milestone.id),
      };
    }
  }

  return {
    where,
    include: {
      project: {
        select: {
          id: true,
          name: true,
        },
      },
      state: {
        select: {
          name: true,
          icon: {
            select: {
              name: true,
            },
          },
          color: {
            select: {
              value: true,
            },
          },
        },
      },
      createdBy: true,
      milestone: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    skip: offset,
    take: limit,
    orderBy: {
      createdAt: Prisma.SortOrder.desc,
    } as Prisma.TestRunsOrderByWithRelationInput,
  };
}

/**
 * Build query for repository stats drill-down
 * This is for REPOSITORY-STATS reports - filters by creation date, creator, etc.
 * NOT by execution results like test-execution reports
 */
export function buildRepositoryStatsQuery(
  context: DrillDownContext,
  offset: number,
  limit: number
): Prisma.RepositoryCasesFindManyArgs {
  const where: Prisma.RepositoryCasesWhereInput = {
    isDeleted: false,
  };

  // Apply project filter directly to RepositoryCases (not through test runs)
  if (context.projectId) {
    where.projectId = context.projectId;
  } else if (context.dimensions.project) {
    where.projectId = Number(context.dimensions.project.id);
  }

  // Apply creator filter
  // For user-engagement reports, the dimension is "user" but we filter by creator
  // For repository-stats reports, the dimension is "creator"
  if (context.dimensions.creator) {
    where.creatorId = String(context.dimensions.creator.id);
  } else if (context.dimensions.user) {
    where.creatorId = String(context.dimensions.user.id);
  }

  // Apply folder filter
  if (context.dimensions.folder) {
    where.folderId = Number(context.dimensions.folder.id);
  }

  // Apply state filter
  if (context.dimensions.state) {
    where.stateId = Number(context.dimensions.state.id);
  }

  // Apply template filter
  if (context.dimensions.template) {
    // Handle "None" case where template ID is null
    if (context.dimensions.template.id === null) {
      where.templateId = { is: null } as any;
    } else {
      where.templateId = Number(context.dimensions.template.id);
    }
  }

  // Apply source filter
  if (context.dimensions.source) {
    where.source = context.dimensions.source.id as any;
  }

  // Apply automated filter for automatedCount/manualCount metrics
  if (context.metricId === "automatedCount") {
    where.automated = true;
  } else if (context.metricId === "manualCount") {
    where.automated = false;
  }

  // Apply date filter to CREATION date (not execution date!)
  if (context.dimensions.date?.createdAt) {
    const createdAtValue = context.dimensions.date.createdAt;
    if (
      typeof createdAtValue === "string" ||
      (createdAtValue &&
        typeof createdAtValue === "object" &&
        "getTime" in createdAtValue)
    ) {
      const date = new Date(createdAtValue as string | Date);
      where.createdAt = {
        gte: startOfDayUTC(date),
        lt: endOfDayUTC(date),
      };
    }
  } else if (context.dimensions.date?.executedAt) {
    // Fallback: if executedAt is provided (from test-execution date dimension), use it
    const executedAtValue = context.dimensions.date.executedAt;
    if (
      typeof executedAtValue === "string" ||
      (executedAtValue &&
        typeof executedAtValue === "object" &&
        "getTime" in executedAtValue)
    ) {
      const date = new Date(executedAtValue as string | Date);
      where.createdAt = {
        gte: startOfDayUTC(date),
        lt: endOfDayUTC(date),
      };
    }
  }

  // Apply report-level date range to CREATION date
  if (context.startDate || context.endDate) {
    const existing = where.createdAt as any;
    where.createdAt = {
      ...(existing || {}),
      ...(context.startDate && { gte: new Date(context.startDate) }),
      ...(context.endDate && { lte: new Date(context.endDate) }),
    };
  }

  return {
    where,
    include: {
      project: {
        select: {
          id: true,
          name: true,
        },
      },
      folder: {
        select: {
          id: true,
          name: true,
        },
      },
      state: {
        select: {
          name: true,
          icon: {
            select: {
              name: true,
            },
          },
          color: {
            select: {
              value: true,
            },
          },
        },
      },
      creator: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      template: {
        select: {
          id: true,
          templateName: true,
        },
      },
      // Include steps for averageSteps and totalSteps metrics
      ...(context.metricId === "averageSteps" ||
      context.metricId === "totalSteps" ||
      context.metricId === "avgStepsPerCase"
        ? {
            steps: {
              where: {
                isDeleted: false,
              },
              select: {
                id: true,
              },
            },
          }
        : {}),
    },
    skip: offset,
    take: limit,
    orderBy: {
      createdAt: Prisma.SortOrder.desc,
    } as Prisma.RepositoryCasesOrderByWithRelationInput,
  };
}

/**
 * Build query for test cases drill-down
 * NOTE: This is for EXECUTION reports - we filter by execution date, not creation date
 */
export function buildTestCasesQuery(
  context: DrillDownContext,
  offset: number,
  limit: number
): Prisma.RepositoryCasesFindManyArgs {
  const where: Prisma.RepositoryCasesWhereInput = {
    isDeleted: false,
  };

  // DON'T filter by RepositoryCases.projectId directly!
  // Test runs in one project can execute test cases from other projects.
  // Instead, we filter by the test run's project through the results.testRun relation.

  // Build testRun filter for all dimension filters
  const testRunFilter: any = {
    isDeleted: false,
  };

  // Apply project filter to the TEST RUN, not the repository case
  if (context.projectId) {
    testRunFilter.projectId = context.projectId;
  } else if (context.dimensions.project) {
    testRunFilter.projectId = Number(context.dimensions.project.id);
  }

  // Apply configuration filter to testRun
  if (context.dimensions.configuration) {
    // Handle "None" case where configuration ID is null
    if (context.dimensions.configuration.id === null) {
      testRunFilter.configId = null;
    } else {
      testRunFilter.configId = Number(context.dimensions.configuration.id);
    }
  }

  // Apply milestone filter to testRun
  if (context.dimensions.milestone) {
    // Handle "None" case where milestone ID is null
    if (context.dimensions.milestone.id === null) {
      testRunFilter.milestoneId = null;
    } else {
      testRunFilter.milestoneId = Number(context.dimensions.milestone.id);
    }
  }

  // Apply testRun filter
  if (context.dimensions.testRun) {
    testRunFilter.id = Number(context.dimensions.testRun.id);
  }

  // Build execution results filter
  const resultsFilter: any = {};

  // Apply user filter to execution results
  if (context.dimensions.user) {
    resultsFilter.executedById = String(context.dimensions.user.id);
  }

  // Apply status filter only if a specific status dimension is selected
  // For testCaseCount metric, exclude "untested" status to match aggregation behavior
  if (context.dimensions.status) {
    resultsFilter.statusId = Number(context.dimensions.status.id);
  } else if (context.metricId === "testCaseCount") {
    // Exclude "untested" status to match testCaseCount aggregation
    resultsFilter.status = {
      systemName: { not: "untested" },
    };
  }

  // CRITICAL: Filter by the TestRunResults.testRun.projectId, not TestRunCases.testRun.projectId
  // TestRunResults.testRunId can be different from TestRunCases.testRunId!
  resultsFilter.testRun = testRunFilter;

  // Apply date filter to EXECUTION date (not creation date!)
  if (context.dimensions.date?.executedAt) {
    const date = new Date(context.dimensions.date.executedAt);
    resultsFilter.executedAt = {
      gte: startOfDayUTC(date),
      lt: endOfDayUTC(date),
    };
  }

  // Apply report-level date range to EXECUTION date
  if (context.startDate || context.endDate) {
    const existing = resultsFilter.executedAt as any;
    resultsFilter.executedAt = {
      ...(existing || {}),
      ...(context.startDate && { gte: new Date(context.startDate) }),
      ...(context.endDate && { lte: new Date(context.endDate) }),
    };
  }

  // Filter test cases by their execution results
  // The relationship is: RepositoryCases → TestRunCases ← TestRunResults (via testRunCaseId)
  // CRITICAL: We filter at the TestRunResults level, not TestRunCases level
  // because TestRunResults.testRunId ≠ TestRunCases.testRunId in some cases!
  where.testRuns = {
    some: {
      results: {
        some: resultsFilter,
      },
    },
  };

  return {
    where,
    include: {
      project: {
        select: {
          id: true,
          name: true,
        },
      },
      folder: {
        select: {
          id: true,
          name: true,
        },
      },
      state: {
        include: {
          color: true,
        },
      },
    },
    skip: offset,
    take: limit,
    orderBy: {
      createdAt: Prisma.SortOrder.desc,
    } as Prisma.RepositoryCasesOrderByWithRelationInput,
  };
}

/**
 * Build query for exploratory sessions drill-down
 */
export function buildSessionsQuery(
  context: DrillDownContext,
  offset: number,
  limit: number
): Prisma.SessionsFindManyArgs {
  const where: Prisma.SessionsWhereInput = {};

  // Apply project filter
  if (context.projectId) {
    where.projectId = context.projectId;
  } else if (context.dimensions.project) {
    where.projectId = Number(context.dimensions.project.id);
  }

  // Apply dimension filters
  if (context.dimensions.user) {
    where.createdById = String(context.dimensions.user.id);
  }

  // Apply date filter
  if (context.dimensions.date?.executedAt) {
    const date = new Date(context.dimensions.date.executedAt);
    where.createdAt = {
      gte: startOfDayUTC(date),
      lt: endOfDayUTC(date),
    };
  }

  // Apply report-level date range
  const dateRangeFilter = buildDateFilter(
    context.startDate,
    context.endDate,
    "createdAt"
  );
  if (
    dateRangeFilter.createdAt &&
    typeof dateRangeFilter.createdAt === "object"
  ) {
    const existing = where.createdAt as any;
    where.createdAt = existing
      ? { ...existing, ...(dateRangeFilter.createdAt as any) }
      : dateRangeFilter.createdAt;
  }

  return {
    where,
    include: {
      project: {
        select: {
          id: true,
          name: true,
        },
      },
      createdBy: true,
    },
    skip: offset,
    take: limit,
    orderBy: {
      createdAt: Prisma.SortOrder.desc,
    } as Prisma.SessionsOrderByWithRelationInput,
  };
}

/**
 * Build query for session results drill-down
 */
export function buildSessionResultsQuery(
  context: DrillDownContext,
  offset: number,
  limit: number
): Prisma.SessionResultsFindManyArgs {
  const where: Prisma.SessionResultsWhereInput = {};

  // Build session filter with all conditions
  const sessionFilter: any = {};

  // Apply project filter
  if (context.projectId) {
    sessionFilter.projectId = context.projectId;
  } else if (context.mode === "cross-project" && context.dimensions.project) {
    sessionFilter.projectId = Number(context.dimensions.project.id);
  }

  sessionFilter.isDeleted = false;

  // Apply session filter if we have any conditions
  if (Object.keys(sessionFilter).length > 0) {
    where.session = sessionFilter;
  }

  // Apply dimension filters
  if (context.dimensions.user) {
    where.createdById = String(context.dimensions.user.id);
  }

  // Apply date filter
  if (context.dimensions.date?.executedAt) {
    const date = new Date(context.dimensions.date.executedAt);
    where.createdAt = {
      gte: startOfDayUTC(date),
      lt: endOfDayUTC(date),
    };
  }

  // Apply report-level date range
  const dateRangeFilter = buildDateFilter(
    context.startDate,
    context.endDate,
    "createdAt"
  );
  if (
    dateRangeFilter.createdAt &&
    typeof dateRangeFilter.createdAt === "object"
  ) {
    const existing = where.createdAt as any;
    where.createdAt = existing
      ? { ...existing, ...(dateRangeFilter.createdAt as any) }
      : dateRangeFilter.createdAt;
  }

  return {
    where,
    include: {
      session: {
        select: {
          id: true,
          name: true,
          isDeleted: true,
          project: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
      createdBy: true,
    },
    skip: offset,
    take: limit,
    orderBy: {
      createdAt: Prisma.SortOrder.desc,
    } as Prisma.SessionResultsOrderByWithRelationInput,
  };
}

/**
 * Build query for issues drill-down
 */
export function buildIssuesQuery(
  context: DrillDownContext,
  offset: number,
  limit: number
): Prisma.IssueFindManyArgs {
  const where: Prisma.IssueWhereInput = {};

  // Apply project filter
  if (context.projectId) {
    where.projectId = context.projectId;
  } else if (context.dimensions.project) {
    where.projectId = Number(context.dimensions.project.id);
  }

  // Apply dimension filters
  if (context.dimensions.user) {
    where.createdById = String(context.dimensions.user.id);
  }

  // Apply date filter
  if (context.dimensions.date?.executedAt) {
    const date = new Date(context.dimensions.date.executedAt);
    where.createdAt = {
      gte: startOfDayUTC(date),
      lt: endOfDayUTC(date),
    };
  }

  // Apply report-level date range
  const dateRangeFilter = buildDateFilter(
    context.startDate,
    context.endDate,
    "createdAt"
  );
  if (
    dateRangeFilter.createdAt &&
    typeof dateRangeFilter.createdAt === "object"
  ) {
    const existing = where.createdAt as any;
    where.createdAt = existing
      ? { ...existing, ...(dateRangeFilter.createdAt as any) }
      : dateRangeFilter.createdAt;
  }

  return {
    where,
    include: {
      project: {
        select: {
          id: true,
          name: true,
        },
      },
      createdBy: true,
    },
    skip: offset,
    take: limit,
    orderBy: {
      createdAt: Prisma.SortOrder.desc,
    } as Prisma.IssueOrderByWithRelationInput,
  };
}

/**
 * Build query for milestones drill-down
 */
export function buildMilestonesQuery(
  context: DrillDownContext,
  offset: number,
  limit: number
): Prisma.MilestonesFindManyArgs {
  const where: Prisma.MilestonesWhereInput = {
    isDeleted: false,
  };

  // Apply project filter
  if (context.projectId) {
    where.projectId = context.projectId;
  } else if (context.dimensions.project) {
    where.projectId = Number(context.dimensions.project.id);
  }

  // Apply creator filter
  if (context.dimensions.creator) {
    where.createdBy = String(context.dimensions.creator.id);
  }

  // Apply milestone filter (when drilling into a specific milestone)
  if (context.dimensions.milestone) {
    if (context.dimensions.milestone.id === null) {
      // This shouldn't happen for milestones, but handle it
      where.id = -1; // No milestones match
    } else {
      where.id = Number(context.dimensions.milestone.id);
    }
  }

  // Apply date filter (createdAt) - only if date dimension is present in the report
  // For project-health reports, date dimension uses createdAt
  if (context.dimensions.date) {
    const dateDim = context.dimensions.date as any;
    let dateValue: string | Date | undefined;

    if (
      dateDim.createdAt &&
      (typeof dateDim.createdAt === "string" ||
        dateDim.createdAt instanceof Date)
    ) {
      dateValue = dateDim.createdAt;
    } else if (
      dateDim.executedAt &&
      (typeof dateDim.executedAt === "string" ||
        dateDim.executedAt instanceof Date)
    ) {
      dateValue = dateDim.executedAt;
    }

    if (dateValue) {
      const date =
        typeof dateValue === "string" ? new Date(dateValue) : dateValue;
      if (!isNaN(date.getTime())) {
        const startOfDay = startOfDayUTC(date);
        const nextDayStart = new Date(startOfDay);
        nextDayStart.setUTCDate(nextDayStart.getUTCDate() + 1);
        where.createdAt = {
          gte: startOfDay,
          lt: nextDayStart,
        };
      }
    }
  }

  // For activeMilestones metric, filter by isStarted=true and isCompleted=false
  if (context.metricId === "activeMilestones") {
    where.isStarted = true;
    where.isCompleted = false;
  }

  return {
    where,
    include: {
      project: {
        select: {
          id: true,
          name: true,
        },
      },
      milestoneType: {
        include: {
          icon: {
            select: {
              name: true,
            },
          },
        },
      },
      creator: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
    skip: offset,
    take: limit,
    orderBy: {
      createdAt: Prisma.SortOrder.desc,
    } as Prisma.MilestonesOrderByWithRelationInput,
  };
}

/**
 * Build query for milestone completion drill-down
 * Shows test cases from test runs in the milestone with their completion status
 */
export function buildMilestoneCompletionQuery(
  context: DrillDownContext,
  offset: number,
  limit: number
): Prisma.TestRunCasesFindManyArgs {
  const where: Prisma.TestRunCasesWhereInput = {};

  // Apply project filter through test run
  const testRunFilter: Prisma.TestRunsWhereInput = {
    isDeleted: false,
  };

  if (context.projectId) {
    testRunFilter.projectId = context.projectId;
  } else if (context.dimensions.project) {
    testRunFilter.projectId = Number(context.dimensions.project.id);
  }

  // Apply milestone filter
  if (context.dimensions.milestone) {
    if (context.dimensions.milestone.id === null) {
      testRunFilter.milestoneId = null;
    } else {
      testRunFilter.milestoneId = Number(context.dimensions.milestone.id);
    }
  }

  // Apply creator filter (milestone creator)
  if (context.dimensions.creator) {
    testRunFilter.milestone = {
      createdBy: String(context.dimensions.creator.id),
    };
  }

  // Apply date filter if present
  if (context.dimensions.date) {
    const dateDim = context.dimensions.date as any;
    let dateValue: string | Date | undefined;

    if (
      dateDim.createdAt &&
      (typeof dateDim.createdAt === "string" ||
        (typeof dateDim.createdAt === "object" &&
          "getTime" in dateDim.createdAt))
    ) {
      dateValue = dateDim.createdAt;
    }

    if (dateValue) {
      const date =
        typeof dateValue === "string" ? new Date(dateValue) : dateValue;
      if (!isNaN(date.getTime())) {
        const startOfDay = startOfDayUTC(date);
        const nextDayStart = new Date(startOfDay);
        nextDayStart.setUTCDate(nextDayStart.getUTCDate() + 1);

        if (!testRunFilter.milestone) {
          testRunFilter.milestone = {};
        }
        testRunFilter.milestone.createdAt = {
          gte: startOfDay,
          lt: nextDayStart,
        };
      }
    }
  }

  where.testRun = testRunFilter;

  return {
    where,
    include: {
      repositoryCase: {
        select: {
          id: true,
          name: true,
          project: {
            select: {
              id: true,
              name: true,
            },
          },
          folder: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
      testRun: {
        select: {
          id: true,
          name: true,
          milestone: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
      status: {
        include: {
          color: true,
        },
      },
    },
    skip: offset,
    take: limit,
    orderBy: {
      order: Prisma.SortOrder.asc,
    } as Prisma.TestRunCasesOrderByWithRelationInput,
  };
}

/**
 * Map metric ID to the appropriate query builder
 */
export function getQueryBuilderForMetric(
  metricId: string,
  reportType?: string
) {
  // Milestone metrics
  if (metricId === "totalMilestones" || metricId === "activeMilestones") {
    return buildMilestonesQuery;
  }

  // Milestone completion metric - shows test cases from test runs
  if (metricId === "milestoneCompletion") {
    return buildMilestoneCompletionQuery;
  }

  // Test execution metrics
  if (
    metricId === "testResults" ||
    metricId === "passRate" ||
    metricId === "avgElapsed" ||
    metricId === "avgElapsedTime" ||
    metricId === "averageElapsed" || // user-engagement metric
    metricId === "sumElapsed" ||
    metricId === "totalElapsedTime" ||
    metricId === "executionCount" || // user-engagement metric
    metricId === "testResultCount" // alternative name
  ) {
    return buildTestExecutionQuery;
  }

  // Test run metrics
  if (metricId === "testRuns" || metricId === "testRunCount") {
    return buildTestRunsQuery;
  }

  // Repository stats metrics - use repository stats query builder
  // These filter by creation date, creator, etc., NOT by execution results
  if (
    metricId === "automatedCount" ||
    metricId === "manualCount" ||
    metricId === "totalSteps" ||
    metricId === "averageSteps" ||
    metricId === "avgStepsPerCase" ||
    metricId === "automationRate"
  ) {
    return buildRepositoryStatsQuery;
  }

  // Test case metrics - need to check report type to determine which query builder
  // For test-execution reports: filter by execution results
  // For repository-stats and user-engagement reports: filter by creation date, creator, etc.
  if (
    metricId === "testCases" ||
    metricId === "testCaseCount" ||
    metricId === "createdCaseCount"
  ) {
    // Check report type to determine which query builder to use
    if (
      reportType === "repository-stats" ||
      reportType === "cross-project-repository-stats" ||
      reportType === "user-engagement" ||
      reportType === "cross-project-user-engagement"
    ) {
      return buildRepositoryStatsQuery;
    }
    // Default to test cases query (for test-execution reports)
    return buildTestCasesQuery;
  }

  // Session metrics
  if (
    metricId === "sessions" ||
    metricId === "sessionDuration" ||
    metricId === "sessionCount" ||
    metricId === "averageDuration" ||
    metricId === "totalDuration"
  ) {
    return buildSessionsQuery;
  }

  // Session result metrics
  if (metricId === "sessionResultCount") {
    return buildSessionResultsQuery;
  }

  // Issue metrics
  if (metricId === "issues" || metricId === "issueCount") {
    return buildIssuesQuery;
  }

  // Default to test executions
  return buildTestExecutionQuery;
}

/**
 * Get the Prisma model name for a metric ID
 */
export function getModelForMetric(metricId: string): string {
  // Milestone metrics
  if (metricId === "totalMilestones" || metricId === "activeMilestones") {
    return "milestones";
  }

  // Milestone completion - returns test run cases
  if (metricId === "milestoneCompletion") {
    return "testRunCases";
  }

  if (
    metricId === "testResults" ||
    metricId === "passRate" ||
    metricId === "avgElapsed" ||
    metricId === "avgElapsedTime" ||
    metricId === "averageElapsed" ||
    metricId === "sumElapsed" ||
    metricId === "totalElapsedTime" ||
    metricId === "executionCount" ||
    metricId === "testResultCount"
  ) {
    return "testRunResults";
  }

  if (metricId === "testRuns" || metricId === "testRunCount") {
    return "testRuns";
  }

  if (
    metricId === "testCases" ||
    metricId === "testCaseCount" ||
    metricId === "createdCaseCount" ||
    metricId === "automatedCount" ||
    metricId === "manualCount" ||
    metricId === "totalSteps" ||
    metricId === "averageSteps" ||
    metricId === "avgStepsPerCase" ||
    metricId === "automationRate"
  ) {
    return "repositoryCases";
  }

  if (
    metricId === "sessions" ||
    metricId === "sessionDuration" ||
    metricId === "sessionCount" ||
    metricId === "averageDuration" ||
    metricId === "totalDuration"
  ) {
    return "sessions";
  }

  if (metricId === "sessionResultCount") {
    return "sessionResults";
  }

  if (metricId === "issues" || metricId === "issueCount") {
    return "issue";
  }

  return "testRunResults";
}
