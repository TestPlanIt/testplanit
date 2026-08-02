import {
  buildFolderAncestorMap,
  groupResults,
  type GroupingOptions,
} from "~/utils/reportGrouping";

/**
 * Conditional `select` fragment for the executed case, included only when a
 * dimension needs case-level data (folder, tag, or the case id). Tag is the
 * implicit many-to-many to Tags; folder is a scalar FK on the case.
 */
function caseSelectFor(groupBy: string[]) {
  const needsFolder = groupBy.includes("folderId");
  const needsTag = groupBy.includes("tagId");
  const needsCaseId =
    groupBy.includes("testRunCaseId") || groupBy.includes("repositoryCaseId");
  if (!needsFolder && !needsTag && !needsCaseId) return {};
  return {
    testRunCase: {
      select: {
        repositoryCaseId: true,
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
      },
    },
  };
}

/**
 * `select` for repository-stats rows (the case is the row). Always carries the
 * scalar dimension columns; tags only when grouping by tag; metric-specific
 * fields (e.g. `automated`, `steps`) come in via `extra`.
 */
function repositoryCaseSelect(
  groupBy: string[],
  extra: Record<string, any> = {}
) {
  return {
    id: true,
    projectId: true,
    templateId: true,
    creatorId: true,
    stateId: true,
    source: true,
    folderId: true,
    createdAt: true,
    ...(groupBy.includes("tagId")
      ? {
          caseTags: {
            where: { tag: { isDeleted: false } },
            select: { tagId: true },
          },
        }
      : {}),
    ...extra,
  };
}

/**
 * Builds the folder ancestor map when, and only when, the folder dimension is
 * grouped with descendants enabled. Returned as grouping options ready to pass
 * to `groupResults`.
 */
async function folderGroupingOptions(
  db: any,
  projectId: number | undefined,
  isProjectSpecific: boolean,
  groupBy: string[],
  filters?: { folderIncludeDescendants?: boolean }
): Promise<GroupingOptions> {
  if (groupBy.includes("folderId") && filters?.folderIncludeDescendants) {
    return {
      folderAncestors: await buildFolderAncestorMap(
        db,
        projectId,
        isProjectSpecific
      ),
    };
  }
  return {};
}

/**
 * Where-clause for automated durations. Automated results live in
 * JUnitTestResult (duration in `time`, seconds) rather than TestRunResults,
 * so the elapsed metrics read both tables.
 */
function junitElapsedWhere(
  projectId: number | undefined,
  isProjectSpecific: boolean,
  filters?: { startDate?: string; endDate?: string }
) {
  return {
    time: { gt: 0 },
    testSuite: {
      testRun: {
        ...(isProjectSpecific && projectId
          ? { projectId: Number(projectId) }
          : {}),
        isDeleted: false,
      },
    },
    ...buildDateFilter(filters, "executedAt"),
  };
}

/**
 * Fetches JUnit results shaped like TestRunResults rows so `groupResults`
 * folds them in unchanged. JUnit rows link straight to the repository case
 * (the testCase dimension's group key), so no run-case indirection is
 * needed.
 */
async function fetchJunitElapsedRows(
  db: any,
  projectId: number | undefined,
  isProjectSpecific: boolean,
  groupBy: string[],
  filters?: { startDate?: string; endDate?: string }
) {
  const needsFolder = groupBy.includes("folderId");
  const needsTag = groupBy.includes("tagId");
  const junitResults = await db.jUnitTestResult.findMany({
    where: junitElapsedWhere(projectId, isProjectSpecific, filters),
    select: {
      executedAt: true,
      createdById: true,
      statusId: true,
      time: true,
      repositoryCaseId: true,
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
    testRunId: r.testSuite.testRunId,
    testRun: r.testSuite.testRun,
    testRunCase: {
      repositoryCaseId: r.repositoryCaseId,
      ...(r.repositoryCase ? { repositoryCase: r.repositoryCase } : {}),
    },
  }));
}

// Helper to generate a human-readable summary
export function getReportSummary(
  dimensions: any[],
  metrics: any[],
  t?: (key: string) => string
) {
  if (dimensions.length === 0 || metrics.length === 0) return null;
  const andText = t ? t("common.and") : "and";
  const groupedByText = t ? t("common.groupedBy") : "grouped by";
  const joinWithAnd = (arr: string[]) =>
    arr.length < 2
      ? arr.join("")
      : arr.slice(0, -1).join(", ") + ` ${andText} ` + arr[arr.length - 1];
  const dimLabels = joinWithAnd(dimensions.map((d) => d.label));
  const metricLabels = joinWithAnd(metrics.map((m) => m.label));
  return `${metricLabels} ${groupedByText} ${dimLabels}`;
}

// Helper to get the userId from the row for the User column
export function getUserIdFromRow(row: any) {
  // Try common keys for direct userId
  const directUserId =
    row?.original?.userId || row?.original?.UserId || row?.original?.id;

  if (directUserId) {
    return directUserId;
  }

  // Check user/User properties
  const userValue = row?.original?.user || row?.original?.User;
  if (userValue) {
    // If it's an object with an id property, return the id
    if (typeof userValue === "object" && userValue.id) {
      return userValue.id;
    }
    // If it's a string, return it directly
    if (typeof userValue === "string") {
      return userValue;
    }
  }

  // Fall back to checking name properties
  return row?.original?.name || row?.original?.Name;
}

// Helper for DraggableList: convert dimension options to DraggableField
export function dimensionToDraggableField(dim: any): {
  id: string;
  label: string;
  apiLabel?: string;
} {
  return {
    id: String(dim.value),
    label: dim.label,
    apiLabel: dim.apiLabel,
  };
}

export function draggableFieldToDimension(field: any): {
  value: string;
  label: string;
  apiLabel?: string;
} {
  return {
    value: String(field.id),
    label: field.label,
    apiLabel: field.apiLabel,
  };
}

// Sort results helper
export function getSortValue(row: any, column: string) {
  let value = row[column];

  // Handle nested objects
  if (typeof value === "object" && value !== null) {
    if (value.name) value = value.name;
    else if (value.id) value = value.id;
    else value = String(value);
  }

  // Handle dates
  if (column.includes("At") || column.includes("date")) {
    return new Date(value).getTime();
  }

  // Handle numbers
  if (typeof value === "number") return value;

  // Handle strings
  return String(value || "").toLowerCase();
}

// Source display information helper
export function getSourceDisplayInfo(sourceName: string) {
  const sourceMap: Record<string, { icon: string; color: string }> = {
    MANUAL: { icon: "user", color: "#3b82f6" },
    API: { icon: "globe", color: "#10b981" },
    IMPORT: { icon: "upload", color: "#f59e0b" },
    JUNIT: { icon: "beaker", color: "#8b5cf6" },
  };
  return sourceMap[sourceName] || { icon: "help-circle", color: "#6b7280" };
}

// Helper to build date filter conditions
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

