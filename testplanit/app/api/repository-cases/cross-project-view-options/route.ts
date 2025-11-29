import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";
import { prisma } from "@/lib/prisma"; // Use raw prisma client (no enhance) for cross-project admin queries
import { Prisma } from "@prisma/client";

interface RequestBody {
  // Filter parameters for automation trends
  projectIds?: number[];
  templateIds?: number[];
  stateIds?: number[];
  automated?: number[];
  dynamicFieldFilters?: Record<number, (string | number)[]>;
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Require admin access for cross-project
  if (session.user.access !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body: RequestBody = await request.json();
    const {
      projectIds,
      templateIds,
      stateIds,
      automated: automatedFilter,
      dynamicFieldFilters,
    } = body;

    // Build base where clause for all projects
    const baseWhere: any = {
      isDeleted: false,
    };

    // Add projectIds filter if provided
    if (projectIds && projectIds.length > 0) {
      baseWhere.projectId = { in: projectIds };
    }

    // Add templateIds filter if provided
    if (templateIds && templateIds.length > 0) {
      baseWhere.templateId = { in: templateIds };
    }

    // Add stateIds filter if provided
    if (stateIds && stateIds.length > 0) {
      baseWhere.stateId = { in: stateIds };
    }

    // Add automated filter if provided
    if (automatedFilter && automatedFilter.length > 0) {
      const automatedBools = automatedFilter.map((v) => v === 1);
      if (automatedBools.length === 1) {
        baseWhere.automated = automatedBools[0];
      }
      // If both are selected, don't add a filter (show all)
    }

    // Save baseWhere BEFORE applying dynamic field filters
    const baseWhereWithoutDynamicFilters = JSON.parse(JSON.stringify(baseWhere));

    // Apply dynamic field filters (custom fields)
    let dynamicFieldFilteredCaseIds: number[] | null = null;

    if (dynamicFieldFilters && Object.keys(dynamicFieldFilters).length > 0) {
      // For each field filter, get the case IDs that match
      const fieldFilterPromises = Object.entries(dynamicFieldFilters).map(
        async ([fieldIdStr, values]) => {
          const fieldId = parseInt(fieldIdStr);
          if (isNaN(fieldId) || !values || values.length === 0) return null;

          // Build SQL WHERE conditions from baseWhere to avoid bind variable limit
          const whereClauses: string[] = [];
          const params: any[] = [];
          let paramIndex = 1;

          // Add isDeleted filter
          if (baseWhere.isDeleted !== undefined) {
            whereClauses.push(`rc."isDeleted" = $${paramIndex}`);
            params.push(baseWhere.isDeleted);
            paramIndex++;
          }

          // Add projectId filter
          if (baseWhere.projectId?.in) {
            const projectIds = baseWhere.projectId.in;
            whereClauses.push(`rc."projectId" = ANY($${paramIndex}::int[])`);
            params.push(projectIds);
            paramIndex++;
          }

          // Add templateId filter
          if (baseWhere.templateId?.in) {
            const templateIds = baseWhere.templateId.in;
            whereClauses.push(`rc."templateId" = ANY($${paramIndex}::int[])`);
            params.push(templateIds);
            paramIndex++;
          }

          // Add stateId filter
          if (baseWhere.stateId?.in) {
            const stateIds = baseWhere.stateId.in;
            whereClauses.push(`rc."stateId" = ANY($${paramIndex}::int[])`);
            params.push(stateIds);
            paramIndex++;
          }

          // Add automated filter
          if (baseWhere.automated !== undefined) {
            whereClauses.push(`rc."automated" = $${paramIndex}`);
            params.push(baseWhere.automated);
            paramIndex++;
          }

          const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

          // Use raw SQL with subquery to avoid bind variable limit
          const caseFieldValues = await prisma.$queryRawUnsafe<Array<{ testCaseId: number; value: any }>>(
            `
            SELECT cfv."testCaseId", cfv."value"
            FROM "CaseFieldValues" cfv
            WHERE cfv."fieldId" = $${paramIndex}
              AND cfv."value" IS NOT NULL
              AND cfv."testCaseId" IN (
                SELECT rc."id"
                FROM "RepositoryCases" rc
                ${whereClause}
              )
            `,
            ...params,
            fieldId
          );

          // Filter in JavaScript since JSON fields don't support 'in' operator
          const filteredCaseIds = caseFieldValues
            .filter((cfv) => {
              if (cfv.value === null || cfv.value === undefined) return false;

              const value = cfv.value;

              // Handle both single values and arrays (for multi-select)
              if (Array.isArray(value)) {
                // Multi-select: check if any selected value is in the array
                return values.some((v) => value.includes(v));
              } else {
                // Single value: check if it matches any selected value
                return values.includes(value as string | number);
              }
            })
            .map((cfv) => cfv.testCaseId);

          return new Set(filteredCaseIds);
        }
      );

      const fieldFilterResults = await Promise.all(fieldFilterPromises);

      // Intersect all the case ID sets (must match ALL filters)
      const validResults = fieldFilterResults.filter(
        (result): result is Set<number> => result !== null
      );

      if (validResults.length > 0) {
        // Start with the first set
        let intersectedIds = validResults[0];

        // Intersect with all other sets
        for (let i = 1; i < validResults.length; i++) {
          intersectedIds = new Set(
            [...intersectedIds].filter((id) => validResults[i].has(id))
          );
        }

        dynamicFieldFilteredCaseIds = Array.from(intersectedIds);

        // If no cases match all filters, return early with empty results
        if (dynamicFieldFilteredCaseIds.length === 0) {
          baseWhere.id = { in: [] };
        } else {
          baseWhere.id = { in: dynamicFieldFilteredCaseIds };
        }
      }
    }

    // For projects aggregation, we need to use a WHERE clause that excludes projectId filter
    // so that all projects remain available for selection even when filtering by project
    const baseWhereWithoutProjectFilter = { ...baseWhere };
    delete baseWhereWithoutProjectFilter.projectId;

    // Execute all aggregation queries in parallel across all projects
    const [projects, templates, states, automatedCounts, dynamicFieldInfo] =
      await Promise.all([
        // Projects aggregation - exclude projectId filter so all projects remain selectable
        prisma.repositoryCases.groupBy({
          by: ["projectId"],
          where: baseWhereWithoutProjectFilter,
          _count: true,
        }),
        // Templates aggregation
        prisma.repositoryCases.groupBy({
          by: ["templateId"],
          where: baseWhere,
          _count: true,
        }),
        // States aggregation
        prisma.repositoryCases.groupBy({
          by: ["stateId"],
          where: baseWhere,
          _count: true,
        }),
        // Automated aggregation
        prisma.repositoryCases.groupBy({
          by: ["automated"],
          where: baseWhere,
          _count: true,
        }),
        // Get all templates across all projects with their field configurations
        prisma.templates.findMany({
          where: {
            isDeleted: false,
          },
          select: {
            id: true,
            templateName: true,
            projects: {
              select: {
                projectId: true,
              },
            },
            caseFields: {
              where: {
                caseField: {
                  isEnabled: true,
                  isDeleted: false,
                },
              },
              select: {
                caseField: {
                  select: {
                    id: true,
                    displayName: true,
                    type: {
                      select: {
                        type: true,
                      },
                    },
                    fieldOptions: {
                      select: {
                        fieldOption: {
                          select: {
                            id: true,
                            name: true,
                            order: true,
                            icon: {
                              select: {
                                name: true,
                              },
                            },
                            iconColor: {
                              select: {
                                value: true,
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        }),
      ]);

    // Get project details (exclude deleted projects)
    const projectIds_result = projects.map((p) => p.projectId);
    const projectDetails = await prisma.projects.findMany({
      where: { id: { in: projectIds_result }, isDeleted: false },
      select: { id: true, name: true },
    });

    const projectsWithCounts = projects
      .map((p) => {
        const project = projectDetails.find((pd) => pd.id === p.projectId);
        // Only include projects that exist and are not deleted
        if (!project) return null;
        return {
          id: p.projectId,
          name: project.name,
          count: p._count,
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);

    // Get template details
    const templateIds_result = templates.map((t) => t.templateId);
    const templateDetails = await prisma.templates.findMany({
      where: { id: { in: templateIds_result } },
      select: { id: true, templateName: true },
    });

    const templatesWithCounts = templates.map((t) => {
      const template = templateDetails.find((td) => td.id === t.templateId);
      return {
        id: t.templateId,
        name: template?.templateName || "Unknown",
        count: t._count,
      };
    });

    // Get state details
    const stateIds_result = states.map((s) => s.stateId);
    const stateDetails = await prisma.workflows.findMany({
      where: { id: { in: stateIds_result } },
      select: {
        id: true,
        name: true,
        icon: { select: { name: true } },
        color: { select: { value: true } },
      },
    });

    const statesWithCounts = states.map((s) => {
      const state = stateDetails.find((sd) => sd.id === s.stateId);
      return {
        id: s.stateId,
        name: state?.name || "Unknown",
        icon: state?.icon,
        iconColor: state?.color,
        count: s._count,
      };
    });

    // Build automated counts
    const automatedWithCounts = automatedCounts.map((a) => ({
      value: a.automated,
      count: a._count,
    }));

    // Build dynamic fields map across all projects
    const dynamicFieldsMap = new Map<
      number,
      {
        fieldId: number;
        displayName: string;
        type: string;
        options?: Array<{
          id: number;
          name: string;
          order: number;
          icon?: { name: string } | null;
          iconColor?: { value: string } | null;
        }>;
      }
    >();

    dynamicFieldInfo.forEach((template) => {
      template.caseFields.forEach((cf) => {
        const field = cf.caseField;
        const fieldType = field.type.type;

        // Only include Dropdown and Multi-Select fields
        if (
          (fieldType === "Dropdown" || fieldType === "Multi-Select") &&
          field.fieldOptions
        ) {
          if (!dynamicFieldsMap.has(field.id)) {
            dynamicFieldsMap.set(field.id, {
              fieldId: field.id,
              displayName: field.displayName,
              type: fieldType,
              options:
                fieldType === "Dropdown" || fieldType === "Multi-Select"
                  ? field.fieldOptions
                      .map((fo) => ({
                        id: fo.fieldOption.id,
                        name: fo.fieldOption.name,
                        order: fo.fieldOption.order,
                        icon: fo.fieldOption.icon,
                        iconColor: fo.fieldOption.iconColor,
                      }))
                      .sort((a, b) => a.order - b.order)
                  : undefined,
            });
          }
        }
      });
    });

    // For dynamic field options with counts, query across all projects
    const dynamicFields: Record<
      string,
      {
        type: string;
        fieldId: number;
        options?: Array<{
          id: number;
          name: string;
          order: number;
          icon?: { name: string } | null;
          iconColor?: { value: string } | null;
          count?: number;
        }>;
      }
    > = {};

    // For cross-project queries with potentially thousands of cases, we need to avoid
    // the bind variable limit. Instead of fetching all case IDs and using IN clause,
    // we'll use a raw SQL query with a subquery to efficiently count field values.

    for (const [fieldId, fieldInfo] of dynamicFieldsMap) {
      if (fieldInfo.options) {
        // Build SQL WHERE conditions from baseWhereWithoutDynamicFilters
        const whereClauses: string[] = [];
        const params: any[] = [];
        let paramIndex = 1;

        // Add isDeleted filter
        if (baseWhereWithoutDynamicFilters.isDeleted !== undefined) {
          whereClauses.push(`rc."isDeleted" = $${paramIndex}`);
          params.push(baseWhereWithoutDynamicFilters.isDeleted);
          paramIndex++;
        }

        // Add projectId filter
        if (baseWhereWithoutDynamicFilters.projectId?.in) {
          const projectIds = baseWhereWithoutDynamicFilters.projectId.in;
          whereClauses.push(`rc."projectId" = ANY($${paramIndex}::int[])`);
          params.push(projectIds);
          paramIndex++;
        }

        // Add templateId filter
        if (baseWhereWithoutDynamicFilters.templateId?.in) {
          const templateIds = baseWhereWithoutDynamicFilters.templateId.in;
          whereClauses.push(`rc."templateId" = ANY($${paramIndex}::int[])`);
          params.push(templateIds);
          paramIndex++;
        }

        // Add stateId filter
        if (baseWhereWithoutDynamicFilters.stateId?.in) {
          const stateIds = baseWhereWithoutDynamicFilters.stateId.in;
          whereClauses.push(`rc."stateId" = ANY($${paramIndex}::int[])`);
          params.push(stateIds);
          paramIndex++;
        }

        // Add automated filter
        if (baseWhereWithoutDynamicFilters.automated !== undefined) {
          whereClauses.push(`rc."automated" = $${paramIndex}`);
          params.push(baseWhereWithoutDynamicFilters.automated);
          paramIndex++;
        }

        const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        // Use raw SQL with subquery to avoid bind variable limit
        const rawFieldValues = await prisma.$queryRawUnsafe<Array<{ value: any }>>(
          `
          SELECT cfv."value"
          FROM "CaseFieldValues" cfv
          WHERE cfv."fieldId" = $${paramIndex}
            AND cfv."value" IS NOT NULL
            AND cfv."testCaseId" IN (
              SELECT rc."id"
              FROM "RepositoryCases" rc
              ${whereClause}
            )
          `,
          ...params,
          fieldId
        );

        // Count occurrences of each option
        const optionCountMap = new Map<number, number>();
        rawFieldValues.forEach((row) => {
          const value = row.value;
          if (Array.isArray(value)) {
            // Multi-select: count each value in the array
            value.forEach((v) => {
              if (typeof v === "number") {
                optionCountMap.set(v, (optionCountMap.get(v) || 0) + 1);
              }
            });
          } else if (typeof value === "number") {
            // Single value
            optionCountMap.set(value, (optionCountMap.get(value) || 0) + 1);
          }
        });

        dynamicFields[fieldInfo.displayName] = {
          type: fieldInfo.type,
          fieldId: fieldInfo.fieldId,
          options: fieldInfo.options.map((opt) => ({
            ...opt,
            count: optionCountMap.get(opt.id) || 0,
          })),
        };
      }
    }

    // Get total count
    const totalCount = await prisma.repositoryCases.count({
      where: baseWhere,
    });

    const duration = Date.now() - startTime;
    console.log(
      `[CrossProjectViewOptions API] Completed in ${duration}ms, totalCount: ${totalCount}`
    );

    return NextResponse.json({
      projects: projectsWithCounts,
      templates: templatesWithCounts,
      states: statesWithCounts,
      automated: automatedWithCounts,
      dynamicFields,
      totalCount,
    });
  } catch (error) {
    console.error(
      "[CrossProjectViewOptions API] Error fetching view options:",
      error
    );
    // Return more detailed error information in development
    return NextResponse.json(
      {
        error: "Failed to fetch view options",
        details: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      },
      { status: 500 }
    );
  }
}
