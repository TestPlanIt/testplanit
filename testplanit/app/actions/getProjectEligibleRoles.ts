"use server";

import { prisma } from "~/lib/prisma";
import { getProjectEffectiveMembers } from "./getProjectEffectiveMembers";

/**
 * Resolve the roles that are pickable as a review assignee for a project.
 *
 * A role appears in the list only when at least one of its holders has
 * effective access to the project. When you assign a review to a role, the
 * decide path resolves the role to its (project-eligible) holders; a role
 * with zero project-eligible holders is a dead-end assignment — the
 * request would have no one able to act on it. Hiding those roles from
 * the picker prevents that footgun.
 *
 * Counts are also project-scoped: `userCount` is the number of holders
 * who are effective project members, not the global role membership.
 * Matches the count the requester will actually see in their "Pending"
 * column for that role.
 *
 * Returns an empty array on any failure rather than throwing — the
 * AssigneeCombobox already falls back to the users page when roles are
 * unavailable, and an unhealthy roles fetch should not block the user
 * from picking a user-kind reviewer.
 */
export async function getProjectEligibleRoles(projectId: number): Promise<
  Array<{
    id: number;
    name: string;
    userCount: number;
  }>
> {
  try {
    const effectiveMemberIds = await getProjectEffectiveMembers(projectId);
    if (effectiveMemberIds.length === 0) {
      return [];
    }

    const roles = await prisma.roles.findMany({
      where: {
        isDeleted: false,
        users: {
          some: {
            id: { in: effectiveMemberIds },
            isActive: true,
            isDeleted: false,
          },
        },
      },
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            users: {
              where: {
                id: { in: effectiveMemberIds },
                isActive: true,
                isDeleted: false,
              },
            },
          },
        },
      },
      orderBy: { name: "asc" },
    });

    return roles.map((r) => ({
      id: r.id,
      name: r.name,
      userCount: r._count?.users ?? 0,
    }));
  } catch (error) {
    console.error("Error fetching project eligible roles:", error);
    return [];
  }
}