// Shared dimension registry factory
export function createTestExecutionDimensionRegistry(
  isProjectSpecific: boolean = true
) {
  return {
    project: !isProjectSpecific
      ? {
          id: "project",
          label: "Project",
          getValues: async (db: any, _projectId?: number) => {
            const projects = await db.projects.findMany({
              where: {
                isDeleted: false,
                testRuns: {
                  some: {
                    isDeleted: false,
                  },
                },
              },
              select: { id: true, name: true },
              orderBy: { name: "asc" },
            });
            return projects;
          },
          groupBy: "projectId",
          join: { testRun: { select: { project: true } } },
          display: (val: any) => ({ name: val.name, id: val.id }),
        }
      : undefined,
    status: {
      id: "status",
      label: "Status",
      getValues: async (db: any, projectId?: number) => {
        const runScope = {
          ...(isProjectSpecific && projectId
            ? { projectId: Number(projectId) }
            : {}),
          isDeleted: false,
        };
        const statuses = await db.status.findMany({
          where: {
            OR: [
              { testRunResults: { some: { testRun: runScope } } },
              // Statuses used only by automated (JUnit) results
              {
                junitTestResults: {
                  some: { testSuite: { testRun: runScope } },
                },
              },
            ],
          },
          select: { id: true, name: true, color: { select: { value: true } } },
          orderBy: { name: "asc" },
        });
        return statuses;
      },
      groupBy: "statusId",
      join: { status: true },
      display: (val: any) => ({
        name: val?.name ?? "None",
        color: val?.color?.value ?? "#6b7280", // Default gray color for "None" status
        id: val?.id ?? null, // Changed from 0 to null
      }),
    },
    user: {
      id: "user",
      label: "Executor",
      getValues: async (db: any, projectId?: number) => {
        const runScope = {
          ...(isProjectSpecific && projectId
            ? { projectId: Number(projectId) }
            : {}),
          isDeleted: false,
        };
        const users = await db.user.findMany({
          where: {
            isDeleted: false,
            OR: [
              { testRunResults: { some: { testRun: runScope } } },
              // Users who only submitted automated (JUnit) results
              {
                junitTestResults: {
                  some: { testSuite: { testRun: runScope } },
                },
              },
            ],
          },
          select: { id: true, name: true, email: true },
          orderBy: { name: "asc" },
        });
        return users;
      },
      groupBy: "executedById",
      join: { executedBy: true },
      display: (val: any) => ({ name: val.name, id: val.id, email: val.email }),
    },
    configuration: {
      id: "configuration",
      label: "Configuration",
      getValues: async (db: any, projectId?: number) => {
        const configurations = await db.configurations.findMany({
          where: {
            testRuns: {
              some: {
                ...(isProjectSpecific && projectId
                  ? { projectId: Number(projectId) }
                  : {}),
                isDeleted: false,
              },
            },
          },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        });
        return configurations;
      },
      groupBy: "configId",
      join: { testRun: { select: { configuration: true } } },
      display: (val: any) => ({
        name: val.name,
        id: val.id,
      }),
    },
    date: {
      id: "date",
      label: "Execution Date",
      getValues: async (
        db: any,
        projectId?: number,
        filters?: { startDate?: string; endDate?: string }
      ) => {
        const dates = await db.testRunResults.findMany({
          where: {
            testRun: {
              ...(isProjectSpecific && projectId
                ? { projectId: Number(projectId) }
                : {}),
              isDeleted: false,
            },
            ...buildDateFilter(filters, "executedAt"),
          },
          select: { executedAt: true },
          distinct: ["executedAt"],
          orderBy: { executedAt: "asc" },
        });

        const datesByDay = dates.reduce((acc: any, curr: any) => {
          const day = new Date(curr.executedAt);
          day.setUTCHours(0, 0, 0, 0);
          const dayStr = day.toISOString();
          if (!acc[dayStr]) {
            acc[dayStr] = day.toISOString();
          }
          return acc;
        }, {});

        return Object.values(datesByDay).map((d: any) => ({
          executedAt: d,
        }));
      },
      groupBy: "executedAt",
      join: {},
      display: (val: any) => {
        const date = new Date(val.executedAt);
        date.setUTCHours(0, 0, 0, 0);
        return { executedAt: date.toISOString() };
      },
    },
    testRun: {
      id: "testRun",
      label: "Test Run",
      getValues: async (db: any, projectId?: number) => {
        const testRuns = await db.testRuns.findMany({
          where: {
            ...(isProjectSpecific && projectId
              ? { projectId: Number(projectId) }
              : {}),
            isDeleted: false,
          },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        });
        return testRuns;
      },
      groupBy: "testRunId",
      join: { testRun: true },
      display: (val: any) => ({ name: val.name, id: val.id }),
    },
    testCase: {
      id: "testCase",
      label: "Test Case",
      // Grouped by REPOSITORY case, not run-case instance: one row/series
      // per case across every run, and it covers JUnit results that were
      // matched to a case without ever being added to a run's case list
      // (those have no TestRunCases record at all).
      getValues: async (db: any, projectId?: number) => {
        const runScope = {
          ...(isProjectSpecific && projectId
            ? { projectId: Number(projectId) }
            : {}),
          isDeleted: false,
        };
        const cases = await db.repositoryCases.findMany({
          where: {
            OR: [
              { testRuns: { some: { testRun: runScope } } },
              {
                junitResults: {
                  some: { testSuite: { testRun: runScope } },
                },
              },
            ],
          },
          select: {
            id: true,
            name: true,
            isDeleted: true,
            source: true,
            automated: true,
            hasParameters: true,
          },
          orderBy: { id: "asc" },
        });
        return cases;
      },
      groupBy: "repositoryCaseId",
      // Dedicated picker lookup with DB-side search and pagination (the
      // full executed-case list is too large to ship per keystroke).
      filterValues: async (
        db: any,
        projectId: number | undefined,
        opts: { search?: string; ids?: string[]; skip: number; take: number }
      ) => {
        const runScope = {
          ...(isProjectSpecific && projectId
            ? { projectId: Number(projectId) }
            : {}),
          isDeleted: false,
        };
        const where = {
          ...(opts.ids ? { id: { in: opts.ids.map(Number) } } : {}),
          ...(opts.search
            ? { name: { contains: opts.search, mode: "insensitive" } }
            : {}),
          OR: [
            { testRuns: { some: { testRun: runScope } } },
            {
              junitResults: {
                some: { testSuite: { testRun: runScope } },
              },
            },
          ],
        };
        const [cases, total] = await Promise.all([
          db.repositoryCases.findMany({
            where,
            select: {
              id: true,
              name: true,
              source: true,
              automated: true,
              hasParameters: true,
              isDeleted: true,
            },
            orderBy: { name: "asc" },
            skip: opts.skip,
            take: opts.take,
          }),
          db.repositoryCases.count({ where }),
        ]);
        return { results: cases, total };
      },
      join: {
        testRunCase: {
          include: {
            repositoryCase: {
              select: {
                id: true,
                name: true,
                isDeleted: true,
                source: true,
                automated: true,
                hasParameters: true,
              },
            },
          },
        },
      },
      display: (val: any) => {
        // Check if val already has the name at root level (from getValues)
        if (val.name) {
          return {
            name: val.name,
            id: val.id,
            isDeleted: val.isDeleted || false,
            source: val.source || "MANUAL",
            automated: val.automated || false,
            hasParameters: val.hasParameters || false,
          };
        }

        // Otherwise try to get from repositoryCase
        return {
          name: val.repositoryCase?.name || `Case ${val.id}`,
          id: val.id,
          isDeleted: val.repositoryCase?.isDeleted || false,
          source: val.repositoryCase?.source || "MANUAL",
          automated: val.repositoryCase?.automated || false,
          hasParameters: val.repositoryCase?.hasParameters || false,
        };
      },
    },
    milestone: {
      id: "milestone",
      label: "Milestone",
      getValues: async (db: any, projectId?: number) => {
        const milestones = await db.milestones.findMany({
          where: {
            testRuns: {
              some: {
                ...(isProjectSpecific && projectId
                  ? { projectId: Number(projectId) }
                  : {}),
                isDeleted: false,
              },
            },
          },
          select: {
            id: true,
            name: true,
            milestoneType: {
              select: {
                icon: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
          orderBy: { name: "asc" },
        });
        return milestones;
      },
      groupBy: "milestoneId",
      join: {
        testRun: {
          select: {
            milestone: {
              select: {
                id: true,
                name: true,
                milestoneType: {
                  select: {
                    icon: {
                      select: {
                        name: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      display: (val: any) => ({
        name: val.name,
        id: val.id,
        milestoneType: val.milestoneType,
      }),
    },
    folder: {
      id: "folder",
      label: "Folder",
      // All non-deleted folders in scope, so both direct and rolled-up
      // (descendants) folder rows resolve to a name in the display lookup.
      getValues: async (db: any, projectId?: number) => {
        const folders = await db.repositoryFolders.findMany({
          where: {
            ...(isProjectSpecific && projectId
              ? { projectId: Number(projectId) }
              : {}),
            isDeleted: false,
          },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        });
        return folders;
      },
      groupBy: "folderId",
      join: {},
      display: (val: any) => ({ name: val.name, id: val.id }),
    },
    tag: {
      id: "tag",
      label: "Tag",
      // Tags carried by executed cases in scope. A case with no tags falls into
      // a null "None" group handled by the response formatter.
      getValues: async (db: any, projectId?: number) => {
        const tags = await db.tags.findMany({
          where: {
            isDeleted: false,
            caseTags: {
              some: {
                case: {
                  ...(isProjectSpecific && projectId
                    ? { projectId: Number(projectId) }
                    : {}),
                  isDeleted: false,
                },
              },
            },
          },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        });
        return tags;
      },
      groupBy: "tagId",
      join: {},
      display: (val: any) => ({ name: val.name, id: val.id }),
    },
  };
}

// Shared metric registry factory
export function createTestExecutionMetricRegistry(
  isProjectSpecific: boolean = true
) {
  return {
    testResults: {
      id: "testResults",
      label: "Test Results Count",
      aggregate: async (
        db: any,
        projectId: number | undefined,
        groupBy: string[],
        filters?: any,
        _dims?: string[]
      ) => {
        if (!groupBy || !Array.isArray(groupBy)) {
          return [];
        }

        const where = {
          testRun: {
            ...(isProjectSpecific && projectId
              ? { projectId: Number(projectId) }
              : {}),
            isDeleted: false,
          },
          status: {
            systemName: { not: "untested" },
          },
          ...buildDateFilter(filters, "executedAt"),
        };

        if (groupBy.length === 0) {
          const count = await db.testRunResults.count({ where });
          return [{ testResults: count }];
        }

        const results = await db.testRunResults.findMany({
          where,
          select: {
            executedAt: true,
            executedById: true,
            statusId: true,
            testRunId: true,
            testRunCaseId: true,
            testRun: {
              select: { projectId: true, configId: true, milestoneId: true },
            },
            ...caseSelectFor(groupBy),
          },
        });

        const options = await folderGroupingOptions(
          db,
          projectId,
          isProjectSpecific,
          groupBy,
          filters
        );

        return groupResults(
          results,
          groupBy,
          {
            create: () => ({ count: 0 }),
            add: (acc: { count: number }) => {
              acc.count++;
            },
            finalize: (acc: { count: number }) => ({ testResults: acc.count }),
          },
          options
        );
      },
    },
    passRate: {
      id: "passRate",
      label: "Pass Rate (%)",
      aggregate: async (
        db: any,
        projectId: number | undefined,
        groupBy: string[],
        filters?: any,
        _dims?: string[]
      ) => {
        if (!groupBy || !Array.isArray(groupBy)) {
          return [];
        }

        const where = {
          testRun: {
            ...(isProjectSpecific && projectId
              ? { projectId: Number(projectId) }
              : {}),
            isDeleted: false,
          },
          status: {
            systemName: { not: "untested" },
          },
          ...buildDateFilter(filters, "executedAt"),
        };

        if (groupBy.length === 0) {
          const total = await db.testRunResults.count({ where });
          const passed = await db.testRunResults.count({
            where: { ...where, status: { ...where.status, isSuccess: true } },
          });
          return [{ passRate: total > 0 ? (passed / total) * 100 : 0 }];
        }

        const results = await db.testRunResults.findMany({
          where,
          select: {
            executedAt: true,
            executedById: true,
            statusId: true,
            testRunId: true,
            testRunCaseId: true,
            status: { select: { isSuccess: true } },
            testRun: {
              select: { projectId: true, configId: true, milestoneId: true },
            },
            ...caseSelectFor(groupBy),
          },
        });

        const options = await folderGroupingOptions(
          db,
          projectId,
          isProjectSpecific,
          groupBy,
          filters
        );

        return groupResults(
          results,
          groupBy,
          {
            create: () => ({ total: 0, passed: 0 }),
            add: (acc: { total: number; passed: number }, result: any) => {
              acc.total++;
              if (result.status?.isSuccess) acc.passed++;
            },
            finalize: (acc: { total: number; passed: number }) => ({
              passRate: acc.total > 0 ? (acc.passed / acc.total) * 100 : 0,
            }),
          },
          options
        );
      },
    },
    avgElapsedTime: {
      id: "avgElapsedTime",
      label: "Avg. Elapsed Time",
      aggregate: async (
        db: any,
        projectId: number | undefined,
        groupBy: string[],
        filters?: any,
        _dims?: string[]
      ) => {
        if (!groupBy || !Array.isArray(groupBy)) {
          return [];
        }

        const where = {
          testRun: {
            ...(isProjectSpecific && projectId
              ? { projectId: Number(projectId) }
              : {}),
            isDeleted: false,
          },
          elapsed: { not: null },
          ...buildDateFilter(filters, "executedAt"),
        };

        if (groupBy.length === 0) {
          const [manual, manualCount, junit, junitCount] = await Promise.all([
            db.testRunResults.aggregate({ where, _sum: { elapsed: true } }),
            db.testRunResults.count({ where }),
            db.jUnitTestResult.aggregate({
              where: junitElapsedWhere(projectId, isProjectSpecific, filters),
              _sum: { time: true },
            }),
            db.jUnitTestResult.count({
              where: junitElapsedWhere(projectId, isProjectSpecific, filters),
            }),
          ]);
          const total = (manual._sum.elapsed || 0) + (junit._sum.time || 0);
          const count = manualCount + junitCount;
          return [
            { avgElapsedTime: count > 0 ? Math.round(total / count) : 0 },
          ];
        }

        const [results, junitRows] = await Promise.all([
          db.testRunResults.findMany({
            where,
            select: {
              executedAt: true,
              executedById: true,
              statusId: true,
              elapsed: true,
              testRunId: true,
              testRunCaseId: true,
              testRun: {
                select: { projectId: true, configId: true, milestoneId: true },
              },
              ...caseSelectFor(groupBy),
            },
          }),
          fetchJunitElapsedRows(
            db,
            projectId,
            isProjectSpecific,
            groupBy,
            filters
          ),
        ]);

        const options = await folderGroupingOptions(
          db,
          projectId,
          isProjectSpecific,
          groupBy,
          filters
        );

        return groupResults(
          [...results, ...junitRows],
          groupBy,
          {
            create: () => ({ total: 0, count: 0 }),
            add: (acc: { total: number; count: number }, result: any) => {
              if (result.elapsed !== null && result.elapsed !== undefined) {
                acc.total += result.elapsed;
                acc.count++;
              }
            },
            finalize: (acc: { total: number; count: number }) => ({
              avgElapsedTime:
                acc.count > 0 ? Math.round(acc.total / acc.count) : 0,
            }),
          },
          options
        );
      },
    },
    totalElapsedTime: {
      id: "totalElapsedTime",
      label: "Total Elapsed Time",
      aggregate: async (
        db: any,
        projectId: number | undefined,
        groupBy: string[],
        filters?: any,
        _dims?: string[]
      ) => {
        if (!groupBy || !Array.isArray(groupBy)) {
          return [];
        }

        const where = {
          testRun: {
            ...(isProjectSpecific && projectId
              ? { projectId: Number(projectId) }
              : {}),
            isDeleted: false,
          },
          elapsed: { not: null },
          ...buildDateFilter(filters, "executedAt"),
        };

        if (groupBy.length === 0) {
          const [manual, junit] = await Promise.all([
            db.testRunResults.aggregate({ where, _sum: { elapsed: true } }),
            db.jUnitTestResult.aggregate({
              where: junitElapsedWhere(projectId, isProjectSpecific, filters),
              _sum: { time: true },
            }),
          ]);
          return [
            {
              totalElapsedTime:
                (manual._sum.elapsed || 0) + (junit._sum.time || 0),
            },
          ];
        }

        const [results, junitRows] = await Promise.all([
          db.testRunResults.findMany({
            where,
            select: {
              executedAt: true,
              executedById: true,
              statusId: true,
              elapsed: true,
              testRunId: true,
              testRunCaseId: true,
              testRun: {
                select: { projectId: true, configId: true, milestoneId: true },
              },
              ...caseSelectFor(groupBy),
            },
          }),
          fetchJunitElapsedRows(
            db,
            projectId,
            isProjectSpecific,
            groupBy,
            filters
          ),
        ]);

        const options = await folderGroupingOptions(
          db,
          projectId,
          isProjectSpecific,
          groupBy,
          filters
        );

        return groupResults(
          [...results, ...junitRows],
          groupBy,
          {
            create: () => ({ total: 0 }),
            add: (acc: { total: number }, result: any) => {
              acc.total += result.elapsed || 0;
            },
            finalize: (acc: { total: number }) => ({
              totalElapsedTime: acc.total,
            }),
          },
          options
        );
      },
    },
    // Alias metrics for test compatibility
    testResultCount: {
      id: "testResultCount",
      label: "Test Result Count", // Slightly different label to avoid exact duplicate
      hidden: true, // Hide from UI but keep for backward compatibility
      aggregate: async (
        db: any,
        projectId: number | undefined,
        groupBy: string[],
        filters?: any,
        dims?: string[]
      ) => {
        // Reuse testResults logic but return testResultCount property
        const registry = createTestExecutionMetricRegistry(isProjectSpecific);
        const results = await registry.testResults.aggregate(
          db,
          projectId,
          groupBy,
          filters,
          dims
        );
        return results.map((result: any) => {
          const { testResults, ...rest } = result;
          return { ...rest, testResultCount: testResults };
        });
      },
    },
    testRunCount: {
      id: "testRunCount",
      label: "Test Runs Count",
      aggregate: async (
        db: any,
        projectId: number | undefined,
        groupBy: string[],
        filters?: any,
        _dims?: string[]
      ) => {
        if (!groupBy || !Array.isArray(groupBy)) {
          return [];
        }

        // Result-level groupings (and case-level folder/tag) require execution
        // data so we can count the distinct runs that touched each group. A run
        // spans many cases, so its folder/tag membership is only knowable here.
        const needsResultLevel = groupBy.some((field) =>
          [
            "executedAt",
            "executedById",
            "statusId",
            "folderId",
            "tagId",
            "testRunCaseId",
            "repositoryCaseId",
          ].includes(field)
        );

        if (needsResultLevel) {
          const results = await db.testRunResults.findMany({
            where: {
              testRun: {
                ...(isProjectSpecific && projectId
                  ? { projectId: Number(projectId) }
                  : {}),
                isDeleted: false,
              },
            },
            select: {
              executedAt: true,
              executedById: true,
              statusId: true,
              testRunId: true,
              testRun: {
                select: { projectId: true, configId: true, milestoneId: true },
              },
              ...caseSelectFor(groupBy),
            },
          });

          // Preserve the prior behavior of dropping results with no valid
          // execution date when the date dimension is in play.
          const rows = groupBy.includes("executedAt")
            ? results.filter(
                (result: any) =>
                  result.executedAt &&
                  !isNaN(new Date(result.executedAt).getTime())
              )
            : results;

          const options = await folderGroupingOptions(
            db,
            projectId,
            isProjectSpecific,
            groupBy,
            filters
          );

          return groupResults(
            rows,
            groupBy,
            {
              create: () => ({ runs: new Set<number>() }),
              add: (acc: { runs: Set<number> }, result: any) => {
                if (result.testRunId != null) acc.runs.add(result.testRunId);
              },
              finalize: (acc: { runs: Set<number> }) => ({
                testRunCount: acc.runs.size,
              }),
            },
            options
          );
        }

        if (groupBy.length === 0) {
          const count = await db.testRuns.count({
            where: {
              ...(isProjectSpecific && projectId
                ? { projectId: Number(projectId) }
                : {}),
              isDeleted: false,
            },
          });
          return [{ testRunCount: count }];
        }

        const results = await db.testRuns.findMany({
          where: {
            ...(isProjectSpecific && projectId
              ? { projectId: Number(projectId) }
              : {}),
            isDeleted: false,
          },
          select: {
            id: true,
            createdById: true,
            projectId: true,
            configId: true,
            milestoneId: true,
          },
        });

        const grouped = new Map<string, any>();
        results.forEach((result: any) => {
          const key = groupBy
            .map((field) => {
              if (field === "projectId") return result.projectId;
              if (field === "configId") return result.configId;
              if (field === "executedById") return result.createdById;
              if (field === "milestoneId") return result.milestoneId;
              if (field === "testRunId") return result.id;
              return null;
            })
            .join("|");

          if (!grouped.has(key)) {
            const groupData: any = {};
            groupBy.forEach((field) => {
              if (field === "projectId") {
                groupData.projectId = result.projectId;
              } else if (field === "configId") {
                groupData.configId = result.configId;
              } else if (field === "executedById") {
                groupData.executedById = result.createdById;
              } else if (field === "milestoneId") {
                groupData.milestoneId = result.milestoneId;
              } else if (field === "testRunId") {
                groupData.testRunId = result.id;
              }
            });
            groupData.testRunCount = 0;
            grouped.set(key, groupData);
          }

          grouped.get(key).testRunCount++;
        });

        return Array.from(grouped.values());
      },
    },
    testCaseCount: {
      id: "testCaseCount",
      label: "Test Cases Count",
      aggregate: async (
        db: any,
        projectId: number | undefined,
        groupBy: string[],
        filters?: any,
        _dims?: string[]
      ) => {
        if (!groupBy || !Array.isArray(groupBy)) {
          return [];
        }

        const where = {
          testRun: {
            ...(isProjectSpecific && projectId
              ? { projectId: Number(projectId) }
              : {}),
            isDeleted: false,
          },
          status: {
            systemName: { not: "untested" },
          },
          testRunCase: {
            repositoryCase: { isDeleted: false },
          },
          ...buildDateFilter(filters, "executedAt"),
        };

        if (groupBy.length === 0) {
          const results = await db.testRunResults.findMany({
            where,
            select: { testRunCase: { select: { repositoryCaseId: true } } },
          });
          const uniqueCases = new Set(
            results
              .map((r: any) => r.testRunCase?.repositoryCaseId)
              .filter((id: number | undefined) => id !== undefined)
          );
          return [{ testCaseCount: uniqueCases.size }];
        }

        const results = await db.testRunResults.findMany({
          where,
          select: {
            executedAt: true,
            executedById: true,
            statusId: true,
            testRunId: true,
            testRun: {
              select: { projectId: true, configId: true, milestoneId: true },
            },
            // Always carry the repository case id (to count unique cases) plus
            // whatever folder/tag selects the grouping requires.
            ...caseSelectFor([...groupBy, "repositoryCaseId"]),
          },
        });

        const options = await folderGroupingOptions(
          db,
          projectId,
          isProjectSpecific,
          groupBy,
          filters
        );

        return groupResults(
          results,
          groupBy,
          {
            create: () => ({ cases: new Set<number>() }),
            add: (acc: { cases: Set<number> }, result: any) => {
              const id = result.testRunCase?.repositoryCaseId;
              if (id != null) acc.cases.add(id);
            },
            finalize: (acc: { cases: Set<number> }) => ({
              testCaseCount: acc.cases.size,
            }),
          },
          options
        );
      },
    },
  };
}

// Shared dimension registry factory for repository stats
export function createRepositoryStatsDimensionRegistry(
  isProjectSpecific: boolean = true
) {
  return {
    project: !isProjectSpecific
      ? {
          id: "project",
          label: "Project",
          getValues: async (db: any, _projectId?: number) => {
            const projects = await db.projects.findMany({
              where: {
                isDeleted: false,
                repositoryCases: {
                  some: {
                    isDeleted: false,
                  },
                },
              },
              select: { id: true, name: true },
              orderBy: { name: "asc" },
            });
            return projects;
          },
          groupBy: "projectId",
          join: { project: true },
          display: (val: any) => ({ name: val.name, id: val.id }),
        }
      : undefined,
    template: {
      id: "template",
      label: "Template",
      getValues: async (db: any, projectId?: number) => {
        const templates = await db.repositoryCases.findMany({
          where: {
            ...(isProjectSpecific && projectId
              ? { projectId: Number(projectId) }
              : {}),
            isDeleted: false,
          },
          select: {
            template: {
              select: { id: true, templateName: true },
            },
          },
          distinct: ["templateId"],
        });
        return templates
          .map((t: any) => ({
            id: t.template?.id,
            name: t.template?.templateName,
          }))
          .filter((t: any) => t.name);
      },
      groupBy: "templateId",
      join: { template: true },
      display: (val: any) => ({
        name: val.templateName || val.name,
        id: val.id,
      }),
    },
    creator: {
      id: "creator",
      label: "Creator",
      getValues: async (db: any, projectId?: number) => {
        const creators = await db.repositoryCases.findMany({
          where: {
            ...(isProjectSpecific && projectId
              ? { projectId: Number(projectId) }
              : {}),
            isDeleted: false,
          },
          select: {
            creator: {
              select: { id: true, name: true },
            },
          },
          distinct: ["creatorId"],
        });
        return creators.map((c: any) => c.creator).filter((c: any) => c);
      },
      groupBy: "creatorId",
      join: { creator: true },
      display: (val: any) => ({ name: val.name, id: val.id }),
    },
    state: {
      id: "state",
      label: "State",
      getValues: async (db: any, projectId?: number) => {
        const states = await db.repositoryCases.findMany({
          where: {
            ...(isProjectSpecific && projectId
              ? { projectId: Number(projectId) }
              : {}),
            isDeleted: false,
          },
          select: {
            state: {
              select: {
                id: true,
                name: true,
                icon: {
                  select: { name: true },
                },
                color: {
                  select: { value: true },
                },
              },
            },
          },
          distinct: ["stateId"],
        });
        return states.map((s: any) => s.state).filter((s: any) => s);
      },
      groupBy: "stateId",
      join: {
        state: {
          include: {
            icon: true,
            color: true,
          },
        },
      },
      display: (val: any) => ({
        name: val.name,
        id: val.id,
        icon: val.icon?.name,
        color: val.color?.value,
      }),
    },
    source: {
      id: "source",
      label: "Source",
      getValues: async (db: any, projectId?: number) => {
        const sources = await db.repositoryCases.groupBy({
          where: {
            ...(isProjectSpecific && projectId
              ? { projectId: Number(projectId) }
              : {}),
            isDeleted: false,
          },
          by: ["source"],
        });
        return sources.map((s: any) => ({
          id: s.source,
          name: s.source,
        }));
      },
      groupBy: "source",
      join: {},
      display: (val: any) => ({ name: val.name || val.id, id: val.id }),
    },
    folder: {
      id: "folder",
      label: "Folder",
      // All non-deleted folders so rolled-up (descendants) ancestor folders
      // still resolve to a name in the display lookup.
      getValues: async (db: any, projectId?: number) => {
        const folders = await db.repositoryFolders.findMany({
          where: {
            ...(isProjectSpecific && projectId
              ? { projectId: Number(projectId) }
              : {}),
            isDeleted: false,
          },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        });
        return folders;
      },
      groupBy: "folderId",
      join: { folder: true },
      display: (val: any) => ({ name: val.name, id: val.id }),
    },
    tag: {
      id: "tag",
      label: "Tag",
      getValues: async (db: any, projectId?: number) => {
        const tags = await db.tags.findMany({
          where: {
            isDeleted: false,
            caseTags: {
              some: {
                case: {
                  ...(isProjectSpecific && projectId
                    ? { projectId: Number(projectId) }
                    : {}),
                  isDeleted: false,
                },
              },
            },
          },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        });
        return tags;
      },
      groupBy: "tagId",
      join: {},
      display: (val: any) => ({ name: val.name, id: val.id }),
    },
    date: {
      id: "date",
      label: "Creation Date",
      getValues: async (db: any, projectId?: number) => {
        const dates = await db.repositoryCases.findMany({
          where: {
            ...(isProjectSpecific && projectId
              ? { projectId: Number(projectId) }
              : {}),
            isDeleted: false,
          },
          select: { createdAt: true },
          distinct: ["createdAt"],
          orderBy: { createdAt: "asc" },
        });

        const datesByDay = dates.reduce((acc: any, curr: any) => {
          const day = new Date(curr.createdAt);
          day.setUTCHours(0, 0, 0, 0);
          const dayStr = day.toISOString();
          if (!acc[dayStr]) {
            acc[dayStr] = day.toISOString();
          }
          return acc;
        }, {});

        return Object.values(datesByDay).map((d: any) => ({
          createdAt: d,
        }));
      },
      groupBy: "createdAt",
      join: {},
      display: (val: any) => {
        if (!val || !val.createdAt) {
          return { createdAt: null };
        }
        const date = new Date(val.createdAt);
        date.setUTCHours(0, 0, 0, 0);
        return { createdAt: date.toISOString() };
      },
    },
    testCase: {
      id: "testCase",
      label: "Test Case",
      getValues: async (db: any, projectId?: number) => {
        const cases = await db.repositoryCases.findMany({
          where: {
            ...(isProjectSpecific && projectId
              ? { projectId: Number(projectId) }
              : {}),
            isDeleted: false,
          },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        });
        return cases;
      },
      groupBy: "id",
      join: {},
      display: (val: any) => ({ name: val.name, id: val.id }),
    },
  };
}

// Shared metric registry factory for repository stats
export function createRepositoryStatsMetricRegistry(
  isProjectSpecific: boolean = true
) {
  return {
    testCaseCount: {
      id: "testCaseCount",
      label: "Test Case Count",
      aggregate: async (
        db: any,
        projectId: number | undefined,
        groupBy: string[],
        filters?: any,
        _dims?: string[]
      ) => {
        if (!groupBy || !Array.isArray(groupBy)) {
          return [];
        }

        const where = {
          ...(isProjectSpecific && projectId
            ? { projectId: Number(projectId) }
            : {}),
          isDeleted: false,
          ...buildDateFilter(filters, "createdAt"),
        };

        if (groupBy.length === 0) {
          const count = await db.repositoryCases.count({ where });
          return [{ testCaseCount: count }];
        }

        const cases = await db.repositoryCases.findMany({
          where,
          select: repositoryCaseSelect(groupBy),
        });

        const options = await folderGroupingOptions(
          db,
          projectId,
          isProjectSpecific,
          groupBy,
          filters
        );

        return groupResults(
          cases,
          groupBy,
          {
            create: () => ({ count: 0 }),
            add: (acc: { count: number }) => {
              acc.count++;
            },
            finalize: (acc: { count: number }) => ({
              testCaseCount: acc.count,
            }),
          },
          options
        );
      },
    },
    automationRate: {
      id: "automationRate",
      label: "Automation Rate (%)",
      aggregate: async (
        db: any,
        projectId: number | undefined,
        groupBy: string[],
        filters?: any,
        _dims?: string[]
      ) => {
        if (!groupBy || !Array.isArray(groupBy)) {
          return [];
        }

        const where = {
          ...(isProjectSpecific && projectId
            ? { projectId: Number(projectId) }
            : {}),
          isDeleted: false,
          ...buildDateFilter(filters, "createdAt"),
        };

        if (groupBy.length === 0) {
          const total = await db.repositoryCases.count({ where });
          const automated = await db.repositoryCases.count({
            where: { ...where, automated: true },
          });
          return [
            { automationRate: total > 0 ? (automated / total) * 100 : 0 },
          ];
        }

        const cases = await db.repositoryCases.findMany({
          where,
          select: repositoryCaseSelect(groupBy, { automated: true }),
        });

        const options = await folderGroupingOptions(
          db,
          projectId,
          isProjectSpecific,
          groupBy,
          filters
        );

        return groupResults(
          cases,
          groupBy,
          {
            create: () => ({ total: 0, automated: 0 }),
            add: (acc: { total: number; automated: number }, result: any) => {
              acc.total++;
              if (result.automated) acc.automated++;
            },
            finalize: (acc: { total: number; automated: number }) => ({
              automationRate:
                acc.total > 0 ? (acc.automated / acc.total) * 100 : 0,
            }),
          },
          options
        );
      },
    },
    automatedCount: {
      id: "automatedCount",
      label: "Automated Cases",
      aggregate: async (
        db: any,
        projectId: number | undefined,
        groupBy: string[],
        filters?: any,
        _dims?: string[]
      ) => {
        if (!groupBy || !Array.isArray(groupBy)) {
          return [];
        }

        const where = {
          ...(isProjectSpecific && projectId
            ? { projectId: Number(projectId) }
            : {}),
          isDeleted: false,
          automated: true,
          ...buildDateFilter(filters, "createdAt"),
        };

        if (groupBy.length === 0) {
          const count = await db.repositoryCases.count({ where });
          return [{ automatedCount: count }];
        }

        const cases = await db.repositoryCases.findMany({
          where,
          select: repositoryCaseSelect(groupBy),
        });

        const options = await folderGroupingOptions(
          db,
          projectId,
          isProjectSpecific,
          groupBy,
          filters
        );

        return groupResults(
          cases,
          groupBy,
          {
            create: () => ({ count: 0 }),
            add: (acc: { count: number }) => {
              acc.count++;
            },
            finalize: (acc: { count: number }) => ({
              automatedCount: acc.count,
            }),
          },
          options
        );
      },
    },
    manualCount: {
      id: "manualCount",
      label: "Manual Cases",
      aggregate: async (
        db: any,
        projectId: number | undefined,
        groupBy: string[],
        filters?: any,
        _dims?: string[]
      ) => {
        if (!groupBy || !Array.isArray(groupBy)) {
          return [];
        }

        const where = {
          ...(isProjectSpecific && projectId
            ? { projectId: Number(projectId) }
            : {}),
          isDeleted: false,
          automated: false,
          ...buildDateFilter(filters, "createdAt"),
        };

        if (groupBy.length === 0) {
          const count = await db.repositoryCases.count({ where });
          return [{ manualCount: count }];
        }

        const cases = await db.repositoryCases.findMany({
          where,
          select: repositoryCaseSelect(groupBy),
        });

        const options = await folderGroupingOptions(
          db,
          projectId,
          isProjectSpecific,
          groupBy,
          filters
        );

        return groupResults(
          cases,
          groupBy,
          {
            create: () => ({ count: 0 }),
            add: (acc: { count: number }) => {
              acc.count++;
            },
            finalize: (acc: { count: number }) => ({ manualCount: acc.count }),
          },
          options
        );
      },
    },
    averageSteps: {
      id: "averageSteps",
      label: "Average Steps per Case",
      aggregate: async (
        db: any,
        projectId: number | undefined,
        groupBy: string[],
        filters?: any,
        _dims?: string[]
      ) => {
        if (!groupBy || !Array.isArray(groupBy)) {
          return [];
        }

        const where = {
          ...(isProjectSpecific && projectId
            ? { projectId: Number(projectId) }
            : {}),
          isDeleted: false,
          ...buildDateFilter(filters, "createdAt"),
        };
        const stepsSelect = {
          steps: { where: { isDeleted: false }, select: { id: true } },
        };

        if (groupBy.length === 0) {
          const repositoryCases = await db.repositoryCases.findMany({
            where,
            select: { id: true, ...stepsSelect },
          });
          const totalCases = repositoryCases.length;
          const totalSteps = repositoryCases.reduce(
            (sum: number, testCase: any) => sum + testCase.steps.length,
            0
          );
          return [
            { averageSteps: totalCases > 0 ? totalSteps / totalCases : 0 },
          ];
        }

        const cases = await db.repositoryCases.findMany({
          where,
          select: repositoryCaseSelect(groupBy, stepsSelect),
        });

        const options = await folderGroupingOptions(
          db,
          projectId,
          isProjectSpecific,
          groupBy,
          filters
        );

        return groupResults(
          cases,
          groupBy,
          {
            create: () => ({ cases: 0, steps: 0 }),
            add: (acc: { cases: number; steps: number }, result: any) => {
              acc.cases++;
              acc.steps += result.steps?.length ?? 0;
            },
            finalize: (acc: { cases: number; steps: number }) => ({
              averageSteps: acc.cases > 0 ? acc.steps / acc.cases : 0,
            }),
          },
          options
        );
      },
    },
    totalSteps: {
      id: "totalSteps",
      label: "Total Steps",
      aggregate: async (
        db: any,
        projectId: number | undefined,
        groupBy: string[],
        filters?: any,
        _dims?: string[]
      ) => {
        if (!groupBy || !Array.isArray(groupBy)) {
          return [];
        }

        const where = {
          ...(isProjectSpecific && projectId
            ? { projectId: Number(projectId) }
            : {}),
          isDeleted: false,
          ...buildDateFilter(filters, "createdAt"),
        };
        const stepsSelect = {
          steps: { where: { isDeleted: false }, select: { id: true } },
        };

        if (groupBy.length === 0) {
          const repositoryCases = await db.repositoryCases.findMany({
            where,
            select: stepsSelect,
          });
          const totalSteps = repositoryCases.reduce(
            (sum: number, testCase: any) => sum + testCase.steps.length,
            0
          );
          return [{ totalSteps }];
        }

        const cases = await db.repositoryCases.findMany({
          where,
          select: repositoryCaseSelect(groupBy, stepsSelect),
        });

        const options = await folderGroupingOptions(
          db,
          projectId,
          isProjectSpecific,
          groupBy,
          filters
        );

        return groupResults(
          cases,
          groupBy,
          {
            create: () => ({ steps: 0 }),
            add: (acc: { steps: number }, result: any) => {
              acc.steps += result.steps?.length ?? 0;
            },
            finalize: (acc: { steps: number }) => ({ totalSteps: acc.steps }),
          },
          options
        );
      },
    },
  };
}

// Shared dimension registry factory for user engagement
export function createUserEngagementDimensionRegistry(
  isProjectSpecific: boolean = true
) {
  return {
    project: !isProjectSpecific
      ? {
          id: "project",
          label: "Project",
          getValues: async (db: any, _projectId?: number) => {
            const projects = await db.projects.findMany({
              where: {
                isDeleted: false,
                OR: [
                  {
                    testRuns: {
                      some: {
                        isDeleted: false,
                        results: {
                          some: {},
                        },
                      },
                    },
                  },
                  {
                    sessions: {
                      some: {
                        isDeleted: false,
                        sessionResults: {
                          some: {},
                        },
                      },
                    },
                  },
                  {
                    repositoryCases: {
                      some: {
                        isDeleted: false,
                      },
                    },
                  },
                ],
              },
              select: { id: true, name: true },
              orderBy: { name: "asc" },
            });
            return projects;
          },
          groupBy: "projectId",
          join: { project: true },
          display: (val: any) => ({ name: val.name, id: val.id }),
        }
      : undefined,
    user: {
      id: "user",
      label: "User",
      getValues: async (db: any, projectId?: number) => {
        const users = await db.user.findMany({
          where: {
            isDeleted: false,
            OR: [
              // Users assigned to projects
              ...(isProjectSpecific && projectId
                ? [
                    {
                      projects: {
                        some: {
                          projectId: Number(projectId),
                        },
                      },
                    },
                  ]
                : []),
              // Users with project permissions
              ...(isProjectSpecific && projectId
                ? [
                    {
                      projectPermissions: {
                        some: {
                          projectId: Number(projectId),
                        },
                      },
                    },
                  ]
                : []),
              // Users who created test cases
              {
                repositoryCases: {
                  some: {
                    ...(isProjectSpecific && projectId
                      ? { projectId: Number(projectId) }
                      : {}),
                    isDeleted: false,
                  },
                },
              },
              // Users who executed tests
              {
                testRunResults: {
                  some: {
                    testRun: {
                      ...(isProjectSpecific && projectId
                        ? { projectId: Number(projectId) }
                        : {}),
                      isDeleted: false,
                    },
                  },
                },
              },
              // Users who participated in sessions
              {
                sessionResults: {
                  some: {
                    session: {
                      ...(isProjectSpecific && projectId
                        ? { projectId: Number(projectId) }
                        : {}),
                      isDeleted: false,
                    },
                  },
                },
              },
            ],
          },
          select: { id: true, name: true, email: true },
          orderBy: { name: "asc" },
        });
        return users;
      },
      groupBy: "userId",
      join: { user: true },
      display: (val: any) => ({ name: val.name, id: val.id, email: val.email }),
    },
    role: {
      id: "role",
      label: "Role",
      getValues: async (db: any, projectId?: number) => {
        // Get roles of users who have any user engagement activity for the project
        const roles = await db.roles.findMany({
          where: {
            isDeleted: false,
            users: {
              some: {
                isDeleted: false,
                OR: [
                  // Users who created repository cases
                  {
                    repositoryCases: {
                      some: {
                        ...(isProjectSpecific && projectId
                          ? { projectId: Number(projectId) }
                          : {}),
                        isDeleted: false,
                      },
                    },
                  },
                  // Users who executed tests
                  {
                    testRunResults: {
                      some: {
                        testRun: {
                          ...(isProjectSpecific && projectId
                            ? { projectId: Number(projectId) }
                            : {}),
                          isDeleted: false,
                        },
                      },
                    },
                  },
                  // Users who participated in sessions
                  {
                    sessionResults: {
                      some: {
                        session: {
                          ...(isProjectSpecific && projectId
                            ? { projectId: Number(projectId) }
                            : {}),
                          isDeleted: false,
                        },
                      },
                    },
                  },
                ],
              },
            },
          },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        });
        return roles;
      },
      groupBy: "roleId",
      join: { role: true },
      display: (val: any) => ({ name: val.name, id: val.id, icon: "drama" }),
    },
    group: {
      id: "group",
      label: "Group",
      getValues: async (db: any, projectId?: number) => {
        // Get groups that contain users who have any user engagement activity for the project
        const groups = await db.groups.findMany({
          where: {
            isDeleted: false,
            assignedUsers: {
              some: {
                user: {
                  isDeleted: false,
                  OR: [
                    // Users who created repository cases
                    {
                      repositoryCases: {
                        some: {
                          ...(isProjectSpecific && projectId
                            ? { projectId: Number(projectId) }
                            : {}),
                          isDeleted: false,
                        },
                      },
                    },
                    // Users who executed tests
                    {
                      testRunResults: {
                        some: {
                          testRun: {
                            ...(isProjectSpecific && projectId
                              ? { projectId: Number(projectId) }
                              : {}),
                            isDeleted: false,
                          },
                        },
                      },
                    },
                    // Users who participated in sessions
                    {
                      sessionResults: {
                        some: {
                          session: {
                            ...(isProjectSpecific && projectId
                              ? { projectId: Number(projectId) }
                              : {}),
                            isDeleted: false,
                          },
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        });
        return groups;
      },
      groupBy: "groupId",
      join: { group: true },
      display: (val: any) => ({ name: val.name, id: val.id, icon: "group" }),
    },
    date: {
      id: "date",
      label: "Activity Date",
      getValues: async (db: any, projectId?: number) => {
        // Get unique activity dates from various user activities
        const testExecutions = await db.testRunResults.findMany({
          where: {
            testRun: {
              ...(isProjectSpecific && projectId
                ? { projectId: Number(projectId) }
                : {}),
              isDeleted: false,
            },
          },
          select: { executedAt: true },
          distinct: ["executedAt"],
          orderBy: { executedAt: "asc" },
        });

        const sessionResults = await db.sessionResults.findMany({
          where: {
            session: {
              ...(isProjectSpecific && projectId
                ? { projectId: Number(projectId) }
                : {}),
              isDeleted: false,
            },
          },
          select: { createdAt: true },
          distinct: ["createdAt"],
          orderBy: { createdAt: "asc" },
        });

        const caseCreations = await db.repositoryCases.findMany({
          where: {
            ...(isProjectSpecific && projectId
              ? { projectId: Number(projectId) }
              : {}),
            isDeleted: false,
          },
          select: { createdAt: true },
          distinct: ["createdAt"],
          orderBy: { createdAt: "asc" },
        });

        // Combine all dates and group by day
        const allDates = [
          ...testExecutions.map((t: any) => t.executedAt),
          ...sessionResults.map((s: any) => s.createdAt),
          ...caseCreations.map((c: any) => c.createdAt),
        ];

        const datesByDay = allDates.reduce((acc: any, date: any) => {
          const day = new Date(date);
          day.setUTCHours(0, 0, 0, 0);
          const dayStr = day.toISOString();
          if (!acc[dayStr]) {
            acc[dayStr] = day.toISOString();
          }
          return acc;
        }, {});

        const result = Object.values(datesByDay).map((d: any) => ({
          executedAt: d,
        }));
        return result;
      },
      groupBy: "executedAt",
      join: {},
      display: (val: any) => {
        if (!val || !val.executedAt) {
          return { executedAt: null };
        }
        const date = new Date(val.executedAt);
        date.setUTCHours(0, 0, 0, 0);
        return { executedAt: date.toISOString() };
      },
    },
  };
}

// Shared metric registry factory for user engagement
export function createUserEngagementMetricRegistry(
  isProjectSpecific: boolean = true
) {
  return {
    executionCount: {
      id: "executionCount",
      label: "Test Executions",
      aggregate: async (
        db: any,
        projectId: number | undefined,
        groupBy: string[],
        filters?: any,
        _dims?: string[]
      ) => {
        if (groupBy.includes("executedAt")) {
          const results = await db.testRunResults.findMany({
            where: {
              testRun: {
                ...(isProjectSpecific && projectId
                  ? { projectId: Number(projectId) }
                  : {}),
                isDeleted: false,
              },
              ...buildDateFilter(filters, "executedAt"),
            },
            select: {
              executedAt: true,
              executedById: true,
              testRun: {
                select: {
                  projectId: true,
                },
              },
            },
          });

          const groupedResults = results.reduce((acc: any, result: any) => {
            const key = groupBy
              .map((field) => {
                if (field === "executedAt") {
                  const date = new Date(result.executedAt);
                  date.setUTCHours(0, 0, 0, 0);
                  return date.toISOString();
                } else if (field === "userId") {
                  return result.executedById;
                } else if (field === "projectId") {
                  return result.testRun.projectId;
                }
                return result[field];
              })
              .join("|");

            if (!acc[key]) {
              acc[key] = {
                ...groupBy.reduce((obj: any, field) => {
                  if (field === "executedAt") {
                    const date = new Date(result.executedAt);
                    date.setUTCHours(0, 0, 0, 0);
                    obj["executedAt"] = date.toISOString();
                  } else if (field === "userId") {
                    obj[field] = result.executedById;
                  } else if (field === "projectId") {
                    obj[field] = result.testRun.projectId;
                  } else {
                    obj[field] = result[field];
                  }
                  return obj;
                }, {}),
                executionCount: 0,
              };
            }
            acc[key].executionCount++;
            return acc;
          }, {});

          return Object.values(groupedResults);
        }

        if (groupBy.length === 0) {
          const count = await db.testRunResults.count({
            where: {
              testRun: {
                ...(isProjectSpecific && projectId
                  ? { projectId: Number(projectId) }
                  : {}),
                isDeleted: false,
              },
              ...buildDateFilter(filters, "executedAt"),
            },
          });
          return [{ executionCount: count }];
        }

        // Manual grouping for other cases
        const results = await db.testRunResults.findMany({
          where: {
            testRun: {
              ...(isProjectSpecific && projectId
                ? { projectId: Number(projectId) }
                : {}),
              isDeleted: false,
            },
            ...buildDateFilter(filters, "executedAt"),
          },
          select: {
            executedById: true,
            executedBy: {
              select: {
                roleId: true,
                groups: {
                  select: {
                    groupId: true,
                  },
                },
              },
            },
            testRun: {
              select: {
                projectId: true,
              },
            },
          },
        });

        const grouped = new Map<string, any>();
        results.forEach((result: any) => {
          // Handle groupId specially - a user can be in multiple groups
          if (groupBy.includes("groupId")) {
            const userGroups = result.executedBy.groups || [];
            if (userGroups.length === 0) {
              // User is not in any group, skip this result for group dimension
              return;
            }

            // Create a separate entry for each group the user belongs to
            userGroups.forEach((groupAssignment: any) => {
              const key = groupBy
                .map((field) => {
                  if (field === "userId") return result.executedById;
                  if (field === "projectId") return result.testRun.projectId;
                  if (field === "roleId") return result.executedBy.roleId;
                  if (field === "groupId") return groupAssignment.groupId;
                  return result[field];
                })
                .join("|");

              if (!grouped.has(key)) {
                const groupData: any = {};
                groupBy.forEach((field) => {
                  if (field === "userId") {
                    groupData.userId = result.executedById;
                  } else if (field === "projectId") {
                    groupData.projectId = result.testRun.projectId;
                  } else if (field === "roleId") {
                    groupData.roleId = result.executedBy.roleId;
                  } else if (field === "groupId") {
                    groupData.groupId = groupAssignment.groupId;
                  } else {
                    groupData[field] = result[field];
                  }
                });
                groupData.executionCount = 0;
                grouped.set(key, groupData);
              }

              grouped.get(key).executionCount++;
            });
          } else {
            // Normal grouping without groups
            const key = groupBy
              .map((field) => {
                if (field === "userId") return result.executedById;
                if (field === "projectId") return result.testRun.projectId;
                if (field === "roleId") return result.executedBy.roleId;
                return result[field];
              })
              .join("|");

            if (!grouped.has(key)) {
              const groupData: any = {};
              groupBy.forEach((field) => {
                if (field === "userId") {
                  groupData.userId = result.executedById;
                } else if (field === "projectId") {
                  groupData.projectId = result.testRun.projectId;
                } else if (field === "roleId") {
                  groupData.roleId = result.executedBy.roleId;
                } else {
                  groupData[field] = result[field];
                }
              });
              groupData.executionCount = 0;
              grouped.set(key, groupData);
            }

            grouped.get(key).executionCount++;
          }
        });

        return Array.from(grouped.values());
      },
    },
    createdCaseCount: {
      id: "createdCaseCount",
      label: "Created Test Case Count",
      aggregate: async (
        db: any,
        projectId: number | undefined,
        groupBy: string[],
        filters?: any,
        _dims?: string[]
      ) => {
        // Check for both createdAt (Repository Stats) and executedAt (User Engagement)
        const hasDateDimension =
          groupBy.includes("createdAt") || groupBy.includes("executedAt");
        const _dateField = groupBy.includes("createdAt")
          ? "createdAt"
          : "executedAt";

        if (hasDateDimension) {
          const results = await db.repositoryCases.findMany({
            where: {
              ...(isProjectSpecific && projectId
                ? { projectId: Number(projectId) }
                : {}),
              isDeleted: false,
              ...buildDateFilter(filters, "createdAt"),
            },
            select: {
              createdAt: true,
              creatorId: true,
              projectId: true,
            },
          });

          const groupedResults = results.reduce((acc: any, result: any) => {
            const key = groupBy
              .map((field) => {
                if (field === "createdAt" || field === "executedAt") {
                  const date = new Date(result.createdAt);
                  date.setUTCHours(0, 0, 0, 0);
                  return date.toISOString();
                } else if (field === "userId") {
                  return result.creatorId;
                }
                return result[field];
              })
              .join("|");

            if (!acc[key]) {
              acc[key] = {
                ...groupBy.reduce((obj: any, field) => {
                  if (field === "createdAt" || field === "executedAt") {
                    const date = new Date(result.createdAt);
                    date.setUTCHours(0, 0, 0, 0);
                    obj[field] = date.toISOString();
                  } else if (field === "userId") {
                    obj[field] = result.creatorId;
                  } else {
                    obj[field] = result[field];
                  }
                  return obj;
                }, {}),
                createdCaseCount: 0,
              };
            }
            acc[key].createdCaseCount++;
            return acc;
          }, {});

          return Object.values(groupedResults);
        }

        if (groupBy.length === 0) {
          const count = await db.repositoryCases.count({
            where: {
              ...(isProjectSpecific && projectId
                ? { projectId: Number(projectId) }
                : {}),
              isDeleted: false,
              ...buildDateFilter(filters, "createdAt"),
            },
          });
          return [{ createdCaseCount: count }];
        }

        // Manual grouping for other cases
        const results = await db.repositoryCases.findMany({
          where: {
            ...(isProjectSpecific && projectId
              ? { projectId: Number(projectId) }
              : {}),
            isDeleted: false,
            ...buildDateFilter(filters, "createdAt"),
          },
          select: {
            creatorId: true,
            projectId: true,
            creator: {
              select: {
                roleId: true,
                groups: {
                  select: {
                    groupId: true,
                  },
                },
              },
            },
          },
        });

        const grouped = new Map<string, any>();
        results.forEach((result: any) => {
          // Handle groupId specially - a user can be in multiple groups
          if (groupBy.includes("groupId")) {
            const userGroups = result.creator.groups || [];
            if (userGroups.length === 0) {
              // User is not in any group, skip this result for group dimension
              return;
            }

            // Create a separate entry for each group the user belongs to
            userGroups.forEach((groupAssignment: any) => {
              const key = groupBy
                .map((field) => {
                  if (field === "userId") return result.creatorId;
                  if (field === "projectId") return result.projectId;
                  if (field === "roleId") return result.creator.roleId;
                  if (field === "groupId") return groupAssignment.groupId;
                  return result[field];
                })
                .join("|");

              if (!grouped.has(key)) {
                const groupData: any = {};
                groupBy.forEach((field) => {
                  if (field === "userId") {
                    groupData.userId = result.creatorId;
                  } else if (field === "projectId") {
                    groupData.projectId = result.projectId;
                  } else if (field === "roleId") {
                    groupData.roleId = result.creator.roleId;
                  } else if (field === "groupId") {
                    groupData.groupId = groupAssignment.groupId;
                  } else {
                    groupData[field] = result[field];
                  }
                });
                groupData.createdCaseCount = 0;
                grouped.set(key, groupData);
              }

              grouped.get(key).createdCaseCount++;
            });
          } else {
            // Normal grouping without groups
            const key = groupBy
              .map((field) => {
                if (field === "userId") return result.creatorId;
                if (field === "projectId") return result.projectId;
                if (field === "roleId") return result.creator.roleId;
                return result[field];
              })
              .join("|");

            if (!grouped.has(key)) {
              const groupData: any = {};
              groupBy.forEach((field) => {
                if (field === "userId") {
                  groupData.userId = result.creatorId;
                } else if (field === "projectId") {
                  groupData.projectId = result.projectId;
                } else if (field === "roleId") {
                  groupData.roleId = result.creator.roleId;
                } else {
                  groupData[field] = result[field];
                }
              });
              groupData.createdCaseCount = 0;
              grouped.set(key, groupData);
            }

            grouped.get(key).createdCaseCount++;
          }
        });

        return Array.from(grouped.values());
      },
    },
    sessionResultCount: {
      id: "sessionResultCount",
      label: "Session Result Count",
      aggregate: async (
        db: any,
        projectId: number | undefined,
        groupBy: string[],
        filters?: any,
        _dims?: string[]
      ) => {
        // Check for both createdAt and executedAt (User Engagement uses executedAt)
        const hasDateDimension =
          groupBy.includes("createdAt") || groupBy.includes("executedAt");

        if (hasDateDimension) {
          const results = await db.sessionResults.findMany({
            where: {
              session: {
                ...(isProjectSpecific && projectId
                  ? { projectId: Number(projectId) }
                  : {}),
                isDeleted: false,
              },
              ...buildDateFilter(filters, "createdAt"),
            },
            select: {
              createdAt: true,
              createdById: true,
              session: {
                select: {
                  projectId: true,
                },
              },
            },
          });

          const groupedResults = results.reduce((acc: any, result: any) => {
            const key = groupBy
              .map((field) => {
                if (field === "createdAt" || field === "executedAt") {
                  const date = new Date(result.createdAt);
                  date.setUTCHours(0, 0, 0, 0);
                  return date.toISOString();
                } else if (field === "userId") {
                  return result.createdById;
                } else if (field === "projectId") {
                  return result.session.projectId;
                }
                return result[field];
              })
              .join("|");

            if (!acc[key]) {
              acc[key] = {
                ...groupBy.reduce((obj: any, field) => {
                  if (field === "createdAt" || field === "executedAt") {
                    const date = new Date(result.createdAt);
                    date.setUTCHours(0, 0, 0, 0);
                    obj[field] = date.toISOString();
                  } else if (field === "userId") {
                    obj[field] = result.createdById;
                  } else if (field === "projectId") {
                    obj[field] = result.session.projectId;
                  } else {
                    obj[field] = result[field];
                  }
                  return obj;
                }, {}),
                sessionResultCount: 0,
              };
            }
            acc[key].sessionResultCount++;
            return acc;
          }, {});

          return Object.values(groupedResults);
        }

        if (groupBy.length === 0) {
          const count = await db.sessionResults.count({
            where: {
              session: {
                ...(isProjectSpecific && projectId
                  ? { projectId: Number(projectId) }
                  : {}),
                isDeleted: false,
              },
              ...buildDateFilter(filters, "createdAt"),
            },
          });
          return [{ sessionResultCount: count }];
        }

        // Manual grouping for other cases
        const results = await db.sessionResults.findMany({
          where: {
            session: {
              ...(isProjectSpecific && projectId
                ? { projectId: Number(projectId) }
                : {}),
              isDeleted: false,
            },
            ...buildDateFilter(filters, "createdAt"),
          },
          select: {
            createdById: true,
            createdBy: {
              select: {
                roleId: true,
                groups: {
                  select: {
                    groupId: true,
                  },
                },
              },
            },
            session: {
              select: {
                projectId: true,
              },
            },
          },
        });

        const grouped = new Map<string, any>();
        results.forEach((result: any) => {
          // Handle groupId specially - a user can be in multiple groups
          if (groupBy.includes("groupId")) {
            const userGroups = result.createdBy.groups || [];
            if (userGroups.length === 0) {
              // User is not in any group, skip this result for group dimension
              return;
            }

            // Create a separate entry for each group the user belongs to
            userGroups.forEach((groupAssignment: any) => {
              const key = groupBy
                .map((field) => {
                  if (field === "userId") return result.createdById;
                  if (field === "projectId") return result.session.projectId;
                  if (field === "roleId") return result.createdBy.roleId;
                  if (field === "groupId") return groupAssignment.groupId;
                  return result[field];
                })
                .join("|");

              if (!grouped.has(key)) {
                const groupData: any = {};
                groupBy.forEach((field) => {
                  if (field === "userId") {
                    groupData.userId = result.createdById;
                  } else if (field === "projectId") {
                    groupData.projectId = result.session.projectId;
                  } else if (field === "roleId") {
                    groupData.roleId = result.createdBy.roleId;
                  } else if (field === "groupId") {
                    groupData.groupId = groupAssignment.groupId;
                  } else {
                    groupData[field] = result[field];
                  }
                });
                groupData.sessionResultCount = 0;
                grouped.set(key, groupData);
              }

              grouped.get(key).sessionResultCount++;
            });
          } else {
            // Normal grouping without groups
            const key = groupBy
              .map((field) => {
                if (field === "userId") return result.createdById;
                if (field === "projectId") return result.session.projectId;
                if (field === "roleId") return result.createdBy.roleId;
                return result[field];
              })
              .join("|");

            if (!grouped.has(key)) {
              const groupData: any = {};
              groupBy.forEach((field) => {
                if (field === "userId") {
                  groupData.userId = result.createdById;
                } else if (field === "projectId") {
                  groupData.projectId = result.session.projectId;
                } else if (field === "roleId") {
                  groupData.roleId = result.createdBy.roleId;
                } else {
                  groupData[field] = result[field];
                }
              });
              groupData.sessionResultCount = 0;
              grouped.set(key, groupData);
            }

            grouped.get(key).sessionResultCount++;
          }
        });

        return Array.from(grouped.values());
      },
    },
    averageElapsed: {
      id: "averageElapsed",
      label: "Average Time per Execution (seconds)",
      aggregate: async (
        db: any,
        projectId: number | undefined,
        groupBy: string[],
        filters?: any,
        _dims?: string[]
      ) => {
        if (groupBy.includes("executedAt")) {
          const results = await db.testRunResults.findMany({
            where: {
              testRun: {
                ...(isProjectSpecific && projectId
                  ? { projectId: Number(projectId) }
                  : {}),
                isDeleted: false,
              },
              elapsed: {
                not: null,
              },
              ...buildDateFilter(filters, "executedAt"),
            },
            select: {
              executedAt: true,
              executedById: true,
              elapsed: true,
              testRun: {
                select: {
                  projectId: true,
                },
              },
            },
          });

          const groupedResults = results.reduce((acc: any, result: any) => {
            const key = groupBy
              .map((field) => {
                if (field === "executedAt") {
                  const date = new Date(result.executedAt);
                  date.setUTCHours(0, 0, 0, 0);
                  return date.toISOString();
                } else if (field === "userId") {
                  return result.executedById;
                } else if (field === "projectId") {
                  return result.testRun.projectId;
                }
                return result[field];
              })
              .join("|");

            if (!acc[key]) {
              acc[key] = {
                ...groupBy.reduce((obj: any, field) => {
                  if (field === "executedAt") {
                    const date = new Date(result.executedAt);
                    date.setUTCHours(0, 0, 0, 0);
                    obj["executedAt"] = date.toISOString();
                  } else if (field === "userId") {
                    obj[field] = result.executedById;
                  } else if (field === "projectId") {
                    obj[field] = result.testRun.projectId;
                  } else {
                    obj[field] = result[field];
                  }
                  return obj;
                }, {}),
                totalElapsed: 0,
                count: 0,
              };
            }
            acc[key].totalElapsed += result.elapsed || 0;
            acc[key].count++;
            return acc;
          }, {});

          return Object.values(groupedResults).map((group: any) => ({
            ...Object.fromEntries(
              Object.entries(group).filter(
                ([key]) => !["totalElapsed", "count"].includes(key)
              )
            ),
            averageElapsed:
              group.count > 0 ? group.totalElapsed / group.count / 1000 : 0,
          }));
        }

        if (groupBy.length === 0) {
          const result = await db.testRunResults.aggregate({
            where: {
              testRun: {
                ...(isProjectSpecific && projectId
                  ? { projectId: Number(projectId) }
                  : {}),
                isDeleted: false,
              },
              elapsed: {
                not: null,
              },
              ...buildDateFilter(filters, "executedAt"),
            },
            _avg: {
              elapsed: true,
            },
          });
          // If no results with elapsed time, return 0
          // Otherwise, return the average in seconds (null values are already filtered out)
          return [
            {
              averageElapsed: result._avg.elapsed
                ? result._avg.elapsed / 1000
                : 0,
            },
          ];
        }

        const results = await db.testRunResults.findMany({
          where: {
            testRun: {
              ...(isProjectSpecific && projectId
                ? { projectId: Number(projectId) }
                : {}),
              isDeleted: false,
            },
            elapsed: {
              not: null,
            },
            ...buildDateFilter(filters, "executedAt"),
          },
          select: {
            executedById: true,
            elapsed: true,
            executedBy: {
              select: {
                roleId: true,
              },
            },
            testRun: {
              select: {
                projectId: true,
              },
            },
          },
        });

        const grouped = new Map<string, any>();
        results.forEach((result: any) => {
          const key = groupBy
            .map((field) => {
              if (field === "userId") return result.executedById;
              if (field === "projectId") return result.testRun.projectId;
              if (field === "roleId") return result.executedBy.roleId;
              return result[field];
            })
            .join("|");

          if (!grouped.has(key)) {
            const groupData: any = {};
            groupBy.forEach((field) => {
              if (field === "userId") {
                groupData.userId = result.executedById;
              } else if (field === "projectId") {
                groupData.projectId = result.testRun.projectId;
              } else if (field === "roleId") {
                groupData.roleId = result.executedBy.roleId;
              } else {
                groupData[field] = result[field];
              }
            });
            groupData.totalElapsed = 0;
            groupData.count = 0;
            grouped.set(key, groupData);
          }

          const group = grouped.get(key);
          // Only count results with non-null elapsed time
          if (result.elapsed !== null && result.elapsed !== undefined) {
            group.totalElapsed += result.elapsed;
            group.count++;
          }
        });

        return Array.from(grouped.values()).map((group: any) => ({
          ...Object.fromEntries(
            Object.entries(group).filter(
              ([key]) => !["totalElapsed", "count"].includes(key)
            )
          ),
          averageElapsed:
            group.count > 0 ? group.totalElapsed / group.count / 1000 : 0,
        }));
      },
    },
    lastActiveDate: {
      id: "lastActiveDate",
      label: "Last Active Date",
      aggregate: async (
        db: any,
        projectId: number | undefined,
        groupBy: string[],
        filters?: any,
        _dims?: string[]
      ) => {
        if (groupBy.length === 0) {
          const result = await db.testRunResults.aggregate({
            where: {
              testRun: {
                ...(isProjectSpecific && projectId
                  ? { projectId: Number(projectId) }
                  : {}),
                isDeleted: false,
              },
              ...buildDateFilter(filters, "executedAt"),
            },
            _max: {
              executedAt: true,
            },
          });
          return [{ lastActiveDate: result._max.executedAt }];
        }

        const results = await db.testRunResults.findMany({
          where: {
            testRun: {
              ...(isProjectSpecific && projectId
                ? { projectId: Number(projectId) }
                : {}),
              isDeleted: false,
            },
            ...buildDateFilter(filters, "executedAt"),
          },
          select: {
            executedAt: true,
            executedById: true,
            executedBy: {
              select: {
                roleId: true,
                groups: {
                  select: {
                    groupId: true,
                  },
                },
              },
            },
            testRun: {
              select: {
                projectId: true,
              },
            },
          },
        });

        const grouped = new Map<string, any>();
        results.forEach((result: any) => {
          // Handle groupId specially - a user can be in multiple groups
          if (groupBy.includes("groupId")) {
            const userGroups = result.executedBy.groups || [];
            if (userGroups.length === 0) {
              // User is not in any group, skip this result for group dimension
              return;
            }

            // Create a separate entry for each group the user belongs to
            userGroups.forEach((groupAssignment: any) => {
              const key = groupBy
                .map((field) => {
                  if (field === "userId") return result.executedById;
                  if (field === "projectId") return result.testRun.projectId;
                  if (field === "roleId") return result.executedBy.roleId;
                  if (field === "groupId") return groupAssignment.groupId;
                  return result[field];
                })
                .join("|");

              if (!grouped.has(key)) {
                const groupData: any = {};
                groupBy.forEach((field) => {
                  if (field === "userId") {
                    groupData.userId = result.executedById;
                  } else if (field === "projectId") {
                    groupData.projectId = result.testRun.projectId;
                  } else if (field === "roleId") {
                    groupData.roleId = result.executedBy.roleId;
                  } else if (field === "groupId") {
                    groupData.groupId = groupAssignment.groupId;
                  } else {
                    groupData[field] = result[field];
                  }
                });
                groupData.lastActiveDate = result.executedAt;
                grouped.set(key, groupData);
              } else {
                const group = grouped.get(key);
                if (
                  new Date(result.executedAt) > new Date(group.lastActiveDate)
                ) {
                  group.lastActiveDate = result.executedAt;
                }
              }
            });
          } else {
            // Normal grouping without groups
            const key = groupBy
              .map((field) => {
                if (field === "userId") return result.executedById;
                if (field === "projectId") return result.testRun.projectId;
                if (field === "roleId") return result.executedBy.roleId;
                return result[field];
              })
              .join("|");

            if (!grouped.has(key)) {
              const groupData: any = {};
              groupBy.forEach((field) => {
                if (field === "userId") {
                  groupData.userId = result.executedById;
                } else if (field === "projectId") {
                  groupData.projectId = result.testRun.projectId;
                } else if (field === "roleId") {
                  groupData.roleId = result.executedBy.roleId;
                } else {
                  groupData[field] = result[field];
                }
              });
              groupData.lastActiveDate = result.executedAt;
              grouped.set(key, groupData);
            } else {
              const group = grouped.get(key);
              if (
                new Date(result.executedAt) > new Date(group.lastActiveDate)
              ) {
                group.lastActiveDate = result.executedAt;
              }
            }
          }
        });

        return Array.from(grouped.values());
      },
    },
  };
}

// Shared issue tracking dimension registry factory
export function createIssueTrackingDimensionRegistry(
  isProjectSpecific: boolean = true
) {
  return {
    project: !isProjectSpecific
      ? {
          id: "project",
          label: "Project",
          getValues: async (db: any, _projectId?: number) => {
            const projects = await db.projects.findMany({
              where: {
                isDeleted: false,
                // Only include projects that have issues
                OR: [
                  {
                    repositoryCases: {
                      some: {
                        caseIssues: {
                          some: {
                            issue: {
                              isDeleted: false,
                            },
                          },
                        },
                      },
                    },
                  },
                  {
                    sessions: {
                      some: {
                        issues: {
                          some: {
                            isDeleted: false,
                          },
                        },
                      },
                    },
                  },
                  {
                    testRuns: {
                      some: {
                        issues: {
                          some: {
                            isDeleted: false,
                          },
                        },
                      },
                    },
                  },
                ],
              },
              select: { id: true, name: true, iconUrl: true },
              orderBy: { name: "asc" },
            });
            return projects;
          },
          groupBy: "projectId",
          join: { project: true },
          display: (val: any) => ({
            name: val.name,
            id: val.id,
            iconUrl: val.iconUrl,
          }),
        }
      : undefined,
    creator: {
      id: "creator",
      label: "Creator",
      getValues: async (db: any, projectId?: number) => {
        if (isProjectSpecific && projectId) {
          // Project-specific: Get creators from the project's issue config
          const project = await db.projects.findUnique({
            where: { id: Number(projectId) },
            include: {
              issues: {
                where: { isDeleted: false },
                include: {
                  createdBy: {
                    select: { id: true, name: true, email: true },
                  },
                },
                distinct: ["createdById"],
              },
            },
          });

          if (!project?.issues) return [];

          return project.issues
            .map((issue: any) => issue.createdBy)
            .filter((creator: any) => creator);
        } else {
          // Cross-project: Get all users who have created issues
          const users = await db.user.findMany({
            where: {
              isDeleted: false,
              createdIssues: {
                some: {
                  isDeleted: false,
                },
              },
            },
            select: { id: true, name: true, email: true },
            orderBy: { name: "asc" },
          });
          return users;
        }
      },
      groupBy: "createdById",
      join: { createdBy: true },
      display: (val: any) => ({
        name: val.name,
        id: val.id,
        email: val.email,
      }),
    },
    issueType: {
      id: "issueType",
      label: "Issue Type",
      getValues: async (db: any, projectId?: number) => {
        const results: Array<{
          id: string | null;
          name: string;
          iconUrl: string | null;
        }> = [];

        if (isProjectSpecific && projectId) {
          // Project-specific: Get distinct issue types from project's issues
          const project = await db.projects.findUnique({
            where: { id: Number(projectId) },
            include: {
              issues: {
                where: { isDeleted: false },
                select: {
                  issueTypeName: true,
                  issueTypeId: true,
                  issueTypeIconUrl: true,
                },
                distinct: ["issueTypeName"],
              },
            },
          });

          if (!project?.issues) return results;

          // Check if there are issues without an issue type
          const hasUnknownType = project.issues.some(
            (issue: any) => issue.issueTypeName === null
          );
          if (hasUnknownType) {
            results.push({ id: null, name: "Unspecified", iconUrl: null });
          }

          // Add known issue types
          project.issues.forEach((issue: any) => {
            if (issue.issueTypeName) {
              results.push({
                id: issue.issueTypeId || issue.issueTypeName,
                name: issue.issueTypeName,
                iconUrl: issue.issueTypeIconUrl,
              });
            }
          });
        } else {
          // Cross-project: Check for issues without issue type
          const unknownTypeCount = await db.issue.count({
            where: {
              isDeleted: false,
              issueTypeName: null,
            },
          });
          if (unknownTypeCount > 0) {
            results.push({ id: null, name: "Unspecified", iconUrl: null });
          }

          // Get all distinct issue types
          const issues = await db.issue.findMany({
            where: {
              isDeleted: false,
              issueTypeName: { not: null },
            },
            select: {
              issueTypeName: true,
              issueTypeId: true,
              issueTypeIconUrl: true,
            },
            distinct: ["issueTypeName"],
            orderBy: { issueTypeName: "asc" },
          });

          issues.forEach((issue: any) => {
            results.push({
              id: issue.issueTypeId || issue.issueTypeName,
              name: issue.issueTypeName,
              iconUrl: issue.issueTypeIconUrl,
            });
          });
        }

        return results;
      },
      groupBy: "issueTypeName",
      join: {},
      display: (val: any) => ({
        name: val.name || "Unspecified",
        id: val.id,
        iconUrl: val.iconUrl,
      }),
    },
    issueTracker: {
      id: "issueTracker",
      label: "Issue Tracker",
      getValues: async (db: any, projectId?: number) => {
        const results: Array<{
          id: number | null;
          name: string;
          provider: string | null;
        }> = [];

        if (isProjectSpecific && projectId) {
          // Project-specific: Get integrations used by project's issues
          const project = await db.projects.findUnique({
            where: { id: Number(projectId) },
            include: {
              issues: {
                where: { isDeleted: false },
                include: {
                  integration: {
                    select: { id: true, name: true, provider: true },
                  },
                },
                distinct: ["integrationId"],
              },
            },
          });

          if (!project?.issues) return results;

          // Check if there are issues without an integration (internal)
          const hasInternalIssues = project.issues.some(
            (issue: any) => issue.integrationId === null
          );
          if (hasInternalIssues) {
            results.push({ id: null, name: "Internal", provider: null });
          }

          // Add external integrations
          project.issues.forEach((issue: any) => {
            if (issue.integration) {
              results.push(issue.integration);
            }
          });
        } else {
          // Cross-project: Check for internal issues
          const internalIssueCount = await db.issue.count({
            where: {
              isDeleted: false,
              integrationId: null,
            },
          });
          if (internalIssueCount > 0) {
            results.push({ id: null, name: "Internal", provider: null });
          }

          // Get all integrations that have issues
          const integrations = await db.integration.findMany({
            where: {
              isDeleted: false,
              issues: {
                some: {
                  isDeleted: false,
                },
              },
            },
            select: { id: true, name: true, provider: true },
            orderBy: { name: "asc" },
          });
          results.push(...integrations);
        }

        return results;
      },
      groupBy: "integrationId",
      join: { integration: true },
      display: (val: any) => ({
        name: val.name || "Internal",
        id: val.id,
        provider: val.provider,
      }),
    },
    issueStatus: {
      id: "issueStatus",
      label: "Issue Status",
      getValues: async (db: any, projectId?: number) => {
        if (isProjectSpecific && projectId) {
          // Project-specific: Get distinct statuses from project's issues
          const project = await db.projects.findUnique({
            where: { id: Number(projectId) },
            include: {
              issues: {
                where: {
                  isDeleted: false,
                  status: { not: null },
                },
                select: { status: true },
                distinct: ["status"],
              },
            },
          });

          if (!project?.issues) return [];

          return project.issues.map((issue: any) => ({
            id: issue.status,
            name: issue.status,
          }));
        } else {
          // Cross-project: Get all distinct statuses
          const issues = await db.issue.findMany({
            where: {
              isDeleted: false,
              status: { not: null },
            },
            select: { status: true },
            distinct: ["status"],
            orderBy: { status: "asc" },
          });

          return issues.map((issue: any) => ({
            id: issue.status,
            name: issue.status,
          }));
        }
      },
      groupBy: "status",
      join: {},
      display: (val: any) => ({
        name: val.name || "Unknown",
        id: val.id || "unknown",
      }),
    },
    priority: {
      id: "priority",
      label: "Priority",
      getValues: async (db: any, projectId?: number) => {
        // Helper to normalize priority for case-insensitive grouping
        const normalizePriority = (priority: string) => {
          const lower = priority.toLowerCase().trim();
          // Capitalize first letter for display
          return lower.charAt(0).toUpperCase() + lower.slice(1);
        };

        if (isProjectSpecific && projectId) {
          // Project-specific: Get distinct priorities from project's issues
          const project = await db.projects.findUnique({
            where: { id: Number(projectId) },
            include: {
              issues: {
                where: {
                  isDeleted: false,
                  priority: { not: null },
                },
                select: { priority: true },
                distinct: ["priority"],
              },
            },
          });

          if (!project?.issues) return [];

          // Normalize priorities for case-insensitive grouping
          const uniquePriorities = new Map<string, string>();
          project.issues.forEach((issue: any) => {
            const normalized = normalizePriority(issue.priority);
            const key = normalized.toLowerCase();
            if (!uniquePriorities.has(key)) {
              uniquePriorities.set(key, normalized);
            }
          });

          return Array.from(uniquePriorities.values()).map((name) => ({
            id: name.toLowerCase(),
            name: name,
          }));
        } else {
          // Cross-project: Get all distinct priorities
          const issues = await db.issue.findMany({
            where: {
              isDeleted: false,
              priority: { not: null },
            },
            select: { priority: true },
            distinct: ["priority"],
            orderBy: { priority: "asc" },
          });

          // Normalize priorities for case-insensitive grouping
          const uniquePriorities = new Map<string, string>();
          issues.forEach((issue: any) => {
            const normalized = normalizePriority(issue.priority);
            const key = normalized.toLowerCase();
            if (!uniquePriorities.has(key)) {
              uniquePriorities.set(key, normalized);
            }
          });

          return Array.from(uniquePriorities.values()).map((name) => ({
            id: name.toLowerCase(),
            name: name,
          }));
        }
      },
      groupBy: "priority",
      join: {},
      display: (val: any) => ({
        name: val.name || "Unknown",
        id: val.id || "unknown",
      }),
    },
    date: {
      id: "date",
      label: "Creation Date",
      getValues: async (db: any, projectId?: number) => {
        if (isProjectSpecific && projectId) {
          // Project-specific: Get dates from the project's issue config issues
          const project = await db.projects.findUnique({
            where: { id: Number(projectId) },
            include: {
              issues: {
                where: { isDeleted: false },
                select: { createdAt: true },
                distinct: ["createdAt"],
                orderBy: { createdAt: "asc" },
              },
            },
          });

          if (!project?.issues) return [];

          // Group dates by day
          const datesByDay = project.issues.reduce((acc: any, curr: any) => {
            const day = new Date(curr.createdAt);
            day.setUTCHours(0, 0, 0, 0);
            const dayStr = day.toISOString();
            if (!acc[dayStr]) {
              acc[dayStr] = day.toISOString();
            }
            return acc;
          }, {});
          return Object.values(datesByDay).map((d: any) => ({ createdAt: d }));
        } else {
          // Cross-project: Get all issue creation dates
          const dates = await db.issue.findMany({
            where: { isDeleted: false },
            select: { createdAt: true },
            distinct: ["createdAt"],
            orderBy: { createdAt: "asc" },
          });

          const datesByDay = dates.reduce((acc: any, curr: any) => {
            const day = new Date(curr.createdAt);
            day.setUTCHours(0, 0, 0, 0);
            const dayStr = day.toISOString();
            if (!acc[dayStr]) {
              acc[dayStr] = day.toISOString();
            }
            return acc;
          }, {});

          return Object.values(datesByDay).map((d: any) => ({
            createdAt: d,
          }));
        }
      },
      groupBy: "createdAt",
      join: {},
      display: (val: any) => {
        const date = new Date(val.createdAt);
        date.setUTCHours(0, 0, 0, 0);
        return { createdAt: date.toISOString() };
      },
    },
  };
}

// Helper to normalize priority for case-insensitive grouping
function normalizePriority(priority: string | null | undefined): string {
  if (!priority) return "unknown";
  const lower = priority.toLowerCase().trim();
  // Capitalize first letter for display
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

// Shared issue tracking metric registry factory
export function createIssueTrackingMetricRegistry(
  isProjectSpecific: boolean = true
) {
  return {
    issueCount: {
      id: "issueCount",
      label: "Issue Count",
      aggregate: async (
        db: any,
        projectId: number | undefined,
        groupBy: string[],
        filters?: any,
        _dims?: string[]
      ) => {
        if (isProjectSpecific && projectId) {
          // Project-specific implementation
          const project = await db.projects.findUnique({
            where: { id: Number(projectId) },
            include: {
              issues: {
                where: {
                  isDeleted: false,
                  ...buildDateFilter(filters, "createdAt"),
                },
                include: {
                  ...(groupBy.includes("createdById")
                    ? { createdBy: true }
                    : {}),
                  ...(groupBy.includes("integrationId")
                    ? { integration: true }
                    : {}),
                },
              },
            },
          });

          if (!project?.issues) return [];

          const issues = project.issues;

          // Handle no grouping (total count)
          if (groupBy.length === 0) {
            return [{ issueCount: issues.length }];
          }

          // Handle date grouping specially
          if (groupBy.includes("createdAt")) {
            // Group manually by date and other dimensions
            const grouped = new Map<string, any>();
            issues.forEach((issue: any) => {
              const key = groupBy
                .map((field) => {
                  if (field === "createdAt") {
                    const date = new Date(issue.createdAt);
                    date.setUTCHours(0, 0, 0, 0);
                    return date.toISOString();
                  } else if (field === "priority") {
                    // Normalize priority for case-insensitive grouping
                    return normalizePriority(issue[field]);
                  }
                  return issue[field] || "unknown";
                })
                .join("|");

              if (!grouped.has(key)) {
                const groupData: any = {};
                groupBy.forEach((field) => {
                  if (field === "createdAt") {
                    const date = new Date(issue.createdAt);
                    date.setUTCHours(0, 0, 0, 0);
                    groupData.createdAt = date.toISOString();
                  } else if (field === "createdById") {
                    groupData.createdById = issue.createdById;
                  } else if (field === "integrationId") {
                    groupData.integrationId = issue.integrationId;
                  } else if (field === "priority") {
                    // Normalize priority for case-insensitive grouping
                    groupData.priority = normalizePriority(issue.priority);
                  }
                });

                groupData.issueCount = 0;
                grouped.set(key, groupData);
              }

              grouped.get(key).issueCount++;
            });

            return Array.from(grouped.values());
          } else {
            // Use manual grouping for non-date fields
            const grouped = new Map<string, any>();
            issues.forEach((issue: any) => {
              const key = groupBy
                .map((field) => {
                  // Normalize priority for case-insensitive grouping
                  if (field === "priority") {
                    return normalizePriority(issue[field]);
                  }
                  return issue[field] || "unknown";
                })
                .join("|");

              if (!grouped.has(key)) {
                const groupData: any = {};
                groupBy.forEach((field) => {
                  // Normalize priority for case-insensitive grouping
                  if (field === "priority") {
                    groupData[field] = normalizePriority(issue[field]);
                  } else {
                    groupData[field] = issue[field];
                  }
                });
                groupData.issueCount = 0;
                grouped.set(key, groupData);
              }

              grouped.get(key).issueCount++;
            });

            return Array.from(grouped.values());
          }
        } else {
          // Cross-project implementation
          if (groupBy.includes("createdAt")) {
            const results = await db.issue.findMany({
              where: { isDeleted: false },
              select: {
                createdAt: true,
                createdById: true,
                integrationId: true,
                issueTypeName: true,
                issueTypeId: true,
                issueTypeIconUrl: true,
                status: true,
                priority: true,
                projectId: true,
                // Get project ID through related entities as fallback
                caseIssues: {
                  select: { case: { select: { projectId: true } } },
                  take: 1,
                },
                sessions: {
                  select: { projectId: true },
                  take: 1,
                },
                testRuns: {
                  select: { projectId: true },
                  take: 1,
                },
              },
            });

            const groupedResults = results.reduce((acc: any, result: any) => {
              // Determine project ID from direct field or related entities
              const projectId =
                result.projectId ||
                result.caseIssues[0]?.case?.projectId ||
                result.sessions[0]?.projectId ||
                result.testRuns[0]?.projectId ||
                null;

              const key = groupBy
                .map((field) => {
                  if (field === "createdAt") {
                    const date = new Date(result.createdAt);
                    date.setUTCHours(0, 0, 0, 0);
                    return date.toISOString();
                  } else if (field === "projectId") {
                    return projectId;
                  } else if (field === "priority") {
                    // Normalize priority for case-insensitive grouping
                    return normalizePriority(result[field]);
                  }
                  return result[field] ?? "unknown";
                })
                .join("|");

              if (!acc[key]) {
                acc[key] = {
                  ...groupBy.reduce((obj: any, field) => {
                    if (field === "createdAt") {
                      const date = new Date(result.createdAt);
                      date.setUTCHours(0, 0, 0, 0);
                      obj[field] = date.toISOString();
                    } else if (field === "projectId") {
                      obj[field] = projectId;
                    } else if (field === "priority") {
                      // Normalize priority for case-insensitive grouping
                      obj[field] = normalizePriority(result[field]);
                    } else {
                      obj[field] = result[field];
                    }
                    return obj;
                  }, {}),
                  issueCount: 0,
                };
              }
              acc[key].issueCount++;
              return acc;
            }, {});

            return Object.values(groupedResults);
          }

          if (groupBy.length === 0) {
            const count = await db.issue.count({
              where: { isDeleted: false },
            });
            return [{ issueCount: count }];
          }

          // For simple groupBy without project
          if (!groupBy.includes("projectId")) {
            const rawResults = await db.issue.groupBy({
              by: groupBy as any[],
              where: { isDeleted: false },
              _count: { _all: true },
            });

            // If grouping by priority, we need to merge case-insensitive values
            if (groupBy.includes("priority")) {
              const merged = new Map<string, any>();
              rawResults.forEach((r: any) => {
                const normalizedPriority = normalizePriority(r.priority);
                const key = groupBy
                  .map((field) =>
                    field === "priority" ? normalizedPriority : r[field]
                  )
                  .join("|");

                if (!merged.has(key)) {
                  merged.set(key, {
                    ...groupBy.reduce((obj: any, field) => {
                      obj[field] =
                        field === "priority" ? normalizedPriority : r[field];
                      return obj;
                    }, {}),
                    issueCount: 0,
                  });
                }
                merged.get(key).issueCount += r._count._all;
              });
              return Array.from(merged.values());
            }

            return rawResults.map((r: any) => ({
              ...r,
              issueCount: r._count._all,
            }));
          }

          // For groupBy with project, we need a more complex query
          const results = await db.issue.findMany({
            where: { isDeleted: false },
            select: {
              createdById: true,
              integrationId: true,
              issueTypeName: true,
              issueTypeId: true,
              issueTypeIconUrl: true,
              status: true,
              priority: true,
              projectId: true,
              caseIssues: {
                select: { case: { select: { projectId: true } } },
                take: 1,
              },
              sessions: {
                select: { projectId: true },
                take: 1,
              },
              testRuns: {
                select: { projectId: true },
                take: 1,
              },
            },
          });

          const groupedResults = results.reduce((acc: any, result: any) => {
            const projectId =
              result.projectId ||
              result.caseIssues[0]?.case?.projectId ||
              result.sessions[0]?.projectId ||
              result.testRuns[0]?.projectId ||
              null;

            const key = groupBy
              .map((field) => {
                if (field === "projectId") {
                  return projectId;
                } else if (field === "priority") {
                  // Normalize priority for case-insensitive grouping
                  return normalizePriority(result[field]);
                }
                return result[field] ?? "unknown";
              })
              .join("|");

            if (!acc[key]) {
              acc[key] = {
                ...groupBy.reduce((obj: any, field) => {
                  if (field === "projectId") {
                    obj[field] = projectId;
                  } else if (field === "priority") {
                    // Normalize priority for case-insensitive grouping
                    obj[field] = normalizePriority(result[field]);
                  } else {
                    obj[field] = result[field];
                  }
                  return obj;
                }, {}),
                issueCount: 0,
              };
            }
            acc[key].issueCount++;
            return acc;
          }, {});

          return Object.values(groupedResults);
        }
      },
    },
  };
}

// ==================== AUTOMATION TRENDS REPORT ====================

// Helper function to get week ending date (Sunday)
function getWeekEndDate(date: Date): Date {
  const weekEnd = new Date(date);
  const day = weekEnd.getUTCDay();
  // If Sunday (0), use current date; otherwise add days until Sunday
  const daysUntilSunday = day === 0 ? 0 : 7 - day;
  weekEnd.setUTCDate(weekEnd.getUTCDate() + daysUntilSunday);
  weekEnd.setUTCHours(23, 59, 59, 999);
  return weekEnd;
}

// Helper function to get week start date (Monday)
function _getWeekStartDate(weekEndDate: Date): Date {
  const weekStart = new Date(weekEndDate);
  weekStart.setUTCDate(weekStart.getUTCDate() - 6); // Go back 6 days (Sunday to Monday)
  weekStart.setUTCHours(0, 0, 0, 0);
  return weekStart;
}

// Automation Trends Dimension Registry
export function createAutomationTrendsDimensionRegistry(
  isProjectSpecific: boolean = true
) {
  return {
    project: !isProjectSpecific
      ? {
          id: "project",
          label: "Project",
          getValues: async (db: any, projectId?: number, filters?: any) => {
            const projects = await db.projects.findMany({
              where: {
                isDeleted: false,
                repositoryCases: {
                  some: {
                    isDeleted: false,
                    ...buildDateFilter(filters, "createdAt"),
                  },
                },
              },
              select: { id: true, name: true },
              orderBy: { name: "asc" },
            });
            return projects;
          },
          groupBy: "projectId",
          join: {
            project: {
              select: { id: true, name: true },
            },
          },
          display: (val: any) => ({ name: val.name, id: val.id }),
        }
      : undefined,
    weekEnding: {
      id: "weekEnding",
      label: "Week Ending",
      getValues: async (db: any, projectId?: number, filters?: any) => {
        // Get all repository cases within the date range
        const cases = await db.repositoryCases.findMany({
          where: {
            ...(isProjectSpecific && projectId
              ? { projectId: Number(projectId) }
              : {}),
            isDeleted: false,
            ...buildDateFilter(filters, "createdAt"),
          },
          select: { createdAt: true },
        });

        // Group by week ending date
        const weeksByEnd = new Map<string, { weekEnding: string }>();
        cases.forEach((c: any) => {
          const weekEnd = getWeekEndDate(new Date(c.createdAt));
          const key = weekEnd.toISOString();
          if (!weeksByEnd.has(key)) {
            weeksByEnd.set(key, { weekEnding: key });
          }
        });

        // Sort by date
        return Array.from(weeksByEnd.values()).sort(
          (a, b) =>
            new Date(a.weekEnding).getTime() - new Date(b.weekEnding).getTime()
        );
      },
      groupBy: "weekEnding",
      join: {},
      display: (val: any) => {
        const date = new Date(val.weekEnding);
        return {
          weekEnding: date.toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
            timeZone: "UTC",
          }),
        };
      },
    },
    priority: {
      id: "priority",
      label: "Priority",
      getValues: async (db: any, projectId?: number, filters?: any) => {
        // Get the priority field
        const priorityField = await db.caseFields.findUnique({
          where: { systemName: "priority" },
          select: { id: true },
        });

        if (!priorityField) return [];

        // Get distinct priority values from case field values
        const values = await db.caseFieldValues.findMany({
          where: {
            fieldId: priorityField.id,
            testCase: {
              ...(isProjectSpecific && projectId
                ? { projectId: Number(projectId) }
                : {}),
              isDeleted: false,
              ...buildDateFilter(filters, "createdAt"),
            },
          },
          select: { value: true },
          distinct: ["value"],
        });

        // Return unique priority values
        const uniqueValues = new Map();
        values.forEach((v: any) => {
          if (v.value && typeof v.value === "string") {
            uniqueValues.set(v.value, { id: v.value, name: v.value });
          }
        });

        return Array.from(uniqueValues.values()).sort((a: any, b: any) =>
          a.name.localeCompare(b.name)
        );
      },
      groupBy: "priority",
      join: {},
      display: (val: any) => ({ name: val.name, id: val.id }),
    },
    automationStatus: {
      id: "automationStatus",
      label: "Automation Status",
      getValues: async () => {
        return [
          { id: "automated", name: "Automated" },
          { id: "manual", name: "Manual" },
        ];
      },
      groupBy: "automated",
      join: {},
      display: (val: any) => ({
        name: val.automated ? "Automated" : "Manual",
        id: val.automated ? "automated" : "manual",
      }),
    },
  };
}

// Automation Trends Metric Registry
export function createAutomationTrendsMetricRegistry(
  isProjectSpecific: boolean = true
) {
  return {
    automatedCount: {
      id: "automatedCount",
      label: "Automated Count",
      aggregate: async (
        db: any,
        projectId: number | undefined,
        groupBy: string[],
        filters?: any,
        dims?: string[]
      ) => {
        if (!groupBy || !Array.isArray(groupBy)) {
          return [];
        }

        // Get priority field if priority dimension is being used
        const priorityField = dims?.includes("priority")
          ? await db.caseFields.findUnique({
              where: { systemName: "priority" },
              select: { id: true },
            })
          : null;

        // Build priority filter if specified in filters
        const priorityFilter =
          filters?.priorityValues && priorityField
            ? {
                caseFieldValues: {
                  some: {
                    fieldId: priorityField.id,
                    value: { in: filters.priorityValues },
                  },
                },
              }
            : {};

        if (groupBy.includes("weekEnding")) {
          // Get all week ending dates from the dimension registry
          const dateFilter = buildDateFilter(filters, "createdAt");

          // Get all cases that could appear in any week snapshot
          const allCases = await db.repositoryCases.findMany({
            where: {
              ...(isProjectSpecific && projectId
                ? { projectId: Number(projectId) }
                : {}),
              automated: true,
              ...dateFilter,
              ...priorityFilter,
            },
            select: {
              id: true,
              createdAt: true,
              isDeleted: true,
              projectId: true,
              automated: true,
              ...(priorityField
                ? {
                    caseFieldValues: {
                      where: { fieldId: priorityField.id },
                      select: { value: true },
                    },
                  }
                : {}),
            },
          });

          // Get all unique week ending dates from cases
          const weekEndDates = new Set<string>();
          allCases.forEach((c: any) => {
            const weekEnd = getWeekEndDate(new Date(c.createdAt));
            weekEndDates.add(weekEnd.toISOString());
          });

          // Sort week dates
          const sortedWeeks = Array.from(weekEndDates).sort();

          // For each week, count cases that existed as of that week end
          const groupedResults: any = {};

          sortedWeeks.forEach((weekEndStr) => {
            const weekEnd = new Date(weekEndStr);

            // Count cases for this week snapshot
            allCases.forEach((testCase: any) => {
              const createdDate = new Date(testCase.createdAt);

              // Include if: created <= weekEnd AND not deleted
              const existedInWeek =
                createdDate <= weekEnd && !testCase.isDeleted;

              if (existedInWeek) {
                const key = groupBy
                  .map((field) => {
                    if (field === "weekEnding") {
                      return weekEndStr;
                    } else if (field === "projectId") {
                      return testCase.projectId;
                    } else if (field === "priority") {
                      const priorityValue =
                        testCase.caseFieldValues?.[0]?.value;
                      return priorityValue || "None";
                    } else if (field === "automated") {
                      return testCase.automated ? "automated" : "manual";
                    }
                    return null;
                  })
                  .join("|");

                if (!groupedResults[key]) {
                  groupedResults[key] = {
                    ...groupBy.reduce((obj: any, field) => {
                      if (field === "weekEnding") {
                        obj[field] = weekEndStr;
                      } else if (field === "projectId") {
                        obj[field] = testCase.projectId;
                      } else if (field === "priority") {
                        const priorityValue =
                          testCase.caseFieldValues?.[0]?.value;
                        obj[field] = priorityValue || "None";
                      } else if (field === "automated") {
                        obj[field] = testCase.automated;
                      }
                      return obj;
                    }, {}),
                    automatedCount: 0,
                  };
                }
                groupedResults[key].automatedCount++;
              }
            });
          });

          return Object.values(groupedResults);
        }

        // Non-week-based aggregation - current snapshot
        const count = await db.repositoryCases.count({
          where: {
            ...(isProjectSpecific && projectId
              ? { projectId: Number(projectId) }
              : {}),
            isDeleted: false,
            automated: true,
            ...buildDateFilter(filters, "createdAt"),
            ...priorityFilter,
          },
        });

        return [{ automatedCount: count }];
      },
    },
    manualCount: {
      id: "manualCount",
      label: "Manual Count",
      aggregate: async (
        db: any,
        projectId: number | undefined,
        groupBy: string[],
        filters?: any,
        dims?: string[]
      ) => {
        if (!groupBy || !Array.isArray(groupBy)) {
          return [];
        }

        // Get priority field if priority dimension is being used
        const priorityField = dims?.includes("priority")
          ? await db.caseFields.findUnique({
              where: { systemName: "priority" },
              select: { id: true },
            })
          : null;

        // Build priority filter if specified in filters
        const priorityFilter =
          filters?.priorityValues && priorityField
            ? {
                caseFieldValues: {
                  some: {
                    fieldId: priorityField.id,
                    value: { in: filters.priorityValues },
                  },
                },
              }
            : {};

        if (groupBy.includes("weekEnding")) {
          const dateFilter = buildDateFilter(filters, "createdAt");

          // Get all cases that could appear in any week snapshot
          const allCases = await db.repositoryCases.findMany({
            where: {
              ...(isProjectSpecific && projectId
                ? { projectId: Number(projectId) }
                : {}),
              automated: false,
              ...dateFilter,
              ...priorityFilter,
            },
            select: {
              id: true,
              createdAt: true,
              isDeleted: true,
              projectId: true,
              automated: true,
              ...(priorityField
                ? {
                    caseFieldValues: {
                      where: { fieldId: priorityField.id },
                      select: { value: true },
                    },
                  }
                : {}),
            },
          });

          // Get all unique week ending dates from cases
          const weekEndDates = new Set<string>();
          allCases.forEach((c: any) => {
            const weekEnd = getWeekEndDate(new Date(c.createdAt));
            weekEndDates.add(weekEnd.toISOString());
          });

          // Sort week dates
          const sortedWeeks = Array.from(weekEndDates).sort();

          // For each week, count cases that existed as of that week end
          const groupedResults: any = {};

          sortedWeeks.forEach((weekEndStr) => {
            const weekEnd = new Date(weekEndStr);

            // Count cases for this week snapshot
            allCases.forEach((testCase: any) => {
              const createdDate = new Date(testCase.createdAt);

              // Include if: created <= weekEnd AND not deleted
              const existedInWeek =
                createdDate <= weekEnd && !testCase.isDeleted;

              if (existedInWeek) {
                const key = groupBy
                  .map((field) => {
                    if (field === "weekEnding") {
                      return weekEndStr;
                    } else if (field === "projectId") {
                      return testCase.projectId;
                    } else if (field === "priority") {
                      const priorityValue =
                        testCase.caseFieldValues?.[0]?.value;
                      return priorityValue || "None";
                    } else if (field === "automated") {
                      return testCase.automated ? "automated" : "manual";
                    }
                    return null;
                  })
                  .join("|");

                if (!groupedResults[key]) {
                  groupedResults[key] = {
                    ...groupBy.reduce((obj: any, field) => {
                      if (field === "weekEnding") {
                        obj[field] = weekEndStr;
                      } else if (field === "projectId") {
                        obj[field] = testCase.projectId;
                      } else if (field === "priority") {
                        const priorityValue =
                          testCase.caseFieldValues?.[0]?.value;
                        obj[field] = priorityValue || "None";
                      } else if (field === "automated") {
                        obj[field] = testCase.automated;
                      }
                      return obj;
                    }, {}),
                    manualCount: 0,
                  };
                }
                groupedResults[key].manualCount++;
              }
            });
          });

          return Object.values(groupedResults);
        }

        // Non-week-based aggregation - current snapshot
        const count = await db.repositoryCases.count({
          where: {
            ...(isProjectSpecific && projectId
              ? { projectId: Number(projectId) }
              : {}),
            isDeleted: false,
            automated: false,
            ...buildDateFilter(filters, "createdAt"),
            ...priorityFilter,
          },
        });

        return [{ manualCount: count }];
      },
    },
    totalCount: {
      id: "totalCount",
      label: "Total Count",
      aggregate: async (
        db: any,
        projectId: number | undefined,
        groupBy: string[],
        filters?: any,
        dims?: string[]
      ) => {
        if (!groupBy || !Array.isArray(groupBy)) {
          return [];
        }

        // Get priority field if priority dimension is being used
        const priorityField = dims?.includes("priority")
          ? await db.caseFields.findUnique({
              where: { systemName: "priority" },
              select: { id: true },
            })
          : null;

        // Build priority filter if specified in filters
        const priorityFilter =
          filters?.priorityValues && priorityField
            ? {
                caseFieldValues: {
                  some: {
                    fieldId: priorityField.id,
                    value: { in: filters.priorityValues },
                  },
                },
              }
            : {};

        if (groupBy.includes("weekEnding")) {
          const dateFilter = buildDateFilter(filters, "createdAt");

          // Get all cases that could appear in any week snapshot
          const allCases = await db.repositoryCases.findMany({
            where: {
              ...(isProjectSpecific && projectId
                ? { projectId: Number(projectId) }
                : {}),
              ...dateFilter,
              ...priorityFilter,
            },
            select: {
              id: true,
              createdAt: true,
              isDeleted: true,
              projectId: true,
              automated: true,
              ...(priorityField
                ? {
                    caseFieldValues: {
                      where: { fieldId: priorityField.id },
                      select: { value: true },
                    },
                  }
                : {}),
            },
          });

          // Get all unique week ending dates from cases
          const weekEndDates = new Set<string>();
          allCases.forEach((c: any) => {
            const weekEnd = getWeekEndDate(new Date(c.createdAt));
            weekEndDates.add(weekEnd.toISOString());
          });

          // Sort week dates
          const sortedWeeks = Array.from(weekEndDates).sort();

          // For each week, count cases that existed as of that week end
          const groupedResults: any = {};

          sortedWeeks.forEach((weekEndStr) => {
            const weekEnd = new Date(weekEndStr);

            // Count cases for this week snapshot
            allCases.forEach((testCase: any) => {
              const createdDate = new Date(testCase.createdAt);

              // Include if: created <= weekEnd AND not deleted
              const existedInWeek =
                createdDate <= weekEnd && !testCase.isDeleted;

              if (existedInWeek) {
                const key = groupBy
                  .map((field) => {
                    if (field === "weekEnding") {
                      return weekEndStr;
                    } else if (field === "projectId") {
                      return testCase.projectId;
                    } else if (field === "priority") {
                      const priorityValue =
                        testCase.caseFieldValues?.[0]?.value;
                      return priorityValue || "None";
                    } else if (field === "automated") {
                      return testCase.automated ? "automated" : "manual";
                    }
                    return null;
                  })
                  .join("|");

                if (!groupedResults[key]) {
                  groupedResults[key] = {
                    ...groupBy.reduce((obj: any, field) => {
                      if (field === "weekEnding") {
                        obj[field] = weekEndStr;
                      } else if (field === "projectId") {
                        obj[field] = testCase.projectId;
                      } else if (field === "priority") {
                        const priorityValue =
                          testCase.caseFieldValues?.[0]?.value;
                        obj[field] = priorityValue || "None";
                      } else if (field === "automated") {
                        obj[field] = testCase.automated;
                      }
                      return obj;
                    }, {}),
                    totalCount: 0,
                  };
                }
                groupedResults[key].totalCount++;
              }
            });
          });

          return Object.values(groupedResults);
        }

        // Non-week-based aggregation - current snapshot
        const count = await db.repositoryCases.count({
          where: {
            ...(isProjectSpecific && projectId
              ? { projectId: Number(projectId) }
              : {}),
            isDeleted: false,
            ...buildDateFilter(filters, "createdAt"),
            ...priorityFilter,
          },
        });

        return [{ totalCount: count }];
      },
    },
    automationRate: {
      id: "automationRate",
      label: "Automation Rate %",
      aggregate: async (
        _prisma: any,
        _projectId: number | undefined,
        _groupBy: string[],
        _filters?: any,
        _dims?: string[]
      ) => {
        // This metric requires calculating from automatedCount and totalCount
        // It will be calculated on the frontend by combining those two metrics
        return [];
      },
      hidden: true, // Hide from UI as it's calculated on frontend
    },
  };
}
