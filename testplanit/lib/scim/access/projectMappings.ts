/**
 * Per-project access mapping for directory groups.
 *
 * `Groups.mappedAccess` grants an org-wide tier. This module is its
 * project-scoped counterpart: an IdP group can grant an access tier on one
 * specific project, which is what "make the QA leads Project Admins on
 * Banking, and nothing else" actually requires.
 *
 * Design: mappings are *materialized* into `GroupProjectPermission` rows
 * rather than resolved at request time. The permission engine
 * (lib/services/areaPermission.ts, lib/services/effectiveRole.ts) already
 * reads those rows and already resolves them through group membership — which
 * SCIM keeps current — so materializing means there is exactly one resolution
 * path to reason about, and per-project access needs no recompute when
 * membership changes.
 *
 * What a mapping can and cannot do:
 *
 *   - It GRANTS. The engine honours `SPECIFIC_ROLE` and `GLOBAL_ROLE` on a
 *     group row; `NO_ACCESS` on a *group* row is ignored outright (denial
 *     comes only from a user-specific row or the project default).
 *   - It therefore CANNOT revoke access the project default already gives.
 *     `NONE` is rejected at the write boundary instead of being stored as a
 *     mapping that would silently do nothing.
 */

import { captureAuditEvent } from "~/lib/services/auditLog";
import type { TxClient } from "~/lib/zenstack";
import type { Access, ProjectAccessType } from "~/zenstack/models";

/**
 * Name of the role a PROJECTADMIN/ADMIN mapping grants on the project.
 *
 * Matches the literal the permission policies and guards already compare
 * against (schema.zmodel `role.name == 'Project Admin'`,
 * lib/services/resultGuards.ts). It is not seeded, so a deployment that never
 * created it gets the documented fallback below rather than a crash.
 */
export const PROJECT_ADMIN_ROLE_NAME = "Project Admin" as const;

/** Tiers a per-project mapping can express. NONE is deliberately absent. */
export const PROJECT_MAPPABLE_ACCESS: readonly Access[] = [
  "USER",
  "PROJECTADMIN",
  "ADMIN",
];

export function isProjectMappableAccess(access: Access): boolean {
  return PROJECT_MAPPABLE_ACCESS.includes(access);
}

export interface MaterializedGrant {
  accessType: ProjectAccessType;
  roleId: number | null;
}

/**
 * Translate a mapped tier into the `GroupProjectPermission` shape the
 * permission engine understands.
 *
 *   - USER          -> GLOBAL_ROLE: members carry their own global role onto
 *                      the project. `DEFAULT` would be wrong here — the engine
 *                      filters DEFAULT group rows out, so it would grant
 *                      nothing at all.
 *   - PROJECTADMIN  -> SPECIFIC_ROLE on the "Project Admin" role.
 *   - ADMIN         -> the same. Org-wide ADMIN is conferred by
 *                      `Groups.mappedAccess`, not by a project mapping; within
 *                      one project, Project Admin is the strongest grant
 *                      there is.
 *
 * When no "Project Admin" role exists, PROJECTADMIN/ADMIN degrade to
 * GLOBAL_ROLE and the caller is told, so the operator learns their mapping is
 * weaker than they asked for instead of silently getting nothing.
 */
export function tierToProjectGrant(
  tier: Access,
  projectAdminRoleId: number | null
): { grant: MaterializedGrant; degraded: boolean } {
  if (tier === "PROJECTADMIN" || tier === "ADMIN") {
    if (projectAdminRoleId !== null) {
      return {
        grant: { accessType: "SPECIFIC_ROLE", roleId: projectAdminRoleId },
        degraded: false,
      };
    }
    return {
      grant: { accessType: "GLOBAL_ROLE", roleId: null },
      degraded: true,
    };
  }

  return {
    grant: { accessType: "GLOBAL_ROLE", roleId: null },
    degraded: false,
  };
}

/**
 * Bring the derived `GroupProjectPermission` rows for one group in line with
 * its current per-project mappings.
 *
 * Idempotent, and safe to re-run: it only ever writes or deletes rows carrying
 * `derivedFromMapping = true`. A permission an admin assigned by hand in the
 * project UI is never deleted here — where a manual row and a mapping collide
 * on the same (group, project) pair the mapping takes it over, because the
 * composite primary key allows only one row and the mapping is the more
 * recently expressed intent. That takeover is audited.
 */
export async function materializeGroupProjectMappings(
  tx: TxClient,
  groupId: number
): Promise<void> {
  const [mappings, existing, projectAdminRole] = await Promise.all([
    tx.groupProjectAccessMapping.findMany({
      where: { groupId },
      select: { projectId: true, mappedAccess: true },
    }),
    tx.groupProjectPermission.findMany({
      where: { groupId },
      select: {
        projectId: true,
        accessType: true,
        roleId: true,
        derivedFromMapping: true,
      },
    }),
    tx.roles.findFirst({
      where: { name: PROJECT_ADMIN_ROLE_NAME, isDeleted: false },
      select: { id: true },
    }),
  ]);

  const projectAdminRoleId = projectAdminRole?.id ?? null;
  const existingByProject = new Map(existing.map((e) => [e.projectId, e]));
  const mappedProjectIds = new Set(mappings.map((m) => m.projectId));

  for (const mapping of mappings) {
    const { grant, degraded } = tierToProjectGrant(
      mapping.mappedAccess,
      projectAdminRoleId
    );
    const current = existingByProject.get(mapping.projectId);

    if (
      current &&
      current.derivedFromMapping &&
      current.accessType === grant.accessType &&
      current.roleId === grant.roleId
    ) {
      continue; // already in the desired shape
    }

    if (current && !current.derivedFromMapping) {
      await captureAuditEvent({
        action: "UPDATE",
        entityType: "GroupProjectPermission",
        entityId: `${groupId}:${mapping.projectId}`,
        metadata: {
          scimProjectMappingSupersededManual: true,
          scimGroupId: String(groupId),
          projectId: mapping.projectId,
          previousAccessType: current.accessType,
          previousRoleId: current.roleId,
        },
      });
    }

    if (degraded) {
      await captureAuditEvent({
        action: "UPDATE",
        entityType: "GroupProjectPermission",
        entityId: `${groupId}:${mapping.projectId}`,
        metadata: {
          scimProjectRoleMissing: true,
          scimGroupId: String(groupId),
          projectId: mapping.projectId,
          requestedTier: mapping.mappedAccess,
          missingRoleName: PROJECT_ADMIN_ROLE_NAME,
        },
      });
    }

    await tx.groupProjectPermission.upsert({
      where: {
        groupId_projectId: { groupId, projectId: mapping.projectId },
      },
      create: {
        groupId,
        projectId: mapping.projectId,
        accessType: grant.accessType,
        roleId: grant.roleId,
        derivedFromMapping: true,
      },
      update: {
        accessType: grant.accessType,
        roleId: grant.roleId,
        derivedFromMapping: true,
      },
    });
  }

  // Withdraw grants whose mapping is gone — but only the ones we created.
  const orphanedProjectIds = existing
    .filter((e) => e.derivedFromMapping && !mappedProjectIds.has(e.projectId))
    .map((e) => e.projectId);

  if (orphanedProjectIds.length > 0) {
    await tx.groupProjectPermission.deleteMany({
      where: { groupId, projectId: { in: orphanedProjectIds } },
    });
  }
}
