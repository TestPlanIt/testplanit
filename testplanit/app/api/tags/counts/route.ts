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
    const { tagIds } = body as { tagIds: number[] };

    if (!Array.isArray(tagIds) || tagIds.length === 0) {
      return NextResponse.json({ counts: {} });
    }

    const isAdmin = session.user.access === "ADMIN";

    // Build the where clause for project access
    const projectAccessWhere = isAdmin
      ? {}
      : {
          project: {
            userPermissions: {
              some: {
                userId: session.user.id,
              },
            },
          },
        };

    // Fetch counts for each tag using individual queries
    // This avoids the bind variable explosion from complex joins
    const counts = await Promise.all(
      tagIds.map(async (tagId) => {
        const [repositoryCasesCount, sessionsCount, testRunsCount] =
          await Promise.all([
            prisma.repositoryCases.count({
              where: {
                isDeleted: false,
                tags: { some: { id: tagId } },
                ...projectAccessWhere,
              },
            }),
            prisma.sessions.count({
              where: {
                isDeleted: false,
                tags: { some: { id: tagId } },
                ...projectAccessWhere,
              },
            }),
            prisma.testRuns.count({
              where: {
                isDeleted: false,
                tags: { some: { id: tagId } },
                ...projectAccessWhere,
              },
            }),
          ]);

        return {
          tagId,
          repositoryCasesCount,
          sessionsCount,
          testRunsCount,
        };
      })
    );

    // Convert to map for easy lookup
    const countsMap = counts.reduce(
      (acc, item) => {
        acc[item.tagId] = {
          repositoryCases: item.repositoryCasesCount,
          sessions: item.sessionsCount,
          testRuns: item.testRunsCount,
        };
        return acc;
      },
      {} as Record<number, { repositoryCases: number; sessions: number; testRuns: number }>
    );

    return NextResponse.json({ counts: countsMap });
  } catch (error) {
    console.error("Error fetching tag counts:", error);
    return NextResponse.json(
      { error: "Failed to fetch counts" },
      { status: 500 }
    );
  }
}
