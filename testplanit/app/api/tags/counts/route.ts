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

    // Fetch all requested tags with their linked entities in ONE tag-driven
    // query. Driving from the tag side (a small set of ids) makes the m2m
    // relation loads compile to join lookups keyed by the tag ids, instead of
    // the correlated EXISTS subqueries ZenStack v3 generates for
    // `tags: { some: { id } }` filters — those scanned the large
    // RepositoryCases / TestRuns tables once per tag. Counts are derived in
    // memory; each linked row is distinct per (entity, tag) so a plain
    // length is the distinct count.
    const tags = await baseDb.tags.findMany({
      where: { id: { in: tagIds } },
      select: {
        id: true,
        caseTags: {
          where: { case: { isDeleted: false, ...projectAccessWhere } },
          select: { caseId: true },
        },
        sessions: {
          where: { isDeleted: false, ...projectAccessWhere },
          select: { id: true },
        },
        testRuns: {
          where: { isDeleted: false, ...projectAccessWhere },
          select: { id: true },
        },
      },
    });

    const countsMap: Record<
      number,
      { repositoryCases: number; sessions: number; testRuns: number }
    > = {};

    for (const tag of tags) {
      countsMap[tag.id] = {
        repositoryCases: tag.caseTags.length,
        sessions: tag.sessions.length,
        testRuns: tag.testRuns.length,
      };
    }

    // Ensure every requested id has an entry (tag not found / no links).
    for (const id of tagIds) {
      if (!countsMap[id]) {
        countsMap[id] = { repositoryCases: 0, sessions: 0, testRuns: 0 };
      }
    }

    return NextResponse.json({ counts: countsMap });
  } catch (error) {
    console.error("Error fetching tag counts:", error);
    return NextResponse.json(
      { error: "Failed to fetch counts" },
      { status: 500 }
    );
  }
}
