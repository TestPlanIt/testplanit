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
          getValues: async (prisma: any, projectId?: number) => {
            const projects = await prisma.projects.findMany({
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
      getValues: async (prisma: any, projectId?: number) => {
        const statuses = await prisma.status.findMany({
          where: {
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
      getValues: async (prisma: any, projectId?: number) => {
        const users = await prisma.user.findMany({
          where: {
            isDeleted: false,
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
      getValues: async (prisma: any, projectId?: number) => {
        const configurations = await prisma.configurations.findMany({
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
        prisma: any,
        projectId?: number,
        filters?: { startDate?: string; endDate?: string }
      ) => {
        const dates = await prisma.testRunResults.findMany({
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
      getValues: async (prisma: any, projectId?: number) => {
        const testRuns = await prisma.testRuns.findMany({
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
      getValues: async (prisma: any, projectId?: number) => {
        const testCases = await prisma.testRunCases.findMany({
          where: {
            testRun: {
              ...(isProjectSpecific && projectId
                ? { projectId: Number(projectId) }
                : {}),
              isDeleted: false,
            },
          },
          select: {
            id: true,
            repositoryCase: {
              select: {
                name: true,
                isDeleted: true,
                source: true,
              },
            },
          },
          orderBy: { id: "asc" },
        });
        return testCases.map(
          (tc: {
            id: any;
            repositoryCase: { name: any; isDeleted: boolean; source: string };
          }) => ({
            id: tc.id,
            name: tc.repositoryCase?.name || `Case ${tc.id}`,
            isDeleted: tc.repositoryCase?.isDeleted || false,
            source: tc.repositoryCase?.source || "MANUAL",
          })
        );
      },
      groupBy: "testRunCaseId",
      join: {
        testRunCase: {
          include: {
            repositoryCase: {
              select: {
                id: true,
                name: true,
                isDeleted: true,
                source: true,
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
          };
        }

        // Otherwise try to get from repositoryCase
        return {
          name: val.repositoryCase?.name || `Case ${val.id}`,
          id: val.id,
          isDeleted: val.repositoryCase?.isDeleted || false,
          source: val.repositoryCase?.source || "MANUAL",
        };
      },
    },
    milestone: {
      id: "milestone",
      label: "Milestone",
      getValues: async (prisma: any, projectId?: number) => {
        const milestones = await prisma.milestones.findMany({
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
        prisma: any,
        projectId: number | undefined,
        groupBy: string[],
        filters?: any,
        dims?: string[]
      ) => {
        // Type guard to ensure groupBy is defined
        if (!groupBy || !Array.isArray(groupBy)) {
          return [];
        }

        if (groupBy.includes("executedAt")) {
          const results = await prisma.testRunResults.findMany({
            where: {
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
            },
            select: {
              executedAt: true,
              executedById: true,
              statusId: true,
              testRunId: true,
              testRunCaseId: true,
              status: {
                select: {
                  id: true,
                  name: true,
                  color: { select: { value: true } },
                },
              },
              testRun: {
                select: {
                  projectId: true,
                  configId: true,
                  milestoneId: true,
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
                } else if (field === "executedById") {
                  return result.executedById;
                } else if (field === "statusId") {
                  return result.statusId;
                } else if (field === "projectId") {
                  return result.testRun.projectId;
                } else if (field === "configId") {
                  return result.testRun.configId;
                } else if (field === "milestoneId") {
                  return result.testRun.milestoneId;
                } else if (field === "testRunId") {
                  return result.testRunId;
                } else if (field === "testRunCaseId") {
                  return result.testRunCaseId;
                }
                return null;
              })
              .join("|");

            if (!acc[key]) {
              acc[key] = {
                ...groupBy.reduce((obj: any, field) => {
                  if (field === "executedAt") {
                    const date = new Date(result.executedAt);
                    date.setUTCHours(0, 0, 0, 0);
                    obj[field] = date.toISOString();
                  } else if (field === "executedById") {
                    obj[field] = result.executedById;
                  } else if (field === "statusId") {
                    obj[field] = result.statusId;
                  } else if (field === "projectId") {
                    obj[field] = result.testRun.projectId;
                  } else if (field === "configId") {
                    obj[field] = result.testRun.configId;
                  } else if (field === "milestoneId") {
                    obj[field] = result.testRun.milestoneId;
                  } else if (field === "testRunId") {
                    obj[field] = result.testRunId;
                  } else if (field === "testRunCaseId") {
                    obj[field] = result.testRunCaseId;
                  }
                  return obj;
                }, {}),
                testResults: 0,
              };
            }
            acc[key].testResults++;
            return acc;
          }, {});

          return Object.values(groupedResults);
        }

        // Handle case where groupBy is empty
        if (groupBy.length === 0) {
          const count = await prisma.testRunResults.count({
            where: {
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
            },
          });
          return [{ testResults: count }];
        }

        // Use Prisma ORM for safe data access with ZenStack
        const results = await prisma.testRunResults.findMany({
          where: {
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
          },
          select: {
            executedById: true,
            statusId: true,
            testRunId: true,
            testRunCaseId: true,
            status: {
              select: {
                id: true,
                name: true,
                color: { select: { value: true } },
              },
            },
            testRun: {
              select: {
                projectId: true,
                configId: true,
                milestoneId: true,
              },
            },
          },
        });

        // Group results manually
        const grouped = new Map<string, any>();
        results.forEach((result: any) => {
          const key = groupBy
            .map((field) => {
              if (field === "projectId") return result.testRun.projectId;
              if (field === "configId") return result.testRun.configId;
              if (field === "milestoneId") return result.testRun.milestoneId;
              if (field === "executedById") return result.executedById;
              if (field === "statusId") return result.statusId;
              if (field === "testRunId") return result.testRunId;
              if (field === "testRunCaseId") return result.testRunCaseId;
              return null;
            })
            .join("|");

          if (!grouped.has(key)) {
            const groupData: any = {};
            groupBy.forEach((field) => {
              if (field === "projectId") {
                groupData.projectId = result.testRun.projectId;
              } else if (field === "configId") {
                groupData.configId = result.testRun.configId;
              } else if (field === "milestoneId") {
                groupData.milestoneId = result.testRun.milestoneId;
              } else if (field === "executedById") {
                groupData.executedById = result.executedById;
              } else if (field === "statusId") {
                groupData.statusId = result.statusId;
              } else if (field === "testRunId") {
                groupData.testRunId = result.testRunId;
              } else if (field === "testRunCaseId") {
                groupData.testRunCaseId = result.testRunCaseId;
              }
            });
            groupData.testResults = 0;
            grouped.set(key, groupData);
          }

          grouped.get(key).testResults++;
        });

        return Array.from(grouped.values()).map((r: any) => ({
          ...r,
          testResults: Number(r.testResults),
        }));
      },
    },
    passRate: {
      id: "passRate",
      label: "Pass Rate (%)",
      aggregate: async (
        prisma: any,
        projectId: number | undefined,
        groupBy: string[],
        filters?: any,
        dims?: string[]
      ) => {
        if (groupBy.includes("executedAt")) {
          const results = await prisma.testRunResults.findMany({
            where: {
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
            },
            select: {
              executedAt: true,
              executedById: true,
              statusId: true,
              testRunId: true,
              testRunCaseId: true,
              status: {
                select: {
                  id: true,
                  name: true,
                  color: { select: { value: true } },
                  isSuccess: true,
                },
              },
              testRun: {
                select: {
                  projectId: true,
                  configId: true,
                  milestoneId: true,
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
                } else if (field === "executedById") {
                  return result.executedById;
                } else if (field === "statusId") {
                  return result.statusId;
                } else if (field === "projectId") {
                  return result.testRun.projectId;
                } else if (field === "configId") {
                  return result.testRun.configId;
                } else if (field === "milestoneId") {
                  return result.testRun.milestoneId;
                } else if (field === "testRunId") {
                  return result.testRunId;
                } else if (field === "testRunCaseId") {
                  return result.testRunCaseId;
                }
                return null;
              })
              .join("|");

            if (!acc[key]) {
              acc[key] = {
                ...groupBy.reduce((obj: any, field) => {
                  if (field === "executedAt") {
                    const date = new Date(result.executedAt);
                    date.setUTCHours(0, 0, 0, 0);
                    obj[field] = date.toISOString();
                  } else if (field === "executedById") {
                    obj[field] = result.executedById;
                  } else if (field === "statusId") {
                    obj[field] = result.statusId;
                  } else if (field === "projectId") {
                    obj[field] = result.testRun.projectId;
                  } else if (field === "configId") {
                    obj[field] = result.testRun.configId;
                  } else if (field === "milestoneId") {
                    obj[field] = result.testRun.milestoneId;
                  } else if (field === "testRunId") {
                    obj[field] = result.testRunId;
                  } else if (field === "testRunCaseId") {
                    obj[field] = result.testRunCaseId;
                  }
                  return obj;
                }, {}),
                totalResults: 0,
                passedResults: 0,
              };
            }
            acc[key].totalResults++;
            if (result.status.isSuccess) {
              acc[key].passedResults++;
            }
            return acc;
          }, {});

          return Object.values(groupedResults).map((group: any) => ({
            ...group,
            passRate:
              group.totalResults > 0
                ? (group.passedResults / group.totalResults) * 100
                : 0,
            totalResults: undefined,
            passedResults: undefined,
          }));
        }

        // Handle case where groupBy is empty
        if (groupBy.length === 0) {
          const total = await prisma.testRunResults.count({
            where: {
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
            },
          });
          const passed = await prisma.testRunResults.count({
            where: {
              testRun: {
                ...(isProjectSpecific && projectId
                  ? { projectId: Number(projectId) }
                  : {}),
                isDeleted: false,
              },
              status: {
                systemName: { not: "untested" },
                isSuccess: true,
              },
              ...buildDateFilter(filters, "executedAt"),
            },
          });
          return [{ passRate: total > 0 ? (passed / total) * 100 : 0 }];
        }

        // Use Prisma ORM for safe data access with ZenStack
        const results = await prisma.testRunResults.findMany({
          where: {
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
          },
          select: {
            executedById: true,
            statusId: true,
            testRunId: true,
            testRunCaseId: true,
            status: {
              select: {
                id: true,
                name: true,
                color: { select: { value: true } },
                isSuccess: true,
              },
            },
            testRun: {
              select: {
                projectId: true,
                configId: true,
                milestoneId: true,
              },
            },
          },
        });

        // Group results manually and calculate pass rate
        const grouped = new Map<string, any>();
        results.forEach((result: any) => {
          const key = groupBy
            .map((field) => {
              if (field === "projectId") return result.testRun.projectId;
              if (field === "configId") return result.testRun.configId;
              if (field === "milestoneId") return result.testRun.milestoneId;
              if (field === "executedById") return result.executedById;
              if (field === "statusId") return result.statusId;
              if (field === "testRunId") return result.testRunId;
              if (field === "testRunCaseId") return result.testRunCaseId;
              return null;
            })
            .join("|");

          if (!grouped.has(key)) {
            const groupData: any = {};
            groupBy.forEach((field) => {
              if (field === "projectId") {
                groupData.projectId = result.testRun.projectId;
              } else if (field === "configId") {
                groupData.configId = result.testRun.configId;
              } else if (field === "milestoneId") {
                groupData.milestoneId = result.testRun.milestoneId;
              } else if (field === "executedById") {
                groupData.executedById = result.executedById;
              } else if (field === "statusId") {
                groupData.statusId = result.statusId;
              } else if (field === "testRunId") {
                groupData.testRunId = result.testRunId;
              } else if (field === "testRunCaseId") {
                groupData.testRunCaseId = result.testRunCaseId;
              }
            });
            groupData.totalResults = 0;
            groupData.passedResults = 0;
            grouped.set(key, groupData);
          }

          const group = grouped.get(key);
          group.totalResults++;
          if (result.status?.isSuccess) {
            group.passedResults++;
          }
        });

        return Array.from(grouped.values()).map((group: any) => ({
          ...Object.fromEntries(
            Object.entries(group).filter(
              ([key]) => !["totalResults", "passedResults"].includes(key)
            )
          ),
          passRate:
            group.totalResults > 0
              ? (group.passedResults / group.totalResults) * 100
              : 0,
        }));
      },
    },
    avgElapsedTime: {
      id: "avgElapsedTime",
      label: "Avg. Elapsed Time",
      aggregate: async (
        prisma: any,
        projectId: number | undefined,
        groupBy: string[],
        filters?: any,
        dims?: string[]
      ) => {
        // Type guard to ensure groupBy is defined
        if (!groupBy || !Array.isArray(groupBy)) {
          return [];
        }

        // Handle case where groupBy is empty
        if (groupBy.length === 0) {
          const result = await prisma.testRunResults.aggregate({
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
          // Otherwise, return the average (null values are already filtered out)
          return [
            { avgElapsedTime: result._avg.elapsed ? Math.round(result._avg.elapsed) : 0 },
          ];
        }

        if (groupBy.includes("executedAt")) {
          const results = await prisma.testRunResults.findMany({
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
              statusId: true,
              status: {
                select: {
                  id: true,
                  name: true,
                  color: { select: { value: true } },
                },
              },
              elapsed: true,
              testRunId: true,
              testRunCaseId: true,
              testRun: {
                select: {
                  projectId: true,
                  configId: true,
                  milestoneId: true,
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
                } else if (field === "executedById") {
                  return result.executedById;
                } else if (field === "statusId") {
                  return result.statusId;
                } else if (field === "projectId") {
                  return result.testRun.projectId;
                } else if (field === "configId") {
                  return result.testRun.configId;
                } else if (field === "milestoneId") {
                  return result.testRun.milestoneId;
                } else if (field === "testRunId") {
                  return result.testRunId;
                } else if (field === "testRunCaseId") {
                  return result.testRunCaseId;
                }
                return null;
              })
              .join("|");

            if (!acc[key]) {
              acc[key] = {
                ...groupBy.reduce((obj: any, field) => {
                  if (field === "executedAt") {
                    const date = new Date(result.executedAt);
                    date.setUTCHours(0, 0, 0, 0);
                    obj[field] = date.toISOString();
                  } else if (field === "executedById") {
                    obj[field] = result.executedById;
                  } else if (field === "statusId") {
                    obj[field] = result.statusId;
                  } else if (field === "projectId") {
                    obj[field] = result.testRun.projectId;
                  } else if (field === "configId") {
                    obj[field] = result.testRun.configId;
                  } else if (field === "milestoneId") {
                    obj[field] = result.testRun.milestoneId;
                  } else if (field === "testRunId") {
                    obj[field] = result.testRunId;
                  } else if (field === "testRunCaseId") {
                    obj[field] = result.testRunCaseId;
                  }
                  return obj;
                }, {}),
                totalElapsed: 0,
                count: 0,
              };
            }
            // Only count results with non-null elapsed time
            if (result.elapsed !== null && result.elapsed !== undefined) {
              acc[key].totalElapsed += result.elapsed;
              acc[key].count++;
            }
            return acc;
          }, {});

          return Object.values(groupedResults).map((group: any) => ({
            ...Object.fromEntries(
              Object.entries(group).filter(
                ([key]) => !["totalElapsed", "count"].includes(key)
              )
            ),
            avgElapsedTime:
              group.count > 0
                ? Math.round(group.totalElapsed / group.count)
                : 0,
          }));
        }

        // Handle non-executedAt grouping
        const results = await prisma.testRunResults.findMany({
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
            statusId: true,
            status: {
              select: {
                id: true,
                name: true,
                color: { select: { value: true } },
              },
            },
            elapsed: true,
            testRunId: true,
            testRunCaseId: true,
            testRun: {
              select: {
                projectId: true,
                configId: true,
                milestoneId: true,
              },
            },
          },
        });

        // If no results, return empty array
        if (!results.length) {
          return [];
        }

        // Group results manually and calculate average elapsed time
        const grouped = new Map<string, any>();
        results.forEach((result: any) => {
          const key = groupBy
            .map((field) => {
              if (field === "projectId") return result.testRun.projectId;
              if (field === "configId") return result.testRun.configId;
              if (field === "milestoneId") return result.testRun.milestoneId;
              if (field === "executedById") return result.executedById;
              if (field === "statusId") return result.statusId;
              if (field === "testRunId") return result.testRunId;
              if (field === "testRunCaseId") return result.testRunCaseId;
              return null;
            })
            .join("|");

          if (!grouped.has(key)) {
            const groupData: any = {};
            groupBy.forEach((field) => {
              if (field === "projectId") {
                groupData.projectId = result.testRun.projectId;
              } else if (field === "configId") {
                groupData.configId = result.testRun.configId;
              } else if (field === "milestoneId") {
                groupData.milestoneId = result.testRun.milestoneId;
              } else if (field === "executedById") {
                groupData.executedById = result.executedById;
              } else if (field === "statusId") {
                groupData.statusId = result.statusId;
              } else if (field === "testRunId") {
                groupData.testRunId = result.testRunId;
              } else if (field === "testRunCaseId") {
                groupData.testRunCaseId = result.testRunCaseId;
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
          avgElapsedTime:
            group.count > 0 ? Math.round(group.totalElapsed / group.count) : 0,
        }));
      },
    },
    totalElapsedTime: {
      id: "totalElapsedTime",
      label: "Total Elapsed Time",
      aggregate: async (
        prisma: any,
        projectId: number | undefined,
        groupBy: string[],
        filters?: any,
        dims?: string[]
      ) => {
        if (groupBy.includes("executedAt")) {
          const results = await prisma.testRunResults.findMany({
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
              statusId: true,
              status: {
                select: {
                  id: true,
                  name: true,
                  color: { select: { value: true } },
                },
              },
              elapsed: true,
              testRunId: true,
              testRunCaseId: true,
              testRun: {
                select: {
                  projectId: true,
                  configId: true,
                  milestoneId: true,
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
                } else if (field === "executedById") {
                  return result.executedById;
                } else if (field === "statusId") {
                  return result.statusId;
                } else if (field === "projectId") {
                  return result.testRun.projectId;
                } else if (field === "configId") {
                  return result.testRun.configId;
                } else if (field === "milestoneId") {
                  return result.testRun.milestoneId;
                } else if (field === "testRunId") {
                  return result.testRunId;
                } else if (field === "testRunCaseId") {
                  return result.testRunCaseId;
                }
                return null;
              })
              .join("|");

            if (!acc[key]) {
              acc[key] = {
                ...groupBy.reduce((obj: any, field) => {
                  if (field === "executedAt") {
                    const date = new Date(result.executedAt);
                    date.setUTCHours(0, 0, 0, 0);
                    obj[field] = date.toISOString();
                  } else if (field === "executedById") {
                    obj[field] = result.executedById;
                  } else if (field === "statusId") {
                    obj[field] = result.statusId;
                  } else if (field === "projectId") {
                    obj[field] = result.testRun.projectId;
                  } else if (field === "configId") {
                    obj[field] = result.testRun.configId;
                  } else if (field === "milestoneId") {
                    obj[field] = result.testRun.milestoneId;
                  } else if (field === "testRunId") {
                    obj[field] = result.testRunId;
                  } else if (field === "testRunCaseId") {
                    obj[field] = result.testRunCaseId;
                  }
                  return obj;
                }, {}),
                totalElapsedTime: 0,
              };
            }
            acc[key].totalElapsedTime += result.elapsed || 0;
            return acc;
          }, {});

          return Object.values(groupedResults);
        }

        // Handle case where groupBy is empty
        if (groupBy.length === 0) {
          const result = await prisma.testRunResults.aggregate({
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
            _sum: {
              elapsed: true,
            },
          });
          return [{ totalElapsedTime: result._sum.elapsed || 0 }];
        }

        // Use Prisma ORM for safe data access with ZenStack
        const results = await prisma.testRunResults.findMany({
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
            statusId: true,
            status: {
              select: {
                id: true,
                name: true,
                color: { select: { value: true } },
              },
            },
            elapsed: true,
            testRunId: true,
            testRunCaseId: true,
            testRun: {
              select: {
                projectId: true,
                configId: true,
                milestoneId: true,
              },
            },
          },
        });

        // Group results manually and calculate total elapsed time
        const grouped = new Map<string, any>();
        results.forEach((result: any) => {
          const key = groupBy
            .map((field) => {
              if (field === "projectId") return result.testRun.projectId;
              if (field === "configId") return result.testRun.configId;
              if (field === "milestoneId") return result.testRun.milestoneId;
              if (field === "executedById") return result.executedById;
              if (field === "statusId") return result.statusId;
              if (field === "testRunId") return result.testRunId;
              if (field === "testRunCaseId") return result.testRunCaseId;
              return null;
            })
            .join("|");

          if (!grouped.has(key)) {
            const groupData: any = {};
            groupBy.forEach((field) => {
              if (field === "projectId") {
                groupData.projectId = result.testRun.projectId;
              } else if (field === "configId") {
                groupData.configId = result.testRun.configId;
              } else if (field === "milestoneId") {
                groupData.milestoneId = result.testRun.milestoneId;
              } else if (field === "executedById") {
                groupData.executedById = result.executedById;
              } else if (field === "statusId") {
                groupData.statusId = result.statusId;
              } else if (field === "testRunId") {
                groupData.testRunId = result.testRunId;
              } else if (field === "testRunCaseId") {
                groupData.testRunCaseId = result.testRunCaseId;
              }
            });
            groupData.totalElapsedTime = 0;
            grouped.set(key, groupData);
          }

          const group = grouped.get(key);
          group.totalElapsedTime += result.elapsed || 0;
        });

        return Array.from(grouped.values()).map((group: any) => ({
          ...Object.fromEntries(
            Object.entries(group).filter(([key]) => key !== "totalElapsedTime")
          ),
          totalElapsedTime: group.totalElapsedTime,
        }));
      },
    },
    // Alias metrics for test compatibility
    testResultCount: {
      id: "testResultCount",
      label: "Test Result Count", // Slightly different label to avoid exact duplicate
      hidden: true, // Hide from UI but keep for backward compatibility
      aggregate: async (
        prisma: any,
        projectId: number | undefined,
        groupBy: string[],
        filters?: any,
        dims?: string[]
      ) => {
        // Reuse testResults logic but return testResultCount property
        const registry = createTestExecutionMetricRegistry(isProjectSpecific);
        const results = await registry.testResults.aggregate(
          prisma,
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
        prisma: any,
        projectId: number | undefined,
        groupBy: string[],
        filters?: any,
        dims?: string[]
      ) => {
        if (
          groupBy.includes("executedAt") ||
          groupBy.includes("executedById") ||
          groupBy.includes("statusId")
        ) {
          // When grouping by executedAt, executedById, or statusId, count unique test runs from actual execution data
          // Note: statusId is a property of TestRunResults, not TestRuns, so we must query results
          const results = await prisma.testRunResults.findMany({
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
                select: {
                  id: true,
                  projectId: true,
                  configId: true,
                  milestoneId: true,
                },
              },
            },
          });

          const groupedResults = results.reduce((acc: any, result: any) => {
            // Skip if executedAt is required but missing or invalid
            if (groupBy.includes("executedAt")) {
              if (
                !result.executedAt ||
                isNaN(new Date(result.executedAt).getTime())
              ) {
                return acc;
              }
            }
            const key = groupBy
              .map((field) => {
                if (field === "executedAt") {
                  const date = new Date(result.executedAt);
                  date.setUTCHours(0, 0, 0, 0);
                  return date.toISOString();
                } else if (field === "executedById") {
                  return result.executedById;
                } else if (field === "statusId") {
                  return result.statusId;
                } else if (field === "projectId") {
                  return result.testRun.projectId;
                } else if (field === "configId") {
                  return result.testRun.configId;
                } else if (field === "milestoneId") {
                  return result.testRun.milestoneId;
                } else if (field === "testRunId") {
                  return result.testRunId;
                } else if (field === "testRunCaseId") {
                  return result.testRunCaseId;
                }
                return null;
              })
              .join("|");

            if (!acc[key]) {
              acc[key] = {
                ...groupBy.reduce((obj: any, field) => {
                  if (field === "executedAt") {
                    const date = new Date(result.executedAt);
                    date.setUTCHours(0, 0, 0, 0);
                    obj[field] = date.toISOString();
                  } else if (field === "executedById") {
                    obj[field] = result.executedById;
                  } else if (field === "statusId") {
                    obj[field] = result.statusId;
                  } else if (field === "projectId") {
                    obj[field] = result.testRun.projectId;
                  } else if (field === "configId") {
                    obj[field] = result.testRun.configId;
                  } else if (field === "milestoneId") {
                    obj[field] = result.testRun.milestoneId;
                  } else if (field === "testRunId") {
                    obj[field] = result.testRunId;
                  } else if (field === "testRunCaseId") {
                    obj[field] = result.testRunCaseId;
                  }
                  return obj;
                }, {}),
                uniqueTestRuns: new Set(),
              };
            }
            // Track unique test run IDs
            acc[key].uniqueTestRuns.add(result.testRunId);
            return acc;
          }, {});

          return Object.values(groupedResults).map((group: any) => ({
            ...group,
            testRunCount: group.uniqueTestRuns.size,
            uniqueTestRuns: undefined, // Remove the Set from output
          }));
        }

        if (groupBy.length === 0) {
          const count = await prisma.testRuns.count({
            where: {
              ...(isProjectSpecific && projectId
                ? { projectId: Number(projectId) }
                : {}),
              isDeleted: false,
            },
          });
          return [{ testRunCount: count }];
        }

        const results = await prisma.testRuns.findMany({
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
        prisma: any,
        projectId: number | undefined,
        groupBy: string[],
        filters?: any,
        dims?: string[]
      ) => {
        // Type guard to ensure groupBy is defined
        if (!groupBy || !Array.isArray(groupBy)) {
          return [];
        }

        if (groupBy.includes("executedAt")) {
          const results = await prisma.testRunResults.findMany({
            where: {
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
                repositoryCase: {
                  isDeleted: false,
                },
              },
              ...buildDateFilter(filters, "executedAt"),
            },
            select: {
              executedAt: true,
              executedById: true,
              statusId: true,
              testRunId: true,
              testRunCase: {
                select: {
                  repositoryCaseId: true,
                },
              },
              testRun: {
                select: {
                  projectId: true,
                  configId: true,
                  milestoneId: true,
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
                } else if (field === "executedById") {
                  return result.executedById;
                } else if (field === "statusId") {
                  return result.statusId;
                } else if (field === "projectId") {
                  return result.testRun.projectId;
                } else if (field === "configId") {
                  return result.testRun.configId;
                } else if (field === "milestoneId") {
                  return result.testRun.milestoneId;
                } else if (field === "testRunId") {
                  return result.testRunId;
                } else if (field === "repositoryCaseId") {
                  return result.testRunCase?.repositoryCaseId;
                }
                return null;
              })
              .join("|");

            if (!acc[key]) {
              acc[key] = {
                ...groupBy.reduce((obj: any, field) => {
                  if (field === "executedAt") {
                    const date = new Date(result.executedAt);
                    date.setUTCHours(0, 0, 0, 0);
                    obj[field] = date.toISOString();
                  } else if (field === "executedById") {
                    obj[field] = result.executedById;
                  } else if (field === "statusId") {
                    obj[field] = result.statusId;
                  } else if (field === "projectId") {
                    obj[field] = result.testRun.projectId;
                  } else if (field === "configId") {
                    obj[field] = result.testRun.configId;
                  } else if (field === "milestoneId") {
                    obj[field] = result.testRun.milestoneId;
                  } else if (field === "testRunId") {
                    obj[field] = result.testRunId;
                  } else if (field === "repositoryCaseId") {
                    obj[field] = result.testRunCase?.repositoryCaseId;
                  }
                  return obj;
                }, {}),
                uniqueCases: new Set<number>(),
              };
            }
            // Track unique repository case IDs
            if (result.testRunCase?.repositoryCaseId) {
              acc[key].uniqueCases.add(result.testRunCase.repositoryCaseId);
            }
            return acc;
          }, {});

          // Convert Sets to counts
          return Object.values(groupedResults).map((group: any) => ({
            ...group,
            testCaseCount: group.uniqueCases.size,
            uniqueCases: undefined, // Remove the Set from output
          }));
        }

        if (groupBy.length === 0) {
          // Count distinct repository case IDs from execution results
          const results = await prisma.testRunResults.findMany({
            where: {
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
                repositoryCase: {
                  isDeleted: false,
                },
              },
              ...buildDateFilter(filters, "executedAt"),
            },
            select: {
              testRunCase: {
                select: {
                  repositoryCaseId: true,
                },
              },
            },
          });
          const uniqueCases = new Set(
            results
              .map((r: any) => r.testRunCase?.repositoryCaseId)
              .filter((id: number | undefined) => id !== undefined)
          );
          return [{ testCaseCount: uniqueCases.size }];
        }

        const results = await prisma.testRunResults.findMany({
          where: {
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
              repositoryCase: {
                isDeleted: false,
              },
            },
            ...buildDateFilter(filters, "executedAt"),
          },
          select: {
            executedById: true,
            statusId: true,
            testRunId: true,
            testRunCase: {
              select: {
                repositoryCaseId: true,
              },
            },
            testRun: {
              select: {
                projectId: true,
                configId: true,
                milestoneId: true,
              },
            },
          },
        });

        const grouped = new Map<string, any>();
        results.forEach((result: any) => {
          const key = groupBy
            .map((field) => {
              if (field === "projectId") return result.testRun.projectId;
              if (field === "configId") return result.testRun.configId;
              if (field === "executedById") return result.executedById;
              if (field === "statusId") return result.statusId;
              if (field === "milestoneId") return result.testRun.milestoneId;
              if (field === "testRunId") return result.testRunId;
              if (field === "repositoryCaseId")
                return result.testRunCase?.repositoryCaseId;
              return null;
            })
            .join("|");

          if (!grouped.has(key)) {
            const groupData: any = {};
            groupBy.forEach((field) => {
              if (field === "projectId") {
                groupData.projectId = result.testRun.projectId;
              } else if (field === "configId") {
                groupData.configId = result.testRun.configId;
              } else if (field === "milestoneId") {
                groupData.milestoneId = result.testRun.milestoneId;
              } else if (field === "executedById") {
                groupData.executedById = result.executedById;
              } else if (field === "statusId") {
                groupData.statusId = result.statusId;
              } else if (field === "testRunId") {
                groupData.testRunId = result.testRunId;
              } else if (field === "repositoryCaseId") {
                groupData.repositoryCaseId =
                  result.testRunCase?.repositoryCaseId;
              }
            });
            groupData.uniqueCases = new Set<number>();
            grouped.set(key, groupData);
          }

          // Track unique repository case IDs
          if (result.testRunCase?.repositoryCaseId) {
            grouped
              .get(key)
              .uniqueCases.add(result.testRunCase.repositoryCaseId);
          }
        });

        // Convert Sets to counts
        return Array.from(grouped.values()).map((group) => ({
          ...group,
          testCaseCount: group.uniqueCases.size,
          uniqueCases: undefined, // Remove the Set from output
        }));
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
          getValues: async (prisma: any, projectId?: number) => {
            const projects = await prisma.projects.findMany({
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
      getValues: async (prisma: any, projectId?: number) => {
        const templates = await prisma.repositoryCases.findMany({
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
      getValues: async (prisma: any, projectId?: number) => {
        const creators = await prisma.repositoryCases.findMany({
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
      getValues: async (prisma: any, projectId?: number) => {
        const states = await prisma.repositoryCases.findMany({
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
      getValues: async (prisma: any, projectId?: number) => {
        const sources = await prisma.repositoryCases.groupBy({
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
      getValues: async (prisma: any, projectId?: number) => {
        const folders = await prisma.repositoryFolders.findMany({
          where: {
            ...(isProjectSpecific && projectId
              ? { projectId: Number(projectId) }
              : {}),
            isDeleted: false,
            cases: {
              some: {
                isDeleted: false,
              },
            },
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
    date: {
      id: "date",
      label: "Creation Date",
      getValues: async (prisma: any, projectId?: number) => {
        const dates = await prisma.repositoryCases.findMany({
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
        prisma: any,
        projectId: number | undefined,
        groupBy: string[],
        filters?: any,
        dims?: string[]
      ) => {
        if (groupBy.includes("createdAt")) {
          const results = await prisma.repositoryCases.findMany({
            where: {
              ...(isProjectSpecific && projectId
                ? { projectId: Number(projectId) }
                : {}),
              isDeleted: false,
              ...buildDateFilter(filters, "createdAt"),
            },
            select: {
              createdAt: true,
              projectId: true,
              templateId: true,
              creatorId: true,
              stateId: true,
              source: true,
              folderId: true,
            },
          });

          const groupedResults = results.reduce((acc: any, result: any) => {
            const key = groupBy
              .map((field) => {
                if (field === "createdAt") {
                  const date = new Date(result.createdAt);
                  date.setUTCHours(0, 0, 0, 0);
                  return date.toISOString();
                }
                return result[field];
              })
              .join("|");

            if (!acc[key]) {
              acc[key] = {
                ...groupBy.reduce((obj: any, field) => {
                  if (field === "createdAt") {
                    const date = new Date(result.createdAt);
                    date.setUTCHours(0, 0, 0, 0);
                    obj[field] = date.toISOString();
                  } else {
                    obj[field] = result[field];
                  }
                  return obj;
                }, {}),
                testCaseCount: 0,
              };
            }
            acc[key].testCaseCount++;
            return acc;
          }, {});

          return Object.values(groupedResults);
        }

        if (groupBy.length === 0) {
          const count = await prisma.repositoryCases.count({
            where: {
              ...(isProjectSpecific && projectId
                ? { projectId: Number(projectId) }
                : {}),
              isDeleted: false,
              ...buildDateFilter(filters, "createdAt"),
            },
          });
          return [{ testCaseCount: count }];
        }

        // Use Prisma groupBy for other cases
        return prisma.repositoryCases
          .groupBy({
            by: groupBy,
            where: {
              ...(isProjectSpecific && projectId
                ? { projectId: Number(projectId) }
                : {}),
              isDeleted: false,
              ...buildDateFilter(filters, "createdAt"),
            },
            _count: { _all: true },
          })
          .then((results: any[]) =>
            results.map((r: any) => ({ ...r, testCaseCount: r._count._all }))
          );
      },
    },
    automationRate: {
      id: "automationRate",
      label: "Automation Rate (%)",
      aggregate: async (
        prisma: any,
        projectId: number | undefined,
        groupBy: string[],
        filters?: any,
        dims?: string[]
      ) => {
        // Type guard to ensure groupBy is defined
        if (!groupBy || !Array.isArray(groupBy)) {
          return [];
        }

        if (groupBy.includes("createdAt")) {
          const results = await prisma.repositoryCases.findMany({
            where: {
              ...(isProjectSpecific && projectId
                ? { projectId: Number(projectId) }
                : {}),
              isDeleted: false,
              ...buildDateFilter(filters, "createdAt"),
            },
            select: {
              createdAt: true,
              projectId: true,
              templateId: true,
              creatorId: true,
              stateId: true,
              source: true,
              automated: true,
              folderId: true,
            },
          });

          const groupedResults = results.reduce((acc: any, result: any) => {
            const key = groupBy
              .map((field) => {
                if (field === "createdAt") {
                  const date = new Date(result.createdAt);
                  date.setUTCHours(0, 0, 0, 0);
                  return date.toISOString();
                }
                return result[field];
              })
              .join("|");

            if (!acc[key]) {
              acc[key] = {
                ...groupBy.reduce((obj: any, field) => {
                  if (field === "createdAt") {
                    const date = new Date(result.createdAt);
                    date.setUTCHours(0, 0, 0, 0);
                    obj[field] = date.toISOString();
                  } else {
                    obj[field] = result[field];
                  }
                  return obj;
                }, {}),
                totalCases: 0,
                automatedCases: 0,
              };
            }
            acc[key].totalCases++;
            if (result.automated) {
              acc[key].automatedCases++;
            }
            return acc;
          }, {});

          return Object.values(groupedResults).map((group: any) => ({
            ...group,
            automationRate:
              group.totalCases > 0
                ? (group.automatedCases / group.totalCases) * 100
                : 0,
            totalCases: undefined,
            automatedCases: undefined,
          }));
        }

        if (groupBy.length === 0) {
          const total = await prisma.repositoryCases.count({
            where: {
              ...(isProjectSpecific && projectId
                ? { projectId: Number(projectId) }
                : {}),
              isDeleted: false,
            },
          });
          const automated = await prisma.repositoryCases.count({
            where: {
              ...(isProjectSpecific && projectId
                ? { projectId: Number(projectId) }
                : {}),
              isDeleted: false,
              automated: true,
              ...buildDateFilter(filters, "createdAt"),
            },
          });
          return [
            { automationRate: total > 0 ? (automated / total) * 100 : 0 },
          ];
        }

        // Manual grouping for automation rate calculation
        const results = await prisma.repositoryCases.findMany({
          where: {
            ...(isProjectSpecific && projectId
              ? { projectId: Number(projectId) }
              : {}),
            isDeleted: false,
          },
          select: {
            projectId: true,
            templateId: true,
            creatorId: true,
            stateId: true,
            source: true,
            automated: true,
            folderId: true,
          },
        });

        const grouped = new Map<string, any>();
        results.forEach((result: any) => {
          const key = groupBy.map((field) => result[field]).join("|");

          if (!grouped.has(key)) {
            const groupData: any = {};
            groupBy.forEach((field) => {
              groupData[field] = result[field];
            });
            groupData.totalCases = 0;
            groupData.automatedCases = 0;
            grouped.set(key, groupData);
          }

          const group = grouped.get(key);
          group.totalCases++;
          if (result.automated) {
            group.automatedCases++;
          }
        });

        return Array.from(grouped.values()).map((group: any) => ({
          ...Object.fromEntries(
            Object.entries(group).filter(
              ([key]) => !["totalCases", "automatedCases"].includes(key)
            )
          ),
          automationRate:
            group.totalCases > 0
              ? (group.automatedCases / group.totalCases) * 100
              : 0,
        }));
      },
    },
    automatedCount: {
      id: "automatedCount",
      label: "Automated Cases",
      aggregate: async (
        prisma: any,
        projectId: number | undefined,
        groupBy: string[],
        filters?: any,
        dims?: string[]
      ) => {
        if (groupBy.includes("createdAt")) {
          const results = await prisma.repositoryCases.findMany({
            where: {
              ...(isProjectSpecific && projectId
                ? { projectId: Number(projectId) }
                : {}),
              isDeleted: false,
              automated: true,
              ...buildDateFilter(filters, "createdAt"),
            },
            select: {
              createdAt: true,
              projectId: true,
              templateId: true,
              creatorId: true,
              stateId: true,
              source: true,
              folderId: true,
            },
          });

          const groupedResults = results.reduce((acc: any, result: any) => {
            const key = groupBy
              .map((field) => {
                if (field === "createdAt") {
                  const date = new Date(result.createdAt);
                  date.setUTCHours(0, 0, 0, 0);
                  return date.toISOString();
                }
                return result[field];
              })
              .join("|");

            if (!acc[key]) {
              acc[key] = {
                ...groupBy.reduce((obj: any, field) => {
                  if (field === "createdAt") {
                    const date = new Date(result.createdAt);
                    date.setUTCHours(0, 0, 0, 0);
                    obj[field] = date.toISOString();
                  } else {
                    obj[field] = result[field];
                  }
                  return obj;
                }, {}),
                automatedCount: 0,
              };
            }
            acc[key].automatedCount++;
            return acc;
          }, {});

          return Object.values(groupedResults);
        }

        if (groupBy.length === 0) {
          const count = await prisma.repositoryCases.count({
            where: {
              ...(isProjectSpecific && projectId
                ? { projectId: Number(projectId) }
                : {}),
              isDeleted: false,
              automated: true,
              ...buildDateFilter(filters, "createdAt"),
            },
          });
          return [{ automatedCount: count }];
        }

        return prisma.repositoryCases
          .groupBy({
            by: groupBy,
            where: {
              ...(isProjectSpecific && projectId
                ? { projectId: Number(projectId) }
                : {}),
              isDeleted: false,
              automated: true,
              ...buildDateFilter(filters, "createdAt"),
            },
            _count: { _all: true },
          })
          .then((results: any[]) =>
            results.map((r: any) => ({ ...r, automatedCount: r._count._all }))
          );
      },
    },
    manualCount: {
      id: "manualCount",
      label: "Manual Cases",
      aggregate: async (
        prisma: any,
        projectId: number | undefined,
        groupBy: string[],
        filters?: any,
        dims?: string[]
      ) => {
        if (groupBy.includes("createdAt")) {
          const results = await prisma.repositoryCases.findMany({
            where: {
              ...(isProjectSpecific && projectId
                ? { projectId: Number(projectId) }
                : {}),
              isDeleted: false,
              automated: false,
              ...buildDateFilter(filters, "createdAt"),
            },
            select: {
              createdAt: true,
              projectId: true,
              templateId: true,
              creatorId: true,
              stateId: true,
              source: true,
              folderId: true,
            },
          });

          const groupedResults = results.reduce((acc: any, result: any) => {
            const key = groupBy
              .map((field) => {
                if (field === "createdAt") {
                  const date = new Date(result.createdAt);
                  date.setUTCHours(0, 0, 0, 0);
                  return date.toISOString();
                }
                return result[field];
              })
              .join("|");

            if (!acc[key]) {
              acc[key] = {
                ...groupBy.reduce((obj: any, field) => {
                  if (field === "createdAt") {
                    const date = new Date(result.createdAt);
                    date.setUTCHours(0, 0, 0, 0);
                    obj[field] = date.toISOString();
                  } else {
                    obj[field] = result[field];
                  }
                  return obj;
                }, {}),
                manualCount: 0,
              };
            }
            acc[key].manualCount++;
            return acc;
          }, {});

          return Object.values(groupedResults);
        }

        if (groupBy.length === 0) {
          const count = await prisma.repositoryCases.count({
            where: {
              ...(isProjectSpecific && projectId
                ? { projectId: Number(projectId) }
                : {}),
              isDeleted: false,
              automated: false,
              ...buildDateFilter(filters, "createdAt"),
            },
          });
          return [{ manualCount: count }];
        }

        return prisma.repositoryCases
          .groupBy({
            by: groupBy,
            where: {
              ...(isProjectSpecific && projectId
                ? { projectId: Number(projectId) }
                : {}),
              isDeleted: false,
              automated: false,
              ...buildDateFilter(filters, "createdAt"),
            },
            _count: { _all: true },
          })
          .then((results: any[]) =>
            results.map((r: any) => ({ ...r, manualCount: r._count._all }))
          );
      },
    },
    averageSteps: {
      id: "averageSteps",
      label: "Average Steps per Case",
      aggregate: async (
        prisma: any,
        projectId: number | undefined,
        groupBy: string[],
        filters?: any,
        dims?: string[]
      ) => {
        if (groupBy.length === 0) {
          const repositoryCases = await prisma.repositoryCases.findMany({
            where: {
              ...(isProjectSpecific && projectId
                ? { projectId: Number(projectId) }
                : {}),
              isDeleted: false,
              ...buildDateFilter(filters, "createdAt"),
            },
            select: {
              id: true,
              steps: {
                where: {
                  isDeleted: false,
                },
                select: {
                  id: true,
                },
              },
            },
          });

          const totalCases = repositoryCases.length;
          const totalSteps = repositoryCases.reduce(
            (sum: number, testCase: any) => sum + testCase.steps.length,
            0
          );

          return [
            {
              averageSteps: totalCases > 0 ? totalSteps / totalCases : 0,
            },
          ];
        }

        const repositoryCases = await prisma.repositoryCases.findMany({
          where: {
            ...(isProjectSpecific && projectId
              ? { projectId: Number(projectId) }
              : {}),
            isDeleted: false,
            ...buildDateFilter(filters, "createdAt"),
          },
          select: {
            id: true,
            projectId: true,
            templateId: true,
            creatorId: true,
            stateId: true,
            source: true,
            createdAt: true,
            folderId: true,
            steps: {
              where: {
                isDeleted: false,
              },
              select: {
                id: true,
              },
            },
          },
        });

        const grouped = new Map<string, any>();
        repositoryCases.forEach((testCase: any) => {
          const key = groupBy
            .map((field) => {
              if (field === "createdAt") {
                const date = new Date(testCase.createdAt);
                date.setUTCHours(0, 0, 0, 0);
                return date.toISOString();
              }
              return testCase[field];
            })
            .join("|");

          if (!grouped.has(key)) {
            const groupData: any = {};
            groupBy.forEach((field) => {
              if (field === "createdAt") {
                const date = new Date(testCase.createdAt);
                date.setUTCHours(0, 0, 0, 0);
                groupData.createdAt = date.toISOString();
              } else {
                groupData[field] = testCase[field];
              }
            });
            groupData.totalCases = 0;
            groupData.totalSteps = 0;
            grouped.set(key, groupData);
          }

          const group = grouped.get(key);
          group.totalCases++;
          group.totalSteps += testCase.steps.length;
        });

        return Array.from(grouped.values()).map((group: any) => ({
          ...Object.fromEntries(
            Object.entries(group).filter(
              ([key]) => !["totalCases", "totalSteps"].includes(key)
            )
          ),
          averageSteps:
            group.totalCases > 0 ? group.totalSteps / group.totalCases : 0,
        }));
      },
    },
    totalSteps: {
      id: "totalSteps",
      label: "Total Steps",
      aggregate: async (
        prisma: any,
        projectId: number | undefined,
        groupBy: string[],
        filters?: any,
        dims?: string[]
      ) => {
        if (groupBy.includes("createdAt")) {
          const results = await prisma.repositoryCases.findMany({
            where: {
              ...(isProjectSpecific && projectId
                ? { projectId: Number(projectId) }
                : {}),
              isDeleted: false,
              ...buildDateFilter(filters, "createdAt"),
            },
            select: {
              createdAt: true,
              projectId: true,
              templateId: true,
              creatorId: true,
              stateId: true,
              source: true,
              folderId: true,
              steps: {
                where: {
                  isDeleted: false,
                },
                select: {
                  id: true,
                },
              },
            },
          });

          const groupedResults = results.reduce((acc: any, result: any) => {
            const key = groupBy
              .map((field) => {
                if (field === "createdAt") {
                  const date = new Date(result.createdAt);
                  date.setUTCHours(0, 0, 0, 0);
                  return date.toISOString();
                }
                return result[field];
              })
              .join("|");

            if (!acc[key]) {
              acc[key] = {
                ...groupBy.reduce((obj: any, field) => {
                  if (field === "createdAt") {
                    const date = new Date(result.createdAt);
                    date.setUTCHours(0, 0, 0, 0);
                    obj[field] = date.toISOString();
                  } else {
                    obj[field] = result[field];
                  }
                  return obj;
                }, {}),
                totalSteps: 0,
              };
            }
            acc[key].totalSteps += result.steps.length;
            return acc;
          }, {});

          return Object.values(groupedResults);
        }

        if (groupBy.length === 0) {
          const repositoryCases = await prisma.repositoryCases.findMany({
            where: {
              ...(isProjectSpecific && projectId
                ? { projectId: Number(projectId) }
                : {}),
              isDeleted: false,
              ...buildDateFilter(filters, "createdAt"),
            },
            select: {
              steps: {
                where: {
                  isDeleted: false,
                },
                select: {
                  id: true,
                },
              },
            },
          });

          const totalSteps = repositoryCases.reduce(
            (sum: number, testCase: any) => sum + testCase.steps.length,
            0
          );

          return [{ totalSteps }];
        }

        const repositoryCases = await prisma.repositoryCases.findMany({
          where: {
            ...(isProjectSpecific && projectId
              ? { projectId: Number(projectId) }
              : {}),
            isDeleted: false,
            ...buildDateFilter(filters, "createdAt"),
          },
          select: {
            id: true,
            projectId: true,
            templateId: true,
            creatorId: true,
            stateId: true,
            source: true,
            createdAt: true,
            folderId: true,
            steps: {
              where: {
                isDeleted: false,
              },
              select: {
                id: true,
              },
            },
          },
        });

        const grouped = new Map<string, any>();
        repositoryCases.forEach((testCase: any) => {
          const key = groupBy
            .map((field) => {
              if (field === "createdAt") {
                const date = new Date(testCase.createdAt);
                date.setUTCHours(0, 0, 0, 0);
                return date.toISOString();
              }
              return testCase[field];
            })
            .join("|");

          if (!grouped.has(key)) {
            const groupData: any = {};
            groupBy.forEach((field) => {
              if (field === "createdAt") {
                const date = new Date(testCase.createdAt);
                date.setUTCHours(0, 0, 0, 0);
                groupData.createdAt = date.toISOString();
              } else {
                groupData[field] = testCase[field];
              }
            });
            groupData.totalSteps = 0;
            grouped.set(key, groupData);
          }

          const group = grouped.get(key);
          group.totalSteps += testCase.steps.length;
        });

        return Array.from(grouped.values()).map((group: any) => ({
          ...Object.fromEntries(
            Object.entries(group).filter(([key]) => key !== "totalSteps")
          ),
          totalSteps: group.totalSteps,
        }));
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
          getValues: async (prisma: any, projectId?: number) => {
            const projects = await prisma.projects.findMany({
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
      getValues: async (prisma: any, projectId?: number) => {
        const users = await prisma.user.findMany({
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
      getValues: async (prisma: any, projectId?: number) => {
        // Get roles of users who have any user engagement activity for the project
        const roles = await prisma.roles.findMany({
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
      getValues: async (prisma: any, projectId?: number) => {
        // Get groups that contain users who have any user engagement activity for the project
        const groups = await prisma.groups.findMany({
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
      getValues: async (prisma: any, projectId?: number) => {
        // Get unique activity dates from various user activities
        const testExecutions = await prisma.testRunResults.findMany({
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

        const sessionResults = await prisma.sessionResults.findMany({
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

        const caseCreations = await prisma.repositoryCases.findMany({
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
        prisma: any,
        projectId: number | undefined,
        groupBy: string[],
        filters?: any,
        dims?: string[]
      ) => {
        if (groupBy.includes("executedAt")) {
          const results = await prisma.testRunResults.findMany({
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
          const count = await prisma.testRunResults.count({
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
        const results = await prisma.testRunResults.findMany({
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
        prisma: any,
        projectId: number | undefined,
        groupBy: string[],
        filters?: any,
        dims?: string[]
      ) => {
        // Check for both createdAt (Repository Stats) and executedAt (User Engagement)
        const hasDateDimension =
          groupBy.includes("createdAt") || groupBy.includes("executedAt");
        const dateField = groupBy.includes("createdAt")
          ? "createdAt"
          : "executedAt";

        if (hasDateDimension) {
          const results = await prisma.repositoryCases.findMany({
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
          const count = await prisma.repositoryCases.count({
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
        const results = await prisma.repositoryCases.findMany({
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
        prisma: any,
        projectId: number | undefined,
        groupBy: string[],
        filters?: any,
        dims?: string[]
      ) => {
        // Check for both createdAt and executedAt (User Engagement uses executedAt)
        const hasDateDimension =
          groupBy.includes("createdAt") || groupBy.includes("executedAt");

        if (hasDateDimension) {
          const results = await prisma.sessionResults.findMany({
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
          const count = await prisma.sessionResults.count({
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
        const results = await prisma.sessionResults.findMany({
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
        prisma: any,
        projectId: number | undefined,
        groupBy: string[],
        filters?: any,
        dims?: string[]
      ) => {
        if (groupBy.includes("executedAt")) {
          const results = await prisma.testRunResults.findMany({
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
          const result = await prisma.testRunResults.aggregate({
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
              averageElapsed: result._avg.elapsed ? result._avg.elapsed / 1000 : 0,
            },
          ];
        }

        const results = await prisma.testRunResults.findMany({
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
        prisma: any,
        projectId: number | undefined,
        groupBy: string[],
        filters?: any,
        dims?: string[]
      ) => {
        if (groupBy.length === 0) {
          const result = await prisma.testRunResults.aggregate({
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

        const results = await prisma.testRunResults.findMany({
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
          getValues: async (prisma: any, projectId?: number) => {
            const projects = await prisma.projects.findMany({
              where: {
                isDeleted: false,
                // Only include projects that have issues
                OR: [
                  {
                    repositoryCases: {
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
      getValues: async (prisma: any, projectId?: number) => {
        if (isProjectSpecific && projectId) {
          // Project-specific: Get creators from the project's issue config
          const project = await prisma.projects.findUnique({
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
          const users = await prisma.user.findMany({
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
      getValues: async (prisma: any, projectId?: number) => {
        if (isProjectSpecific && projectId) {
          // Project-specific: Get issue config from the project
          // Project-specific: Since the current schema doesn't have issueConfig,
          // we'll check if the project has any issues and return a placeholder config
          const project = await prisma.projects.findUnique({
            where: { id: Number(projectId) },
            include: {
              issues: {
                where: { isDeleted: false },
                select: { id: true },
                take: 1,
              },
            },
          });

          // Return a placeholder issue config if the project has issues
          return project?.issues && project.issues.length > 0
            ? [
                {
                  id: projectId,
                  name: "Project Issues",
                  systemType: "INTERNAL",
                  configData: {},
                  isDefault: true,
                  isActive: true,
                },
              ]
            : [];
        } else {
          // Cross-project: Get all active issue configs
          // Note: issueConfig table doesn't exist in current schema
          // Return empty array for cross-project queries
          return [];
          /*
          const configs = await prisma.issueConfig.findMany({
            where: {
              isDeleted: false,
              isActive: true,
            },
            select: {
              id: true,
              name: true,
              systemType: true,
              configData: true,
              isDefault: true,
              isActive: true,
            },
            orderBy: { name: "asc" },
          });
          return configs;
          */
        }
      },
      groupBy: "integrationId",
      join: { integration: true },
      display: (val: any) => ({
        name: val.name,
        id: val.id,
        systemType: val.systemType,
        configData: val.configData,
        isDefault: val.isDefault,
        isActive: val.isActive,
      }),
    },
    date: {
      id: "date",
      label: "Creation Date",
      getValues: async (prisma: any, projectId?: number) => {
        if (isProjectSpecific && projectId) {
          // Project-specific: Get dates from the project's issue config issues
          const project = await prisma.projects.findUnique({
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
          const dates = await prisma.issue.findMany({
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

// Shared issue tracking metric registry factory
export function createIssueTrackingMetricRegistry(
  isProjectSpecific: boolean = true
) {
  return {
    issueCount: {
      id: "issueCount",
      label: "Issue Count",
      aggregate: async (
        prisma: any,
        projectId: number | undefined,
        groupBy: string[],
        filters?: any,
        dims?: string[]
      ) => {
        if (isProjectSpecific && projectId) {
          // Project-specific implementation
          const project = await prisma.projects.findUnique({
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
                .map((field) => issue[field] || "unknown")
                .join("|");

              if (!grouped.has(key)) {
                const groupData: any = {};
                groupBy.forEach((field) => {
                  groupData[field] = issue[field];
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
            const results = await prisma.issue.findMany({
              where: { isDeleted: false },
              select: {
                createdAt: true,
                createdById: true,
                integrationId: true,
                // Get project ID through related entities
                repositoryCases: {
                  select: { projectId: true },
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
              // Determine project ID from related entities
              const projectId =
                result.repositoryCases[0]?.projectId ||
                result.sessions[0]?.projectId ||
                result.testRuns[0]?.projectId ||
                null;

              const key = groupBy
                .map((field) => {
                  if (field === "createdAt") {
                    const date = new Date(result.createdAt);
                    date.setUTCHours(0, 0, 0, 0);
                    return date.toISOString();
                  } else if (field === "createdById") {
                    return result.createdById;
                  } else if (field === "integrationId") {
                    return result.integrationId;
                  } else if (field === "projectId") {
                    return projectId;
                  }
                  return "unknown";
                })
                .join("|");

              if (!acc[key]) {
                acc[key] = {
                  ...groupBy.reduce((obj: any, field) => {
                    if (field === "createdAt") {
                      const date = new Date(result.createdAt);
                      date.setUTCHours(0, 0, 0, 0);
                      obj[field] = date.toISOString();
                    } else if (field === "createdById") {
                      obj[field] = result.createdById;
                    } else if (field === "integrationId") {
                      obj[field] = result.integrationId;
                    } else if (field === "projectId") {
                      obj[field] = projectId;
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
            const count = await prisma.issue.count({
              where: { isDeleted: false },
            });
            return [{ issueCount: count }];
          }

          // For simple groupBy without project
          if (!groupBy.includes("projectId")) {
            return prisma.issue
              .groupBy({
                by: groupBy as any[],
                where: { isDeleted: false },
                _count: { _all: true },
              })
              .then((results: any[]) =>
                results.map((r: any) => ({
                  ...r,
                  issueCount: r._count._all,
                }))
              );
          }

          // For groupBy with project, we need a more complex query
          const results = await prisma.issue.findMany({
            where: { isDeleted: false },
            select: {
              createdById: true,
              integrationId: true,
              repositoryCases: {
                select: { projectId: true },
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
              result.repositoryCases[0]?.projectId ||
              result.sessions[0]?.projectId ||
              result.testRuns[0]?.projectId ||
              null;

            const key = groupBy
              .map((field) => {
                if (field === "createdById") {
                  return result.createdById;
                } else if (field === "integrationId") {
                  return result.integrationId;
                } else if (field === "projectId") {
                  return projectId;
                }
                return "unknown";
              })
              .join("|");

            if (!acc[key]) {
              acc[key] = {
                ...groupBy.reduce((obj: any, field) => {
                  if (field === "createdById") {
                    obj[field] = result.createdById;
                  } else if (field === "integrationId") {
                    obj[field] = result.integrationId;
                  } else if (field === "projectId") {
                    obj[field] = projectId;
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
function getWeekStartDate(weekEndDate: Date): Date {
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
          getValues: async (prisma: any, projectId?: number, filters?: any) => {
            const projects = await prisma.projects.findMany({
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
      getValues: async (prisma: any, projectId?: number, filters?: any) => {
        // Get all repository cases within the date range
        const cases = await prisma.repositoryCases.findMany({
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
      getValues: async (prisma: any, projectId?: number, filters?: any) => {
        // Get the priority field
        const priorityField = await prisma.caseFields.findUnique({
          where: { systemName: "priority" },
          select: { id: true },
        });

        if (!priorityField) return [];

        // Get distinct priority values from case field values
        const values = await prisma.caseFieldValues.findMany({
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
        prisma: any,
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
          ? await prisma.caseFields.findUnique({
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
          const allCases = await prisma.repositoryCases.findMany({
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
        const count = await prisma.repositoryCases.count({
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
        prisma: any,
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
          ? await prisma.caseFields.findUnique({
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
          const allCases = await prisma.repositoryCases.findMany({
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
        const count = await prisma.repositoryCases.count({
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
        prisma: any,
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
          ? await prisma.caseFields.findUnique({
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
          const allCases = await prisma.repositoryCases.findMany({
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
        const count = await prisma.repositoryCases.count({
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
        prisma: any,
        projectId: number | undefined,
        groupBy: string[],
        filters?: any,
        dims?: string[]
      ) => {
        // This metric requires calculating from automatedCount and totalCount
        // It will be calculated on the frontend by combining those two metrics
        return [];
      },
      hidden: true, // Hide from UI as it's calculated on frontend
    },
  };
}
