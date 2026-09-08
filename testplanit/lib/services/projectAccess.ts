import { baseDb } from "~/lib/db";
import { ProjectAccessType } from "~/zenstack/models";

/**
 * Whether a user (identified by id + global access level) may access a project.
 * This is the same access model the token-authenticated routes and the Forge
 * (Jira panel) endpoints enforce: an ADMIN reaches any project; otherwise the
 * user needs a direct user permission, a group permission, the project's
 * GLOBAL_ROLE default, or (for PROJECTADMIN) an explicit project assignment —
 * all excluding NO_ACCESS.
 */
export async function userHasProjectAccess(
  user: { id: string; access: string | null | undefined },
  projectId: number
): Promise<boolean> {
  const isAdmin = user.access === "ADMIN";
  const isProjectAdmin = user.access === "PROJECTADMIN";

  const where = isAdmin
    ? { id: projectId, isDeleted: false }
    : {
        id: projectId,
        isDeleted: false,
        OR: [
          {
            userPermissions: {
              some: {
                userId: user.id,
                accessType: { not: ProjectAccessType.NO_ACCESS },
              },
            },
          },
          {
            groupPermissions: {
              some: {
                group: { assignedUsers: { some: { userId: user.id } } },
                accessType: { not: ProjectAccessType.NO_ACCESS },
              },
            },
          },
          { defaultAccessType: ProjectAccessType.GLOBAL_ROLE },
          ...(isProjectAdmin
            ? [{ assignedUsers: { some: { userId: user.id } } }]
            : []),
        ],
      };

  const project = await baseDb.projects.findFirst({
    where,
    select: { id: true },
  });
  return !!project;
}
