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
    const { projectIds } = body as { projectIds: number[] };

    if (!Array.isArray(projectIds) || projectIds.length === 0) {
      return NextResponse.json({ counts: {} });
    }

    // Fetch issue counts for each project using the same filter logic as the Project Issues page
    const counts = await Promise.all(
      projectIds.map(async (projectId) => {
        // Count issues that are associated with this project through any relationship
        // This matches the filter used in app/[locale]/projects/issues/[projectId]/page.tsx
        const issueCount = await prisma.issue.count({
          where: {
            isDeleted: false,
            OR: [
              { repositoryCases: { some: { projectId } } },
              { sessions: { some: { projectId } } },
              { testRuns: { some: { projectId } } },
              {
                sessionResults: {
                  some: { session: { projectId } },
                },
              },
              {
                testRunResults: {
                  some: { testRun: { projectId } },
                },
              },
              {
                testRunStepResults: {
                  some: {
                    testRunResult: { testRun: { projectId } },
                  },
                },
              },
            ],
          },
        });

        return {
          projectId,
          issueCount,
        };
      })
    );

    // Convert to map for easy lookup
    const countsMap = counts.reduce(
      (acc, item) => {
        acc[item.projectId] = item.issueCount;
        return acc;
      },
      {} as Record<number, number>
    );

    return NextResponse.json({ counts: countsMap });
  } catch (error) {
    console.error("Error fetching project issue counts:", error);
    return NextResponse.json(
      { error: "Failed to fetch project issue counts" },
      { status: 500 }
    );
  }
}
