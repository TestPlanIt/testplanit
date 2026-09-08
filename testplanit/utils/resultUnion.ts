/**
 * THE canonical source for the manual ∪ automated result union.
 *
 * TestPlanIt stores executions in TWO tables — TestRunResults (manual;
 * duration in `elapsed`, seconds) and JUnitTestResult (automated; duration
 * in `time`, seconds, linked straight to the repository case through the
 * suite's run). Every result-level report metric operates on the union of
 * both, under one contract:
 *
 * - Untested is not an execution; a null JUnit statusId is treated as
 *   Untested. Both are excluded everywhere.
 * - Deleted rows, deleted runs, and deleted parents are excluded.
 * - Durations are SECONDS end to end (see utils/metricUnits.ts).
 * - Automated results attribute to the submitting user (createdById).
 * - JUnit rows without an execution timestamp cannot sit on a date axis;
 *   date-grouped reads exclude them (product ruling Q4).
 *
 * Every helper takes the database client as a parameter — this module is
 * bundled into client components via reportUtils, so it must never import
 * the server-only prisma stack.
 *
 * Consumers today: the test-execution and user-engagement registries
 * (utils/reportUtils.ts). The execution-log union
 * (utils/executionLogUtils.ts) and the drill-down dual-source handler
 * (app/api/report-builder/drill-down) implement the same contract in their
 * own query shapes — any semantic change here must be mirrored there.
 */

/**
 * Where-clause for automated durations. Automated results live in
 * JUnitTestResult (duration in `time`, seconds) rather than TestRunResults,
 * so every result-level metric reads both tables.
 */
export function junitResultWhere(
  projectId: number | undefined,
  isProjectSpecific: boolean,
  filters?: { startDate?: string; endDate?: string },
  opts: {
    requireTime?: boolean;
    requireExecutedAt?: boolean;
    runFilter?: Record<string, unknown>;
  } = {}
) {
  // requireExecutedAt and the date range both constrain executedAt — they
  // must merge into one condition, or whichever spreads last silently
  // discards the other.
  const executedAtFilter = {
    ...(opts.requireExecutedAt ? { not: null } : {}),
    ...(buildDateFilter(filters, "executedAt").executedAt ?? {}),
  };
  return {
    ...(opts.requireTime ? { time: { gt: 0 } } : {}),
    ...(Object.keys(executedAtFilter).length > 0
      ? { executedAt: executedAtFilter }
      : {}),
    // Untested is not an execution, and a null statusId is treated as
    // Untested — both are excluded from every result-level metric.
    statusId: { not: null },
    status: { systemName: { not: "untested" } },
    testSuite: {
      // runFilter lets run-scoped metrics (testRunCount) constrain by run
      // fields like createdAt instead of the default project scope.
      testRun: opts.runFilter ?? {
        ...(isProjectSpecific && projectId
          ? { projectId: Number(projectId) }
          : {}),
        isDeleted: false,
      },
    },
  };
}

/**
 * Where-clause for manual results (TestRunResults) in result-level metrics:
 * live rows in live runs, Untested excluded (an untested row is a
 * placeholder, not an execution).
 */
export function manualResultWhere(
  projectId: number | undefined,
  isProjectSpecific: boolean,
  filters?: { startDate?: string; endDate?: string },
  opts: { requireElapsed?: boolean } = {}
) {
  return {
    isDeleted: false,
    ...(opts.requireElapsed ? { elapsed: { not: null } } : {}),
    status: { systemName: { not: "untested" } },
    testRun: {
      ...(isProjectSpecific && projectId
        ? { projectId: Number(projectId) }
        : {}),
      isDeleted: false,
    },
    ...buildDateFilter(filters, "executedAt"),
  };
}

/**
 * Fetches JUnit results shaped like TestRunResults rows so `groupResults`
 * folds them in unchanged. JUnit rows link straight to the repository case
 * (the testCase dimension's group key), so no run-case indirection is
 * needed. Rows without an execution timestamp are excluded from date
 * groupings — they cannot be placed on a date axis.
 */
export async function fetchJunitResultRows(
  db: any,
  projectId: number | undefined,
  isProjectSpecific: boolean,
  groupBy: string[],
  filters?: { startDate?: string; endDate?: string },
  opts: {
    requireTime?: boolean;
    requireExecutedAt?: boolean;
    includeStatusFlags?: boolean;
    runFilter?: Record<string, unknown>;
  } = {}
) {
  const needsFolder = groupBy.includes("folderId");
  const needsTag = groupBy.includes("tagId");
  const junitResults = await db.jUnitTestResult.findMany({
    where: junitResultWhere(projectId, isProjectSpecific, filters, {
      ...opts,
      requireExecutedAt:
        opts.requireExecutedAt || groupBy.includes("executedAt"),
    }),
    select: {
      executedAt: true,
      createdById: true,
      statusId: true,
      time: true,
      repositoryCaseId: true,
      ...(opts.includeStatusFlags
        ? { status: { select: { isSuccess: true } } }
        : {}),
      ...(needsFolder || needsTag
        ? {
            repositoryCase: {
              select: {
                ...(needsFolder ? { folderId: true } : {}),
                ...(needsTag
                  ? {
                      caseTags: {
                        where: { tag: { isDeleted: false } },
                        select: { tagId: true },
                      },
                    }
                  : {}),
              },
            },
          }
        : {}),
      testSuite: {
        select: {
          testRunId: true,
          testRun: {
            select: { projectId: true, configId: true, milestoneId: true },
          },
        },
      },
    },
  });

  return junitResults.map((r: any) => ({
    executedAt: r.executedAt,
    executedById: r.createdById,
    statusId: r.statusId,
    elapsed: r.time,
    ...(opts.includeStatusFlags ? { status: r.status } : {}),
    testRunId: r.testSuite.testRunId,
    testRun: r.testSuite.testRun,
    testRunCase: {
      repositoryCaseId: r.repositoryCaseId,
      ...(r.repositoryCase ? { repositoryCase: r.repositoryCase } : {}),
    },
  }));
}

