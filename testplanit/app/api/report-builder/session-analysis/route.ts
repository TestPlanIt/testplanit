import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildDateFilter } from "@/utils/reportUtils";

// Note: Session analysis uses custom session-specific logic
// This handles unique session dimensions like assignedTo, template, state, etc.
// Could be a candidate for shared session analysis utilities in reportUtils.ts

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
  session: {
    id: "session",
    label: "Session",
    getValues: async (prisma: any, projectId: number) =>
      await prisma.sessions.findMany({
        where: {
          projectId: Number(projectId),
          isDeleted: false,
        },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
    groupBy: "id",
    join: { session: true },
    display: (val: any) => ({ name: val.name, id: val.id }),
  },
  assignedTo: {
    id: "assignedTo",
    label: "Assigned To",
    getValues: async (prisma: any, projectId: number) => {
      const assignees = await prisma.sessions.findMany({
        where: {
          projectId: Number(projectId),
          isDeleted: false,
          assignedTo: { isNot: null },
        },
        select: {
          assignedTo: {
            select: { id: true, name: true, email: true },
          },
        },
        distinct: ["assignedToId"],
      });
      return assignees.map((a: any) => a.assignedTo).filter((a: any) => a);
    },
    groupBy: "assignedToId",
    join: { assignedTo: true },
    display: (val: any) => ({
      name: val.name,
      id: val.id,
      email: val.email,
    }),
  },
  milestone: {
    id: "milestone",
    label: "Milestone",
    getValues: async (prisma: any, projectId: number) => {
      const milestones = await prisma.sessions.findMany({
        where: {
          projectId: Number(projectId),
          isDeleted: false,
          milestone: { isNot: null },
        },
        select: {
          milestone: {
            select: {
              id: true,
              name: true,
              milestoneType: {
                select: {
                  icon: {
                    select: { name: true },
                  },
                },
              },
            },
          },
        },
        distinct: ["milestoneId"],
      });
      return milestones.map((m: any) => m.milestone).filter((m: any) => m);
    },
    groupBy: "milestoneId",
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
      icon: val.milestoneType?.icon?.name,
    }),
  },
  template: {
    id: "template",
    label: "Template",
    getValues: async (prisma: any, projectId: number) => {
      const templates = await prisma.sessions.findMany({
        where: {
          projectId: Number(projectId),
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
          id: t.template.id,
          name: t.template.templateName,
        }))
        .filter((t: any) => t.name);
    },
    groupBy: "templateId",
    join: { template: true },
    display: (val: any) => ({ name: val.name, id: val.id }),
  },
  state: {
    id: "state",
    label: "State",
    getValues: async (prisma: any, projectId: number) => {
      const states = await prisma.sessions.findMany({
        where: {
          projectId: Number(projectId),
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
  creator: {
    id: "creator",
    label: "Creator",
    getValues: async (prisma: any, projectId: number) => {
      const creators = await prisma.sessions.findMany({
        where: {
          projectId: Number(projectId),
          isDeleted: false,
        },
        select: {
          createdBy: {
            select: { id: true, name: true, email: true },
          },
        },
        distinct: ["createdById"],
      });
      return creators.map((c: any) => c.createdBy).filter((c: any) => c);
    },
    groupBy: "createdById",
    join: { createdBy: true },
    display: (val: any) => ({
      name: val.name,
      id: val.id,
      email: val.email,
    }),
  },
  date: {
    id: "date",
    label: "Creation Date",
    getValues: async (prisma: any, projectId: number) => {
      const dates = await prisma.sessions.findMany({
        where: {
          projectId: Number(projectId),
          isDeleted: false,
        },
        select: { createdAt: true },
        distinct: ["createdAt"],
        orderBy: { createdAt: "asc" },
      });
      // Group dates by day
      const datesByDay = dates.reduce((acc: any, curr: any) => {
        const day = new Date(curr.createdAt);
        day.setUTCHours(0, 0, 0, 0);
        const dayStr = day.toISOString();
        if (!acc[dayStr]) {
          acc[dayStr] = day.toISOString();
        }
        return acc;
      }, {});
      return Object.values(datesByDay).map((d: any) => ({ createdAt: d }));
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
  sessionCount: {
    id: "sessionCount",
    label: "Session Count",
    aggregate: async (prisma, projectId, groupBy, filters, dims) => {
      // Handle date grouping or assignedToId grouping specially (need to include related data)
      if (groupBy.includes("createdAt") || groupBy.includes("assignedToId")) {
        const sessions = await prisma.sessions.findMany({
          where: {
            projectId: Number(projectId),
            isDeleted: false,
            ...buildDateFilter(filters, "createdAt"),
          },
          include: {
            ...(groupBy.includes("id") ? {} : {}),
            ...(groupBy.includes("assignedToId") ? { assignedTo: true } : {}),
            ...(groupBy.includes("milestoneId")
              ? {
                  milestone: {
                    include: {
                      milestoneType: {
                        include: { icon: true },
                      },
                    },
                  },
                }
              : {}),
            ...(groupBy.includes("templateId") ? { template: true } : {}),
            ...(groupBy.includes("stateId")
              ? {
                  state: {
                    include: {
                      icon: true,
                      color: true,
                    },
                  },
                }
              : {}),
            ...(groupBy.includes("createdById") ? { createdBy: true } : {}),
          },
        });

        // Group manually by date and other dimensions
        const grouped = new Map<string, any>();
        sessions.forEach((session: any) => {
          const key = groupBy
            .map((field) => {
              if (field === "createdAt") {
                const date = new Date(session.createdAt);
                date.setUTCHours(0, 0, 0, 0);
                return date.toISOString();
              }
              return session[field] || "unknown";
            })
            .join("|");

          if (!grouped.has(key)) {
            const groupData: any = {};
            groupBy.forEach((field) => {
              if (field === "createdAt") {
                const date = new Date(session.createdAt);
                date.setUTCHours(0, 0, 0, 0);
                groupData.createdAt = date.toISOString();
              } else if (field === "id") {
                groupData.id = session.id;
              } else if (field === "assignedToId") {
                groupData.assignedToId = session.assignedToId;
                // Also include the assignedTo user object if available
                if (session.assignedTo) {
                  groupData.assignedTo = session.assignedTo;
                }
              } else if (field === "milestoneId") {
                groupData.milestoneId = session.milestoneId;
              } else if (field === "templateId") {
                groupData.templateId = session.templateId;
              } else if (field === "stateId") {
                groupData.stateId = session.stateId;
              } else if (field === "createdById") {
                groupData.createdById = session.createdById;
              }
            });

            groupData.sessionCount = 0;
            grouped.set(key, groupData);
          }

          grouped.get(key).sessionCount++;
        });

        return Array.from(grouped.values());
      } else {
        // Use database aggregation for non-date grouping
        const results = await prisma.sessions.groupBy({
          where: {
            projectId: Number(projectId),
            isDeleted: false,
            ...buildDateFilter(filters, "createdAt"),
          },
          by: groupBy as any,
          _count: { id: true },
        });

        return results.map((result: any) => ({
          ...result,
          sessionCount: result._count.id,
        }));
      }
    },
  },
  activeSessions: {
    id: "activeSessions",
    label: "Active Sessions",
    aggregate: async (prisma, projectId, groupBy, filters, dims) => {
      // Always use manual aggregation since we need to count boolean values
      // which cannot be aggregated with _sum in Prisma
      // Manual aggregation - get all sessions and group manually
      const sessions = await prisma.sessions.findMany({
        where: {
          projectId: Number(projectId),
          isDeleted: false,
          ...buildDateFilter(filters, "createdAt"),
        },
        include: {
          ...(groupBy.includes("id") ? {} : {}),
          ...(groupBy.includes("assignedToId") ? { assignedTo: true } : {}),
          ...(groupBy.includes("milestoneId")
            ? {
                milestone: {
                  include: {
                    milestoneType: {
                      include: { icon: true },
                    },
                  },
                },
              }
            : {}),
          ...(groupBy.includes("templateId") ? { template: true } : {}),
          ...(groupBy.includes("stateId")
            ? {
                state: {
                  include: {
                    icon: true,
                    color: true,
                  },
                },
              }
            : {}),
          ...(groupBy.includes("createdById") ? { createdBy: true } : {}),
        },
      });

      // Group manually
      const grouped = new Map<string, any>();
      sessions.forEach((session: any) => {
        const key = groupBy
          .map((field) => {
            if (field === "createdAt") {
              const date = new Date(session.createdAt);
              date.setUTCHours(0, 0, 0, 0);
              return date.toISOString();
            }
            return session[field] || "unknown";
          })
          .join("|");

        if (!grouped.has(key)) {
          const groupData: any = {};

          groupBy.forEach((field) => {
            if (field === "createdAt") {
              const date = new Date(session.createdAt);
              date.setUTCHours(0, 0, 0, 0);
              groupData.createdAt = date.toISOString();
            } else if (field === "id") {
              groupData.id = session.id;
            } else if (field === "assignedToId") {
              groupData.assignedToId = session.assignedToId;
            } else if (field === "milestoneId") {
              groupData.milestoneId = session.milestoneId;
            } else if (field === "templateId") {
              groupData.templateId = session.templateId;
            } else if (field === "stateId") {
              groupData.stateId = session.stateId;
            } else if (field === "createdById") {
              groupData.createdById = session.createdById;
            }
          });

          groupData.activeSessions = 0;
          grouped.set(key, groupData);
        }

        const group = grouped.get(key);
        // Count active sessions (isActive = true)
        if (session.isActive) {
          group.activeSessions++;
        }
      });

      return Array.from(grouped.values()).map((group: any) => ({
        ...group,
        activeSessions: group.activeSessions,
      }));
    },
  },
  averageDuration: {
    id: "averageDuration",
    label: "Average Duration",
    aggregate: async (prisma, projectId, groupBy, filters, dims) => {
      // Handle manual aggregation for complex grouping
      const needsManualAggregation =
        groupBy.some(
          (field) => field === "createdById" || field === "createdAt" || field === "assignedToId"
        ) || groupBy.length === 0;

      if (needsManualAggregation) {
        const sessions = await prisma.sessions.findMany({
          where: {
            projectId: Number(projectId),
            isDeleted: false,
            elapsed: { not: null },
            ...buildDateFilter(filters, "createdAt"),
          },
          include: {
            ...(groupBy.includes("id") ? {} : {}),
            ...(groupBy.includes("assignedToId") ? { assignedTo: true } : {}),
            ...(groupBy.includes("milestoneId")
              ? {
                  milestone: {
                    include: {
                      milestoneType: {
                        include: { icon: true },
                      },
                    },
                  },
                }
              : {}),
            ...(groupBy.includes("templateId") ? { template: true } : {}),
            ...(groupBy.includes("stateId")
              ? {
                  state: {
                    include: {
                      icon: true,
                      color: true,
                    },
                  },
                }
              : {}),
            ...(groupBy.includes("createdById") ? { createdBy: true } : {}),
          },
        });

        // Group manually
        const grouped = new Map<string, any>();
        sessions.forEach((session: any) => {
          const key = groupBy
            .map((field) => {
              if (field === "createdAt") {
                const date = new Date(session.createdAt);
                date.setUTCHours(0, 0, 0, 0);
                return date.toISOString();
              }
              return session[field] || "unknown";
            })
            .join("|");

          if (!grouped.has(key)) {
            const groupData: any = {};

            groupBy.forEach((field) => {
              if (field === "createdAt") {
                const date = new Date(session.createdAt);
                date.setUTCHours(0, 0, 0, 0);
                groupData.createdAt = date.toISOString();
              } else if (field === "id") {
                groupData.id = session.id;
              } else if (field === "assignedToId") {
                groupData.assignedToId = session.assignedToId;
                // Also include the assignedTo user object if available
                if (session.assignedTo) {
                  groupData.assignedTo = session.assignedTo;
                }
              } else if (field === "milestoneId") {
                groupData.milestoneId = session.milestoneId;
              } else if (field === "templateId") {
                groupData.templateId = session.templateId;
              } else if (field === "stateId") {
                groupData.stateId = session.stateId;
              } else if (field === "createdById") {
                groupData.createdById = session.createdById;
              }
            });

            groupData.totalDuration = 0;
            groupData.sessionCount = 0;
            grouped.set(key, groupData);
          }

          const group = grouped.get(key);
          if (session.elapsed) {
            group.totalDuration += session.elapsed;
            group.sessionCount++;
          }
        });

        return Array.from(grouped.values()).map((group: any) => ({
          ...group,
          averageDuration:
            group.sessionCount > 0
              ? Math.round((group.totalDuration / group.sessionCount) * 1000) // Convert seconds to milliseconds
              : 0,
        }));
      } else {
        // Use database aggregation
        const results = await prisma.sessions.groupBy({
          where: {
            projectId: Number(projectId),
            isDeleted: false,
            elapsed: { not: null },
            ...buildDateFilter(filters, "createdAt"),
          },
          by: groupBy as any,
          _avg: { elapsed: true },
        });

        return results.map((result: any) => ({
          ...result,
          averageDuration: result._avg.elapsed
            ? Math.round(result._avg.elapsed * 1000) // Convert seconds to milliseconds
            : 0,
        }));
      }
    },
  },
  totalDuration: {
    id: "totalDuration",
    label: "Total Duration",
    aggregate: async (prisma, projectId, groupBy, filters, dims) => {
      // Handle manual aggregation for complex grouping
      const needsManualAggregation =
        groupBy.some(
          (field) => field === "createdById" || field === "createdAt" || field === "assignedToId"
        ) || groupBy.length === 0;

      if (needsManualAggregation) {
        const sessions = await prisma.sessions.findMany({
          where: {
            projectId: Number(projectId),
            isDeleted: false,
            elapsed: { not: null },
            ...buildDateFilter(filters, "createdAt"),
          },
          include: {
            ...(groupBy.includes("id") ? {} : {}),
            ...(groupBy.includes("assignedToId") ? { assignedTo: true } : {}),
            ...(groupBy.includes("milestoneId")
              ? {
                  milestone: {
                    include: {
                      milestoneType: {
                        include: { icon: true },
                      },
                    },
                  },
                }
              : {}),
            ...(groupBy.includes("templateId") ? { template: true } : {}),
            ...(groupBy.includes("stateId")
              ? {
                  state: {
                    include: {
                      icon: true,
                      color: true,
                    },
                  },
                }
              : {}),
            ...(groupBy.includes("createdById") ? { createdBy: true } : {}),
          },
        });

        // Group manually
        const grouped = new Map<string, any>();
        sessions.forEach((session: any) => {
          const key = groupBy
            .map((field) => {
              if (field === "createdAt") {
                const date = new Date(session.createdAt);
                date.setUTCHours(0, 0, 0, 0);
                return date.toISOString();
              }
              return session[field] || "unknown";
            })
            .join("|");

          if (!grouped.has(key)) {
            const groupData: any = {};

            groupBy.forEach((field) => {
              if (field === "createdAt") {
                const date = new Date(session.createdAt);
                date.setUTCHours(0, 0, 0, 0);
                groupData.createdAt = date.toISOString();
              } else if (field === "id") {
                groupData.id = session.id;
              } else if (field === "assignedToId") {
                groupData.assignedToId = session.assignedToId;
                // Also include the assignedTo user object if available
                if (session.assignedTo) {
                  groupData.assignedTo = session.assignedTo;
                }
              } else if (field === "milestoneId") {
                groupData.milestoneId = session.milestoneId;
              } else if (field === "templateId") {
                groupData.templateId = session.templateId;
              } else if (field === "stateId") {
                groupData.stateId = session.stateId;
              } else if (field === "createdById") {
                groupData.createdById = session.createdById;
              }
            });

            groupData.totalDuration = 0;
            grouped.set(key, groupData);
          }

          const group = grouped.get(key);
          if (session.elapsed) {
            group.totalDuration += session.elapsed;
          }
        });

        return Array.from(grouped.values()).map((group: any) => ({
          ...group,
          totalDuration: group.totalDuration * 1000, // Convert seconds to milliseconds
        }));
      } else {
        // Use database aggregation
        const results = await prisma.sessions.groupBy({
          where: {
            projectId: Number(projectId),
            isDeleted: false,
            elapsed: { not: null },
            ...buildDateFilter(filters, "createdAt"),
          },
          by: groupBy as any,
          _sum: { elapsed: true },
        });

        return results.map((result: any) => ({
          ...result,
          totalDuration: (result._sum.elapsed || 0) * 1000, // Convert seconds to milliseconds
        }));
      }
    },
  },
};

// Cartesian product utility function
function cartesianProduct(arrays: any[][]): any[][] {
  return arrays.reduce(
    (acc, curr) => {
      return acc.flatMap((d) => curr.map((e) => [...d, e]));
    },
    [[]] as any[][]
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

    // Get dimensions with actual values
    const dimensions = await Promise.all(
      Object.values(DIMENSION_REGISTRY).map(async (dim) => ({
        id: dim.id,
        label: dim.label,
        values: await dim.getValues(prisma, Number(projectId)),
      }))
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
    const { projectId, dimensions, metrics, startDate, endDate } = await req.json();

    if (!projectId) {
      return Response.json(
        { error: "Project ID is required" },
        { status: 400 }
      );
    }

    if (
      !dimensions ||
      !metrics ||
      dimensions.length === 0 ||
      metrics.length === 0
    ) {
      return Response.json(
        { error: "At least one dimension and one metric are required" },
        { status: 400 }
      );
    }

    // Validate dimensions
    for (const dimId of dimensions) {
      if (!DIMENSION_REGISTRY[dimId]) {
        return Response.json(
          { error: `Unsupported dimension: ${dimId}` },
          { status: 400 }
        );
      }
    }

    // Validate metrics
    for (const metricId of metrics) {
      if (!METRIC_REGISTRY[metricId]) {
        return Response.json(
          { error: `Unsupported metric: ${metricId}` },
          { status: 400 }
        );
      }
    }

    // Get dimension configurations
    const dimensionConfigs = dimensions.map((dimId: string) => {
      const config = DIMENSION_REGISTRY[dimId];
      return config;
    });

    const metricConfigs = metrics.map((metricId: string) => {
      const config = METRIC_REGISTRY[metricId];
      return config;
    });

    // Get group by fields
    const groupBy = dimensionConfigs.map((config: any) => config.groupBy);

    // Aggregate all metrics using the same groupBy - this ensures we only get combinations that actually exist
    const metricResults = await Promise.all(
      metricConfigs.map((metricConfig: any) =>
        metricConfig.aggregate(
          prisma,
          Number(projectId),
          groupBy,
          { startDate, endDate },
          dimensions
        )
      )
    );

    // Get all dimension values lookup for display formatting
    const dimensionValues = await Promise.all(
      dimensionConfigs.map((config: any) =>
        config.getValues(prisma, Number(projectId))
      )
    );

    // Create lookup maps for dimension values
    const dimensionLookups = dimensionConfigs.map(
      (config: any, index: number) => {
        const values = dimensionValues[index];
        const lookup = new Map();
        values.forEach((value: any) => {
          const key = config.groupBy.endsWith("Id")
            ? value.id
            : value[config.groupBy] || value.id;
          lookup.set(key, value);
        });
        return lookup;
      }
    );

    // Merge results from all metrics based on matching keys
    const resultMap = new Map<string, any>();

    // Process each metric's results
    metricResults.forEach((currentMetricResults, metricIndex) => {
      const metricConfig = metricConfigs[metricIndex];

      currentMetricResults.forEach((result: any) => {
        // Create a key for this result
        const resultKey = dimensionConfigs
          .map((config: any) => {
            if (config.groupBy === "createdAt") {
              const date = new Date(result.createdAt);
              date.setUTCHours(0, 0, 0, 0);
              return date.toISOString();
            }
            return result[config.groupBy] ?? "unknown";
          })
          .join("|");

        // Get or create the row for this key
        if (!resultMap.has(resultKey)) {
          const row: any = {};

          // Add dimension values with display formatting
          dimensionConfigs.forEach((config: any, dimIndex: number) => {
            const dimValue = result[config.groupBy];
            const lookup = dimensionLookups[dimIndex];
            const fullDimValue = lookup.get(dimValue);

            if (fullDimValue) {
              row[config.id] = config.display(fullDimValue);
            } else if (config.groupBy === "createdAt") {
              const date = new Date(result.createdAt);
              date.setUTCHours(0, 0, 0, 0);
              row[config.id] = config.display({
                createdAt: date.toISOString(),
              });
            } else if (dimValue === null || dimValue === undefined) {
              // Handle null/undefined values
              row[config.id] = { name: "None", id: null };
            } else {
              // Special handling for assignedTo dimension - check if assignedTo data is in result
              if (config.id === "assignedTo" && result.assignedTo) {
                const displayValue = config.display(result.assignedTo);
                row[config.id] = displayValue;
              } else {
                // Handle other unknown values
                row[config.id] = { name: "Unknown", id: dimValue };
              }
            }
          });

          resultMap.set(resultKey, row);
        }

        // Add the metric value to the row
        const row = resultMap.get(resultKey);
        row[metricConfig.label] = result[metricConfig.id];
      });
    });

    // Convert result map to array
    const results = Array.from(resultMap.values());

    // Sort results by Creation Date if date dimension is used
    if (dimensions.includes("date")) {
      results.sort((a: any, b: any) => {
        const dateA = a.date?.createdAt;
        const dateB = b.date?.createdAt;

        if (!dateA && !dateB) return 0;
        if (!dateA) return 1;
        if (!dateB) return -1;

        return new Date(dateA).getTime() - new Date(dateB).getTime();
      });
    }

    return Response.json({ results });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
