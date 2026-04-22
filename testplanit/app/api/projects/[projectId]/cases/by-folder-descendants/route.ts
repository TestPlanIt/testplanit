import { ProjectAccessType } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { prisma } from "~/lib/prisma";
import { authOptions } from "~/server/auth";

// Accepts the same `where` / `orderBy` / `select` that the ZenStack
// useFindManyRepositoryCases hook would build client-side. We POST instead of
// GET so a deep folder tree (which expands into a very large `folderId: { in: [...] }`
// array) can't push the request past the HTTP 414 URI limit.
const requestSchema = z.object({
  folderId: z.number().int(),
  where: z.record(z.string(), z.any()).optional(),
  orderBy: z
    .union([
      z.record(z.string(), z.any()),
      z.array(z.record(z.string(), z.any())),
    ])
    .optional(),
  select: z.record(z.string(), z.any()).optional(),
  skip: z.number().int().nonnegative().optional(),
  take: z.number().int().nonnegative().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { projectId: projectIdParam } = await params;
    const projectId = parseInt(projectIdParam);
    if (isNaN(projectId)) {
      return NextResponse.json(
        { error: "Invalid project ID" },
        { status: 400 }
      );
    }

    const isAdmin = session.user.access === "ADMIN";
    const isProjectAdmin = session.user.access === "PROJECTADMIN";

    const projectAccessWhere = isAdmin
      ? { id: projectId, isDeleted: false }
      : {
          id: projectId,
          isDeleted: false,
          OR: [
            {
              userPermissions: {
                some: {
                  userId: session.user.id,
                  accessType: { not: ProjectAccessType.NO_ACCESS },
                },
              },
            },
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
            {
              defaultAccessType: ProjectAccessType.GLOBAL_ROLE,
            },
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

    const project = await prisma.projects.findFirst({
      where: projectAccessWhere,
    });

    if (!project) {
      return NextResponse.json(
        { error: "Project not found or access denied" },
        { status: 404 }
      );
    }

    const body = await request.json();
    const { folderId, where, orderBy, select, skip, take } =
      requestSchema.parse(body);

    // Walk the folder tree server-side. Returns the root plus every non-deleted
    // descendant within the same project. Keeps the wire payload bounded to one
    // folderId regardless of tree depth.
    const descendantRows = await prisma.$queryRaw<Array<{ id: number }>>`
      WITH RECURSIVE descendants AS (
        SELECT id
        FROM "RepositoryFolders"
        WHERE id = ${folderId}
          AND "projectId" = ${projectId}
          AND "isDeleted" = false
        UNION ALL
        SELECT f.id
        FROM "RepositoryFolders" f
        INNER JOIN descendants d ON f."parentId" = d.id
        WHERE f."projectId" = ${projectId}
          AND f."isDeleted" = false
      )
      SELECT id FROM descendants
    `;

    const descendantIds = descendantRows.map((r) => r.id);

    if (descendantIds.length === 0) {
      return NextResponse.json({
        cases: select ? [] : null,
        totalCount: 0,
      });
    }

    // Force projectId and folderId on the server so a client can't use this
    // endpoint to query cases outside the authorized project or folder subtree.
    const enforcedWhere = {
      ...(where ?? {}),
      projectId,
      folderId: { in: descendantIds },
    };

    const [totalCount, cases] = await Promise.all([
      prisma.repositoryCases.count({ where: enforcedWhere }),
      select
        ? prisma.repositoryCases.findMany({
            where: enforcedWhere,
            orderBy: orderBy as never,
            select: select as never,
            skip,
            take,
          })
        : Promise.resolve(null),
    ]);

    const serializedCases = cases
      ? cases.map((c: Record<string, unknown>) => {
          const attachments = (
            c as { attachments?: Array<Record<string, unknown>> }
          ).attachments;
          if (!attachments) return c;
          return {
            ...c,
            attachments: attachments.map((a) => ({
              ...a,
              size: typeof a.size === "bigint" ? a.size.toString() : a.size,
            })),
          };
        })
      : null;

    return NextResponse.json({ cases: serializedCases, totalCount });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data", details: error.issues },
        { status: 400 }
      );
    }

    console.error("Error fetching cases by folder descendants:", error);
    return NextResponse.json(
      { error: "Failed to fetch cases" },
      { status: 500 }
    );
  }
}
