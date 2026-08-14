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
const COLLAB_SCOPE_CACHE_PREFIX = "acl:collab:";

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
    // Also drops the user's collaborator scope — it derives from the same
    // rows. Other viewers' collaborator scopes (which may newly include or
    // exclude this user) are left to the shared TTL.
    const keys = (
      await Promise.all([
        valkeyConnection.keys(`${PROJECT_IDS_CACHE_PREFIX}${userId}:*`),
        valkeyConnection.keys(`${COLLAB_SCOPE_CACHE_PREFIX}${userId}:*`),
      ])
    ).flat();
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
    const keys = (
      await Promise.all([
        valkeyConnection.keys(`${PROJECT_IDS_CACHE_PREFIX}*`),
        valkeyConnection.keys(`${COLLAB_SCOPE_CACHE_PREFIX}*`),
      ])
    ).flat();
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
 * The users a viewer may read under the User model's collaborator scoping:
 * admins read everyone; everyone else reads users sharing at least one
 * effectively-accessible project (the same five sources as the project ladder
 * above, with per-user NO_ACCESS honored per project).
 *
 * Users granted a shared project by an enumerable source (creator, explicit
 * user permission, qualifying group permission, assignment on a
 * SPECIFIC_ROLE-default project) are listed in `userIds`. Grants that flow
 * from a project default apply to classes of users too large to enumerate, so
 * they are carried as flags the policy combines with per-row columns:
 * `viaOpenDefault` (a shared project's default grants any non-NONE user),
 * `viaGlobalRoleDefault` (same via a GLOBAL_ROLE default — User.roleId is
 * non-nullable, so the ladder's global-role requirement always holds), and
 * `viaAdminAccess` (ADMIN users reach every project, so a viewer with any
 * accessible project shares one with every admin). The `*Denied` lists carve
 * out users whose per-user NO_ACCESS rows cover every project of a class.
 */
export interface CollaboratorScope {
  all: boolean;
  userIds: string[];
  viaOpenDefault: boolean;
  viaGlobalRoleDefault: boolean;
  viaAdminAccess: boolean;
  openDefaultDenied: string[];
  globalRoleDefaultDenied: string[];
}

const EMPTY_COLLABORATOR_SCOPE: CollaboratorScope = {
  all: false,
  userIds: [],
  viaOpenDefault: false,
  viaGlobalRoleDefault: false,
  viaAdminAccess: false,
  openDefaultDenied: [],
  globalRoleDefaultDenied: [],
};

function collabScopeCacheKey(user: UserForAuth): string {
  return `${COLLAB_SCOPE_CACHE_PREFIX}${user.id}:${user.access}:${user.roleId ?? "none"}`;
}

/**
 * Resolve the viewer's collaborator scope. Cache-aside over Valkey on the same
 * 60s clock as the project-id resolution. Unlike that cache, this one also
 * depends on OTHER users' permission rows — a grant made to someone else puts
 * them in every eligible viewer's directory — so per-user invalidation cannot
 * fully cover it; the TTL is the actual staleness bound for third-party grants.
 */
export async function resolveCollaboratorScope(
  user: UserForAuth,
  accessibleProjectIds?: number[]
): Promise<CollaboratorScope> {
  if (user.access === "ADMIN") {
    return { ...EMPTY_COLLABORATOR_SCOPE, all: true };
  }

  const key = collabScopeCacheKey(user);
  if (valkeyConnection) {
    try {
      const raw = await valkeyConnection.get(key);
      if (raw) return JSON.parse(raw) as CollaboratorScope;
    } catch {
      // fall through to the DB — a cache outage must not deny access
    }
  }

  const ids = accessibleProjectIds ?? (await resolveAccessibleProjectIds(user));
  const scope = await computeCollaboratorScope(user, ids);

  if (valkeyConnection) {
    try {
      await valkeyConnection.set(
        key,
        JSON.stringify(scope),
        "EX",
        PROJECT_IDS_CACHE_TTL_SECONDS
      );
    } catch {
      // non-fatal
    }
  }

  return scope;
}

/**
 * Whether a user falls inside a resolved collaborator scope. Mirrors the User
 * read policy's rule set (minus the viewer-self rule, which callers handle).
 */
export function collaboratorScopeIncludes(
  scope: CollaboratorScope,
  target: { id: string; access: string }
): boolean {
  if (scope.all) return true;
  if (scope.userIds.includes(target.id)) return true;
  if (scope.viaAdminAccess && target.access === "ADMIN") return true;
  if (target.access === "NONE") return false;
  if (scope.viaOpenDefault && !scope.openDefaultDenied.includes(target.id)) {
    return true;
  }
  if (
    scope.viaGlobalRoleDefault &&
    !scope.globalRoleDefaultDenied.includes(target.id)
  ) {
    return true;
  }
  return false;
}

/**
 * The uncached inverse of computeAccessibleProjectIds: given the viewer's
 * accessible projects, find every user the ladder would grant at least one of
 * them to. Set-based queries scoped to those projects, assembled with the same
 * branch semantics (NO_ACCESS outranks, then creator / user permission /
 * group / assignment / defaults).
 */
async function computeCollaboratorScope(
  viewer: UserForAuth,
  accessibleProjectIds: number[]
): Promise<CollaboratorScope> {
  if (accessibleProjectIds.length === 0) {
    return { ...EMPTY_COLLABORATOR_SCOPE };
  }

  const [projects, perms, groupPerms, assignments] = await Promise.all([
    baseDb.projects.findMany({
      where: { id: { in: accessibleProjectIds } },
      select: {
        id: true,
        createdBy: true,
        defaultAccessType: true,
        defaultRoleId: true,
      },
    }),
    baseDb.userProjectPermission.findMany({
      where: { projectId: { in: accessibleProjectIds } },
      select: { userId: true, projectId: true, accessType: true },
    }),
    baseDb.groupProjectPermission.findMany({
      where: { projectId: { in: accessibleProjectIds } },
      select: {
        projectId: true,
        accessType: true,
        roleId: true,
        group: { select: { assignedUsers: { select: { userId: true } } } },
      },
    }),
    baseDb.projectAssignment.findMany({
      where: { projectId: { in: accessibleProjectIds } },
      select: { userId: true, projectId: true },
    }),
  ]);

  const deniedByUser = new Map<string, Set<number>>();
  for (const perm of perms) {
    if (perm.accessType === ProjectAccessType.NO_ACCESS) {
      const denied = deniedByUser.get(perm.userId) ?? new Set<number>();
      denied.add(perm.projectId);
      deniedByUser.set(perm.userId, denied);
    }
  }
  const isDenied = (userId: string, projectId: number) =>
    deniedByUser.get(userId)?.has(projectId) ?? false;

  const projectById = new Map(projects.map((p) => [p.id, p]));
  const userIds = new Set<string>();

  for (const p of projects) {
    if (p.createdBy && !isDenied(p.createdBy, p.id)) {
      userIds.add(p.createdBy);
    }
  }
  // Explicit user permissions grant unconditionally — the GLOBAL_ROLE variant
  // has no role requirement, the same asymmetry as the forward ladder.
  for (const perm of perms) {
    if (
      perm.accessType === ProjectAccessType.SPECIFIC_ROLE ||
      perm.accessType === ProjectAccessType.GLOBAL_ROLE
    ) {
      userIds.add(perm.userId);
    }
  }
  for (const gp of groupPerms) {
    // SPECIFIC_ROLE needs the grant's role; GLOBAL_ROLE needs the member's
    // global role, which User.roleId (non-nullable) always supplies.
    const qualifies =
      (gp.accessType === ProjectAccessType.SPECIFIC_ROLE &&
        gp.roleId != null) ||
      gp.accessType === ProjectAccessType.GLOBAL_ROLE;
    if (!qualifies) continue;
    for (const member of gp.group.assignedUsers) {
      if (!isDenied(member.userId, gp.projectId)) {
        userIds.add(member.userId);
      }
    }
  }
  for (const a of assignments) {
    const p = projectById.get(a.projectId);
    if (
      p &&
      p.defaultAccessType === ProjectAccessType.SPECIFIC_ROLE &&
      p.defaultRoleId != null &&
      !isDenied(a.userId, a.projectId)
    ) {
      userIds.add(a.userId);
    }
  }
  // The policy's self rule covers the viewer; keep the list to others.
  userIds.delete(viewer.id);

  const openDefaultIds: number[] = [];
  const globalRoleDefaultIds: number[] = [];
  for (const p of projects) {
    if (
      p.defaultAccessType === ProjectAccessType.DEFAULT ||
      (p.defaultAccessType === ProjectAccessType.SPECIFIC_ROLE &&
        p.defaultRoleId != null)
    ) {
      openDefaultIds.push(p.id);
    } else if (p.defaultAccessType === ProjectAccessType.GLOBAL_ROLE) {
      globalRoleDefaultIds.push(p.id);
    }
  }

  // A user leaves a default-grant class only when their NO_ACCESS rows cover
  // every project of that class — one uncovered project still grants.
  const openDefaultDenied: string[] = [];
  const globalRoleDefaultDenied: string[] = [];
  for (const [userId, denied] of deniedByUser) {
    if (
      openDefaultIds.length > 0 &&
      openDefaultIds.every((id) => denied.has(id))
    ) {
      openDefaultDenied.push(userId);
    }
    if (
      globalRoleDefaultIds.length > 0 &&
      globalRoleDefaultIds.every((id) => denied.has(id))
    ) {
      globalRoleDefaultDenied.push(userId);
    }
  }

  return {
    all: false,
    userIds: [...userIds].sort(),
    viaOpenDefault: openDefaultIds.length > 0,
    viaGlobalRoleDefault: globalRoleDefaultIds.length > 0,
    viaAdminAccess: true,
    openDefaultDenied: openDefaultDenied.sort(),
    globalRoleDefaultDenied: globalRoleDefaultDenied.sort(),
  };
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
  let accessibleProjectIds: number[] | null = null;
  let collab: CollaboratorScope | null = null;

  // Read both cached scopes in ONE Valkey round trip — this path runs once per
  // enhanced-db request, and round trips on the JS thread are the resource the
  // 60s cache exists to protect. Either miss falls back to its resolver, which
  // recomputes and repopulates its own key.
  if (valkeyConnection && user.access !== "ADMIN") {
    try {
      const [rawIds, rawCollab] = await valkeyConnection.mget(
        projectIdsCacheKey(user),
        collabScopeCacheKey(user)
      );
      if (rawIds) accessibleProjectIds = JSON.parse(rawIds) as number[];
      if (rawCollab) collab = JSON.parse(rawCollab) as CollaboratorScope;
    } catch {
      // fall through to the resolvers — a cache outage must not deny access
    }
  }
  accessibleProjectIds ??= await resolveAccessibleProjectIds(user);
  collab ??= await resolveCollaboratorScope(user, accessibleProjectIds);

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
    collabUserIds: collab.userIds,
    collabViaOpenDefault: collab.viaOpenDefault,
    collabViaGlobalRoleDefault: collab.viaGlobalRoleDefault,
    collabViaAdminAccess: collab.viaAdminAccess,
    collabOpenDefaultDenied: collab.openDefaultDenied,
    collabGlobalRoleDefaultDenied: collab.globalRoleDefaultDenied,
  };
}
