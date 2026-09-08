/**
 * Query builders for report drill-down functionality
 * These functions construct database queries to fetch underlying records for each metric type
 */

import type {
  IssueFindManyArgs,
  IssueWhereInput,
  MilestonesFindManyArgs,
  MilestonesWhereInput,
  RepositoryCasesFindManyArgs,
  RepositoryCasesWhereInput,
  SessionResultsFindManyArgs,
  SessionResultsWhereInput,
  SessionsFindManyArgs,
  SessionsWhereInput,
  TestRunCasesFindManyArgs,
  TestRunCasesWhereInput,
  TestRunResultsFindManyArgs,
  TestRunResultsWhereInput,
  TestRunsFindManyArgs,
  TestRunsWhereInput,
} from "~/zenstack/input";
import type { DrillDownContext } from "~/lib/types/reportDrillDown";

/**
 * Dimension ids each report type may send in a drill-down context. A key
 * outside this list means no builder handles it — the drawer would silently
 * ignore the filter and stop matching its cell — so the route rejects it
 * loudly instead. Report types without an entry (custom presets) skip the
 * check. Cross-project variants share their base type's list.
 */
export const DRILL_DOWN_DIMENSIONS_BY_REPORT: Record<
  string,
  ReadonlySet<string>
> = {
  "test-execution": new Set([
    "configuration",
    "date",
    "folder",
    "milestone",
    "project",
    "status",
    "tag",
    "testCase",
    "testRun",
    "user",
  ]),
  "user-engagement": new Set(["date", "group", "project", "role", "user"]),
  "repository-stats": new Set([
    "creator",
    "date",
    "folder",
    "project",
    "source",
    "state",
    "tag",
    "template",
    "testCase",
  ]),
  "issue-tracking": new Set([
    "creator",
    "date",
    "issueStatus",
    "issueTracker",
    "issueType",
    "priority",
    "project",
  ]),
  "session-analysis": new Set([
    "assignedTo",
    "creator",
    "date",
    "milestone",
    "session",
    "state",
    "template",
  ]),
  "project-health": new Set(["creator", "date", "milestone", "project"]),
  "milestone-readiness": new Set(["date", "milestone"]),
};

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
 * Build base date filter from report-level date range. Mirrors
 * reportUtils.buildDateFilter: the end date is inclusive of its entire day
 * (exclusive next-day-midnight bound), so a drill-down never shows fewer
 * rows than the aggregated cell.
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
      const start = new Date(startDate);
      start.setUTCHours(0, 0, 0, 0);
      filter[dateField].gte = start;
    }
    if (endDate) {
      const nextDay = new Date(endDate);
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      nextDay.setUTCHours(0, 0, 0, 0);
      filter[dateField].lt = nextDay;
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
): TestRunResultsFindManyArgs {
  const where: TestRunResultsWhereInput = { isDeleted: false };

  // Build testRun filter with all conditions
  const testRunFilter: any = { isDeleted: false };

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

  // Role/group dimensions (user-engagement) filter on the executor.
  const executorFilter: any = {};
  if (context.dimensions.role) {
    executorFilter.roleId =
      context.dimensions.role.id == null
        ? null
        : Number(context.dimensions.role.id);
  }
  if (context.dimensions.group) {
    executorFilter.groups =
      context.dimensions.group.id == null
        ? { none: {} }
        : { some: { groupId: Number(context.dimensions.group.id) } };
  }
  if (Object.keys(executorFilter).length > 0) {
    where.executedBy = executorFilter;
  }

  if (context.dimensions.status) {
    where.statusId = Number(context.dimensions.status.id);
  }

  // testCase (a repository case id), folder, and tag all filter on the
  // executed case. Build a single testRunCase filter so they compose.
  const runCaseFilter: any = {};
  if (context.dimensions.testCase) {
    runCaseFilter.repositoryCaseId = Number(context.dimensions.testCase.id);
  }
  const repositoryCaseFilter: any = {};
  if (context.dimensions.folder) {
    const folder = context.dimensions.folder;
    if (folder.id === null || folder.id === "") {
      repositoryCaseFilter.folderId = null;
    } else if (Array.isArray((folder as any).subtreeIds)) {
      // Descendants rolled up: match the clicked folder and its subtree.
      repositoryCaseFilter.folderId = {
        in: (folder as any).subtreeIds.map(Number),
      };
    } else {
      repositoryCaseFilter.folderId = Number(folder.id);
    }
  }
  if (context.dimensions.tag) {
    const tag = context.dimensions.tag;
    repositoryCaseFilter.caseTags =
      tag.id === null || tag.id === ""
        ? { none: {} }
        : { some: { tag: { id: Number(tag.id) } } };
  }
  if (Object.keys(repositoryCaseFilter).length > 0) {
    runCaseFilter.repositoryCase = repositoryCaseFilter;
  }
  if (Object.keys(runCaseFilter).length > 0) {
    where.testRunCase = runCaseFilter;
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
              hasParameters: true,
            },
          },
        },
      },
    },
    skip: offset,
    take: limit,
    orderBy: {
      executedAt: "desc",
    } as NonNullable<TestRunResultsFindManyArgs["orderBy"]>,
  };
}

