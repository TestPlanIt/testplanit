/**
 * Access manifest cache.
 *
 * The ZenStack CRUD endpoint evaluates per-request access policies that
 * expand into complex Prisma WHERE clauses (joins across `userPermissions`,
 * `groupPermissions`, `role.rolePermissions`, etc). Under sustained load
 * this JavaScript evaluation is the dominant CPU cost per mutation.
 *
 * An "access manifest" is a precomputed, cacheable summary of what a given
 * user can do across all projects. Once cached, a route handler can check
 * `hasAreaWriteAccess(manifest, projectId, area)` in O(1) and bypass
 * ZenStack's policy engine for the fast path.
 *
 * The manifest only covers the common case: reads, creates and updates on
 * project-scoped models that inherit access from their parent project.
 * Anything requiring finer-grained area-level permissions (e.g. "can the
 * user close test runs") falls through to ZenStack's regular path.
 *
 * TTL is short (60s) so revoked permissions propagate quickly; the manifest
 * can also be explicitly invalidated on permission mutations.
 */

import type { ApplicationArea } from "~/zenstack/models";
import { baseDb } from "./db";
import valkeyConnection from "./valkey";

const MANIFEST_CACHE_TTL_SECONDS = 60;
const MANIFEST_CACHE_PREFIX = "access:manifest:";

/**
 * Compact per-project access summary. The booleans aggregate across all
 * `ApplicationArea`s; `writableAreas` keeps the per-area add/edit grants that
 * a create's policy actually requires. Other checks (e.g. "canClose on
 * TestRuns") still go through ZenStack.
 */
export interface ProjectAccess {
  /** User can read resources in this project. */
  canRead: boolean;
  /** User can create/update resources in this project (any area). */
  canWrite: boolean;
  /**
   * The areas the user can create/update in, or "all". Absent on manifests
   * cached before it was added.
   */
  writableAreas?: string[] | "all";
  /** User can delete resources in this project (any area). */
  canDelete: boolean;
}

export interface AccessManifest {
  userId: string;
  access: string | null; // NONE | USER | PROJECTADMIN | ADMIN
  isAdmin: boolean;
  /** Map of projectId → access summary. Missing entries mean "no access". */
  projects: Record<number, ProjectAccess>;
  generatedAt: number;
}

const ADMIN_ACCESS: ProjectAccess = {
  canRead: true,
  canWrite: true,
  canDelete: true,
  writableAreas: "all",
};

type AreaPermission = { area: string; canAddEdit: boolean; canDelete: boolean };

/** Project access granted by one role's permission rows. */
function accessFrom(perms: AreaPermission[]): ProjectAccess {
  return {
    canRead: true,
    canWrite: perms.some((rp) => rp.canAddEdit),
    canDelete: perms.some((rp) => rp.canDelete),
    writableAreas: perms.filter((rp) => rp.canAddEdit).map((rp) => rp.area),
  };
}

const NO_ACCESS: ProjectAccess = {
  canRead: false,
  canWrite: false,
  canDelete: false,
};

/**
 * Cache-aside manifest fetch. Returns null only if the user doesn't exist.
 */
export async function getAccessManifest(
  userId: string
): Promise<AccessManifest | null> {
  if (valkeyConnection) {
    try {
      const raw = await valkeyConnection.get(
        `${MANIFEST_CACHE_PREFIX}${userId}`
      );
      if (raw) return JSON.parse(raw) as AccessManifest;
    } catch {
      // fall through to DB
    }
  }

  const manifest = await computeAccessManifest(userId);
  if (manifest && valkeyConnection) {
    try {
      await valkeyConnection.set(
        `${MANIFEST_CACHE_PREFIX}${userId}`,
        JSON.stringify(manifest),
        "EX",
        MANIFEST_CACHE_TTL_SECONDS
      );
    } catch {
      // non-fatal
    }
  }
  return manifest;
}

/**
 * Build a manifest for the user by querying their permissions once.
 * This is the expensive path — subsequent requests for the same user hit
 * the cache.
 */
async function computeAccessManifest(
  userId: string
): Promise<AccessManifest | null> {
  const user = await baseDb.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      access: true,
      isActive: true,
      isDeleted: true,
      roleId: true,
      role: {
        select: {
          id: true,
          rolePermissions: true,
        },
      },
      groups: {
        select: {
          groupId: true,
        },
      },
    },
  });

  if (!user || !user.isActive || user.isDeleted) return null;

  const manifest: AccessManifest = {
    userId: user.id,
    access: user.access,
    isAdmin: user.access === "ADMIN",
    projects: {},
    generatedAt: Date.now(),
  };

  // ADMIN bypasses all project permissions. We still need to know WHICH
  // projects exist so read filters can be applied correctly if needed.
  // But for simplicity we leave `projects` empty and the `isAdmin` flag
  // short-circuits any lookup.
  if (manifest.isAdmin) {
    return manifest;
  }

  // NONE users have no project access at all.
  if (user.access === "NONE" || user.access === null) {
    return manifest;
  }

  const globalRolePermissions = user.role?.rolePermissions ?? [];
  const userGroupIds = new Set(user.groups.map((g) => g.groupId));

  // Fetch every project together with the permission shape relevant to
  // this specific user. We deliberately over-fetch (all defaults + all
  // matching permissions) because Postgres is cheap and cache lifetime
  // means we only do this once per TTL window.
  const projects = await baseDb.projects.findMany({
    where: {
      isDeleted: false,
    },
    select: {
      id: true,
      createdBy: true,
      defaultAccessType: true,
      defaultRoleId: true,
      defaultRole: {
        select: {
          rolePermissions: true,
        },
      },
      userPermissions: {
        where: { userId: user.id },
        select: {
          accessType: true,
          roleId: true,
          role: {
            select: { rolePermissions: true },
          },
        },
      },
      groupPermissions: {
        where: { groupId: { in: Array.from(userGroupIds) } },
        select: {
          accessType: true,
          roleId: true,
          role: {
            select: { rolePermissions: true },
          },
        },
      },
      assignedUsers: {
        where: { userId: user.id },
        select: { userId: true },
      },
    },
  });

  for (const p of projects) {
    manifest.projects[p.id] = computeProjectAccess({
      userId: user.id,
      userAccess: user.access,
      globalRolePermissions,
      project: p,
    });
  }

  return manifest;
}

