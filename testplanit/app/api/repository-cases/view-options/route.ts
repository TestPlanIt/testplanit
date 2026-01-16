import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";
import { prisma } from "~/lib/prisma";
import { Prisma } from "@prisma/client";
import { getUserAccessibleProjects } from "~/app/actions/getUserAccessibleProjects";

interface ViewOptionsRequest {
  projectId: number;
  isRunMode?: boolean;
  selectedTestCases?: number[];
  runId?: number;
  runIds?: number[]; // For multi-configuration test runs
  // Filter parameters for automation trends
  templateIds?: number[];
  stateIds?: number[];
  automated?: number[];
  dynamicFieldFilters?: Record<number, (string | number)[]>;
}

export async function POST(request: Request) {
  const startTime = Date.now();
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as ViewOptionsRequest;
    const {
      projectId,
      isRunMode,
      selectedTestCases,
      runId,
      runIds,
      templateIds,
      stateIds,
      automated: automatedFilter,
      dynamicFieldFilters,
    } = body;

    // Use runIds if provided (multi-config), otherwise use single runId
    const effectiveRunIds = runIds && runIds.length > 0 ? runIds : runId ? [runId] : [];

    if (!projectId || isNaN(projectId)) {
      return NextResponse.json(
        { error: "Invalid project ID" },
        { status: 400 }
      );
    }

    // Verify user has access to the project
    const project = await prisma.projects.findUnique({
      where: { id: projectId, isDeleted: false },
    });

    if (!project) {
      return NextResponse.json(
        { error: "Project not found" },
        { status: 404 }
      );
    }

    // Check if user has access to this project
    const accessibleProjects = await getUserAccessibleProjects(session.user.id);
    const hasAccess = accessibleProjects.some(p => p.projectId === projectId);

    if (!hasAccess) {
      return NextResponse.json(
        { error: "Access denied" },
        { status: 403 }
      );
    }

    // Build the base where clause for repository cases
    const baseWhere: Prisma.RepositoryCasesWhereInput = {
      isDeleted: false,
      isArchived: false,
      projectId: projectId,
      folder: { isDeleted: false },
    };

    // If in run mode, get test cases from all selected runs
    let effectiveSelectedTestCases = selectedTestCases;
    // For multi-config: array of all test case IDs (with duplicates for counting)
    let allTestRunCaseIds: number[] = [];

    if (isRunMode && effectiveRunIds.length > 0) {
      // Fetch all test case IDs from the selected runs
      const testRunCases = await prisma.testRunCases.findMany({
        where: {
          testRunId: { in: effectiveRunIds },
        },
        select: {
          repositoryCaseId: true,
        },
      });

      // Keep all IDs for counting (includes duplicates across configs)
      allTestRunCaseIds = testRunCases.map(trc => trc.repositoryCaseId);

      // Get unique test case IDs for filtering
      effectiveSelectedTestCases = [...new Set(allTestRunCaseIds)];

      if (effectiveSelectedTestCases.length > 0) {
        baseWhere.id = { in: effectiveSelectedTestCases };
      }
    } else if (isRunMode && selectedTestCases && selectedTestCases.length > 0) {
      // Fallback to provided selectedTestCases if no runIds
      baseWhere.id = { in: selectedTestCases };
      allTestRunCaseIds = selectedTestCases;
    }

    // Apply automation trends filters
    if (templateIds && templateIds.length > 0) {
      baseWhere.templateId = { in: templateIds };
    }

    if (stateIds && stateIds.length > 0) {
      baseWhere.stateId = { in: stateIds };
    }

    if (automatedFilter && automatedFilter.length > 0) {
      const automatedBools = automatedFilter.map((v) => v === 1);
      if (automatedBools.length === 1) {
        baseWhere.automated = automatedBools[0];
      }
      // If both are selected, don't add a filter (show all)
    }

    // Save baseWhere BEFORE applying dynamic field filters
    // This is used for counting dynamic field options
    // Use JSON parse/stringify for deep copy to avoid reference issues
    const baseWhereWithoutDynamicFilters = JSON.parse(JSON.stringify(baseWhere));

    // Apply dynamic field filters (custom fields)
    // We need to fetch case IDs that match ALL dynamic field filters
    // and then filter baseWhere by those IDs
    let dynamicFieldFilteredCaseIds: number[] | null = null;

    if (dynamicFieldFilters && Object.keys(dynamicFieldFilters).length > 0) {
      // For each field filter, get the case IDs that match
      const fieldFilterPromises = Object.entries(dynamicFieldFilters).map(
        async ([fieldIdStr, values]) => {
          const fieldId = parseInt(fieldIdStr);
          if (isNaN(fieldId) || !values || values.length === 0) return null;

          // First, get all matching case IDs from the base filter
          const matchingCases = await prisma.repositoryCases.findMany({
            where: baseWhere,
            select: { id: true },
          });
          const baseCaseIds = matchingCases.map((c) => c.id);

          // Then fetch case field values only for those cases
          const caseFieldValues = await prisma.caseFieldValues.findMany({
            where: {
              fieldId: fieldId,
              testCaseId: { in: baseCaseIds },
              value: {
                not: Prisma.DbNull,
              },
            },
            select: {
              testCaseId: true,
              value: true,
            },
          });

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
          // Apply this constraint to baseWhere to ensure no results
          baseWhere.id = { in: [] };
        } else {
          // Apply the intersection of case IDs to baseWhere
          baseWhere.id = { in: dynamicFieldFilteredCaseIds };
        }
      }
    }

    // Execute all aggregation queries in parallel
    const [
      templates,
      states,
      creators,
      automatedCounts,
      tags,
      issues,
      dynamicFieldInfo,
      testRunData,
      totalCount,
    ] = await Promise.all([
      // Templates with counts
      prisma.repositoryCases.groupBy({
        by: ["templateId"],
        where: baseWhere,
        _count: true,
      }),

      // States with counts
      prisma.repositoryCases.groupBy({
        by: ["stateId"],
        where: baseWhere,
        _count: true,
      }),

      // Creators with counts
      prisma.repositoryCases.groupBy({
        by: ["creatorId"],
        where: baseWhere,
        _count: true,
      }),

      // Automated counts
      prisma.repositoryCases.groupBy({
        by: ["automated"],
        where: baseWhere,
        _count: true,
      }),

      // Tags - use raw SQL to count tags efficiently with GROUP BY
      (async () => {
        // Build WHERE clause for the raw query
        // In run mode, filter by selected test cases from all selected runs
        let result: Array<{ tagId: number; count: bigint }>;

        if (isRunMode && effectiveSelectedTestCases && effectiveSelectedTestCases.length > 0) {
          result = await prisma.$queryRaw<Array<{ tagId: number; count: bigint }>>`
            SELECT rct."B" as "tagId", COUNT(*)::bigint as count
            FROM "public"."_RepositoryCasesToTags" rct
            INNER JOIN "public"."RepositoryCases" rc ON rc.id = rct."A"
            LEFT JOIN "public"."RepositoryFolders" rf ON rf.id = rc."folderId"
            WHERE rc."isDeleted" = false
              AND rc."isArchived" = false
              AND rc."projectId" = ${projectId}
              AND rf."isDeleted" = false
              AND rc.id = ANY(${effectiveSelectedTestCases})
            GROUP BY rct."B"
          `;
        } else {
          result = await prisma.$queryRaw<Array<{ tagId: number; count: bigint }>>`
            SELECT rct."B" as "tagId", COUNT(*)::bigint as count
            FROM "public"."_RepositoryCasesToTags" rct
            INNER JOIN "public"."RepositoryCases" rc ON rc.id = rct."A"
            LEFT JOIN "public"."RepositoryFolders" rf ON rf.id = rc."folderId"
            WHERE rc."isDeleted" = false
              AND rc."isArchived" = false
              AND rc."projectId" = ${projectId}
              AND rf."isDeleted" = false
            GROUP BY rct."B"
          `;
        }

        return result.map(row => ({
          tagId: row.tagId,
          count: row.count,
        }));
      })(),

      // Issues - use raw SQL to count issues efficiently with GROUP BY
      // In the _IssueToRepositoryCases join table: "A" = Issue.id, "B" = RepositoryCases.id
      (async () => {
        let result: Array<{ issueId: number; count: bigint }>;

        if (isRunMode && effectiveSelectedTestCases && effectiveSelectedTestCases.length > 0) {
          result = await prisma.$queryRaw<Array<{ issueId: number; count: bigint }>>`
            SELECT rci."A" as "issueId", COUNT(*)::bigint as count
            FROM "public"."_IssueToRepositoryCases" rci
            INNER JOIN "public"."RepositoryCases" rc ON rc.id = rci."B"
            INNER JOIN "public"."Issue" i ON i.id = rci."A"
            LEFT JOIN "public"."RepositoryFolders" rf ON rf.id = rc."folderId"
            WHERE rc."isDeleted" = false
              AND rc."isArchived" = false
              AND rc."projectId" = ${projectId}
              AND rf."isDeleted" = false
              AND i."isDeleted" = false
              AND rc.id = ANY(${effectiveSelectedTestCases})
            GROUP BY rci."A"
          `;
        } else {
          result = await prisma.$queryRaw<Array<{ issueId: number; count: bigint }>>`
            SELECT rci."A" as "issueId", COUNT(*)::bigint as count
            FROM "public"."_IssueToRepositoryCases" rci
            INNER JOIN "public"."RepositoryCases" rc ON rc.id = rci."B"
            INNER JOIN "public"."Issue" i ON i.id = rci."A"
            LEFT JOIN "public"."RepositoryFolders" rf ON rf.id = rc."folderId"
            WHERE rc."isDeleted" = false
              AND rc."isArchived" = false
              AND rc."projectId" = ${projectId}
              AND rf."isDeleted" = false
              AND i."isDeleted" = false
            GROUP BY rci."A"
          `;
        }

        return result.map(row => ({
          issueId: row.issueId,
          count: row.count,
        }));
      })(),

      // Get field info for dynamic fields
      prisma.templates.findMany({
        where: {
          isDeleted: false,
          projects: {
            some: {
              projectId: projectId,
            },
          },
        },
        select: {
          id: true,
          templateName: true,
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

      // Test run data (if in run mode)
      isRunMode && effectiveRunIds.length > 0
        ? prisma.testRunCases.findMany({
            where: {
              testRunId: { in: effectiveRunIds },
            },
            select: {
              repositoryCaseId: true,
              statusId: true,
              assignedToId: true,
              testRunId: true,
              status: {
                select: {
                  id: true,
                  name: true,
                  color: {
                    select: {
                      value: true,
                    },
                  },
                },
              },
              assignedTo: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          })
        : Promise.resolve(null),

      // Total count
      prisma.repositoryCases.count({ where: baseWhere }),
    ]);

    // Fetch template names and state details
    const [templateDetails, stateDetails, creatorDetails, tagDetails, issueDetails] =
      await Promise.all([
        prisma.templates.findMany({
          where: {
            id: { in: templates.map((t) => t.templateId) },
            isDeleted: false,
          },
          select: {
            id: true,
            templateName: true,
          },
        }),

        prisma.workflows.findMany({
          where: {
            id: { in: states.map((s) => s.stateId) },
            isDeleted: false,
          },
          select: {
            id: true,
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
        }),

        prisma.user.findMany({
          where: {
            id: { in: creators.map((c) => c.creatorId) },
          },
          select: {
            id: true,
            name: true,
          },
        }),

        tags.length > 0
          ? prisma.tags.findMany({
              where: {
                id: { in: tags.map((t) => t.tagId) },
                isDeleted: false,
              },
              select: {
                id: true,
                name: true,
              },
            })
          : Promise.resolve([]),

        issues.length > 0
          ? prisma.issue.findMany({
              where: {
                id: { in: issues.map((i) => i.issueId) },
                isDeleted: false,
              },
              select: {
                id: true,
                name: true,
                title: true,
              },
            })
          : Promise.resolve([]),
      ]);

    // For multi-config mode, we need to count based on TestRunCases, not unique RepositoryCases
    // Fetch case properties for recounting if in multi-config mode
    let casePropertiesMap: Map<number, { templateId: number; stateId: number; creatorId: string; automated: boolean }> | null = null;

    if (isRunMode && allTestRunCaseIds.length > 0 && effectiveRunIds.length > 1) {
      const caseProperties = await prisma.repositoryCases.findMany({
        where: { id: { in: effectiveSelectedTestCases } },
        select: {
          id: true,
          templateId: true,
          stateId: true,
          creatorId: true,
          automated: true,
        },
      });

      casePropertiesMap = new Map(
        caseProperties.map((c) => [c.id, { templateId: c.templateId, stateId: c.stateId, creatorId: c.creatorId, automated: c.automated }])
      );
    }

    // Map templates with counts
    let templatesWithCounts: Array<{ id: number; name: string; count: number }>;

    if (casePropertiesMap && allTestRunCaseIds.length > 0) {
      // Multi-config: count based on all TestRunCases
      const templateCountMap = new Map<number, number>();
      allTestRunCaseIds.forEach((caseId) => {
        const props = casePropertiesMap!.get(caseId);
        if (props) {
          templateCountMap.set(props.templateId, (templateCountMap.get(props.templateId) || 0) + 1);
        }
      });

      templatesWithCounts = Array.from(templateCountMap.entries()).map(([templateId, count]) => {
        const template = templateDetails.find((td) => td.id === templateId);
        return {
          id: templateId,
          name: template?.templateName || "Unknown",
          count,
        };
      });
    } else {
      // Single config or non-run mode: use original groupBy counts
      templatesWithCounts = templates.map((t) => {
        const template = templateDetails.find((td) => td.id === t.templateId);
        return {
          id: t.templateId,
          name: template?.templateName || "Unknown",
          count: t._count,
        };
      });
    }

    // Map states with counts
    let statesWithCounts: Array<{ id: number; name: string; icon?: any; iconColor?: any; count: number }>;

    if (casePropertiesMap && allTestRunCaseIds.length > 0) {
      // Multi-config: count based on all TestRunCases
      const stateCountMap = new Map<number, number>();
      allTestRunCaseIds.forEach((caseId) => {
        const props = casePropertiesMap!.get(caseId);
        if (props) {
          stateCountMap.set(props.stateId, (stateCountMap.get(props.stateId) || 0) + 1);
        }
      });

      statesWithCounts = Array.from(stateCountMap.entries()).map(([stateId, count]) => {
        const state = stateDetails.find((sd) => sd.id === stateId);
        return {
          id: stateId,
          name: state?.name || "Unknown",
          icon: state?.icon,
          iconColor: state?.color,
          count,
        };
      });
    } else {
      // Single config or non-run mode: use original groupBy counts
      statesWithCounts = states.map((s) => {
        const state = stateDetails.find((sd) => sd.id === s.stateId);
        return {
          id: s.stateId,
          name: state?.name || "Unknown",
          icon: state?.icon,
          iconColor: state?.color,
          count: s._count,
        };
      });
    }

    // Map creators with counts
    let creatorsWithCounts: Array<{ id: string; name: string; count: number }>;

    if (casePropertiesMap && allTestRunCaseIds.length > 0) {
      // Multi-config: count based on all TestRunCases
      const creatorCountMap = new Map<string, number>();
      allTestRunCaseIds.forEach((caseId) => {
        const props = casePropertiesMap!.get(caseId);
        if (props) {
          creatorCountMap.set(props.creatorId, (creatorCountMap.get(props.creatorId) || 0) + 1);
        }
      });

      creatorsWithCounts = Array.from(creatorCountMap.entries()).map(([creatorId, count]) => {
        const creator = creatorDetails.find((cd) => cd.id === creatorId);
        return {
          id: creatorId,
          name: creator?.name || "Unknown",
          count,
        };
      });
    } else {
      // Single config or non-run mode: use original groupBy counts
      creatorsWithCounts = creators.map((c) => {
        const creator = creatorDetails.find((cd) => cd.id === c.creatorId);
        return {
          id: c.creatorId,
          name: creator?.name || "Unknown",
          count: c._count,
        };
      });
    }

    // Calculate effective total count for multi-config
    const effectiveTotalCount = (casePropertiesMap && allTestRunCaseIds.length > 0)
      ? allTestRunCaseIds.length
      : totalCount;

    // Calculate tag counts including special options
    const casesWithTags = await prisma.repositoryCases.count({
      where: {
        ...baseWhere,
        tags: {
          some: {},
        },
      },
    });

    // For multi-config, recalculate tag counts based on TestRunCases
    let effectiveCasesWithTags = casesWithTags;
    let effectiveCasesWithoutTags = totalCount - casesWithTags;

    if (casePropertiesMap && allTestRunCaseIds.length > 0) {
      // Fetch which cases have tags
      const casesWithTagsSet = new Set(
        (await prisma.repositoryCases.findMany({
          where: {
            id: { in: effectiveSelectedTestCases },
            tags: { some: {} },
          },
          select: { id: true },
        })).map((c) => c.id)
      );

      effectiveCasesWithTags = allTestRunCaseIds.filter((id) => casesWithTagsSet.has(id)).length;
      effectiveCasesWithoutTags = allTestRunCaseIds.length - effectiveCasesWithTags;
    }

    // For multi-config, recalculate individual tag counts
    let tagCountsForList = tags.map((t) => ({
      tagId: t.tagId,
      count: Number(t.count),
    }));

    if (casePropertiesMap && allTestRunCaseIds.length > 0) {
      // Fetch tag associations for all cases
      const caseTagAssociations = await prisma.repositoryCases.findMany({
        where: { id: { in: effectiveSelectedTestCases } },
        select: {
          id: true,
          tags: { select: { id: true } },
        },
      });

      const caseTagsMap = new Map<number, Set<number>>(
        caseTagAssociations.map((c) => [c.id, new Set(c.tags.map((t) => t.id))])
      );

      // Count tags based on TestRunCases
      const tagCountMap = new Map<number, number>();
      allTestRunCaseIds.forEach((caseId) => {
        const caseTags = caseTagsMap.get(caseId);
        if (caseTags) {
          caseTags.forEach((tagId) => {
            tagCountMap.set(tagId, (tagCountMap.get(tagId) || 0) + 1);
          });
        }
      });

      tagCountsForList = Array.from(tagCountMap.entries()).map(([tagId, count]) => ({
        tagId,
        count,
      }));
    }

    const tagsWithCounts = [
      {
        id: "any" as const,
        name: "Any Tag",
        count: effectiveCasesWithTags,
      },
      {
        id: "none" as const,
        name: "No Tags",
        count: effectiveCasesWithoutTags,
      },
      ...tagCountsForList.map((t) => {
        const tag = tagDetails.find((td) => td.id === t.tagId);
        return {
          id: t.tagId,
          name: tag?.name || "Unknown",
          count: t.count,
        };
      }),
    ];

    // Calculate issue counts including special options
    const casesWithIssues = await prisma.repositoryCases.count({
      where: {
        ...baseWhere,
        issues: {
          some: {
            isDeleted: false,
          },
        },
      },
    });

    // For multi-config, recalculate issue counts based on TestRunCases
    let effectiveCasesWithIssues = casesWithIssues;
    let effectiveCasesWithoutIssues = totalCount - casesWithIssues;

    if (casePropertiesMap && allTestRunCaseIds.length > 0) {
      // Fetch which cases have issues
      const casesWithIssuesSet = new Set(
        (await prisma.repositoryCases.findMany({
          where: {
            id: { in: effectiveSelectedTestCases },
            issues: { some: { isDeleted: false } },
          },
          select: { id: true },
        })).map((c) => c.id)
      );

      effectiveCasesWithIssues = allTestRunCaseIds.filter((id) => casesWithIssuesSet.has(id)).length;
      effectiveCasesWithoutIssues = allTestRunCaseIds.length - effectiveCasesWithIssues;
    }

    // For multi-config, recalculate individual issue counts
    let issueCountsForList = issues.map((i) => ({
      issueId: i.issueId,
      count: Number(i.count),
    }));

    if (casePropertiesMap && allTestRunCaseIds.length > 0) {
      // Fetch issue associations for all cases
      const caseIssueAssociations = await prisma.repositoryCases.findMany({
        where: { id: { in: effectiveSelectedTestCases } },
        select: {
          id: true,
          issues: { select: { id: true }, where: { isDeleted: false } },
        },
      });

      const caseIssuesMap = new Map<number, Set<number>>(
        caseIssueAssociations.map((c) => [c.id, new Set(c.issues.map((i) => i.id))])
      );

      // Count issues based on TestRunCases
      const issueCountMap = new Map<number, number>();
      allTestRunCaseIds.forEach((caseId) => {
        const caseIssues = caseIssuesMap.get(caseId);
        if (caseIssues) {
          caseIssues.forEach((issueId) => {
            issueCountMap.set(issueId, (issueCountMap.get(issueId) || 0) + 1);
          });
        }
      });

      issueCountsForList = Array.from(issueCountMap.entries()).map(([issueId, count]) => ({
        issueId,
        count,
      }));
    }

    const issuesWithCounts = [
      {
        id: "any" as const,
        name: "Any Issue",
        count: effectiveCasesWithIssues,
      },
      {
        id: "none" as const,
        name: "No Issues",
        count: effectiveCasesWithoutIssues,
      },
      ...issueCountsForList.map((i) => {
        const issue = issueDetails.find((id) => id.id === i.issueId);
        return {
          id: i.issueId,
          name: issue?.name || "Unknown",
          title: issue?.title,
          count: i.count,
        };
      }),
    ];

    // Process dynamic fields
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

        if (
          [
            "Dropdown",
            "Multi-Select",
            "Checkbox",
            "Integer",
            "Number",
            "Link",
            "Steps",
            "Date",
            "Text Long",
            "Text String",
          ].includes(fieldType)
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

    // For dynamic field options with counts, we need to query case field values
    const dynamicFields: Record<
      string,
      {
        type: string;
        fieldId: number;
        options?: Array<{
          id: number;
          name: string;
          icon?: { name: string } | null;
          iconColor?: { value: string } | null;
          count?: number;
        }>;
        values?: any[];
      }
    > = {};

    // Get all matching case IDs once to reuse for all dynamic field queries
    // Use baseWhereWithoutDynamicFilters to get counts that respect standard filters
    // but not dynamic field filters (otherwise counts would always be 0 for non-selected options)
    const allMatchingCases = await prisma.repositoryCases.findMany({
      where: baseWhereWithoutDynamicFilters,
      select: { id: true },
    });
    const allMatchingCaseIds = allMatchingCases.map((c) => c.id);

    for (const [fieldId, fieldInfo] of dynamicFieldsMap) {

      if (fieldInfo.options) {
        // For dropdown/multi-select, query field values using Prisma
        const fieldValues = await prisma.caseFieldValues.findMany({
          where: {
            fieldId: fieldId,
            testCaseId: { in: allMatchingCaseIds },
            value: {
              not: Prisma.DbNull,
            },
          },
          select: {
            value: true,
          },
        });

        // Count occurrences of each option (handling both single values and arrays)
        const optionCountMap = new Map<number, number>();
        fieldValues.forEach((fv) => {
          if (fv.value !== null && fv.value !== undefined) {
            if (Array.isArray(fv.value)) {
              // Multi-Select field - array of option IDs
              fv.value.forEach((optionId) => {
                if (typeof optionId === 'number') {
                  optionCountMap.set(optionId, (optionCountMap.get(optionId) || 0) + 1);
                }
              });
            } else if (typeof fv.value === 'number') {
              // Dropdown field - single option ID
              optionCountMap.set(fv.value, (optionCountMap.get(fv.value) || 0) + 1);
            }
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
      } else if (fieldInfo.type === "Link") {
        // For Link fields, count cases with/without links
        const linkCount = await prisma.caseFieldValues.count({
          where: {
            fieldId: fieldId,
            testCaseId: { in: allMatchingCaseIds },
            value: {
              not: Prisma.DbNull,
            },
            AND: [
              { value: { not: "" } },
            ],
          },
        });

        dynamicFields[fieldInfo.displayName] = {
          type: fieldInfo.type,
          fieldId: fieldInfo.fieldId,
          counts: {
            hasValue: linkCount,
            noValue: totalCount - linkCount,
          },
        } as any;
      } else if (fieldInfo.type === "Steps") {
        // For Steps fields, count cases that have at least one step
        // Use a subquery to avoid fetching all data
        const withStepsCount = await prisma.repositoryCases.count({
          where: {
            ...baseWhere,
            steps: {
              some: {
                isDeleted: false,
              },
            },
          },
        });

        dynamicFields[fieldInfo.displayName] = {
          type: fieldInfo.type,
          fieldId: fieldInfo.fieldId,
          counts: {
            hasValue: withStepsCount,
            noValue: totalCount - withStepsCount,
          },
        } as any;
      } else if (fieldInfo.type === "Checkbox") {
        // For Checkbox fields, count checked/unchecked
        const checkedCount = await prisma.caseFieldValues.count({
          where: {
            fieldId: fieldId,
            testCaseId: { in: allMatchingCaseIds },
            value: {
              equals: true,
            },
          },
        });

        dynamicFields[fieldInfo.displayName] = {
          type: fieldInfo.type,
          fieldId: fieldInfo.fieldId,
          counts: {
            hasValue: checkedCount,
            noValue: totalCount - checkedCount,
          },
        } as any;
      } else if (fieldInfo.type === "Integer" || fieldInfo.type === "Number") {
        // For Integer/Number fields, get all distinct values and their counts
        const fieldValues = await prisma.caseFieldValues.findMany({
          where: {
            fieldId: fieldId,
            testCaseId: { in: allMatchingCaseIds },
            value: {
              not: Prisma.DbNull,
            },
          },
          select: {
            value: true,
          },
        });

        // Count occurrences of each value
        const valueCounts = new Map<number, number>();
        fieldValues.forEach((fv) => {
          if (fv.value !== null && fv.value !== undefined) {
            const numValue = typeof fv.value === 'number' ? fv.value : parseFloat(fv.value as string);
            if (!isNaN(numValue)) {
              valueCounts.set(numValue, (valueCounts.get(numValue) || 0) + 1);
            }
          }
        });

        // Sort values numerically and create options array
        const sortedValues = Array.from(valueCounts.keys()).sort((a, b) => a - b);
        const options = sortedValues.map((value) => ({
          id: value,
          name: value.toString(),
          count: valueCounts.get(value) || 0,
        }));

        const withValueCount = fieldValues.length;

        dynamicFields[fieldInfo.displayName] = {
          type: fieldInfo.type,
          fieldId: fieldInfo.fieldId,
          options: options,
          counts: {
            hasValue: withValueCount,
            noValue: totalCount - withValueCount,
          },
        } as any;
      } else if (fieldInfo.type === "Date") {
        // For Date fields, count cases with valid date values (not null or empty)
        const fieldValues = await prisma.caseFieldValues.findMany({
          where: {
            fieldId: fieldId,
            testCaseId: { in: allMatchingCaseIds },
            value: {
              not: Prisma.DbNull,
            },
          },
          select: {
            value: true,
          },
        });

        // Count non-null, non-empty date values
        const withDateCount = fieldValues.filter((fv) => {
          if (fv.value === null || fv.value === undefined) return false;
          // Check if it's a non-empty string
          if (typeof fv.value === 'string') {
            return fv.value.trim() !== '';
          }
          return true;
        }).length;

        dynamicFields[fieldInfo.displayName] = {
          type: fieldInfo.type,
          fieldId: fieldInfo.fieldId,
          counts: {
            hasValue: withDateCount,
            noValue: totalCount - withDateCount,
          },
        } as any;
      } else if (fieldInfo.type === "Text Long" || fieldInfo.type === "Text String") {
        // For Text fields, count cases with/without text (excluding empty strings and empty TipTap docs)
        const fieldValues = await prisma.caseFieldValues.findMany({
          where: {
            fieldId: fieldId,
            testCaseId: { in: allMatchingCaseIds },
            value: {
              not: Prisma.DbNull,
            },
          },
          select: {
            value: true,
          },
        });

        // Count non-empty text values
        let withTextCount = 0;
        fieldValues.forEach((fv) => {
          if (fv.value !== null && fv.value !== undefined) {
            // Check if it's a non-empty string or non-empty TipTap document
            if (typeof fv.value === 'string') {
              if (fv.value.trim() !== '') {
                withTextCount++;
              }
            } else if (typeof fv.value === 'object') {
              // TipTap JSON format - check if it has content
              const doc = fv.value as any;
              if (doc.content && Array.isArray(doc.content)) {
                const hasContent = doc.content.some((node: any) =>
                  node.content && Array.isArray(node.content) && node.content.length > 0
                );
                if (hasContent) {
                  withTextCount++;
                }
              }
            }
          }
        });

        dynamicFields[fieldInfo.displayName] = {
          type: fieldInfo.type,
          fieldId: fieldInfo.fieldId,
          counts: {
            hasValue: withTextCount,
            noValue: totalCount - withTextCount,
          },
        } as any;
      } else {
        // For other field types, just include the field info
        dynamicFields[fieldInfo.displayName] = {
          type: fieldInfo.type,
          fieldId: fieldInfo.fieldId,
          values: [],
        };
      }
    }

    // Process test run data if in run mode
    let testRunOptions = null;
    if (testRunData) {
      const statusMap = new Map<
        number,
        { id: number; name: string; color?: { value: string }; count: number }
      >();
      const assignedToMap = new Map<
        string,
        { id: string; name: string; count: number }
      >();
      let untestedCount = 0;
      let unassignedCount = 0;

      testRunData.forEach((trc) => {
        if (trc.statusId && trc.status) {
          const existing = statusMap.get(trc.statusId);
          if (existing) {
            existing.count++;
          } else {
            statusMap.set(trc.statusId, {
              id: trc.statusId,
              name: trc.status.name,
              color: trc.status.color,
              count: 1,
            });
          }
        } else {
          untestedCount++;
        }

        if (trc.assignedToId && trc.assignedTo) {
          const existing = assignedToMap.get(trc.assignedToId);
          if (existing) {
            existing.count++;
          } else {
            assignedToMap.set(trc.assignedToId, {
              id: trc.assignedToId,
              name: trc.assignedTo.name,
              count: 1,
            });
          }
        } else {
          unassignedCount++;
        }
      });

      testRunOptions = {
        statuses: Array.from(statusMap.values()),
        assignedTo: Array.from(assignedToMap.values()),
        untestedCount,
        unassignedCount,
        totalCount: testRunData.length,
      };
    }

    const elapsed = Date.now() - startTime;

    // Calculate automated counts for multi-config
    let automatedWithCounts: Array<{ value: boolean; count: number }>;

    if (casePropertiesMap && allTestRunCaseIds.length > 0) {
      const automatedCountMap = new Map<boolean, number>();
      allTestRunCaseIds.forEach((caseId) => {
        const props = casePropertiesMap!.get(caseId);
        if (props) {
          automatedCountMap.set(props.automated, (automatedCountMap.get(props.automated) || 0) + 1);
        }
      });

      automatedWithCounts = Array.from(automatedCountMap.entries()).map(([value, count]) => ({
        value,
        count,
      }));
    } else {
      automatedWithCounts = automatedCounts.map((ac) => ({
        value: ac.automated,
        count: ac._count,
      }));
    }

    return NextResponse.json({
      templates: templatesWithCounts.sort((a, b) =>
        a.name.localeCompare(b.name)
      ),
      states: statesWithCounts.sort((a, b) => a.name.localeCompare(b.name)),
      creators: creatorsWithCounts.sort((a, b) => a.name.localeCompare(b.name)),
      automated: automatedWithCounts,
      tags: tagsWithCounts,
      issues: issuesWithCounts,
      dynamicFields,
      testRunOptions,
      totalCount: effectiveTotalCount,
    });
  } catch (error) {
    console.error("[ViewOptions API] Error fetching view options:", error);
    return NextResponse.json(
      { error: "Failed to fetch view options" },
      { status: 500 }
    );
  }
}
