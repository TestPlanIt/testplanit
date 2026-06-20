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
 * `hasWriteAccess(manifest, projectId)` in O(1) and bypass ZenStack's
 * policy engine for the fast path.
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
import { prisma } from "./prisma";
import valkeyConnection from "./valkey";

const MANIFEST_CACHE_TTL_SECONDS = 60;
const MANIFEST_CACHE_PREFIX = "access:manifest:";

/**
 * Compact per-project access summary. Booleans aggregate across all
 * `ApplicationArea`s — good enough for CRUD on project-scoped models.
 * Area-specific checks (e.g. "canClose on TestRuns") still go through
 * ZenStack.
 */
export interface ProjectAccess {
  /** User can read resources in this project. */
  canRead: boolean;
  /** User can create/update resources in this project (any area). */
  canWrite: boolean;
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
};

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
  const user = await prisma.user.findUnique({
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
  const projects = await prisma.projects.findMany({
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
  globalRolePermissions: Array<{
    area: ApplicationArea;
    canAddEdit: boolean;
    canDelete: boolean;
  }>;
  project: {
    createdBy: string;
    defaultAccessType: string;
    defaultRoleId: number | null;
    defaultRole: {
      rolePermissions: Array<{ canAddEdit: boolean; canDelete: boolean }>;
    } | null;
    userPermissions: Array<{
      accessType: string;
      role: {
        rolePermissions: Array<{ canAddEdit: boolean; canDelete: boolean }>;
      } | null;
    }>;
    groupPermissions: Array<{
      accessType: string;
      role: {
        rolePermissions: Array<{ canAddEdit: boolean; canDelete: boolean }>;
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
    if (perms !== null) {
      return {
        canRead: true,
        canWrite: perms.some((rp) => rp.canAddEdit),
        canDelete: perms.some((rp) => rp.canDelete),
      };
    }
  }

  // Group permission: first non-NO_ACCESS group grant we find.
  for (const gp of ctx.project.groupPermissions) {
    if (gp.accessType === "NO_ACCESS") return NO_ACCESS;
    const perms = resolveRolePermissions(
      gp.accessType,
      gp.role?.rolePermissions,
      ctx.globalRolePermissions
    );
    if (perms !== null) {
      return {
        canRead: true,
        canWrite: perms.some((rp) => rp.canAddEdit),
        canDelete: perms.some((rp) => rp.canDelete),
      };
    }
  }

  // Project default access.
  switch (ctx.project.defaultAccessType) {
    case "GLOBAL_ROLE":
      if (ctx.globalRolePermissions.length > 0) {
        return {
          canRead: true,
          canWrite: ctx.globalRolePermissions.some((rp) => rp.canAddEdit),
          canDelete: ctx.globalRolePermissions.some((rp) => rp.canDelete),
        };
      }
      return NO_ACCESS;
    case "SPECIFIC_ROLE":
      if (ctx.project.defaultRole) {
        return {
          canRead: true,
          canWrite: ctx.project.defaultRole.rolePermissions.some(
            (rp) => rp.canAddEdit
          ),
          canDelete: ctx.project.defaultRole.rolePermissions.some(
            (rp) => rp.canDelete
          ),
        };
      }
      return NO_ACCESS;
    case "DEFAULT":
      return ctx.globalRolePermissions.length > 0
        ? {
            canRead: true,
            canWrite: ctx.globalRolePermissions.some((rp) => rp.canAddEdit),
            canDelete: ctx.globalRolePermissions.some((rp) => rp.canDelete),
          }
        : NO_ACCESS;
    default:
      return NO_ACCESS;
  }
}

function resolveRolePermissions(
  accessType: string,
  specificRolePermissions:
    | Array<{ canAddEdit: boolean; canDelete: boolean }>
    | undefined,
  globalRolePermissions: Array<{ canAddEdit: boolean; canDelete: boolean }>
): Array<{ canAddEdit: boolean; canDelete: boolean }> | null {
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
