import { NextRequest, NextResponse } from "next/server";
import { getServerAuthSession } from "~/server/auth";
import { db } from "~/server/db";

export async function GET(request: NextRequest) {
  const session = await getServerAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q") || "";
  const projectIdStr = searchParams.get("projectId");

  if (!projectIdStr) {
    return NextResponse.json(
      { error: "projectId is required" },
      { status: 400 }
    );
  }

  const projectId = parseInt(projectIdStr, 10);

  if (isNaN(projectId)) {
    return NextResponse.json({ error: "Invalid projectId" }, { status: 400 });
  }

  try {
    // First, fetch the project to check its defaultAccessType
    const project = await db.projects.findUnique({
      where: { id: projectId },
      select: {
        defaultAccessType: true,
        assignedUsers: {
          where: { user: { isActive: true, isDeleted: false } },
          select: { userId: true },
        },
        groupPermissions: {
          select: {
            accessType: true,
            group: {
              select: {
                assignedUsers: {
                  where: { user: { isActive: true, isDeleted: false } },
                  select: { userId: true },
                },
              },
            },
          },
        },
      },
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Calculate effective project members using the same logic as processProjectsWithEffectiveMembers
    const directUserIds = new Set(project.assignedUsers.map((a) => a.userId));
    const groupUserIds = new Set<string>();

    // Include users from groups that have access (not NO_ACCESS)
    project.groupPermissions?.forEach((perm) => {
      if (perm.accessType !== "NO_ACCESS") {
        perm.group?.assignedUsers?.forEach((assignment) => {
          groupUserIds.add(assignment.userId);
        });
      }
    });

    // For GLOBAL_ROLE or SPECIFIC_ROLE: all active users (except access === 'NONE') are members
    const includeAllActiveUsers =
      project.defaultAccessType === "GLOBAL_ROLE" ||
      project.defaultAccessType === "SPECIFIC_ROLE";

    // Search for users matching the query
    const users = await db.user.findMany({
      where: {
        AND: [
          {
            OR: [
              { name: { contains: query, mode: "insensitive" } },
              { email: { contains: query, mode: "insensitive" } },
            ],
          },
          // Include inactive/deleted users so they can be mentioned if needed
          // but they'll be marked as such in the UI
        ],
      },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        isActive: true,
        isDeleted: true,
        access: true,
      },
      take: 10,
      orderBy: [
        { isActive: "desc" },
        { isDeleted: "asc" },
        { name: "asc" },
      ],
    });

    // Map users to mention user format and check if they are project members
    const mentionUsers = users.map((user) => {
      // Check if user is a project member using the same logic as MemberList:
      // 1. Direct assignment
      // 2. Group-based assignment
      // 3. Default access (GLOBAL_ROLE or SPECIFIC_ROLE) for active users with access !== 'NONE'
      const isDirectMember = directUserIds.has(user.id);
      const isGroupMember = groupUserIds.has(user.id);
      const isDefaultAccessMember =
        includeAllActiveUsers &&
        user.isActive &&
        !user.isDeleted &&
        user.access !== "NONE";

      const isProjectMember =
        isDirectMember || isGroupMember || isDefaultAccessMember;

      return {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        isProjectMember,
        isActive: user.isActive,
        isDeleted: user.isDeleted,
      };
    });

    return NextResponse.json({ users: mentionUsers });
  } catch (error) {
    console.error("Error searching for mention users:", error);
    return NextResponse.json(
      { error: "Failed to search users" },
      { status: 500 }
    );
  }
}
