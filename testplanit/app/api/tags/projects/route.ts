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

    // For each tag, fetch a small sample of projects from different sources
    const projectsData = await Promise.all(
      tagIds.map(async (tagId) => {
        // Fetch all distinct project IDs from each relation type
        // No need to limit since we're using direct Prisma queries (no bind variable issues)
        const [caseProjectIds, sessionProjectIds, runProjectIds] =
          await Promise.all([
            prisma.repositoryCases.findMany({
              where: {
                isDeleted: false,
                tags: { some: { id: tagId } },
              },
              select: { projectId: true },
              distinct: ["projectId"],
            }),
            prisma.sessions.findMany({
              where: {
                isDeleted: false,
                tags: { some: { id: tagId } },
              },
              select: { projectId: true },
              distinct: ["projectId"],
            }),
            prisma.testRuns.findMany({
              where: {
                isDeleted: false,
                tags: { some: { id: tagId } },
              },
              select: { projectId: true },
              distinct: ["projectId"],
            }),
          ]);

        // Combine and deduplicate project IDs
        const uniqueProjectIds = [
          ...new Set([
            ...caseProjectIds.map((c) => c.projectId),
            ...sessionProjectIds.map((s) => s.projectId),
            ...runProjectIds.map((r) => r.projectId),
          ]),
        ];

        // Fetch actual project data with access control
        if (uniqueProjectIds.length === 0) {
          return { tagId, projects: [] };
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

        return { tagId, projects };
      })
    );

    // Convert to map for easy lookup
    const projectsMap = projectsData.reduce(
      (acc, item) => {
        acc[item.tagId] = item.projects;
        return acc;
      },
      {} as Record<number, Array<{ id: number; name: string; iconUrl: string | null }>>
    );

    return NextResponse.json({ projects: projectsMap });
  } catch (error) {
    console.error("Error fetching tag projects:", error);
    return NextResponse.json(
      { error: "Failed to fetch projects" },
      { status: 500 }
    );
  }
}
