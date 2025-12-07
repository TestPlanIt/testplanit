import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";
import { prisma } from "~/lib/prisma";
import { ProjectAccessType } from "@prisma/client";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { projectId, isRunMode, selectedTestCases } = body as {
      projectId: number;
      isRunMode?: boolean;
      selectedTestCases?: number[];
    };

    if (!projectId || isNaN(projectId)) {
      return NextResponse.json(
        { error: "Invalid project ID" },
        { status: 400 }
      );
    }

    const isAdmin = session.user.access === "ADMIN";
    const isProjectAdmin = session.user.access === "PROJECTADMIN";

    // Build the where clause for project access
    // This needs to account for all access paths: userPermissions, groupPermissions,
    // assignedUsers, and project defaultAccessType (GLOBAL_ROLE)
    const projectAccessWhere = isAdmin
      ? { id: projectId, isDeleted: false }
      : {
          id: projectId,
          isDeleted: false,
          OR: [
            // Direct user permissions
            {
              userPermissions: {
                some: {
                  userId: session.user.id,
                  accessType: { not: ProjectAccessType.NO_ACCESS },
                },
              },
            },
            // Group permissions
            {
              groupPermissions: {
                some: {
                  group: {
                    assignedUsers: {
                      some: {
                        userId: session.user.id,
                      },
                    },
                  },
                  accessType: { not: ProjectAccessType.NO_ACCESS },
                },
              },
            },
            // Project default GLOBAL_ROLE (any authenticated user with a role)
            {
              defaultAccessType: ProjectAccessType.GLOBAL_ROLE,
            },
            // Direct assignment to project with PROJECTADMIN access
            ...(isProjectAdmin
              ? [
                  {
                    assignedUsers: {
                      some: {
                        userId: session.user.id,
                      },
                    },
                  },
                ]
              : []),
          ],
        };

    // Verify user has access to the project
    const project = await prisma.projects.findFirst({
      where: projectAccessWhere,
    });

    if (!project) {
      return NextResponse.json(
        { error: "Project not found or access denied" },
        { status: 404 }
      );
    }

    // Build the where clause for repository cases
    const where: any = {
      isDeleted: false,
      isArchived: false,
      projectId: projectId,
      folder: { isDeleted: false },
    };

    // If in run mode, filter by selected test cases
    if (isRunMode && selectedTestCases && selectedTestCases.length > 0) {
      where.id = { in: selectedTestCases };
    }

    // Fetch repository cases with all necessary data
    const cases = await prisma.repositoryCases.findMany({
      where,
      select: {
        id: true,
        name: true,
        templateId: true,
        stateId: true,
        creatorId: true,
        automated: true,
        template: {
          select: {
            id: true,
            templateName: true,
            caseFields: {
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
                            icon: true,
                            iconColor: true,
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
        state: {
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
        },
        caseFieldValues: {
          select: {
            id: true,
            value: true,
            fieldId: true,
            field: {
              select: {
                id: true,
                displayName: true,
                type: {
                  select: {
                    type: true,
                  },
                },
              },
            },
          },
          where: { field: { isEnabled: true, isDeleted: false } },
        },
        creator: {
          select: {
            id: true,
            name: true,
          },
        },
        steps: {
          where: {
            isDeleted: false,
            OR: [
              { sharedStepGroupId: null },
              { sharedStepGroup: { isDeleted: false } },
            ],
          },
          select: {
            id: true,
            order: true,
            step: true,
            expectedResult: true,
            sharedStepGroup: {
              select: {
                id: true,
                name: true,
              },
            },
          },
          orderBy: { order: "asc" },
        },
        tags: {
          select: {
            id: true,
            name: true,
          },
        },
        testRuns: {
          select: {
            testRun: {
              select: {
                id: true,
                isDeleted: true,
                isCompleted: true,
              },
            },
          },
        },
      },
    });

    // Filter out orphaned field values (field values not in the test case's template)
    const filteredCases = cases.map((testCase) => {
      // Get the set of field IDs that are part of this test case's template
      const templateFieldIds = new Set(
        testCase.template?.caseFields?.map((cf) => cf.caseField.id) || []
      );

      // Filter caseFieldValues to only include fields in the template
      const filteredFieldValues = testCase.caseFieldValues.filter((cfv) =>
        templateFieldIds.has(cfv.fieldId)
      );

      return {
        ...testCase,
        caseFieldValues: filteredFieldValues,
      };
    });

    return NextResponse.json({ cases: filteredCases });
  } catch (error) {
    console.error("Error fetching repository cases:", error);
    return NextResponse.json(
      { error: "Failed to fetch repository cases" },
      { status: 500 }
    );
  }
}
