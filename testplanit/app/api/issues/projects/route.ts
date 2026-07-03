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
    const { issueIds } = body as { issueIds: number[] };

    if (!Array.isArray(issueIds) || issueIds.length === 0) {
      return NextResponse.json({ projects: {} });
    }

    const isAdmin = session.user.access === "ADMIN";
    const isProjectAdmin = session.user.access === "PROJECTADMIN";

    // Build the where clause for project access
    // This needs to account for all access paths: userPermissions, groupPermissions,
    // assignedUsers, and project defaultAccessType (GLOBAL_ROLE)
    const projectAccessWhere = isAdmin
      ? {}
      : {
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

    // Pull every issue's associated project IDs in ONE issue-driven query.
    // Driving from the issue side (a small set of ids) makes each relation load
    // compile to a `WHERE "A" IN (issueIds)` join lookup, so the whole page
    // costs ~7 queries total regardless of page size. The previous shape ran
    // ~10 correlated queries PER issue (≈500 for a 50-row page) — same result,
    // orders of magnitude more round-trips. Project IDs are collected in memory
    // and resolved to project rows (with access control) in a single follow-up.
    const issues = await baseDb.issue.findMany({
      where: { id: { in: issueIds } },
      select: {
        id: true,
        caseIssues: {
          where: { case: { isDeleted: false } },
          select: { case: { select: { projectId: true } } },
        },
        sessions: {
          where: { isDeleted: false },
          select: { projectId: true },
        },
        sessionResults: {
          where: { session: { isDeleted: false } },
          select: { session: { select: { projectId: true } } },
        },
        testRuns: {
          where: { isDeleted: false },
          select: { projectId: true },
        },
        testRunResults: {
          where: { testRun: { isDeleted: false } },
          select: { testRun: { select: { projectId: true } } },
        },
        testRunStepResults: {
          where: { testRunResult: { testRun: { isDeleted: false } } },
          select: {
            testRunResult: {
              select: { testRun: { select: { projectId: true } } },
            },
          },
        },
      },
    });

    // Per-issue set of referenced project IDs, plus the union across all issues
    // (so the access-controlled project fetch below runs exactly once).
    const projectIdsByIssue = new Map<number, Set<number>>();
    const allProjectIds = new Set<number>();

    for (const issue of issues) {
      const ids = new Set<number>();
      const add = (projectId: number | null | undefined) => {
        if (typeof projectId === "number") {
          ids.add(projectId);
          allProjectIds.add(projectId);
        }
      };

      for (const ci of issue.caseIssues) add(ci.case?.projectId);
      for (const s of issue.sessions) add(s.projectId);
      for (const sr of issue.sessionResults) add(sr.session?.projectId);
      for (const tr of issue.testRuns) add(tr.projectId);
      for (const trr of issue.testRunResults) add(trr.testRun?.projectId);
      for (const tsr of issue.testRunStepResults) {
        add(tsr.testRunResult?.testRun?.projectId);
      }

      projectIdsByIssue.set(issue.id, ids);
    }

    // One access-controlled fetch for every referenced project. A project that
    // the caller can't access simply won't appear here, so it's dropped from
    // each issue's list below — matching the previous per-issue behavior.
    const projects =
      allProjectIds.size > 0
        ? await baseDb.projects.findMany({
            where: {
              id: { in: Array.from(allProjectIds) },
              isDeleted: false,
              ...projectAccessWhere,
            },
            select: { id: true, name: true, iconUrl: true },
          })
        : [];

    const projectById = new Map(projects.map((p) => [p.id, p]));

    const projectsMap: Record<
      number,
      Array<{ id: number; name: string; iconUrl: string | null }>
    > = {};

    for (const id of issueIds) {
      const ids = projectIdsByIssue.get(id);
      projectsMap[id] = ids
        ? Array.from(ids)
            .map((pid) => projectById.get(pid))
            .filter(
              (p): p is { id: number; name: string; iconUrl: string | null } =>
                p != null
            )
        : [];
    }

    return NextResponse.json({ projects: projectsMap });
  } catch (error) {
    console.error("Error fetching issue projects:", error);
    return NextResponse.json(
      { error: "Failed to fetch projects" },
      { status: 500 }
    );
  }
}
