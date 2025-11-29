import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

// Note: Project health uses custom milestone and issue-based logic
// This doesn't fit the existing shared patterns but could be a candidate
// for future shared utilities specific to project health metrics

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
          isCompleted: true,
          isStarted: true,
          milestoneType: {
            select: {
              icon: {
                select: { name: true },
              },
            },
          },
        },
        orderBy: { name: "asc" },
      }),
    groupBy: "id",
    join: {
      milestone: {
        include: {
          milestoneType: {
            include: { icon: true },
          },
        },
      },
    },
    display: (val: any) => ({
      name: val.name,
      id: val.id,
      milestoneType: val.milestoneType,
      isCompleted: val.isCompleted,
      isStarted: val.isStarted,
    }),
  },
  creator: {
    id: "creator",
    label: "Creator",
    getValues: async (prisma: any, projectId: number) => {
      // Get creators from milestones and issues
      const milestoneCreators = await prisma.milestones.findMany({
        where: {
          projectId: Number(projectId),
          isDeleted: false,
        },
        select: {
          creator: {
            select: { id: true, name: true, email: true },
          },
        },
        distinct: ["createdBy"],
      });

      const issueCreators = await prisma.issue.findMany({
        where: {
          OR: [
            { repositoryCases: { some: { projectId: Number(projectId) } } },
            {
              sessions: {
                some: { projectId: Number(projectId), isDeleted: false },
              },
            },
            {
              testRuns: {
                some: { projectId: Number(projectId), isDeleted: false },
              },
            },
          ],
          isDeleted: false,
        },
        select: {
          createdBy: {
            select: { id: true, name: true, email: true },
          },
        },
        distinct: ["createdById"],
      });

      const allCreators = [
        ...milestoneCreators.map((m: any) => m.creator),
        ...issueCreators.map((i: any) => i.createdBy),
      ].filter((c: any) => c);

      // Remove duplicates by id
      const uniqueCreators = allCreators.reduce((acc: any[], creator: any) => {
        if (!acc.find((c: any) => c.id === creator.id)) {
          acc.push(creator);
        }
        return acc;
      }, []);

      return uniqueCreators;
    },
    groupBy: "createdBy",
    join: { creator: true },
    display: (val: any) => ({
      name: val.name,
      id: val.id,
      email: val.email,
    }),
  },
  date: {
    id: "date",
    label: "Activity Date",
    getValues: async (prisma: any, projectId: number) => {
      // Get dates from milestones and issues
      const milestoneDates = await prisma.milestones.findMany({
        where: {
          projectId: Number(projectId),
          isDeleted: false,
        },
        select: { createdAt: true },
        distinct: ["createdAt"],
        orderBy: { createdAt: "asc" },
      });

      const issueDates = await prisma.issue.findMany({
        where: {
          OR: [
            { repositoryCases: { some: { projectId: Number(projectId) } } },
            {
              sessions: {
                some: { projectId: Number(projectId), isDeleted: false },
              },
            },
            {
              testRuns: {
                some: { projectId: Number(projectId), isDeleted: false },
              },
            },
          ],
          isDeleted: false,
        },
        select: { createdAt: true },
        distinct: ["createdAt"],
        orderBy: { createdAt: "asc" },
      });

      const allDates = [...milestoneDates, ...issueDates];

      // Group dates by day
      const datesByDay = allDates.reduce((acc: any, curr: any) => {
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
      const date = new Date(val.createdAt);
      date.setUTCHours(0, 0, 0, 0);
      return { createdAt: date.toISOString() };
    },
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
  milestoneCompletion: {
    id: "milestoneCompletion",
    label: "Milestone Completion (%)",
    aggregate: async (prisma, projectId, groupBy, filters, dims) => {
      // Handle case where groupBy contains fields not available for direct grouping
      const filteredGroupBy = groupBy.filter(
        (field) => field !== "projectId" && field !== "createdBy"
      );
      const needsManualAggregation =
        groupBy.some((field) => field === "createdBy") ||
        groupBy.length === 0 ||
        filteredGroupBy.length === 0 ||
        groupBy.includes("createdAt"); // Always use manual aggregation for date grouping

      if (needsManualAggregation) {
        // Manual aggregation - get all milestones and calculate milestone completion
        // Based on total test cases in test runs vs completed test results
        const milestones = await prisma.milestones.findMany({
          where: {
            projectId: Number(projectId),
            isDeleted: false,
          },
          include: {
            ...(groupBy.includes("id")
              ? {
                  milestoneType: {
                    include: { icon: true },
                  },
                }
              : {}),
            ...(groupBy.includes("createdBy") ? { creator: true } : {}),
            ...(groupBy.includes("projectId") ? { project: true } : {}),
            testRuns: {
              where: {
                isDeleted: false,
              },
              include: {
                testCases: true,
                results: {
                  where: {
                    isDeleted: false,
                  },
                  include: {
                    status: {
                      select: {
                        id: true,
                        isCompleted: true,
                      },
                    },
                  },
                },
              },
            },
          },
        });

        // Group manually and calculate milestone completion
        // Total = TestRunCases count, Completed = TestRunResults with isCompleted=true
        const grouped = new Map<string, any>();
        milestones.forEach((milestone: any) => {
          const key = groupBy
            .map((field) => {
              if (field === "createdAt") {
                const date = new Date(milestone.createdAt);
                date.setUTCHours(0, 0, 0, 0);
                return date.toISOString();
              }
              if (field === "createdBy") {
                // Use the createdBy string ID, not the creator object
                return milestone.createdBy || "unknown";
              }
              return milestone[field] || "unknown";
            })
            .join("|");

          if (!grouped.has(key)) {
            const groupData: any = {};

            groupBy.forEach((field) => {
              if (field === "createdAt") {
                const date = new Date(milestone.createdAt);
                date.setUTCHours(0, 0, 0, 0);
                groupData.createdAt = date.toISOString();
              } else if (field === "id") {
                groupData.id = milestone.id;
              } else if (field === "createdBy") {
                groupData.createdBy = milestone.createdBy;
              } else if (field === "projectId") {
                groupData.projectId = milestone.projectId;
              }
            });

            grouped.set(key, {
              ...groupData,
              ...(groupBy.includes("projectId")
                ? { projectId: Number(projectId) }
                : {}),
              totalTestCases: 0,
              completedTestCases: 0,
            });
          }

          const group = grouped.get(key);

          // Count total test cases (from TestRunCases) and completed results
          milestone.testRuns.forEach((testRun: any) => {
            // Add total test cases from TestRunCases
            group.totalTestCases += testRun.testCases.length;

            // Count completed test results from TestRunResults
            testRun.results.forEach((result: any) => {
              if (result.status?.isCompleted === true) {
                group.completedTestCases++;
              }
            });
          });
        });

        return Array.from(grouped.values()).map((group: any) => {
          const milestoneCompletion =
            group.totalTestCases > 0
              ? Math.min(
                  (group.completedTestCases / group.totalTestCases) * 100,
                  100
                ) // Cap at 100%
              : 0;
          return {
            ...group,
            milestoneCompletion,
          };
        });
      }

      // Regular aggregation - calculate milestone completion
      // Total = TestRunCases count, Completed = TestRunResults with isCompleted=true
      const results = await prisma.milestones.groupBy({
        by: groupBy.filter(
          (field) => field !== "projectId" && field !== "createdBy"
        ),
        where: {
          projectId: Number(projectId),
          isDeleted: false,
        },
        _count: { _all: true },
      });

      const enrichedResults = await Promise.all(
        results.map(async (result: any) => {
          // Build where clause for milestones in this group
          const milestoneWhere: any = {
            projectId: Number(projectId),
            isDeleted: false,
          };

          if (result.id) {
            milestoneWhere.id = result.id;
          }

          if (result.createdAt) {
            const startOfDay = new Date(result.createdAt);
            startOfDay.setUTCHours(0, 0, 0, 0);
            const endOfDay = new Date(startOfDay);
            endOfDay.setUTCHours(23, 59, 59, 999);
            milestoneWhere.createdAt = {
              gte: startOfDay,
              lte: endOfDay,
            };
          }

          // Get total test cases (TestRunCases) in test runs for milestones in this group
          const totalTestCases = await prisma.testRunCases.count({
            where: {
              testRun: {
                milestone: milestoneWhere,
                isDeleted: false,
              },
            },
          });

          // Get completed test results (TestRunResults with isCompleted=true status)
          const testResultCounts = await prisma.testRunResults.groupBy({
            by: ["statusId"],
            where: {
              testRun: {
                milestone: milestoneWhere,
                isDeleted: false,
              },
              isDeleted: false,
            },
            _count: { _all: true },
          });

          // Get status information to check isCompleted flag
          const statusIds = testResultCounts
            .map((tr: any) => tr.statusId)
            .filter(Boolean);
          const statuses = await prisma.status.findMany({
            where: {
              id: { in: statusIds },
            },
            select: {
              id: true,
              isCompleted: true,
            },
          });

          const statusMap = new Map(
            statuses.map((s: any) => [s.id, s.isCompleted])
          );

          let completedTestCases = 0;

          testResultCounts.forEach((tr: any) => {
            const count = Number(tr._count._all);

            // Count only completed test results
            if (tr.statusId) {
              const isCompleted = statusMap.get(tr.statusId);
              if (isCompleted === true) {
                completedTestCases += count;
              }
            }
          });

          const milestoneCompletion =
            totalTestCases > 0
              ? Math.min((completedTestCases / totalTestCases) * 100, 100) // Cap at 100%
              : 0;

          return {
            ...result,
            ...(groupBy.includes("projectId")
              ? { projectId: Number(projectId) }
              : {}),
            milestoneCompletion,
          };
        })
      );

      return enrichedResults;
    },
  },

  totalMilestones: {
    id: "totalMilestones",
    label: "Total Milestones",
    aggregate: async (prisma, projectId, groupBy, filters, dims) => {
      const filteredGroupBy = groupBy.filter(
        (field) => field !== "projectId" && field !== "createdBy"
      );
      const needsManualAggregation =
        groupBy.some(
          (field) => field === "createdBy" || field === "createdAt"
        ) ||
        groupBy.length === 0 ||
        filteredGroupBy.length === 0;

      if (needsManualAggregation) {
        const milestones = await prisma.milestones.findMany({
          where: {
            projectId: Number(projectId),
            isDeleted: false,
          },
          include: {
            ...(groupBy.includes("createdBy") ? { creator: true } : {}),
          },
        });

        if (groupBy.length === 0) {
          return [
            {
              projectId: Number(projectId),
              totalMilestones: milestones.length,
            },
          ];
        }

        const grouped = new Map<string, any>();
        milestones.forEach((milestone: any) => {
          const key = groupBy
            .map((field) => {
              if (field === "createdAt") {
                const date = new Date(milestone.createdAt);
                date.setUTCHours(0, 0, 0, 0);
                return date.toISOString();
              }
              return milestone[field] || "unknown";
            })
            .join("|");

          if (!grouped.has(key)) {
            const groupData: any = {};

            groupBy.forEach((field) => {
              if (field === "createdAt") {
                const date = new Date(milestone.createdAt);
                date.setUTCHours(0, 0, 0, 0);
                groupData.createdAt = date.toISOString();
              } else if (field === "id") {
                groupData.id = milestone.id;
              } else if (field === "createdBy") {
                groupData.createdBy = milestone.createdBy;
              } else if (field === "projectId") {
                groupData.projectId = milestone.projectId;
              }
            });

            grouped.set(key, {
              ...groupData,
              ...(groupBy.includes("projectId")
                ? { projectId: Number(projectId) }
                : {}),
              totalMilestones: 0,
            });
          }

          grouped.get(key).totalMilestones++;
        });

        return Array.from(grouped.values());
      }

      // Regular groupBy
      return prisma.milestones
        .groupBy({
          by: groupBy.filter(
            (field) => field !== "projectId" && field !== "createdBy"
          ),
          where: {
            projectId: Number(projectId),
            isDeleted: false,
          },
          _count: { _all: true },
        })
        .then((results: any[]) =>
          results.map((r: any) => ({
            ...r,
            ...(groupBy.includes("projectId")
              ? { projectId: Number(projectId) }
              : {}),
            totalMilestones: r._count._all,
          }))
        );
    },
  },
  activeMilestones: {
    id: "activeMilestones",
    label: "Active Milestones",
    aggregate: async (prisma, projectId, groupBy, filters, dims) => {
      const filteredGroupBy = groupBy.filter(
        (field) => field !== "projectId" && field !== "createdBy"
      );
      const needsManualAggregation =
        groupBy.some(
          (field) => field === "createdBy" || field === "createdAt"
        ) ||
        groupBy.length === 0 ||
        filteredGroupBy.length === 0;

      if (needsManualAggregation) {
        const milestones = await prisma.milestones.findMany({
          where: {
            projectId: Number(projectId),
            isDeleted: false,
            isStarted: true,
            isCompleted: false,
          },
          include: {
            ...(groupBy.includes("createdBy") ? { creator: true } : {}),
          },
        });

        if (groupBy.length === 0) {
          return [
            {
              projectId: Number(projectId),
              activeMilestones: milestones.length,
            },
          ];
        }

        const grouped = new Map<string, any>();
        milestones.forEach((milestone: any) => {
          const key = groupBy
            .map((field) => {
              if (field === "createdAt") {
                const date = new Date(milestone.createdAt);
                date.setUTCHours(0, 0, 0, 0);
                return date.toISOString();
              }
              return milestone[field] || "unknown";
            })
            .join("|");

          if (!grouped.has(key)) {
            const groupData: any = {};

            groupBy.forEach((field) => {
              if (field === "createdAt") {
                const date = new Date(milestone.createdAt);
                date.setUTCHours(0, 0, 0, 0);
                groupData.createdAt = date.toISOString();
              } else if (field === "id") {
                groupData.id = milestone.id;
              } else if (field === "createdBy") {
                groupData.createdBy = milestone.createdBy;
              } else if (field === "projectId") {
                groupData.projectId = milestone.projectId;
              }
            });

            grouped.set(key, {
              ...groupData,
              ...(groupBy.includes("projectId")
                ? { projectId: Number(projectId) }
                : {}),
              activeMilestones: 0,
            });
          }

          grouped.get(key).activeMilestones++;
        });

        return Array.from(grouped.values());
      }

      // Regular groupBy
      return prisma.milestones
        .groupBy({
          by: groupBy.filter(
            (field) => field !== "projectId" && field !== "createdBy"
          ),
          where: {
            projectId: Number(projectId),
            isDeleted: false,
            isStarted: true,
            isCompleted: false,
          },
          _count: { _all: true },
        })
        .then((results: any[]) =>
          results.map((r: any) => ({
            ...r,
            ...(groupBy.includes("projectId")
              ? { projectId: Number(projectId) }
              : {}),
            activeMilestones: r._count._all,
          }))
        );
    },
  },
};

// Helper function to get cartesian product of arrays
function cartesianProduct(arrays: any[][]): any[][] {
  if (arrays.length === 0) return [[]];
  if (arrays.some((arr) => arr.length === 0)) return [];

  return arrays.reduce(
    (a, b) => {
      if (!Array.isArray(a)) a = [a];
      return a.flatMap((d) =>
        b.map((e) => (Array.isArray(d) ? [...d, e] : [d, e]))
      );
    },
    [[]]
  );
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const projectId = url.searchParams.get("projectId");

    if (!projectId) {
      return Response.json(
        { error: "Project ID is required" },
        { status: 400 }
      );
    }

    const dimensions = await Promise.all(
      Object.values(DIMENSION_REGISTRY).map(async (dim) => {
        const values = await dim.getValues(prisma, Number(projectId));
        return {
          id: dim.id,
          label: dim.label,
          values,
        };
      })
    );

    const metrics = Object.values(METRIC_REGISTRY).map((metric) => ({
      id: metric.id,
      label: metric.label,
    }));

    return Response.json({ dimensions, metrics });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { projectId, dimensions, metrics } = await req.json();

    if (!projectId || !dimensions || !metrics) {
      return Response.json(
        { error: "Project ID, dimensions, and metrics are required" },
        { status: 400 }
      );
    }

    // Validate dimensions
    const invalidDimensions = dimensions.filter(
      (dim: string) => !DIMENSION_REGISTRY[dim]
    );
    if (invalidDimensions.length > 0) {
      return Response.json(
        { error: `Unsupported dimension(s): ${invalidDimensions.join(", ")}` },
        { status: 400 }
      );
    }

    // Validate metrics
    if (!metrics || metrics.length === 0) {
      return Response.json(
        { error: "At least one metric must be specified" },
        { status: 400 }
      );
    }

    const invalidMetrics = metrics.filter(
      (metric: string) => !METRIC_REGISTRY[metric]
    );
    if (invalidMetrics.length > 0) {
      return Response.json(
        { error: `Unsupported metric(s): ${invalidMetrics.join(", ")}` },
        { status: 400 }
      );
    }

    // Create groupBy clause from dimensions
    const groupBy = dimensions.map(
      (dim: string) => DIMENSION_REGISTRY[dim].groupBy
    );

    // Get dimension values for joins
    const dimValues = await Promise.all(
      dimensions.map((dim: string) =>
        DIMENSION_REGISTRY[dim].getValues(prisma, Number(projectId))
      )
    );

    // Generate cartesian product of all dimension combinations
    const dimensionCombinations = cartesianProduct(dimValues);

    // Handle case where there are no dimension combinations
    if (dimensionCombinations.length === 0) {
      return Response.json({ results: [] });
    }

    // Build aggregations (following User Engagement pattern)
    const mergedResults: Record<string, any> = {};
    for (const metricKey of metrics) {
      const metricConfig = METRIC_REGISTRY[metricKey];
      if (metricConfig && metricConfig.aggregate) {
        const metricResults = await metricConfig.aggregate(
          prisma,
          Number(projectId),
          groupBy,
          {},
          dimensions
        );
        for (const row of metricResults) {
          const key = JSON.stringify(
            groupBy.map((field: string) => {
              const val = row[field];
              // Ensure consistent types - dates should be ISO strings, IDs should be numbers
              if (field === "createdAt" && val) {
                const date = new Date(val);
                date.setUTCHours(0, 0, 0, 0);
                return date.toISOString();
              }
              return Number(val);
            })
          );
          if (!mergedResults[key]) mergedResults[key] = { ...row };
          else Object.assign(mergedResults[key], row);
        }
      }
    }
    const aggregatedResults = Object.values(mergedResults);

    if (aggregatedResults.length === 0) {
      return Response.json({ results: [] });
    }

    // Build a lookup map from the aggregated results
    const resultMap = new Map();
    for (const row of aggregatedResults) {
      const key = JSON.stringify(
        groupBy.map((field: string) => {
          const val = (row as any)[field];
          // Ensure consistent types - dates should be ISO strings, IDs should be numbers
          if (field === "createdAt" && val) {
            const date = new Date(val);
            date.setUTCHours(0, 0, 0, 0);
            return date.toISOString();
          }
          // For createdBy field, keep as string; for numeric fields, convert to number
          if (field === "createdBy") {
            return val; // String ID
          }
          return Number(val);
        })
      );
      resultMap.set(key, row);
    }

    // For each dimension combination, build the output row
    const results = dimensionCombinations.map((combination) => {
      // Ensure combination is an array
      if (!Array.isArray(combination)) {
        combination = [combination];
      }

      // Create lookup key for this combination
      const key = JSON.stringify(
        combination.map((val: any, i: number) => {
          const dim = dimensions[i];
          if (dim === "date") {
            const date = new Date(val.createdAt);
            date.setUTCHours(0, 0, 0, 0);
            return date.toISOString();
          }
          // For creator dimension, keep ID as string; for others, convert to number
          if (dim === "creator") {
            return val.id; // String ID
          }
          // Ensure consistent number type for numeric IDs
          return Number(val.id);
        })
      );

      const row = resultMap.get(key);
      const out: any = {};

      // Add dimension display values
      combination.forEach((dimValue: any, index: number) => {
        const dimKey = dimensions[index];
        const dimConfig = DIMENSION_REGISTRY[dimKey];
        const display = dimConfig.display(dimValue);

        // Structure dimension data properly like User Engagement API
        if (dimKey === "milestone") {
          out.milestone = {
            name: display.name,
            id: display.id,
            isCompleted: display.isCompleted,
            isStarted: display.isStarted,
            milestoneType: display.milestoneType,
          };
        } else if (dimKey === "creator") {
          out.creator = {
            name: display.name,
            id: display.id.toString(),
            email: display.email,
          };
        } else if (dimKey === "date") {
          out.date = {
            createdAt: display.createdAt,
          };
        } else {
          // Fallback for other dimensions
          out[dimKey] = display;
        }
      });

      // Add metrics
      for (const metricKey of metrics) {
        const metricConfig = METRIC_REGISTRY[metricKey];
        if (row) {
          out[metricConfig.label] = row[metricKey] ?? 0;
        } else {
          out[metricConfig.label] = 0;
        }
      }

      return out;
    });

    // Filter out zero values for count metrics but keep them for percentage metrics
    const metricLabels = metrics.map((m: string) => METRIC_REGISTRY[m].label);
    const filteredResults = results.filter((result) => {
      const hasNonZeroCountMetric = metricLabels.some((label: string) => {
        const value = result[label];
        // For percentage metrics (containing %), keep zero values (0% is valid)
        if (label.includes("(%)")) {
          return value !== undefined && value !== null;
        }
        // For count metrics, filter out zero values (0 milestones means no data)
        return value !== undefined && value !== null && value !== 0;
      });
      return hasNonZeroCountMetric;
    });

    // Sort results by Activity Date if date dimension is used
    if (dimensions.includes("date")) {
      filteredResults.sort((a: any, b: any) => {
        const dateA = a.date?.createdAt;
        const dateB = b.date?.createdAt;

        if (!dateA && !dateB) return 0;
        if (!dateA) return 1;
        if (!dateB) return -1;

        return new Date(dateA).getTime() - new Date(dateB).getTime();
      });
    }

    return Response.json({ results: filteredResults });
  } catch (e: any) {
    console.error("Project Health API Error:", e);
    return Response.json({ error: e.message }, { status: 500 });
  }
}