/**
 * Build query for the automated half of a result-level drill-down.
 * Automated results live in JUnitTestResult, so result cells drill into
 * both tables; this mirrors buildTestExecutionQuery's dimension filters
 * onto the JUnit shape. The testCase dimension carries a repository case
 * id, which JUnit rows link to directly. Untested rows (including null
 * statusId, which is treated as Untested) are excluded per the reporting
 * contract; elapsed metrics additionally require a duration.
 */
export function buildJunitResultQuery(
  context: DrillDownContext,
  opts: { requireTime?: boolean } = {}
): Record<string, any> | null {
  const testCaseId = context.dimensions.testCase?.id;
  if (
    context.dimensions.testCase &&
    (testCaseId == null || testCaseId === "")
  ) {
    return null;
  }

  const where: Record<string, any> = {
    ...(opts.requireTime ? { time: { gt: 0 } } : {}),
    statusId: { not: null },
    status: { systemName: { not: "untested" } },
  };

  // Run-level filters travel through the suite's run.
  const testRunFilter: any = {};

  if (context.projectId) {
    testRunFilter.projectId = context.projectId;
  } else if (context.mode === "cross-project" && context.dimensions.project) {
    testRunFilter.projectId = Number(context.dimensions.project.id);
  }

  if (context.dimensions.configuration) {
    testRunFilter.configId =
      context.dimensions.configuration.id === null
        ? null
        : Number(context.dimensions.configuration.id);
  }

  if (context.dimensions.milestone) {
    testRunFilter.milestone = {
      id: Number(context.dimensions.milestone.id),
    };
  }

  if (context.dimensions.testRun) {
    if (context.dimensions.testRun.id === null) {
      testRunFilter.isDeleted = true;
    } else {
      testRunFilter.id = Number(context.dimensions.testRun.id);
    }
  }

  if (testCaseId != null && testCaseId !== "") {
    where.repositoryCaseId = Number(testCaseId);
  }

  if (Object.keys(testRunFilter).length > 0) {
    where.testSuite = { testRun: testRunFilter };
  }

  if (context.dimensions.user) {
    where.createdById = String(context.dimensions.user.id);
  }

  // Role/group dimensions (user-engagement) filter on the submitting user.
  const submitterFilter: any = {};
  if (context.dimensions.role) {
    submitterFilter.roleId =
      context.dimensions.role.id == null
        ? null
        : Number(context.dimensions.role.id);
  }
  if (context.dimensions.group) {
    submitterFilter.groups =
      context.dimensions.group.id == null
        ? { none: {} }
        : { some: { groupId: Number(context.dimensions.group.id) } };
  }
  if (Object.keys(submitterFilter).length > 0) {
    where.createdBy = submitterFilter;
  }

  if (context.dimensions.status) {
    where.statusId = Number(context.dimensions.status.id);
    delete where.status;
  }

  // Folder and tag filter on the linked repository case.
  const repositoryCaseFilter: any = {};
  if (context.dimensions.folder) {
    const folder = context.dimensions.folder;
    if (folder.id === null || folder.id === "") {
      repositoryCaseFilter.folderId = null;
    } else if (Array.isArray((folder as any).subtreeIds)) {
      repositoryCaseFilter.folderId = {
        in: (folder as any).subtreeIds.map(Number),
      };
    } else {
      repositoryCaseFilter.folderId = Number(folder.id);
    }
  }
  if (context.dimensions.tag) {
    const tag = context.dimensions.tag;
    repositoryCaseFilter.caseTags =
      tag.id === null || tag.id === ""
        ? { none: {} }
        : { some: { tag: { id: Number(tag.id) } } };
  }
  if (Object.keys(repositoryCaseFilter).length > 0) {
    where.repositoryCase = repositoryCaseFilter;
  }

  if (context.dimensions.date?.executedAt) {
    const date = new Date(context.dimensions.date.executedAt);
    where.executedAt = {
      gte: startOfDayUTC(date),
      lt: endOfDayUTC(date),
    };
  }

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

  return {
    where,
    include: {
      status: {
        include: {
          color: true,
        },
      },
      createdBy: true,
      repositoryCase: {
        select: {
          id: true,
          name: true,
          hasParameters: true,
        },
      },
      testSuite: {
        select: {
          testRun: {
            select: {
              id: true,
              name: true,
              projectId: true,
              configId: true,
              configuration: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      },
    },
    orderBy: {
      executedAt: "desc",
    },
  };
}

/**
 * Build query for test runs drill-down
 */
export function buildTestRunsQuery(
  context: DrillDownContext,
  offset: number,
  limit: number
): TestRunsFindManyArgs {
  // A "run" counts whether or not it has results (product ruling): the
  // date dimension and report date range use the run's createdAt, and
  // "by user" means the run's creator. Status/case groupings derive run
  // membership from the union of manual and automated results.
  const where: TestRunsWhereInput = { isDeleted: false };

  // Apply project filter
  if (context.projectId) {
    where.projectId = context.projectId;
  } else if (context.dimensions.project) {
    where.projectId = Number(context.dimensions.project.id);
  }

  if (context.dimensions.user) {
    where.createdById = String(context.dimensions.user.id);
  }

  if (context.dimensions.status) {
    const statusId = Number(context.dimensions.status.id);
    where.OR = [
      { results: { some: { isDeleted: false, statusId } } },
      {
        junitTestSuites: {
          some: { results: { some: { statusId } } },
        },
      },
    ];
  }

  // Date dimension and report-level range apply to the run's creation day
  if (context.dimensions.date?.executedAt) {
    const date = new Date(context.dimensions.date.executedAt);
    where.createdAt = {
      gte: startOfDayUTC(date),
      lt: endOfDayUTC(date),
    };
  }
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
      createdAt: "desc",
    } as NonNullable<TestRunsFindManyArgs["orderBy"]>,
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
): RepositoryCasesFindManyArgs {
  const where: RepositoryCasesWhereInput = {
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

  // Role/group dimensions (user-engagement) filter on the case's creator.
  const caseCreatorFilter: any = {};
  if (context.dimensions.role) {
    caseCreatorFilter.roleId =
      context.dimensions.role.id == null
        ? null
        : Number(context.dimensions.role.id);
  }
  if (context.dimensions.group) {
    caseCreatorFilter.groups =
      context.dimensions.group.id == null
        ? { none: {} }
        : { some: { groupId: Number(context.dimensions.group.id) } };
  }
  if (Object.keys(caseCreatorFilter).length > 0) {
    where.creator = caseCreatorFilter;
  }

  // Apply folder filter (a rolled-up subtree, or a single folder). Cases always
  // belong to a folder, so there is no null "None" case here.
  if (context.dimensions.folder && context.dimensions.folder.id != null) {
    const folder = context.dimensions.folder;
    where.folderId = Array.isArray((folder as any).subtreeIds)
      ? { in: (folder as any).subtreeIds.map(Number) }
      : Number(folder.id);
  }

  // Apply tag filter
  if (context.dimensions.tag) {
    const tag = context.dimensions.tag;
    where.caseTags =
      tag.id === null || tag.id === ""
        ? { none: {} }
        : { some: { tag: { id: Number(tag.id) } } };
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

  // Apply testCase filter (when drilling down by individual test case)
  if (context.dimensions.testCase) {
    where.id = Number(context.dimensions.testCase.id);
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
  const creationRangeFilter = buildDateFilter(
    context.startDate,
    context.endDate,
    "createdAt"
  );
  if (creationRangeFilter.createdAt) {
    const existing = where.createdAt as any;
    where.createdAt = { ...(existing || {}), ...creationRangeFilter.createdAt };
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
      createdAt: "desc",
    } as NonNullable<RepositoryCasesFindManyArgs["orderBy"]>,
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
): RepositoryCasesFindManyArgs {
  // "Executed cases" are repository cases with at least one result — manual
  // (TestRunResults) or automated (JUnitTestResult) — matching the cell's
  // dimension filters. Untested placeholders don't count as executions.
  const where: RepositoryCasesWhereInput = {
    isDeleted: false,
  };

  // Run-scope filter shared by both membership branches. Test runs in one
  // project can execute cases from other projects, so the project filter
  // applies to the RUN, not the repository case.
  const testRunFilter: any = {
    isDeleted: false,
  };

  if (context.projectId) {
    testRunFilter.projectId = context.projectId;
  } else if (context.dimensions.project) {
    testRunFilter.projectId = Number(context.dimensions.project.id);
  }

  if (context.dimensions.configuration) {
    if (context.dimensions.configuration.id === null) {
      testRunFilter.configId = null;
    } else {
      testRunFilter.configId = Number(context.dimensions.configuration.id);
    }
  }

  if (context.dimensions.milestone) {
    if (context.dimensions.milestone.id === null) {
      testRunFilter.milestoneId = null;
    } else {
      testRunFilter.milestoneId = Number(context.dimensions.milestone.id);
    }
  }

  if (context.dimensions.testRun) {
    testRunFilter.id = Number(context.dimensions.testRun.id);
  }

  // Manual-results membership branch
  const resultsFilter: any = {
    isDeleted: false,
    status: { systemName: { not: "untested" } },
    testRun: testRunFilter,
  };
  // Automated-results membership branch
  const junitFilter: any = {
    statusId: { not: null },
    status: { systemName: { not: "untested" } },
    testSuite: { testRun: testRunFilter },
  };

  if (context.dimensions.user) {
    resultsFilter.executedById = String(context.dimensions.user.id);
    junitFilter.createdById = String(context.dimensions.user.id);
  }

  if (context.dimensions.status) {
    const statusId = Number(context.dimensions.status.id);
    resultsFilter.statusId = statusId;
    delete resultsFilter.status;
    junitFilter.statusId = statusId;
    delete junitFilter.status;
  }

  // Execution-date filters apply to both branches
  const executedAtFilter: any = {};
  if (context.dimensions.date?.executedAt) {
    const date = new Date(context.dimensions.date.executedAt);
    executedAtFilter.gte = startOfDayUTC(date);
    executedAtFilter.lt = endOfDayUTC(date);
  }
  if (context.startDate) {
    executedAtFilter.gte = executedAtFilter.gte ?? new Date(context.startDate);
  }
  if (context.endDate) {
    executedAtFilter.lte = new Date(context.endDate);
  }
  if (Object.keys(executedAtFilter).length > 0) {
    resultsFilter.executedAt = executedAtFilter;
    junitFilter.executedAt = executedAtFilter;
  }

  where.OR = [
    // The relationship is: RepositoryCases → TestRunCases ← TestRunResults.
    // Filter at the TestRunResults level, not TestRunCases level, because
    // TestRunResults.testRunId ≠ TestRunCases.testRunId in some cases.
    { testRuns: { some: { results: { some: resultsFilter } } } },
    { junitResults: { some: junitFilter } },
  ];

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
      createdAt: "desc",
    } as NonNullable<RepositoryCasesFindManyArgs["orderBy"]>,
  };
}

/**
 * Build query for exploratory sessions drill-down
 */
export function buildSessionsQuery(
  context: DrillDownContext,
  offset: number,
  limit: number
): SessionsFindManyArgs {
  const where: SessionsWhereInput = { isDeleted: false };

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
  if (context.dimensions.creator) {
    where.createdById = String(context.dimensions.creator.id);
  }
  if (context.dimensions.session) {
    where.id = Number(context.dimensions.session.id);
  }
  if (context.dimensions.assignedTo) {
    where.assignedToId = String(context.dimensions.assignedTo.id);
  }
  if (context.dimensions.milestone) {
    where.milestoneId =
      context.dimensions.milestone.id === null
        ? null
        : Number(context.dimensions.milestone.id);
  }
  if (context.dimensions.template) {
    where.templateId = Number(context.dimensions.template.id);
  }
  if (context.dimensions.state) {
    where.stateId = Number(context.dimensions.state.id);
  }

  // The Active Sessions metric counts sessions still in progress.
  if (context.metricId === "activeSessions") {
    where.isCompleted = false;
  }

  // Apply date filter — the session date dimension is the creation day.
  const clickedSessionDate =
    (context.dimensions.date as any)?.createdAt ??
    context.dimensions.date?.executedAt;
  if (clickedSessionDate) {
    const date = new Date(clickedSessionDate as string);
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
      createdAt: "desc",
    } as NonNullable<SessionsFindManyArgs["orderBy"]>,
  };
}

/**
 * Build query for session results drill-down
 */
export function buildSessionResultsQuery(
  context: DrillDownContext,
  offset: number,
  limit: number
): SessionResultsFindManyArgs {
  const where: SessionResultsWhereInput = { isDeleted: false };

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

  // Role/group dimensions (user-engagement) filter on the result's creator.
  const creatorFilter: any = {};
  if (context.dimensions.role) {
    creatorFilter.roleId =
      context.dimensions.role.id == null
        ? null
        : Number(context.dimensions.role.id);
  }
  if (context.dimensions.group) {
    creatorFilter.groups =
      context.dimensions.group.id == null
        ? { none: {} }
        : { some: { groupId: Number(context.dimensions.group.id) } };
  }
  if (Object.keys(creatorFilter).length > 0) {
    where.createdBy = creatorFilter;
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
      createdAt: "desc",
    } as NonNullable<SessionResultsFindManyArgs["orderBy"]>,
  };
}

/**
 * Build query for issues drill-down
 */
export function buildIssuesQuery(
  context: DrillDownContext,
  offset: number,
  limit: number
): IssueFindManyArgs {
  const where: IssueWhereInput = { isDeleted: false };

  // Apply project filter. For project-scoped drill-downs the route swaps
  // this for the project-relevant issue population (direct FK plus
  // case/run/session links) to match the aggregation.
  if (context.projectId) {
    where.projectId = context.projectId;
  } else if (context.dimensions.project) {
    where.projectId = Number(context.dimensions.project.id);
  }

  // Apply dimension filters
  if (context.dimensions.user) {
    where.createdById = String(context.dimensions.user.id);
  }
  if (context.dimensions.creator) {
    where.createdById = String(context.dimensions.creator.id);
  }

  // Issues group by type NAME (external ids vary per tracker); "Unspecified"
  // carries a null id.
  if (context.dimensions.issueType) {
    where.issueTypeName =
      context.dimensions.issueType.id === null
        ? null
        : String(
            context.dimensions.issueType.name ?? context.dimensions.issueType.id
          );
  }

  if (context.dimensions.issueTracker) {
    where.integrationId =
      context.dimensions.issueTracker.id === null
        ? null
        : Number(context.dimensions.issueTracker.id);
  }

  if (context.dimensions.issueStatus) {
    where.status = String(context.dimensions.issueStatus.id);
  }

  // Priorities aggregate case-insensitively (dimension ids are lowercased).
  if (context.dimensions.priority) {
    where.priority = {
      equals: String(context.dimensions.priority.id),
      mode: "insensitive",
    } as any;
  }

  // Apply date filter — the issue-tracking date dimension is the issue's
  // creation day.
  const clickedDate =
    (context.dimensions.date as any)?.createdAt ??
    context.dimensions.date?.executedAt;
  if (clickedDate) {
    const date = new Date(clickedDate as string);
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
      createdAt: "desc",
    } as NonNullable<IssueFindManyArgs["orderBy"]>,
  };
}

