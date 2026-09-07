/**
 * Per-project access mapping for directory groups.
 *
 * `Groups.mappedAccess` grants an org-wide tier. This module is its
 * project-scoped counterpart: an IdP group can grant access on one specific
 * project rather than across the whole instance.
 *
 * Design: mappings are *materialized* into `GroupProjectPermission` rows
 * rather than resolved at request time. The permission engine
 * (lib/services/areaPermission.ts, lib/services/effectiveRole.ts) already
 * reads those rows and already resolves them through group membership — which
 * SCIM keeps current — so materializing means there is exactly one resolution
 * path to reason about, and per-project access needs no recompute when
 * membership changes.
 *
 * ## What a mapping does, precisely
 *
 * It grants project access with `GLOBAL_ROLE`: each member carries their own
 * global role onto the project. That is the only thing a group-level row can
 * express here, and the reason is worth stating because the tier names invite
 * a different assumption:
 *
 *   - `PROJECTADMIN` is a *system access level*, not a role. Project-admin
 *     authority is decided by `authorizeProjectAdminForProject`, which
 *     recognises system ADMIN, the project creator, a `SPECIFIC_ROLE`
 *     **user** permission naming a "Project Admin" role, or system
 *     PROJECTADMIN plus `assignedUsers` membership. A *group* permission row
 *     is none of those, so no mapping written here can confer project-admin
 *     authority — only the per-area RBAC permissions the member's own role
 *     carries.
 *   - `SPECIFIC_ROLE` would need a role id, and this mapping deliberately
 *     does not pick roles on the operator's behalf. An earlier version bound
 *     PROJECTADMIN/ADMIN to a role *named* "Project Admin", which conflated a
 *     system access level with an RBAC role and depended on a role nothing
 *     creates.
 *   - `NO_ACCESS` on a group row is ignored by the engine outright (denial
 *     comes only from a user-specific row or the project default), so a
 *     mapping cannot revoke access the project default already grants. NONE
 *     is rejected at the write boundary rather than stored as a mapping that
 *     would silently do nothing.
 *
 * Consequence: the stored tier records operator intent and is audited, but
 * every mappable tier currently materializes the same grant. Anything finer
 * belongs in the project's own permission settings, where a role can be
 * chosen explicitly.
 */

import { captureAuditEvent } from "~/lib/services/auditLog";
import type { TxClient } from "~/lib/zenstack";
import type { Access, ProjectAccessType } from "~/zenstack/models";

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
 * Every mappable tier resolves to `GLOBAL_ROLE` — see the module header for
 * why a group-level row cannot express more than that. `DEFAULT` would be
 * wrong even as a "weakest" option: the engine filters DEFAULT group rows
 * out, so it would grant nothing at all.
 */
export function tierToProjectGrant(tier: Access): MaterializedGrant {
  void tier;
  return { accessType: "GLOBAL_ROLE", roleId: null };
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
  const [mappings, existing] = await Promise.all([
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
  ]);

  const existingByProject = new Map(existing.map((e) => [e.projectId, e]));
  const mappedProjectIds = new Set(mappings.map((m) => m.projectId));

  for (const mapping of mappings) {
    const grant = tierToProjectGrant(mapping.mappedAccess);
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
