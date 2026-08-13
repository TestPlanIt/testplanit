import { ProjectAccessType } from "~/zenstack/models";
import { baseDb } from "~/lib/db";
import valkeyConnection from "./valkey";

/**
 * Cache for the resolved accessible-project id list.
 *
 * 60s to match MANIFEST_CACHE_TTL_SECONDS in ./access-manifest, which caches the
 * same class of data (project defaults + user/group permissions + assignments)
 * read from the same tables. Both are permission data with the same staleness
 * consequence, so they should expire on the same clock.
 */
const PROJECT_IDS_CACHE_TTL_SECONDS = 60;
const PROJECT_IDS_CACHE_PREFIX = "acl:projectids:";

/**
 * `access` and `roleId` are part of the key, not just the user id.
 *
 * Both feed the precedence ladder below, so a global role or access-level change
 * alters the answer. Keying on them means such a change lands on a different key
 * and takes effect IMMEDIATELY rather than after the TTL. What the 60s window
 * still covers is a change to the permission tables themselves — a granted or
 * revoked UserProjectPermission / GroupProjectPermission / ProjectAssignment, a
 * project default, or group membership.
 */
function projectIdsCacheKey(user: UserForAuth): string {
  return `${PROJECT_IDS_CACHE_PREFIX}${user.id}:${user.access}:${user.roleId ?? "none"}`;
}

/**
 * The user shape callers already have in hand — a User row loaded with its role
 * and that role's permission grid. Matches `getUserWithRole` and the
 * `include: { role: { include: { rolePermissions: true } } }` fetch used by the
 * export and stream routes.
 */
export interface UserForAuth {
  id: string;
  access: string;
  roleId: number | null;
  role?: {
    id: number;
    name: string;
    rolePermissions?: Array<{
      area: string;
      canAddEdit: boolean;
      canDelete: boolean;
      canClose: boolean;
      canReadSensitive: boolean;
      canApprove: boolean;
    }> | null;
  } | null;
}

/**
 * Resolve every project this user may read. Cache-aside over Valkey with a 60s
 * TTL; see PROJECT_IDS_CACHE_TTL_SECONDS and projectIdsCacheKey above for what
 * the window does and does not cover, and buildAuthContext for why caching is
 * acceptable here at all.
 *
 * This reproduces the precedence ladder the per-model read rules used to
 * evaluate per row. A project qualifies when any branch holds:
 *
 *   1. the user created it
 *   2. a UserProjectPermission row with SPECIFIC_ROLE
 *   3. a UserProjectPermission row with GLOBAL_ROLE
 *   4. membership of a group whose GroupProjectPermission grants SPECIFIC_ROLE
 *      (with a role) or GLOBAL_ROLE (and the user carries a global role)
 *   5. project default GLOBAL_ROLE, the user has a global role, access != NONE
 *   6. an explicit ProjectAssignment plus project default SPECIFIC_ROLE with a
 *      default role
 *   7. project default SPECIFIC_ROLE with a default role, access != NONE
 *   8. project default DEFAULT, access != NONE
 *
 * A per-user NO_ACCESS permission removes the project whichever branch added
 * it — this is the `@@deny('read', …NO_ACCESS…)` rule that used to sit beside
 * each read policy, folded in here so the id list is self-contained.
 *
 * Soft-deleted projects are NOT filtered out: the previous predicates did not
 * consider `Projects.isDeleted`, and every model already filters its own
 * `isDeleted` at query time. Excluding them here would silently narrow access
 * relative to the rules this replaces.
 */
export async function resolveAccessibleProjectIds(
  user: UserForAuth
): Promise<number[]> {
  const key = projectIdsCacheKey(user);

  if (valkeyConnection) {
    try {
      const raw = await valkeyConnection.get(key);
      if (raw) return JSON.parse(raw) as number[];
    } catch {
      // fall through to the DB — a cache outage must not deny access
    }
  }

  const ids = await computeAccessibleProjectIds(user);

  if (valkeyConnection) {
    try {
      await valkeyConnection.set(
        key,
        JSON.stringify(ids),
        "EX",
        PROJECT_IDS_CACHE_TTL_SECONDS
      );
    } catch {
      // non-fatal
    }
  }

  return ids;
}

/**
 * Invalidate one user's resolved project list. Call wherever permissions, role
 * assignments, group membership, or project defaults change.
 *
 * NOTE: ./access-manifest exports the equivalent `invalidateAccessManifest`, and
 * as of 2026-08-13 it has NO callers anywhere — that cache relies purely on TTL
 * expiry. Wiring both from the permission-mutation endpoints is a follow-up; do
 * them together, since they cache the same underlying data.
 */
export async function invalidateAccessibleProjectIds(
  userId: string
): Promise<void> {
  if (!valkeyConnection) return;
  try {
    const keys = await valkeyConnection.keys(
      `${PROJECT_IDS_CACHE_PREFIX}${userId}:*`
    );
    if (keys.length > 0) {
      await valkeyConnection.del(...keys);
    }
  } catch {
    // non-fatal
  }
}

/**
 * Invalidate every user's resolved project list. Call when a change affects many
 * users at once — a project's defaultAccessType, or a role's permission grid.
 */
export async function invalidateAllAccessibleProjectIds(): Promise<void> {
  if (!valkeyConnection) return;
  try {
    const keys = await valkeyConnection.keys(`${PROJECT_IDS_CACHE_PREFIX}*`);
    if (keys.length > 0) {
      await valkeyConnection.del(...keys);
    }
  } catch {
    // non-fatal
  }
}

