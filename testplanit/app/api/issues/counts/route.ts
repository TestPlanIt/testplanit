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
    const { issueIds, projectId } = body as { issueIds: number[]; projectId?: number };

    if (!Array.isArray(issueIds) || issueIds.length === 0) {
      return NextResponse.json({ counts: {} });
    }

    const isAdmin = session.user.access === "ADMIN";
    const isProjectAdmin = session.user.access === "PROJECTADMIN";

    // Build the where clause for project access
    // This needs to account for all access paths: userPermissions, groupPermissions,
    // assignedUsers, and project defaultAccessType (GLOBAL_ROLE)
    const projectAccessWhere = isAdmin
      ? {}
      : {
          project: {
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
          },
        };

    // If projectId is provided, scope counts to that project only
    const projectFilter = projectId !== undefined
      ? { projectId }
      : {};

    // Fetch counts for each issue using individual queries
    const counts = await Promise.all(
      issueIds.map(async (issueId) => {
        const [
          repositoryCasesCount,
          directSessionsCount,
          sessionResultsCount,
          directTestRunsCount,
          testRunResultsCount,
          testRunStepResultsCount,
        ] = await Promise.all([
          // Repository cases
          prisma.repositoryCases.count({
            where: {
              isDeleted: false,
              issues: { some: { id: issueId } },
              ...projectFilter,
              ...projectAccessWhere,
            },
          }),
          // Sessions - direct
          prisma.sessions.count({
            where: {
              isDeleted: false,
              issues: { some: { id: issueId } },
              ...projectFilter,
              ...projectAccessWhere,
            },
          }),
          // Sessions - from session results
          prisma.sessionResults.groupBy({
            by: ["sessionId"],
            where: {
              issues: {
                some: {
                  id: issueId,
                },
              },
              session: {
                isDeleted: false,
                ...projectFilter,
                ...projectAccessWhere,
              },
            },
          }).then(results => results.length),
          // Test runs - direct
          prisma.testRuns.count({
            where: {
              isDeleted: false,
              issues: { some: { id: issueId } },
              ...projectFilter,
              ...projectAccessWhere,
            },
          }),
          // Test runs - from test run results
          prisma.testRunResults.groupBy({
            by: ["testRunId"],
            where: {
              issues: {
                some: {
                  id: issueId,
                },
              },
              testRun: {
                isDeleted: false,
                ...projectFilter,
                ...projectAccessWhere,
              },
            },
          }).then(results => results.length),
          // Test runs - from test run step results
          prisma.testRunStepResults.findMany({
            where: {
              issues: {
                some: {
                  id: issueId,
                },
              },
              testRunResult: {
                testRun: {
                  isDeleted: false,
                  ...projectFilter,
                  ...projectAccessWhere,
                },
              },
            },
            select: {
              testRunResultId: true,
            },
            distinct: ["testRunResultId"],
          }),
        ]);

        // Combine unique sessions
        const totalSessionsCount = directSessionsCount + sessionResultsCount;

        // To get test run IDs from step results, we need to fetch the test run results
        const uniqueTestRunResultIds = testRunStepResultsCount.map(r => r.testRunResultId);
        let stepResultsTestRunsCount = 0;
        if (uniqueTestRunResultIds.length > 0) {
          // Fetch the test runs for these results
          const testRunResults = await prisma.testRunResults.findMany({
            where: {
              id: { in: uniqueTestRunResultIds },
            },
            select: { testRunId: true },
            distinct: ["testRunId"],
          });
          stepResultsTestRunsCount = testRunResults.length;
        }

        // Total unique test runs
        const totalTestRunsCount = directTestRunsCount + testRunResultsCount + stepResultsTestRunsCount;

        return {
          issueId,
          repositoryCasesCount,
          sessionsCount: totalSessionsCount,
          testRunsCount: totalTestRunsCount,
        };
      })
    );

    // Convert to map for easy lookup
    const countsMap = counts.reduce(
      (acc, item) => {
        acc[item.issueId] = {
          repositoryCases: item.repositoryCasesCount,
          sessions: item.sessionsCount,
          testRuns: item.testRunsCount,
        };
        return acc;
      },
      {} as Record<
        number,
        { repositoryCases: number; sessions: number; testRuns: number }
      >
    );

    return NextResponse.json({ counts: countsMap });
  } catch (error) {
    console.error("Error fetching issue counts:", error);
    return NextResponse.json(
      { error: "Failed to fetch counts" },
      { status: 500 }
    );
  }
}
