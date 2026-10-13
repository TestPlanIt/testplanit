import { baseDb } from "~/lib/db";
import {
  resolveEffectiveProjectAccessForUsers,
  type EffectiveRoleSource,
} from "~/lib/services/effectiveRole";
import { getProjectEffectiveMemberIds } from "~/lib/services/projectMembers";

export type ProjectAccessSource =
  "SYSTEM_ADMIN" | "SYSTEM_PROJECT_ADMIN" | EffectiveRoleSource;

export interface ProjectAccessRosterEntry {
  userId: string;
  name: string;
  email: string | null;
  image: string | null;
  systemAccess: "ADMIN" | "PROJECTADMIN" | "USER";
  /** Null for system admins and project admins, whose system access decides. */
  effectiveRole: { id: number; name: string } | null;
  source: ProjectAccessSource;
}

/**
 * Every user who can open `projectId`, with the role that governs what they
 * may do there. Read-only; the caller authorizes.
 *
 * Membership comes from `getProjectEffectiveMemberIds` plus every active
 * system ADMIN, who reaches any project. System access is reported the way
 * `/api/get-user-permissions` reports it: ADMIN and PROJECTADMIN carry full
 * permissions, so no project role is resolved for them. Everyone else walks
 * the ladder in `effectiveRole.ts`; a member the ladder cannot resolve to a
 * role (assigned under a NO_ACCESS default, say) cannot open the project and
 * is left out.
 */
export async function getProjectAccessRoster(
  projectId: number
): Promise<ProjectAccessRosterEntry[]> {
  const memberIds = await getProjectEffectiveMemberIds(projectId);

  const users = await baseDb.user.findMany({
    where: {
      isActive: true,
      isDeleted: false,
      OR: [{ id: { in: memberIds } }, { access: "ADMIN" }],
    },
    select: { id: true, name: true, email: true, image: true, access: true },
  });

  const ladderUserIds = users
    .filter((u) => u.access !== "ADMIN" && u.access !== "PROJECTADMIN")
    .map((u) => u.id);
  const resolutions = await resolveEffectiveProjectAccessForUsers(
    ladderUserIds,
    projectId,
    baseDb
  );

  const roleIds = Array.from(
    new Set(
      Array.from(resolutions.values())
        .map((r) => r.roleId)
        .filter((id): id is number => id !== null)
    )
  );
  const roles =
    roleIds.length === 0
      ? []
      : await baseDb.roles.findMany({
          where: { id: { in: roleIds } },
          select: { id: true, name: true },
        });
  const roleById = new Map(roles.map((r) => [r.id, r]));

  const entries: ProjectAccessRosterEntry[] = [];
  for (const user of users) {
    const base = {
      userId: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
    };

    if (user.access === "ADMIN") {
      entries.push({
        ...base,
        systemAccess: "ADMIN",
        effectiveRole: null,
        source: "SYSTEM_ADMIN",
      });
      continue;
    }
    if (user.access === "PROJECTADMIN") {
      entries.push({
        ...base,
        systemAccess: "PROJECTADMIN",
        effectiveRole: null,
        source: "SYSTEM_PROJECT_ADMIN",
      });
      continue;
    }

    const resolution = resolutions.get(user.id);
    const role =
      resolution?.roleId != null ? roleById.get(resolution.roleId) : undefined;
    if (!resolution?.source || !role) continue;

    entries.push({
      ...base,
      systemAccess: "USER",
      effectiveRole: role,
      source: resolution.source,
    });
  }

  return entries.sort((a, b) => a.name.localeCompare(b.name));
}
