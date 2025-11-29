import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";
import { prisma } from "~/lib/prisma";

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

    // Build the where clause for project access
    const projectAccessWhere = isAdmin
      ? {}
      : {
          userPermissions: {
            some: {
              userId: session.user.id,
            },
          },
        };

    // For each issue, fetch all associated projects from different sources
    const projectsData = await Promise.all(
      issueIds.map(async (issueId) => {
        // Fetch all distinct project IDs from each relation type
        const [
          caseProjectIds,
          sessionProjectIds,
          sessionResultProjectIds,
          runProjectIds,
          runResultProjectIds,
          stepResultProjectIds,
        ] = await Promise.all([
          // From repository cases
          prisma.repositoryCases.findMany({
            where: {
              isDeleted: false,
              issues: { some: { id: issueId } },
            },
            select: { projectId: true },
            distinct: ["projectId"],
          }),
          // From sessions
          prisma.sessions.findMany({
            where: {
              isDeleted: false,
              issues: { some: { id: issueId } },
            },
            select: { projectId: true },
            distinct: ["projectId"],
          }),
          // From session results
          prisma.sessionResults.findMany({
            where: {
              issues: {
                some: {
                  id: issueId,
                },
              },
              session: { isDeleted: false },
            },
            select: {
              sessionId: true,
            },
          }),
          // From test runs
          prisma.testRuns.findMany({
            where: {
              isDeleted: false,
              issues: { some: { id: issueId } },
            },
            select: { projectId: true },
            distinct: ["projectId"],
          }),
          // From test run results
          prisma.testRunResults.findMany({
            where: {
              issues: {
                some: {
                  id: issueId,
                },
              },
              testRun: { isDeleted: false },
            },
            select: {
              testRunId: true,
            },
          }),
          // From test run step results
          prisma.testRunStepResults.findMany({
            where: {
              issues: {
                some: {
                  id: issueId,
                },
              },
              testRunResult: {
                testRun: { isDeleted: false },
              },
            },
            select: {
              testRunResultId: true,
            },
          }),
        ]);

        // Fetch project IDs from session IDs and test run IDs
        const sessionIdsFromResults = sessionResultProjectIds.map(sr => sr.sessionId);
        const testRunIdsFromResults = runResultProjectIds.map(rr => rr.testRunId);
        const testRunResultIdsFromStepResults = stepResultProjectIds.map(srr => srr.testRunResultId);

        // Fetch sessions to get their project IDs
        const sessionsFromResults = sessionIdsFromResults.length > 0
          ? await prisma.sessions.findMany({
              where: { id: { in: sessionIdsFromResults } },
              select: { projectId: true },
            })
          : [];

        // Fetch test runs to get their project IDs
        const testRunsFromResults = testRunIdsFromResults.length > 0
          ? await prisma.testRuns.findMany({
              where: { id: { in: testRunIdsFromResults } },
              select: { projectId: true },
            })
          : [];

        // Fetch test run results to get test run IDs, then get their project IDs
        const testRunsFromStepResults = testRunResultIdsFromStepResults.length > 0
          ? await prisma.testRunResults.findMany({
              where: { id: { in: testRunResultIdsFromStepResults } },
              select: { testRunId: true },
            }).then(async (results) => {
              const testRunIds = results.map(r => r.testRunId);
              return testRunIds.length > 0
                ? await prisma.testRuns.findMany({
                    where: { id: { in: testRunIds } },
                    select: { projectId: true },
                  })
                : [];
            })
          : [];

        // Combine and deduplicate project IDs
        const uniqueProjectIds = [
          ...new Set([
            ...caseProjectIds.map((c) => c.projectId),
            ...sessionProjectIds.map((s) => s.projectId),
            ...sessionsFromResults.map((s) => s.projectId),
            ...runProjectIds.map((r) => r.projectId),
            ...testRunsFromResults.map((r) => r.projectId),
            ...testRunsFromStepResults.map((r) => r.projectId),
          ]),
        ];

        // Fetch actual project data with access control
        if (uniqueProjectIds.length === 0) {
          return { issueId, projects: [] };
        }

        const projects = await prisma.projects.findMany({
          where: {
            id: { in: uniqueProjectIds },
            isDeleted: false,
            ...projectAccessWhere,
          },
          select: {
            id: true,
            name: true,
            iconUrl: true,
          },
        });

        return { issueId, projects };
      })
    );

    // Convert to map for easy lookup
    const projectsMap = projectsData.reduce(
      (acc, item) => {
        acc[item.issueId] = item.projects;
        return acc;
      },
      {} as Record<
        number,
        Array<{ id: number; name: string; iconUrl: string | null }>
      >
    );

    return NextResponse.json({ projects: projectsMap });
  } catch (error) {
    console.error("Error fetching issue projects:", error);
    return NextResponse.json(
      { error: "Failed to fetch projects" },
      { status: 500 }
    );
  }
}
