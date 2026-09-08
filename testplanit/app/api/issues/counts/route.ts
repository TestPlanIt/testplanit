import { ProjectAccessType } from "~/zenstack/models";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { baseDb } from "~/lib/db";
import { authOptions } from "~/server/auth";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { issueIds, projectId } = body as {
      issueIds: number[];
      projectId?: number;
    };

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
    const projectFilter = projectId !== undefined ? { projectId } : {};

    // Fetch all requested issues with their linked entities in ONE
    // issue-driven query. Driving from the issue side (a small set of ids)
    // makes the m2m relation loads compile to `... WHERE "A" IN (issueIds)`
    // join lookups instead of the correlated EXISTS subqueries that ZenStack
    // v3 generates for `issues: { some: { id } }` filters — those scanned the
    // large TestRunResults / TestRunStepResults tables once per issue and
    // pegged the database. Counts are then derived in memory with the same
    // additive semantics as before.
    const issues = await baseDb.issue.findMany({
      where: { id: { in: issueIds } },
      select: {
        id: true,
        caseIssues: {
          where: {
            case: { isDeleted: false, ...projectFilter, ...projectAccessWhere },
          },
          select: { caseId: true },
        },
        sessions: {
          where: { isDeleted: false, ...projectFilter, ...projectAccessWhere },
          select: { id: true },
        },
        sessionResults: {
          where: {
            session: {
              isDeleted: false,
              ...projectFilter,
              ...projectAccessWhere,
            },
          },
          select: { sessionId: true },
        },
        testRuns: {
          where: { isDeleted: false, ...projectFilter, ...projectAccessWhere },
          select: { id: true },
        },
        testRunResults: {
          where: {
            testRun: {
              isDeleted: false,
              ...projectFilter,
              ...projectAccessWhere,
            },
          },
          select: { testRunId: true },
        },
        testRunStepResults: {
          where: {
            testRunResult: {
              testRun: {
                isDeleted: false,
                ...projectFilter,
                ...projectAccessWhere,
              },
            },
          },
          select: { testRunResult: { select: { testRunId: true } } },
        },
        milestoneIssues: {
          where: {
            milestone: {
              isDeleted: false,
              ...projectFilter,
              ...projectAccessWhere,
            },
          },
          select: { milestoneId: true },
        },
      },
    });

    const countsMap: Record<
      number,
      {
        repositoryCases: number;
        sessions: number;
        testRuns: number;
        milestones: number;
      }
    > = {};

    for (const issue of issues) {
      // Sessions: directly-linked + sessions reached via linked session
      // results (kept additive to preserve the previous totals exactly).
      const directSessions = issue.sessions.length;
      const viaResultSessions = new Set(
        issue.sessionResults.map((r) => r.sessionId)
      ).size;

      // Test runs: directly-linked + via test run results + via test run
      // step results (same additive semantics as before).
      const directTestRuns = issue.testRuns.length;
      const viaResultTestRuns = new Set(
        issue.testRunResults.map((r) => r.testRunId)
      ).size;
      const viaStepTestRuns = new Set(
        issue.testRunStepResults
          .map((s) => s.testRunResult?.testRunId)
          .filter((id): id is number => id != null)
      ).size;

      countsMap[issue.id] = {
        repositoryCases: issue.caseIssues.length,
        sessions: directSessions + viaResultSessions,
        testRuns: directTestRuns + viaResultTestRuns + viaStepTestRuns,
        // MilestoneIssue is keyed on (milestoneId, issueId), so each row is a
        // distinct milestone membership — the length is the milestone count.
        milestones: issue.milestoneIssues.length,
      };
    }

    // Ensure every requested id has an entry (issue not found / no links).
    for (const id of issueIds) {
      if (!countsMap[id]) {
        countsMap[id] = {
          repositoryCases: 0,
          sessions: 0,
          testRuns: 0,
          milestones: 0,
        };
      }
    }

    return NextResponse.json({ counts: countsMap });
  } catch (error) {
    console.error("Error fetching issue counts:", error);
    return NextResponse.json(
      { error: "Failed to fetch counts" },
      { status: 500 }
    );
  }
}