/**
 * The uncached computation. Four queries in one round of parallelism; see
 * resolveAccessibleProjectIds for why the result is cached.
 */
async function computeAccessibleProjectIds(
  user: UserForAuth
): Promise<number[]> {
  const hasGlobalRole = user.roleId != null;
  const notNoAccess = user.access !== "NONE";

  const [projects, userPerms, groupPerms, assignments] = await Promise.all([
    baseDb.projects.findMany({
      select: {
        id: true,
        createdBy: true,
        defaultAccessType: true,
        defaultRoleId: true,
      },
    }),
    baseDb.userProjectPermission.findMany({
      where: { userId: user.id },
      select: { projectId: true, accessType: true },
    }),
    baseDb.groupProjectPermission.findMany({
      where: { group: { assignedUsers: { some: { userId: user.id } } } },
      select: { projectId: true, accessType: true, roleId: true },
    }),
    baseDb.projectAssignment.findMany({
      where: { userId: user.id },
      select: { projectId: true },
    }),
  ]);

  const userPermByProject = new Map(
    userPerms.map((p) => [p.projectId, p.accessType])
  );
  const assignedProjectIds = new Set(assignments.map((a) => a.projectId));

  const groupGrantedProjectIds = new Set<number>();
  for (const perm of groupPerms) {
    if (
      (perm.accessType === ProjectAccessType.SPECIFIC_ROLE &&
        perm.roleId != null) ||
      (perm.accessType === ProjectAccessType.GLOBAL_ROLE && hasGlobalRole)
    ) {
      groupGrantedProjectIds.add(perm.projectId);
    }
  }

  const accessible: number[] = [];
  for (const project of projects) {
    // A per-user NO_ACCESS row outranks every grant below.
    if (userPermByProject.get(project.id) === ProjectAccessType.NO_ACCESS) {
      continue;
    }

    const userPerm = userPermByProject.get(project.id);
    const granted =
      project.createdBy === user.id ||
      userPerm === ProjectAccessType.SPECIFIC_ROLE ||
      userPerm === ProjectAccessType.GLOBAL_ROLE ||
      groupGrantedProjectIds.has(project.id) ||
      (project.defaultAccessType === ProjectAccessType.GLOBAL_ROLE &&
        hasGlobalRole &&
        notNoAccess) ||
      (assignedProjectIds.has(project.id) &&
        project.defaultAccessType === ProjectAccessType.SPECIFIC_ROLE &&
        project.defaultRoleId != null) ||
      (project.defaultAccessType === ProjectAccessType.SPECIFIC_ROLE &&
        project.defaultRoleId != null &&
        notNoAccess) ||
      (project.defaultAccessType === ProjectAccessType.DEFAULT && notNoAccess);

    if (granted) accessible.push(project.id);
  }

  return accessible;
}

/**
 * Resolve the project-visibility scope for a viewer by user id, for services
 * that aggregate across projects with raw SQL (outside the policy layer).
 * Returns `null` for ADMIN (unrestricted — no project filter applies),
 * otherwise the viewer's accessible project ids. Access/roleId are re-read
 * from the database rather than trusted from the session so a revoked
 * permission takes effect immediately.
 */
export async function resolveViewerProjectScope(
  userId: string
): Promise<number[] | null> {
  const viewer = await baseDb.user.findUnique({
    where: { id: userId },
    select: { access: true, roleId: true },
  });
  if (!viewer) return [];
  if (viewer.access === "ADMIN") return null;
  return resolveAccessibleProjectIds({
    id: userId,
    access: viewer.access,
    roleId: viewer.roleId,
  });
}

/**
 * Build the `AuthCtx` value the access policies are evaluated against.
 *
 * Called per request from getAuthDb (lib/zenstack.ts). The project-id resolution
 * underneath is now cached for 60s — this comment previously said caching would
 * be a security regression, which was aimed at caching in the SESSION, where a
 * revoked permission would survive until the user next signed in. A 60s TTL is a
 * different trade, and the one already made for the same data in
 * ./access-manifest.
 *
 * Why it changed: the four uncached queries this fans out to were 37% of ALL
 * database queries on the instance, and 69% of query volume was permission
 * checks of one kind or another. The cost is not Postgres CPU — each query is
 * sub-millisecond — it is that every one is a round trip whose Prisma
 * serialization runs on the single Next.js JS thread, which is the resource that
 * was actually saturating.
 *
 * The accepted trade: a revoked project permission, changed group membership, or
 * altered project default can remain in force for up to 60s. A changed global
 * role or access level takes effect immediately, because both are in the cache
 * key. Call invalidateAccessibleProjectIds to close the window on a known
 * mutation.
 */
export async function buildAuthContext(user: UserForAuth) {
  const accessibleProjectIds = await resolveAccessibleProjectIds(user);

  return {
    id: user.id,
    access: user.access,
    roleId: user.roleId ?? null,
    role: user.role
      ? {
          id: user.role.id,
          name: user.role.name,
          rolePermissions: (user.role.rolePermissions ?? []).map((p) => ({
            area: p.area,
            canAddEdit: p.canAddEdit,
            canDelete: p.canDelete,
            canClose: p.canClose,
            canReadSensitive: p.canReadSensitive,
            canApprove: p.canApprove,
          })),
        }
      : null,
    accessibleProjectIds,
  };
}
