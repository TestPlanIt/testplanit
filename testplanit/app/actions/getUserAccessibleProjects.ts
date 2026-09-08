"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";
import { baseDb } from "~/lib/db";
import {
  collaboratorScopeIncludes,
  resolveAccessibleProjectIds,
  resolveCollaboratorScope,
  type CollaboratorScope,
} from "~/lib/authContext";

export interface AccessibleProject {
  id: number;
  name: string;
  iconUrl: string | null;
}

/**
 * Batched effective-project-access resolver.
 *
 * Computes the set of projects each of the given users can access, mirroring
 * the per-user rules in the `Projects` access policy: projects the user
 * created, explicit user permissions, explicit assignments, group
 * permissions, and role-based defaults (GLOBAL_ROLE / SPECIFIC_ROLE / DEFAULT),
 * minus explicit NO_ACCESS denials.
 *
 * Runs a constant number of set-based queries regardless of how many users are
 * requested. This lets a table of users resolve every row's projects in a
 * single round-trip instead of firing a ~8-query action per rendered row.
 *
 * Scoped to the caller: admins get every user's full project list; everyone
 * else gets only users inside their collaborator scope (matching the User read
 * policy), and for those users only the projects shared with the caller —
 * never the names of projects the caller cannot access themselves.
 */
export async function getUsersAccessibleProjects(
  userIds: string[]
): Promise<Record<string, AccessibleProject[]>> {
  const result: Record<string, AccessibleProject[]> = {};
  if (userIds.length === 0) {
    return result;
  }

  const session = await getServerSession(authOptions);
  const viewerId = session?.user?.id;
  if (!viewerId) {
    return result;
  }

  try {
    const viewer = await baseDb.user.findUnique({
      where: { id: viewerId },
      select: { access: true, roleId: true },
    });
    if (!viewer) {
      return result;
    }

    // null ⇒ unrestricted (ADMIN viewer).
    let viewerProjectIds: Set<number> | null = null;
    let collabScope: CollaboratorScope | null = null;
    if (viewer.access !== "ADMIN") {
      const viewerForAuth = {
        id: viewerId,
        access: viewer.access,
        roleId: viewer.roleId,
      };
      const ids = await resolveAccessibleProjectIds(viewerForAuth);
      collabScope = await resolveCollaboratorScope(viewerForAuth, ids);
      viewerProjectIds = new Set(ids);
    }
    const [allProjects, users, permissions, assignments] = await Promise.all([
      // Every live project, with the fields needed to both classify default
      // access and render the badge. This one fetch replaces the per-user
      // all-projects / GLOBAL_ROLE / SPECIFIC_ROLE / DEFAULT queries.
      baseDb.projects.findMany({
        where: { isDeleted: false },
        select: {
          id: true,
          name: true,
          iconUrl: true,
          createdBy: true,
          defaultAccessType: true,
          defaultRoleId: true,
        },
      }),
      baseDb.user.findMany({
        where: { id: { in: userIds } },
        select: {
          id: true,
          access: true,
          roleId: true,
          groups: {
            select: {
              group: {
                select: {
                  projectPermissions: {
                    select: { projectId: true, accessType: true },
                  },
                },
              },
            },
          },
        },
      }),
      baseDb.userProjectPermission.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true, projectId: true, accessType: true },
      }),
      baseDb.projectAssignment.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true, projectId: true },
      }),
    ]);

    // Project detail lookup + default-access classification. Deleted projects
    // are absent from this map, so any stale reference to one (a group
    // permission or assignment pointing at a since-deleted project) is dropped
    // when ids are resolved back to details below.
    const projectById = new Map<number, AccessibleProject>();
    const createdByUser = new Map<string, number[]>();
    const globalRoleProjectIds: number[] = [];
    const specificRoleProjectIds: number[] = [];
    const defaultProjectIds: number[] = [];
    for (const p of allProjects) {
      projectById.set(p.id, { id: p.id, name: p.name, iconUrl: p.iconUrl });
      if (p.createdBy) {
        const created = createdByUser.get(p.createdBy) ?? [];
        created.push(p.id);
        createdByUser.set(p.createdBy, created);
      }
      if (p.defaultAccessType === "GLOBAL_ROLE") {
        globalRoleProjectIds.push(p.id);
      } else if (
        p.defaultAccessType === "SPECIFIC_ROLE" &&
        p.defaultRoleId !== null
      ) {
        specificRoleProjectIds.push(p.id);
      } else if (p.defaultAccessType === "DEFAULT") {
        defaultProjectIds.push(p.id);
      }
    }
    const allProjectIds = allProjects.map((p) => p.id);

    // Bucket the per-user rows so each user is assembled from in-memory lookups.
    const permsByUser = new Map<string, number[]>();
    const deniedByUser = new Map<string, Set<number>>();
    for (const perm of permissions) {
      if (perm.accessType === "NO_ACCESS") {
        const denied = deniedByUser.get(perm.userId) ?? new Set<number>();
        denied.add(perm.projectId);
        deniedByUser.set(perm.userId, denied);
      } else {
        const perms = permsByUser.get(perm.userId) ?? [];
        perms.push(perm.projectId);
        permsByUser.set(perm.userId, perms);
      }
    }
    const assignmentsByUser = new Map<string, number[]>();
    for (const assignment of assignments) {
      const assigned = assignmentsByUser.get(assignment.userId) ?? [];
      assigned.push(assignment.projectId);
      assignmentsByUser.set(assignment.userId, assigned);
    }
    const userById = new Map(users.map((u) => [u.id, u]));

    const toProjects = (ids: Iterable<number>): AccessibleProject[] => {
      const out: AccessibleProject[] = [];
      const seen = new Set<number>();
      for (const id of ids) {
        if (seen.has(id)) continue;
        // Non-admin callers only ever learn about projects they share with
        // the target — never the names of projects outside their own set.
        if (viewerProjectIds && !viewerProjectIds.has(id)) continue;
        const detail = projectById.get(id);
        if (detail) {
          seen.add(id);
          out.push(detail);
        }
      }
      out.sort((a, b) => a.name.localeCompare(b.name));
      return out;
    };

    for (const userId of userIds) {
      const user = userById.get(userId);

      // Unknown user or no system access -> no projects.
      if (!user || user.access === "NONE") {
        result[userId] = [];
        continue;
      }

      // Users outside the caller's collaborator scope resolve to nothing,
      // mirroring the User read policy (their row is not readable either).
      if (
        collabScope &&
        userId !== viewerId &&
        !collaboratorScopeIncludes(collabScope, {
          id: userId,
          access: user.access,
        })
      ) {
        result[userId] = [];
        continue;
      }

      // ADMIN sees every project.
      if (user.access === "ADMIN") {
        result[userId] = toProjects(allProjectIds);
        continue;
      }

      const denied = deniedByUser.get(userId) ?? new Set<number>();
      const projectIds = new Set<number>();

      // Explicit access sources are added unconditionally.
      for (const id of createdByUser.get(userId) ?? []) projectIds.add(id);
      for (const id of permsByUser.get(userId) ?? []) projectIds.add(id);
      for (const id of assignmentsByUser.get(userId) ?? []) projectIds.add(id);

      // Group permissions, unless the user is explicitly denied.
      for (const membership of user.groups) {
        for (const gp of membership.group.projectPermissions) {
          if (gp.accessType !== "NO_ACCESS" && !denied.has(gp.projectId)) {
            projectIds.add(gp.projectId);
          }
        }
      }

      // Role-based project defaults, unless the user is explicitly denied.
      if (user.roleId) {
        for (const id of globalRoleProjectIds) {
          if (!denied.has(id)) projectIds.add(id);
        }
      }
      for (const id of specificRoleProjectIds) {
        if (!denied.has(id)) projectIds.add(id);
      }
      for (const id of defaultProjectIds) {
        if (!denied.has(id)) projectIds.add(id);
      }

      result[userId] = toProjects(projectIds);
    }

    return result;
  } catch (error) {
    console.error("Error getting users accessible projects:", error);
    return result;
  }
}

/**
 * Single-user convenience wrapper preserving the historical `{ projectId }[]`
 * shape relied on by API-route access checks.
 */
export async function getUserAccessibleProjects(
  userId: string
): Promise<{ projectId: number }[]> {
  const map = await getUsersAccessibleProjects([userId]);
  return (map[userId] ?? []).map((p) => ({ projectId: p.id }));
}
