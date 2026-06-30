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

    // Fetch all requested tags with the project ids they touch, driven from
    // the tag side so the m2m relation loads are join lookups keyed by the tag
    // ids rather than ZenStack v3 correlated-EXISTS scans of the large
    // RepositoryCases / TestRuns tables (which previously ran once per tag).
    const tags = await baseDb.tags.findMany({
      where: { id: { in: tagIds } },
      select: {
        id: true,
        caseTags: {
          where: { case: { isDeleted: false } },
          select: { case: { select: { projectId: true } } },
        },
        sessions: {
          where: { isDeleted: false },
          select: { projectId: true },
        },
        testRuns: {
          where: { isDeleted: false },
          select: { projectId: true },
        },
      },
    });

    // Collect the distinct project ids each tag touches, plus the union.
    const projectIdsByTag = new Map<number, Set<number>>();
    const allProjectIds = new Set<number>();
    for (const tag of tags) {
      const ids = new Set<number>();
      for (const ct of tag.caseTags) {
        const pid = ct.case?.projectId;
        if (pid != null) ids.add(pid);
      }
      for (const s of tag.sessions) {
        if (s.projectId != null) ids.add(s.projectId);
      }
      for (const r of tag.testRuns) {
        if (r.projectId != null) ids.add(r.projectId);
      }
      projectIdsByTag.set(tag.id, ids);
      ids.forEach((id) => allProjectIds.add(id));
    }

    // Fetch the accessible projects once (access control applied here).
    const accessibleProjects =
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
    const projectById = new Map(accessibleProjects.map((p) => [p.id, p]));

    // Build per-tag project lists (only accessible projects).
    const projectsMap: Record<
      number,
      Array<{ id: number; name: string; iconUrl: string | null }>
    > = {};
    for (const tagId of tagIds) {
      const ids = projectIdsByTag.get(tagId);
      projectsMap[tagId] = ids
        ? Array.from(ids)
            .map((id) => projectById.get(id))
            .filter(
              (p): p is { id: number; name: string; iconUrl: string | null } =>
                p != null
            )
        : [];
    }

    return NextResponse.json({ projects: projectsMap });
  } catch (error) {
    console.error("Error fetching tag projects:", error);
    return NextResponse.json(
      { error: "Failed to fetch projects" },
      { status: 500 }
    );
  }
}
