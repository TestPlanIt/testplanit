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
    const { tagIds } = body as { tagIds: number[] };

    if (!Array.isArray(tagIds) || tagIds.length === 0) {
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