export function buildDateFilter(
  filters?: { startDate?: string; endDate?: string },
  dateField: string = "executedAt"
) {
  const conditions: any = {};

  if (filters?.startDate) {
    // Normalize start date to UTC midnight (start of day)
    const startDate = new Date(filters.startDate);
    startDate.setUTCHours(0, 0, 0, 0);
    conditions[dateField] = { gte: startDate };
  }

  if (filters?.endDate) {
    // Use next day as exclusive boundary to include the entire end date
    const nextDay = new Date(filters.endDate);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    nextDay.setUTCHours(0, 0, 0, 0);

    if (conditions[dateField]) {
      conditions[dateField].lt = nextDay;
    } else {
      conditions[dateField] = { lt: nextDay };
    }
  }

  return conditions;
}

/** Executor identity needed by the engagement dimensions (role + groups). */
export const engagementUserSelect = {
  select: {
    roleId: true,
    groups: { select: { groupId: true } },
  },
};

/**
 * Rows for engagement execution metrics: the manual ∪ automated result
 * union with executor identity attached, shaped for engagement grouping
 * (user/role/group/project/date). Automated results attribute to the
 * submitting user. Rows without an execution timestamp cannot sit on a
 * date axis and are excluded from date groupings; elsewhere they fall
 * back to their submission time.
 */
export async function fetchEngagementExecutionRows(
  db: any,
  projectId: number | undefined,
  isProjectSpecific: boolean,
  groupBy: string[],
  filters?: { startDate?: string; endDate?: string },
  opts: { requireElapsed?: boolean } = {}
) {
  const [manual, junit] = await Promise.all([
    db.testRunResults.findMany({
      where: manualResultWhere(projectId, isProjectSpecific, filters, {
        requireElapsed: opts.requireElapsed,
      }),
      select: {
        executedAt: true,
        executedById: true,
        elapsed: true,
        executedBy: engagementUserSelect,
        testRun: { select: { projectId: true } },
      },
    }),
    db.jUnitTestResult.findMany({
      where: junitResultWhere(projectId, isProjectSpecific, filters, {
        requireTime: opts.requireElapsed,
        requireExecutedAt: groupBy.includes("executedAt"),
      }),
      select: {
        executedAt: true,
        createdAt: true,
        createdById: true,
        time: true,
        createdBy: engagementUserSelect,
        testSuite: { select: { testRun: { select: { projectId: true } } } },
      },
    }),
  ]);

  return [
    ...manual.map((r: any) => ({
      executedAt: r.executedAt,
      userId: r.executedById,
      roleId: r.executedBy?.roleId ?? null,
      groupIds: (r.executedBy?.groups ?? []).map((g: any) => g.groupId),
      projectId: r.testRun.projectId,
      elapsed: r.elapsed,
    })),
    ...junit.map((r: any) => ({
      executedAt: r.executedAt ?? r.createdAt,
      userId: r.createdById,
      roleId: r.createdBy?.roleId ?? null,
      groupIds: (r.createdBy?.groups ?? []).map((g: any) => g.groupId),
      projectId: r.testSuite.testRun.projectId,
      elapsed: r.time,
    })),
  ];
}

/**
 * Groups engagement rows on any combination of the engagement dimensions.
 * Group membership fans out (a user in two groups counts in both; users in
 * no group have no bucket on that dimension), matching how the group
 * dimension has always aggregated.
 */
export function groupEngagementRows(
  rows: any[],
  groupBy: string[],
  makeBucket: () => any,
  accumulate: (bucket: any, row: any) => void
) {
  const grouped = new Map<string, any>();
  const add = (row: any, groupId: number | null) => {
    const keyFor = (field: string) => {
      if (field === "executedAt") {
        const date = new Date(row.executedAt);
        date.setUTCHours(0, 0, 0, 0);
        return date.toISOString();
      }
      if (field === "groupId") return groupId;
      return row[field];
    };
    const key = groupBy.map(keyFor).join("|");
    if (!grouped.has(key)) {
      const bucket: any = makeBucket();
      groupBy.forEach((field) => {
        bucket[field] = keyFor(field);
      });
      grouped.set(key, bucket);
    }
    accumulate(grouped.get(key), row);
  };

  rows.forEach((row) => {
    if (groupBy.includes("groupId")) {
      (row.groupIds ?? []).forEach((gid: number) => add(row, gid));
    } else {
      add(row, null);
    }
  });
  return grouped;
}
