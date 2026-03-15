import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { prisma } from "~/lib/prisma";
import { authOptions } from "~/server/auth";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { projectIds } = body as { projectIds: number[] };

    if (!Array.isArray(projectIds) || projectIds.length === 0) {
      return NextResponse.json({ counts: {} });
    }

    // Use a single optimized query with UNION to find all issues related to projects
    // This is much faster than N separate queries with complex OR conditions
    const results = await prisma.$queryRaw<{ projectId: number; issueCount: bigint }[]>`
      SELECT
        project_id as "projectId",
        COUNT(DISTINCT issue_id) as "issueCount"
      FROM (
        -- Issues linked through RepositoryCases
        SELECT DISTINCT rc."projectId" as project_id, i.id as issue_id
        FROM "Issue" i
        INNER JOIN "_IssueToRepositoryCases" irc ON i.id = irc."A"
        INNER JOIN "RepositoryCases" rc ON irc."B" = rc.id
        WHERE i."isDeleted" = false
          AND rc."projectId" = ANY(${projectIds}::int[])

        UNION

        -- Issues linked through Sessions
        SELECT DISTINCT s."projectId" as project_id, i.id as issue_id
        FROM "Issue" i
        INNER JOIN "_IssueToSessions" is2 ON i.id = is2."A"
        INNER JOIN "Sessions" s ON is2."B" = s.id
        WHERE i."isDeleted" = false
          AND s."projectId" = ANY(${projectIds}::int[])

        UNION

        -- Issues linked through TestRuns
        SELECT DISTINCT tr."projectId" as project_id, i.id as issue_id
        FROM "Issue" i
        INNER JOIN "_IssueToTestRuns" itr ON i.id = itr."A"
        INNER JOIN "TestRuns" tr ON itr."B" = tr.id
        WHERE i."isDeleted" = false
          AND tr."projectId" = ANY(${projectIds}::int[])

        UNION

        -- Issues linked through SessionResults
        SELECT DISTINCT s."projectId" as project_id, i.id as issue_id
        FROM "Issue" i
        INNER JOIN "_IssueToSessionResults" isr ON i.id = isr."A"
        INNER JOIN "SessionResults" sr ON isr."B" = sr.id
        INNER JOIN "Sessions" s ON sr."sessionId" = s.id
        WHERE i."isDeleted" = false
          AND s."projectId" = ANY(${projectIds}::int[])

        UNION

        -- Issues linked through TestRunResults
        SELECT DISTINCT tr."projectId" as project_id, i.id as issue_id
        FROM "Issue" i
        INNER JOIN "_IssueToTestRunResults" itrr ON i.id = itrr."A"
        INNER JOIN "TestRunResults" trr ON itrr."B" = trr.id
        INNER JOIN "TestRuns" tr ON trr."testRunId" = tr.id
        WHERE i."isDeleted" = false
          AND tr."projectId" = ANY(${projectIds}::int[])

        UNION

        -- Issues linked through TestRunStepResults
        SELECT DISTINCT tr."projectId" as project_id, i.id as issue_id
        FROM "Issue" i
        INNER JOIN "_IssueToTestRunStepResults" itrsr ON i.id = itrsr."A"
        INNER JOIN "TestRunStepResults" trsr ON itrsr."B" = trsr.id
        INNER JOIN "TestRunResults" trr ON trsr."testRunResultId" = trr.id
        INNER JOIN "TestRuns" tr ON trr."testRunId" = tr.id
        WHERE i."isDeleted" = false
          AND tr."projectId" = ANY(${projectIds}::int[])
      ) AS all_issues
      GROUP BY project_id
    `;

    // Convert bigint to number and create the counts map
    const countsMap = results.reduce(
      (acc, item) => {
        acc[item.projectId] = Number(item.issueCount);
        return acc;
      },
      {} as Record<number, number>
    );

    // Ensure all requested projectIds are in the result (with 0 if no issues)
    projectIds.forEach((projectId) => {
      if (!(projectId in countsMap)) {
        countsMap[projectId] = 0;
      }
    });

    return NextResponse.json({ counts: countsMap });
  } catch (error) {
    console.error("Error fetching project issue counts:", error);
    return NextResponse.json(
      { error: "Failed to fetch project issue counts" },
      { status: 500 }
    );
  }
}
