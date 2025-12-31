import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { reportRequestSchema } from "~/lib/schemas/reportRequestSchema";

// Registry for dimensions
const DIMENSION_REGISTRY: Record<
  string,
  {
    id: string;
    label: string;
    getValues: (prisma: any, projectId: number) => Promise<any[]>;
    groupBy: string;
    join: any;
    display: (val: any) => any;
  }
> = {
  status: {
    id: "status",
    label: "Status",
    getValues: async (prisma: any, projectId: number) => {
      // Get only statuses that are used in test results for this project
      const statuses = await prisma.status.findMany({
        where: {
          testRunResults: {
            some: {
              testRun: {
                projectId: Number(projectId),
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
      name: val.name,
      color: val.color?.value,
      id: val.id,
    }),
  },
  user: {
    id: "user",
    label: "Executor",
    getValues: async (prisma: any, projectId: number) => {
      // Get only users who have executed tests in this project
      const users = await prisma.user.findMany({
        where: {
          isDeleted: false,
          testRunResults: {
            some: {
              testRun: {
                projectId: Number(projectId),
                isDeleted: false,
              },
            },
          },
        },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      });
      return users;
    },
    groupBy: "executedById",
    join: { executedBy: true },
    display: (val: any) => ({ name: val.name, id: val.id }),
  },
  testRun: {
    id: "testRun",
    label: "Test Run",
    getValues: async (prisma: any, projectId: number) =>
      await prisma.testRuns.findMany({
        where: { projectId: Number(projectId), isDeleted: false },
        select: { id: true, name: true },
      }),
    groupBy: "id",
    join: { testRun: true },
    display: (val: any) => ({ name: val.name, id: val.id }),
  },
  testCase: {
    id: "testCase",
    label: "Executed Test Case",
    getValues: async (prisma: any, projectId: number) => {
      const testCases = await prisma.testRunCases.findMany({
        where: {
          testRun: { projectId: Number(projectId), isDeleted: false },
        },
        select: {
          id: true,
          repositoryCaseId: true,
          repositoryCase: {
            select: {
              id: true,
              name: true,
              isDeleted: true,
              source: true,
            },
          },
        },
      });
      // Flatten the structure to have name at root level
      return testCases.map(
        (tc: {
          id: number;
          repositoryCaseId: number;
          repositoryCase: {
            id: number;
            name: string;
            isDeleted: boolean;
            source: string;
          } | null;
        }) => ({
          id: tc.id,
          repositoryCaseId: tc.repositoryCaseId,
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
      // Handle null/undefined
      if (!val) {
        return {
          name: "Unknown",
          id: null,
          isDeleted: false,
          source: "MANUAL",
        };
      }

      // Check for name at root level first (from flattened getValues or joined data)
      if (val.name) {
        return {
          name: val.name,
          id: val.id,
          isDeleted: val.isDeleted || false,
          source: val.source || "MANUAL",
        };
      }

      // If val has repositoryCase (from join), use it
      if (val.repositoryCase) {
        return {
          name: val.repositoryCase.name || `Case ${val.id}`,
          id: val.id,
          isDeleted: val.repositoryCase.isDeleted || false,
          source: val.repositoryCase.source || "MANUAL",
        };
      }

      // Fallback - use id for name
      return {
        name: `Case ${val.id || val}`,
        id: val.id || val,
        isDeleted: false,
        source: "MANUAL",
      };
    },
  },
  date: {
    id: "date",
    label: "Execution Date",
    getValues: async (prisma: any, projectId: number) => {
      const dates = await prisma.testRunResults.findMany({
        where: { testRun: { projectId: Number(projectId) }, isDeleted: false },
        select: { executedAt: true },
        distinct: ["executedAt"],
        orderBy: {
          executedAt: "asc",
        },
      });
      // Group dates by day
      const datesByDay = dates.reduce((acc: any, curr: any) => {
        const day = new Date(curr.executedAt);
        day.setUTCHours(0, 0, 0, 0);
        const dayStr = day.toISOString();
        if (!acc[dayStr]) {
          acc[dayStr] = day;
        }
        return acc;
      }, {});
      return Object.values(datesByDay).map((d: any) => ({ executedAt: d }));
    },
    groupBy: "executedAt",
    join: {},
    display: (val: any) => {
      const date = new Date(val.executedAt);
      date.setUTCHours(0, 0, 0, 0);
      return { executedAt: date.toISOString() };
    },
  },
  milestone: {
    id: "milestone",
    label: "Milestone",
    getValues: async (prisma: any, projectId: number) =>
      await prisma.milestones.findMany({
        where: {
          projectId: Number(projectId),
          isDeleted: false,
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
      }),
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
  configuration: {
    id: "configuration",
    label: "Configuration",
    getValues: async (prisma: any, projectId: number) => {
      // Get all configurations from test runs in the project
      const testRuns = await prisma.testRuns.findMany({
        where: {
          projectId: Number(projectId),
          isDeleted: false,
          configuration: { isNot: null },
        },
        select: {
          configuration: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      // Extract unique configurations and ensure they have valid data
      const configs = testRuns
        .map(
          (tr: { configuration: { id: number; name: string } | null }) =>
            tr.configuration
        )
        .filter(
          (
            config: { id: number; name: string } | null
          ): config is { id: number; name: string } =>
            config !== null &&
            typeof config.id === "number" &&
            typeof config.name === "string"
        )
        .filter(
          (
            config: { id: number; name: string },
            index: number,
            self: { id: number; name: string }[]
          ) =>
            index ===
            self.findIndex(
              (c: { id: number; name: string }) => c.id === config.id
            )
        );

      return configs;
    },
    groupBy: "configId",
    join: { testRun: { select: { configuration: true } } },
    display: (val: any) => ({ name: val.name, id: val.id }),
  },
};

// Registry for metrics
const METRIC_REGISTRY: Record<
  string,
  {
    id: string;
    label: string;
    aggregate: (
      prisma: any,
      projectId: number,
      groupBy: string[],
      filters?: any,
      dims?: string[]
    ) => Promise<any[]>;
  }
> = {
  testResultCount: {
    id: "testResultCount",
    label: "Test Results Count",
    aggregate: async (prisma, projectId, groupBy, filters, dims) => {
      // If date is in groupBy, we need to handle it specially
      const dateIndex = groupBy.indexOf("executedAt");
      if (dateIndex !== -1) {
        // Determine if we need to join testRun for milestoneId/configId
        const needsMilestone = groupBy.includes("milestoneId");
        const needsConfig = groupBy.includes("configId");
        const needsTestCase = groupBy.includes("testRunCaseId");

        const results = await prisma.testRunResults.findMany({
          where: {
            testRun: { projectId: Number(projectId) },
            isDeleted: false,
          },
          select: {
            executedAt: true,
            ...(groupBy.includes("statusId") ? { statusId: true } : {}),
            ...(groupBy.includes("executedById") ? { executedById: true } : {}),
            ...(needsTestCase ? { testRunCaseId: true } : {}),
            testRun:
              needsMilestone || needsConfig
                ? {
                    select: {
                      ...(needsMilestone ? { milestoneId: true } : {}),
                      ...(needsConfig ? { configId: true } : {}),
                    },
                  }
                : undefined,
            ...(needsTestCase
              ? {
                  testRunCase: {
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
                  },
                }
              : {}),
          },
        });

        // Group results by day and other dimensions
        const groupedResults = results.reduce((acc: any, result: any) => {
          const key = groupBy
            .map((field) => {
              if (field === "executedAt") {
                const date = new Date(result.executedAt);
                date.setUTCHours(0, 0, 0, 0);
                return date.toISOString();
              }
              if (field === "milestoneId" || field === "configId") {
                return result.testRun ? result.testRun[field] : null;
              }
              if (field === "testRunCaseId") {
                return result.testRunCaseId;
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
                  obj[field] = date.toISOString();
                } else if (field === "milestoneId" || field === "configId") {
                  obj[field] = result.testRun ? result.testRun[field] : null;
                } else if (field === "testRunCaseId") {
                  obj[field] = result.testRunCaseId;
                  // Also store the testRunCase data for display
                  obj.testRunCase = result.testRunCase;
                } else {
                  obj[field] = result[field];
                }
                return obj;
              }, {}),
              testResultCount: 0,
            };
          }
          acc[key].testResultCount++;
          return acc;
        }, {});

        return Object.values(groupedResults);
      }

      const relatedFields = ["milestoneId", "configId", "testRunCaseId"];
      const needsManualGrouping = groupBy.some((g) =>
        relatedFields.includes(g)
      );

      if (needsManualGrouping) {
        const needsTestCase = groupBy.includes("testRunCaseId");
        const results = await prisma.testRunResults.findMany({
          where: {
            testRun: { projectId: Number(projectId), isDeleted: false },
          },
          select: {
            statusId: true,
            executedById: true,
            ...(needsTestCase ? { testRunCaseId: true } : {}),
            testRun: {
              select: {
                milestoneId: true,
                configId: true,
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
                configuration: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
            ...(needsTestCase
              ? {
                  testRunCase: {
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
                  },
                }
              : {}),
          },
        });

        const counts = results.reduce(
          (acc: Record<string, any>, result: any) => {
            const key = groupBy
              .map((field) => {
                if (field === "milestoneId" || field === "configId") {
                  return result.testRun ? result.testRun[field] : null;
                }
                if (field === "testRunCaseId") {
                  return result.testRunCaseId;
                }
                return result[field];
              })
              .join("|");

            if (!acc[key]) {
              acc[key] = {
                ...groupBy.reduce((obj: Record<string, any>, field) => {
                  if (field === "milestoneId") {
                    obj[field] = result.testRun ? result.testRun[field] : null;
                    // Also store the full milestone data for display
                    if (result.testRun?.milestone) {
                      obj.milestone = result.testRun.milestone;
                    }
                  } else if (field === "configId") {
                    obj[field] = result.testRun ? result.testRun[field] : null;
                    // Also store the full configuration data for display
                    if (result.testRun?.configuration) {
                      obj.configuration = result.testRun.configuration;
                    }
                  } else if (field === "testRunCaseId") {
                    obj[field] = result.testRunCaseId;
                    // Also store the testRunCase data for display
                    obj.testRunCase = result.testRunCase;
                  } else {
                    obj[field] = result[field];
                  }
                  return obj;
                }, {}),
                testResultCount: 0,
              };
            }
            acc[key].testResultCount++;
            return acc;
          },
          {}
        );

        return Object.values(counts);
      }

      // Default: use prisma.groupBy for fields directly on the table
      return prisma.testRunResults
        .groupBy({
          by: groupBy,
          where: {
            testRun: { projectId: Number(projectId) },
            isDeleted: false,
          },
          _count: { _all: true },
        })
        .then((results: any[]) =>
          results.map((r: any) => ({ ...r, testResultCount: r._count._all }))
        );
    },
  },
  testRunCount: {
    id: "testRunCount",
    label: "Test Runs Count",
    aggregate: async (prisma, projectId, groupBy, filters, dims) => {
      // If date is in groupBy, we need to handle it specially
      const dateIndex = groupBy.indexOf("executedAt");
      // Case 1: Grouping by fields that live on the TestRunResults table
      if (
        groupBy.some((g) =>
          ["statusId", "executedById", "executedAt"].includes(g)
        )
      ) {
        const results = await prisma.testRunResults.findMany({
          where: {
            testRun: { projectId: Number(projectId), isDeleted: false },
          },
          select: {
            testRunId: true,
            statusId: true,
            executedById: true,
            executedAt: true,
            testRun: {
              select: {
                milestoneId: true,
                configId: true,
              },
            },
          },
        });

        const groups = results.reduce(
          (acc: Record<string, any>, result: any) => {
            const key = groupBy
              .map((field) => {
                if (field === "milestoneId" || field === "configId")
                  return result.testRun[field];
                if (field === "executedAt") {
                  const d = new Date(result.executedAt);
                  d.setUTCHours(0, 0, 0, 0);
                  return d.toISOString();
                }
                return result[field];
              })
              .join("|");

            if (!acc[key]) {
              acc[key] = {
                ...groupBy.reduce((obj: Record<string, any>, field) => {
                  if (field === "milestoneId" || field === "configId")
                    obj[field] = result.testRun[field];
                  else if (field === "executedAt") {
                    const d = new Date(result.executedAt);
                    d.setUTCHours(0, 0, 0, 0);
                    obj[field] = d.toISOString();
                  } else obj[field] = result[field];
                  return obj;
                }, {}),
                runs: new Set<number>(),
              };
            }
            if (result.testRunId) acc[key].runs.add(result.testRunId);
            return acc;
          },
          {}
        );

        return Object.values(groups).map((g: any) => ({
          ...g,
          testRunCount: g.runs.size,
          runs: undefined,
        }));
      }

      // Case 2: Grouping by test cases
      if (dims?.includes("testCase")) {
        const results = await prisma.testRunCases.findMany({
          where: {
            testRun: { projectId: Number(projectId), isDeleted: false },
          },
          select: { id: true, testRunId: true }, // id here is testRunCases.id
        });
        const groups = results.reduce(
          (
            acc: Record<string, any>,
            r: { id: number; testRunId: number | null }
          ) => {
            if (!acc[r.id]) acc[r.id] = { id: r.id, runs: new Set() };
            if (r.testRunId) acc[r.id].runs.add(r.testRunId);
            return acc;
          },
          {}
        );
        return Object.values(groups).map((g: any) => ({
          id: g.id,
          testRunCount: g.runs.size,
          runs: undefined,
        }));
      }

      // Case 3: Grouping by fields directly on TestRuns table (milestone, config, or testRun itself)
      const directGroupBy = groupBy.filter((g) =>
        ["milestoneId", "configId", "id"].includes(g)
      );

      // If no valid fields to group by on this table, do a global count.
      if (directGroupBy.length === 0) {
        const count = await prisma.testRuns.count({
          where: { projectId: Number(projectId), isDeleted: false },
        });
        return [{ testRunCount: count }];
      }

      const dbResults = await prisma.testRuns.groupBy({
        by: directGroupBy as any, // Cast to any to satisfy prisma's type limitations here
        where: { projectId: Number(projectId), isDeleted: false },
        _count: { _all: true },
      });
      return dbResults.map((r: any) => ({ ...r, testRunCount: r._count._all }));
    },
  },
  testCaseCount: {
    id: "testCaseCount",
    label: "Test Cases Count",
    aggregate: async (prisma, projectId, groupBy, filters, dims) => {
      // If date is in groupBy, we need to handle it specially
      const dateIndex = groupBy.indexOf("executedAt");
      // Special handling for milestone grouping
      if (groupBy.includes("milestoneId")) {
        const results = await prisma.testRunCases.findMany({
          where: {
            testRun: {
              projectId: Number(projectId),
              isDeleted: false,
              milestoneId: { not: null },
            },
          },
          select: {
            repositoryCaseId: true,
            testRun: {
              select: {
                milestoneId: true,
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
        });

        const counts = results.reduce(
          (
            acc: Record<
              number,
              { name: string; milestone: any; cases: Set<number> }
            >,
            curr: {
              repositoryCaseId: number;
              testRun: {
                milestoneId: number | null;
                milestone: { id: number; name: string } | null;
              };
            }
          ) => {
            const milestoneId = curr.testRun.milestoneId;
            if (milestoneId && curr.testRun.milestone) {
              if (!acc[milestoneId]) {
                acc[milestoneId] = {
                  name: curr.testRun.milestone.name,
                  milestone: curr.testRun.milestone,
                  cases: new Set(),
                };
              }
              acc[milestoneId].cases.add(curr.repositoryCaseId);
            }
            return acc;
          },
          {}
        );

        const finalCounts = Object.keys(counts).map((milestoneId) => {
          const numericMilestoneId = Number(milestoneId);
          const data = counts[numericMilestoneId];
          return {
            milestoneId: numericMilestoneId,
            testCaseCount: data.cases.size,
            milestone: counts[numericMilestoneId].milestone,
          };
        });
        return finalCounts;
      }

      // For status grouping, we need to count test cases by their latest result status
      if (groupBy.includes("statusId")) {
        const cases = await prisma.testRunCases.findMany({
          where: {
            testRun: { projectId: Number(projectId), isDeleted: false },
          },
          include: {
            results: {
              orderBy: { executedAt: "desc" },
              take: 1,
              include: { status: true },
            },
          },
        });

        const counts: Record<number, number> = {};
        for (const c of cases) {
          const statusId = c.results[0]?.statusId || 1; // Default to untested (1) if no results
          counts[statusId] = (counts[statusId] || 0) + 1;
        }

        return Object.entries(counts).map(([statusId, count]) => ({
          statusId: Number(statusId),
          testCaseCount: count,
        }));
      }

      // Handle grouping by fields on TestRun, like configuration
      if (groupBy.includes("configId")) {
        const cases = await prisma.testRunCases.findMany({
          where: {
            testRun: {
              projectId: Number(projectId),
              isDeleted: false,
              configId: { not: null },
            },
          },
          select: {
            id: true,
            testRun: {
              select: {
                configId: true,
              },
            },
          },
        });

        const counts = cases.reduce(
          (acc: Record<number, Set<number>>, curr: any) => {
            const configId = curr.testRun.configId;
            if (configId) {
              if (!acc[configId]) {
                acc[configId] = new Set();
              }
              acc[configId].add(curr.id);
            }
            return acc;
          },
          {}
        );

        return Object.entries(counts).map(([configId, data]) => ({
          configId: Number(configId),
          testCaseCount: (data as Set<number>).size,
        }));
      }

      // Fallback to default groupBy for other dimensions
      const directGroupBy = groupBy.filter((g) => ["id"].includes(g)); // Only 'testCase' dimension
      if (directGroupBy.length === 0 && groupBy.length > 0) {
        return [];
      }
      return prisma.testRunCases
        .groupBy({
          by: directGroupBy,
          where: {
            testRun: { projectId: Number(projectId), isDeleted: false },
          },
          _count: { _all: true },
        })
        .then(
          (
            results: Array<{ _count: { _all: number } } & Record<string, any>>
          ) =>
            results.map(
              (r: { _count: { _all: number } } & Record<string, any>) => ({
                ...r,
                testCaseCount: r._count._all,
              })
            )
        );
    },
  },
  avgElapsed: {
    id: "avgElapsed",
    label: "Avg. Elapsed Time",
    aggregate: async (prisma, projectId, groupBy, filters, dims) => {
      // If date is in groupBy, we need to handle it specially
      const dateIndex = groupBy.indexOf("executedAt");
      const needsMilestoneOrConfig = groupBy.some((g) =>
        ["milestoneId", "configId"].includes(g)
      );

      if (needsMilestoneOrConfig) {
        const results = await prisma.testRunResults.findMany({
          where: {
            testRun: { projectId: Number(projectId), isDeleted: false },
          },
          select: {
            elapsed: true,
            testRun: {
              select: {
                milestoneId: groupBy.includes("milestoneId") ? true : undefined,
                configId: groupBy.includes("configId") ? true : undefined,
                ...(groupBy.includes("milestoneId")
                  ? {
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
                    }
                  : {}),
                ...(groupBy.includes("configId")
                  ? {
                      configuration: {
                        select: {
                          id: true,
                          name: true,
                        },
                      },
                    }
                  : {}),
              },
            },
          },
        });

        const groups = results.reduce(
          (acc: Record<string, any>, result: any) => {
            const key = groupBy
              .map((field) => result.testRun[field] || "null")
              .join("|");
            if (!acc[key]) {
              acc[key] = {
                ...groupBy.reduce((obj: Record<string, any>, field) => {
                  if (field === "milestoneId") {
                    obj[field] = result.testRun[field];
                    if (result.testRun?.milestone) {
                      obj.milestone = result.testRun.milestone;
                    }
                  } else if (field === "configId") {
                    obj[field] = result.testRun[field];
                    if (result.testRun?.configuration) {
                      obj.configuration = result.testRun.configuration;
                    }
                  } else {
                    obj[field] = result.testRun[field];
                  }
                  return obj;
                }, {}),
                _values: [],
              };
            }
            if (result.elapsed !== null) {
              acc[key]._values.push(result.elapsed);
            }
            return acc;
          },
          {}
        );

        return Object.values(groups).map((group: any) => {
          const { _values, ...rest } = group;
          const sum = _values.reduce((a: number, b: number) => a + b, 0);
          const avg = _values.length > 0 ? sum / _values.length : 0;
          return { ...rest, avgElapsed: avg };
        });
      }

      // Handle complex grouping scenarios that require manual aggregation
      const needsManualGrouping = groupBy.some((g) =>
        ["executedAt", "id"].includes(g)
      );

      if (needsManualGrouping) {
        // Build the select object dynamically
        const selectObj: any = {
          elapsed: true,
          ...(groupBy.includes("statusId") ? { statusId: true } : {}),
          ...(groupBy.includes("executedById") ? { executedById: true } : {}),
          ...(groupBy.includes("executedAt") ? { executedAt: true } : {}),
          ...(groupBy.includes("id") ? { testRunId: true } : {}),
        };

        const results = await prisma.testRunResults.findMany({
          where: {
            testRun: { projectId: Number(projectId), isDeleted: false },
            isDeleted: false,
          },
          select: selectObj,
        });

        const groups = results.reduce(
          (acc: Record<string, any>, result: any) => {
            const key = groupBy
              .map((field) => {
                if (field === "executedAt") {
                  const date = new Date(result.executedAt);
                  date.setUTCHours(0, 0, 0, 0);
                  return date.toISOString();
                }
                if (field === "id") {
                  return result.testRunId || null;
                }
                return result[field] || null;
              })
              .join("|");

            if (!acc[key]) {
              acc[key] = {
                ...groupBy.reduce((obj: Record<string, any>, field) => {
                  if (field === "executedAt") {
                    const date = new Date(result.executedAt);
                    date.setUTCHours(0, 0, 0, 0);
                    obj[field] = date.toISOString();
                  } else if (field === "id") {
                    obj[field] = result.testRunId || null;
                  } else {
                    obj[field] = result[field] || null;
                  }
                  return obj;
                }, {}),
                _values: [],
              };
            }
            if (result.elapsed !== null && result.elapsed !== undefined) {
              acc[key]._values.push(result.elapsed);
            }
            return acc;
          },
          {}
        );

        return Object.values(groups).map((group: any) => {
          const { _values, ...rest } = group;
          const sum = _values.reduce((a: number, b: number) => a + b, 0);
          const avg = _values.length > 0 ? sum / _values.length : 0;
          return { ...rest, avgElapsed: avg };
        });
      }

      // For simple groupBy scenarios, use Prisma's groupBy
      return prisma.testRunResults
        .groupBy({
          by: groupBy,
          where: {
            testRun: { projectId: Number(projectId), isDeleted: false },
            isDeleted: false,
            // Exclude null elapsed values from average calculation
            elapsed: { not: null },
          },
          _avg: { elapsed: true },
        })
        .then((results: any[]) =>
          results.map((r: any) => ({
            ...r,
            // If avg is null (no results), return 0
            avgElapsed: r._avg.elapsed ?? 0,
          }))
        );
    },
  },
  sumElapsed: {
    id: "sumElapsed",
    label: "Total Elapsed Time",
    aggregate: async (prisma, projectId, groupBy, filters, dims) => {
      // If date is in groupBy, we need to handle it specially
      const dateIndex = groupBy.indexOf("executedAt");
      const needsMilestoneOrConfig = groupBy.some((g) =>
        ["milestoneId", "configId"].includes(g)
      );

      if (needsMilestoneOrConfig) {
        const results = await prisma.testRunResults.findMany({
          where: {
            testRun: { projectId: Number(projectId), isDeleted: false },
          },
          select: {
            elapsed: true,
            testRun: {
              select: {
                milestoneId: groupBy.includes("milestoneId") ? true : undefined,
                configId: groupBy.includes("configId") ? true : undefined,
                ...(groupBy.includes("milestoneId")
                  ? {
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
                    }
                  : {}),
                ...(groupBy.includes("configId")
                  ? {
                      configuration: {
                        select: {
                          id: true,
                          name: true,
                        },
                      },
                    }
                  : {}),
              },
            },
          },
        });

        const groups = results.reduce(
          (acc: Record<string, any>, result: any) => {
            const key = groupBy
              .map((field) => result.testRun[field] || "null")
              .join("|");
            if (!acc[key]) {
              acc[key] = {
                ...groupBy.reduce((obj: Record<string, any>, field) => {
                  if (field === "milestoneId") {
                    obj[field] = result.testRun[field];
                    if (result.testRun?.milestone) {
                      obj.milestone = result.testRun.milestone;
                    }
                  } else if (field === "configId") {
                    obj[field] = result.testRun[field];
                    if (result.testRun?.configuration) {
                      obj.configuration = result.testRun.configuration;
                    }
                  } else {
                    obj[field] = result.testRun[field];
                  }
                  return obj;
                }, {}),
                _sum: 0,
              };
            }
            if (result.elapsed !== null) {
              acc[key]._sum += result.elapsed;
            }
            return acc;
          },
          {}
        );

        return Object.values(groups).map((group: any) => {
          const { _sum, ...rest } = group;
          return { ...rest, sumElapsed: _sum };
        });
      }

      // Handle complex grouping scenarios that require manual aggregation
      const needsManualGrouping = groupBy.some((g) =>
        ["executedAt", "id"].includes(g)
      );

      if (needsManualGrouping) {
        // Build the select object dynamically
        const selectObj: any = {
          elapsed: true,
          ...(groupBy.includes("statusId") ? { statusId: true } : {}),
          ...(groupBy.includes("executedById") ? { executedById: true } : {}),
          ...(groupBy.includes("executedAt") ? { executedAt: true } : {}),
          ...(groupBy.includes("id") ? { testRunId: true } : {}),
        };

        const results = await prisma.testRunResults.findMany({
          where: {
            testRun: { projectId: Number(projectId), isDeleted: false },
            isDeleted: false,
          },
          select: selectObj,
        });

        const groups = results.reduce(
          (acc: Record<string, any>, result: any) => {
            const key = groupBy
              .map((field) => {
                if (field === "executedAt") {
                  const date = new Date(result.executedAt);
                  date.setUTCHours(0, 0, 0, 0);
                  return date.toISOString();
                }
                if (field === "id") {
                  return result.testRunId || null;
                }
                return result[field] || null;
              })
              .join("|");

            if (!acc[key]) {
              acc[key] = {
                ...groupBy.reduce((obj: Record<string, any>, field) => {
                  if (field === "executedAt") {
                    const date = new Date(result.executedAt);
                    date.setUTCHours(0, 0, 0, 0);
                    obj[field] = date.toISOString();
                  } else if (field === "id") {
                    obj[field] = result.testRunId || null;
                  } else {
                    obj[field] = result[field] || null;
                  }
                  return obj;
                }, {}),
                _sum: 0,
              };
            }
            if (result.elapsed !== null && result.elapsed !== undefined) {
              acc[key]._sum += result.elapsed;
            }
            return acc;
          },
          {}
        );

        return Object.values(groups).map((group: any) => {
          const { _sum, ...rest } = group;
          return { ...rest, sumElapsed: _sum };
        });
      }

      // For simple groupBy scenarios, use Prisma's groupBy
      return prisma.testRunResults
        .groupBy({
          by: groupBy,
          where: {
            testRun: { projectId: Number(projectId), isDeleted: false },
            isDeleted: false,
          },
          _sum: { elapsed: true },
        })
        .then((results: any[]) =>
          results.map((r: any) => ({
            ...r,
            sumElapsed: r._sum.elapsed ?? 0,
          }))
        );
    },
  },
};

// Helper: cartesian product
function cartesianProduct(arrays: any[][]): any[][] {
  return arrays.reduce(
    (a, b) => a.flatMap((d) => b.map((e) => [d, e].flat())),
    [[]]
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { projectId, dimensions, metrics, page = 1, pageSize, sortColumn, sortDirection } = body;

    const validation = reportRequestSchema.safeParse({
      ...body,
      reportType: "test-execution",
    });

    if (!validation.success) {
      return Response.json(
        { error: validation.error.issues[0].message },
        { status: 400 }
      );
    }

    if (!projectId) {
      return Response.json(
        { error: "Project ID is required" },
        { status: 400 }
      );
    }

    const dims: string[] = dimensions;
    const mets: string[] = metrics;

    if (dims.length === 0 || mets.length === 0)
      return Response.json(
        { error: "At least one dimension and one metric required" },
        { status: 400 }
      );

    // Validate dimensions/metrics
    for (const d of dims)
      if (!DIMENSION_REGISTRY[d])
        return Response.json(
          { error: `Unsupported dimension: ${d}` },
          { status: 400 }
        );
    for (const m of mets)
      if (!METRIC_REGISTRY[m])
        return Response.json(
          { error: `Unsupported metric: ${m}` },
          { status: 400 }
        );

    // 1. Fetch all possible values for each dimension
    const allDimensionValues = await Promise.all(
      dims.map(async (d: string) =>
        DIMENSION_REGISTRY[d].getValues(prisma, projectId)
      )
    );

    // 2. Build groupBy fields
    const by: string[] = dims.map((d: string) => DIMENSION_REGISTRY[d].groupBy);

    // 3. Build aggregations
    // For each selected metric, call its aggregate function and merge results by group key
    const mergedResults: Record<string, any> = {};
    for (const m of mets) {
      const metric = METRIC_REGISTRY[m];
      if (metric && metric.aggregate) {
        const metricResults = await metric.aggregate(
          prisma,
          projectId,
          by,
          undefined,
          dims
        );
        for (const row of metricResults) {
          // Build a key for lookup based on groupBy fields
          const key = JSON.stringify(by.map((b: string) => row[b]));
          if (!mergedResults[key]) mergedResults[key] = { ...row };
          else Object.assign(mergedResults[key], row);
        }
      }
    }
    const results = Object.values(mergedResults);

    // If there are no results from aggregation at all, there's no data to report.
    if (results.length === 0) {
      return Response.json({ results: [] });
    }

    // 5. Build a lookup map from the results
    const resultMap = new Map();
    for (const row of results) {
      const key = JSON.stringify(by.map((b: string) => (row as any)[b]));
      resultMap.set(key, row);
    }

    // 6. For passRate, get passing status IDs
    let passStatusIds: number[] = [];
    if (mets.includes("passRate")) {
      const statuses = await prisma.status.findMany({
        where: { isSuccess: true },
        select: { id: true },
      });
      passStatusIds = statuses.map((s) => s.id);
    }

    // 7. Generate all combinations
    const combos = cartesianProduct(allDimensionValues);

    // 8. For each combination, build the output row
    const enriched = await Promise.all(
      combos.map(async (combo: any[]) => {
        // Build a key for lookup
        const key = JSON.stringify(
          combo.map((val: any, i: number) => {
            const d = dims[i];
            if (d === "date") {
              // For date, use the day part only for grouping
              const date = new Date(val.executedAt);
              date.setUTCHours(0, 0, 0, 0);
              return date.toISOString();
            }
            if (d === "attempt") return val.attempt;
            return val.id;
          })
        );
        const row = resultMap.get(key);
        const out: any = {};
        // Add dimension display values
        for (let i = 0; i < dims.length; i++) {
          const d = dims[i];
          let val = combo[i];

          // For testCase dimension, if we have testRunCase data in the result row, use that instead
          if (d === "testCase" && row && row.testRunCase) {
            val = row.testRunCase;
          }

          // For milestone dimension, if we have milestone data in the result row, use that instead
          if (d === "milestone" && row && row.milestone) {
            val = row.milestone;
          }

          // For configuration dimension, if we have configuration data in the result row, use that instead
          if (d === "configuration" && row && row.configuration) {
            val = row.configuration;
          }

          const display = DIMENSION_REGISTRY[d].display(val);
          if (d === "status") {
            // For status, store both the status name and color
            out.status = {
              name: display.name,
              id: display.id,
              color: display.color,
            };
          } else if (d === "user") {
            // For user, store the user name and ID
            out.user = {
              name: display.name,
              id: display.id,
            };
          } else if (d === "testRun") {
            // For test run, store both name and ID
            out.testRun = {
              name: display.name,
              id: display.id,
            };
            // Also store at root level for backward compatibility
            out.testRunId = display.id;
          } else if (d === "testCase") {
            // For test case, store name, ID, and additional properties
            out.testCase = {
              name: display.name,
              id: display.id,
              isDeleted: display.isDeleted,
              source: display.source,
            };
            // Also store at root level for backward compatibility
            out.testCaseId = display.id;
          } else if (d === "date") {
            // For date, store the day timestamp
            out.date = {
              executedAt: display.executedAt,
            };
            // Also store at root level for backward compatibility
            out.executedAt = display.executedAt;
          } else if (d === "milestone") {
            // For milestone, store name, ID, and milestoneType
            out.milestone = {
              name: display.name,
              id: display.id,
              milestoneType: display.milestoneType,
            };
            // Also store at root level for backward compatibility
            out.milestoneId = display.id;
          } else if (d === "configuration") {
            // For configuration, store both name and ID
            out.configuration = {
              name: display.name,
              id: display.id,
            };
          } else {
            // For other dimensions, copy all display values
            Object.entries(display).forEach(([k, v]) => (out[k] = v));
          }
        }
        // Add metrics
        for (const m of mets) {
          const metric = METRIC_REGISTRY[m];
          if (row) {
            out[metric.label] = row[metric.id] ?? 0;
          } else {
            out[metric.label] = 0;
          }
        }
        return out;
      })
    );

    // List of metric keys to check
    const metricKeys = mets.map((m) => METRIC_REGISTRY[m].label);

    // Filter out rows where all metrics are zero/null and the row has no data
    const filtered = enriched.filter((row) => {
      // Check if any metric has a non-zero, non-null value
      const hasNonZeroMetric = metricKeys.some(
        (key) => row[key] !== undefined && row[key] !== null && row[key] !== 0
      );
      // Keep the row if it has at least one non-zero metric or any data
      return hasNonZeroMetric;
    });

    // No need to group by status since we want to preserve all statuses
    const groupedResults = filtered;

    // Transform the data to be more suitable for TanStack Table grouping
    const transformedResults = groupedResults.map((row) => {
      const transformed: any = {};

      // Add metrics directly to the root level
      metricKeys.forEach((key) => {
        transformed[key] = row[key] || 0;
      });

      // Add all dimensions that were requested
      dims.forEach((dim) => {
        switch (dim) {
          case "user":
            transformed.user = row.user || { name: "-", id: null };
            break;
          case "status":
            transformed.status = row.status || {
              name: "-",
              id: null,
              color: null,
            };
            break;
          case "testRun":
            transformed.testRun = row.testRun || { name: "-", id: null };
            break;
          case "testCase":
            transformed.testCase = row.testCase || {
              name: "-",
              id: null,
              isDeleted: false,
              source: "MANUAL",
            };
            break;
          case "milestone":
            transformed.milestone = row.milestone || { name: "-", id: null };
            break;
          case "configuration":
            transformed.configuration = row.configuration || {
              name: "-",
              id: null,
            };
            break;
          case "date":
            transformed.date = row.date || { executedAt: null };
            break;
        }
      });

      // Add a unique ID for each row based on all dimensions
      const idParts = dims.map((dim) => {
        switch (dim) {
          case "user":
            return row.user?.id || "unknown";
          case "status":
            return row.status?.id || "unknown";
          case "testRun":
            return row.testRunId || row.testRun?.id || "unknown";
          case "testCase":
            return row.testCase?.id || "unknown";
          case "milestone":
            return row.milestone?.id || "unknown";
          case "configuration":
            return row.configuration?.id || "unknown";
          case "date":
            return row.date?.executedAt || "unknown";
          default:
            return "unknown";
        }
      });
      transformed.id = idParts.join("-");

      return transformed;
    });

    // Apply sorting if specified
    if (sortColumn && sortDirection) {
      transformedResults.sort((a: any, b: any) => {
        // Determine if sortColumn is a dimension or metric
        let aVal, bVal;

        // Check if it's a dimension
        if (dims.includes(sortColumn)) {
          const dimData = a[sortColumn];
          const dimDataB = b[sortColumn];

          // Handle different dimension types
          if (sortColumn === "date") {
            aVal = dimData?.executedAt;
            bVal = dimDataB?.executedAt;
          } else {
            // For other dimensions, sort by name or id
            aVal = dimData?.name || dimData?.id;
            bVal = dimDataB?.name || dimDataB?.id;
          }
        } else {
          // It's a metric - the sortColumn should already be a backend metric ID
          const metric = mets.find((m) => m === sortColumn);

          if (metric && METRIC_REGISTRY[metric]) {
            const metricLabel = METRIC_REGISTRY[metric].label;
            aVal = a[metricLabel];
            bVal = b[metricLabel];
          } else {
            // Fallback: try to find by label match
            aVal = a[sortColumn];
            bVal = b[sortColumn];
          }
        }

        // Handle null/undefined values
        if (aVal === null || aVal === undefined) return 1;
        if (bVal === null || bVal === undefined) return -1;

        const multiplier = sortDirection === "asc" ? 1 : -1;

        // Handle dates
        if (sortColumn === "date" || aVal instanceof Date || bVal instanceof Date) {
          const aTime = new Date(aVal).getTime();
          const bTime = new Date(bVal).getTime();
          return (aTime - bTime) * multiplier;
        }

        // Handle numbers
        if (typeof aVal === "number" && typeof bVal === "number") {
          return (aVal - bVal) * multiplier;
        }

        // Handle strings
        return String(aVal).localeCompare(String(bVal)) * multiplier;
      });
    } else if (dims.includes("date")) {
      // Default sort by date if date dimension is used (for backward compatibility)
      transformedResults.sort((a: any, b: any) => {
        const dateA = a.date?.executedAt;
        const dateB = b.date?.executedAt;

        if (!dateA && !dateB) return 0;
        if (!dateA) return 1;
        if (!dateB) return -1;

        return new Date(dateA).getTime() - new Date(dateB).getTime();
      });
    }

    // Apply pagination
    const totalCount = transformedResults.length;
    let paginatedResults = transformedResults;

    if (pageSize && pageSize !== "All") {
      const skip = (page - 1) * pageSize;
      const take = pageSize;
      paginatedResults = transformedResults.slice(skip, skip + take);
    }

    return Response.json({
      results: paginatedResults,
      allResults: transformedResults, // Full dataset for charts
      totalCount,
      page,
      pageSize: pageSize || totalCount,
    });
  } catch (e: any) {
    if (e.message.includes("Unsupported")) {
      return Response.json({ error: e.message }, { status: 400 });
    }
    return Response.json(
      { error: "An unexpected error occurred." },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const projectIdParam = searchParams.get("projectId");
    const projectId = projectIdParam ? Number(projectIdParam) : undefined;

    // Get all dimensions and their possible values
    const dimensions = await Promise.all(
      Object.values(DIMENSION_REGISTRY).map(async (dim) => {
        let values: any[] = [];
        try {
          values = await dim.getValues(prisma, projectId ?? 0);
        } catch (e) {
          // fallback: ignore errors for dimensions that require projectId if not provided
        }
        return {
          id: dim.id,
          label: dim.label,
          values,
        };
      })
    );

    // Get all metrics
    const metrics = Object.values(METRIC_REGISTRY).map((met) => ({
      id: met.id,
      label: met.label,
    }));

    return Response.json({ dimensions, metrics });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