/**
 * Build query for milestones drill-down
 */
export function buildMilestonesQuery(
  context: DrillDownContext,
  offset: number,
  limit: number
): MilestonesFindManyArgs {
  const where: MilestonesWhereInput = {
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
      createdAt: "desc",
    } as NonNullable<MilestonesFindManyArgs["orderBy"]>,
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
): TestRunCasesFindManyArgs {
  // The metric counts live run-cases in live runs of live milestones, so the
  // drill-down applies the same population filters.
  const where: TestRunCasesWhereInput = { isDeleted: false };

  // Apply project filter through test run
  const testRunFilter: TestRunsWhereInput = {
    isDeleted: false,
  };

  if (context.projectId) {
    testRunFilter.projectId = context.projectId;
  } else if (context.dimensions.project) {
    testRunFilter.projectId = Number(context.dimensions.project.id);
  }

  const milestoneFilter: any = { isDeleted: false };

  // Apply milestone filter
  if (
    context.dimensions.milestone &&
    context.dimensions.milestone.id !== null
  ) {
    testRunFilter.milestoneId = Number(context.dimensions.milestone.id);
  }

  // Apply creator filter (milestone creator)
  if (context.dimensions.creator) {
    milestoneFilter.createdBy = String(context.dimensions.creator.id);
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

        milestoneFilter.createdAt = {
          gte: startOfDay,
          lt: nextDayStart,
        };
      }
    }
  }

  // Apply report-level date range to the milestone's creation date, matching
  // the aggregation
  const milestoneRangeFilter = buildDateFilter(
    context.startDate,
    context.endDate,
    "createdAt"
  );
  if (milestoneRangeFilter.createdAt) {
    milestoneFilter.createdAt = {
      ...(milestoneFilter.createdAt || {}),
      ...milestoneRangeFilter.createdAt,
    };
  }

  testRunFilter.milestone = milestoneFilter;

  where.testRun = testRunFilter;

  return {
    where,
    include: {
      repositoryCase: {
        select: {
          id: true,
          name: true,
          hasParameters: true,
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
      order: "asc",
    } as NonNullable<TestRunCasesFindManyArgs["orderBy"]>,
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
    metricId === "sessionCount" ||
    metricId === "activeSessions" ||
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
    metricId === "sessionCount" ||
    metricId === "activeSessions" ||
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