function computeProjectAccess(ctx: {
  userId: string;
  userAccess: string | null;
  globalRolePermissions: AreaPermission[];
  project: {
    createdBy: string;
    defaultAccessType: string;
    defaultRoleId: number | null;
    defaultRole: {
      rolePermissions: AreaPermission[];
    } | null;
    userPermissions: Array<{
      accessType: string;
      role: {
        rolePermissions: AreaPermission[];
      } | null;
    }>;
    groupPermissions: Array<{
      accessType: string;
      role: {
        rolePermissions: AreaPermission[];
      } | null;
    }>;
    assignedUsers: Array<{ userId: string }>;
  };
}): ProjectAccess {
  // Creator has full access.
  if (ctx.project.createdBy === ctx.userId) return ADMIN_ACCESS;

  // PROJECTADMIN on assignedUsers → full access to this project.
  if (
    ctx.userAccess === "PROJECTADMIN" &&
    ctx.project.assignedUsers.length > 0
  ) {
    return ADMIN_ACCESS;
  }

  // Direct user permission: overrides group and default.
  const userPerm = ctx.project.userPermissions[0];
  if (userPerm) {
    if (userPerm.accessType === "NO_ACCESS") return NO_ACCESS;
    const perms = resolveRolePermissions(
      userPerm.accessType,
      userPerm.role?.rolePermissions,
      ctx.globalRolePermissions
    );
    if (perms !== null) return accessFrom(perms);
  }

  // Group permission: first non-NO_ACCESS group grant we find.
  for (const gp of ctx.project.groupPermissions) {
    if (gp.accessType === "NO_ACCESS") return NO_ACCESS;
    const perms = resolveRolePermissions(
      gp.accessType,
      gp.role?.rolePermissions,
      ctx.globalRolePermissions
    );
    if (perms !== null) return accessFrom(perms);
  }

  // Project default access.
  switch (ctx.project.defaultAccessType) {
    case "GLOBAL_ROLE":
      if (ctx.globalRolePermissions.length > 0) {
        return accessFrom(ctx.globalRolePermissions);
      }
      return NO_ACCESS;
    case "SPECIFIC_ROLE":
      if (ctx.project.defaultRole) {
        return accessFrom(ctx.project.defaultRole.rolePermissions);
      }
      return NO_ACCESS;
    case "DEFAULT":
      return ctx.globalRolePermissions.length > 0
        ? accessFrom(ctx.globalRolePermissions)
        : NO_ACCESS;
    default:
      return NO_ACCESS;
  }
}

function resolveRolePermissions(
  accessType: string,
  specificRolePermissions: AreaPermission[] | undefined,
  globalRolePermissions: AreaPermission[]
): AreaPermission[] | null {
  if (accessType === "SPECIFIC_ROLE") {
    return specificRolePermissions ?? null;
  }
  if (accessType === "GLOBAL_ROLE") {
    return globalRolePermissions;
  }
  return null;
}

/**
 * Check whether the user has write (create/update) access to a given project.
 * ADMIN users always succeed.
 */
export function hasWriteAccess(
  manifest: AccessManifest,
  projectId: number
): boolean {
  if (manifest.isAdmin) return true;
  return manifest.projects[projectId]?.canWrite ?? false;
}

/**
 * Can the user create/update in `area` on the project? `undefined` when the
 * manifest predates per-area data, so the caller can defer to the full
 * policy check instead of guessing.
 */
export function hasAreaWriteAccess(
  manifest: AccessManifest,
  projectId: number,
  area: ApplicationArea
): boolean | undefined {
  if (manifest.isAdmin) return true;
  const project = manifest.projects[projectId];
  if (!project) return false;
  if (project.writableAreas === undefined) return undefined;
  return (
    project.writableAreas === "all" || project.writableAreas.includes(area)
  );
}

/**
 * Check read access.
 */
export function hasReadAccess(
  manifest: AccessManifest,
  projectId: number
): boolean {
  if (manifest.isAdmin) return true;
  return manifest.projects[projectId]?.canRead ?? false;
}

/**
 * Invalidate a single user's manifest. Call from endpoints that change
 * permissions, role assignments, or project defaults.
 */
export async function invalidateAccessManifest(userId: string): Promise<void> {
  if (!valkeyConnection) return;
  try {
    await valkeyConnection.del(`${MANIFEST_CACHE_PREFIX}${userId}`);
  } catch {
    // non-fatal
  }
}

/**
 * Invalidate all users' manifests. Call when something changes that
 * affects many users at once (e.g. project defaultAccessType change,
 * role permissions updated).
 */
export async function invalidateAllAccessManifests(): Promise<void> {
  if (!valkeyConnection) return;
  try {
    const keys = await valkeyConnection.keys(`${MANIFEST_CACHE_PREFIX}*`);
    if (keys.length > 0) {
      await valkeyConnection.del(...keys);
    }
  } catch {
    // non-fatal
  }
}
