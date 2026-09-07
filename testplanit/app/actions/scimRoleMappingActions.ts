"use server";

/**
 * SCIM role-mapping admin server actions.
 *
 * The sibling of `scimMappingActions.ts` for the `roles` core-attribute
 * hybrid: where that file maps an IdP *group* onto an access tier, this one
 * maps an IdP-asserted `roles[].value` string onto a tier. Role-derived tiers
 * take precedence over group-derived ones (see `resolveEffectiveAccess`), so
 * a role mapping can raise *or lower* a user's access — which is why every
 * mutation here is preceded by the same downgrade preview the group-mapping
 * flow uses.
 *
 * Each mutation writes exactly one `captureAuditEvent` row and enqueues a
 * scoped recompute job (`roleValue`) rather than recomputing inline: a single
 * role can be asserted for the entire directory, and the admin request must
 * not block on that sweep.
 *
 * Role values are stored and compared lowercased — IdPs are inconsistent
 * about the casing of role labels, and `User.scimRoles` is written lowercased
 * by the SCIM mapper.
 */

import { z } from "zod/v4";

import { runWithAuditContext } from "~/lib/auditContext";
import { captureAuditEvent } from "~/lib/services/auditLog";
import { getScimAccessRecomputeQueue } from "~/lib/queues";
import { baseDb } from "~/lib/db";
import { ACCESS_RANK, resolveEffectiveAccess } from "~/lib/scim/access/resolve";
import { readScimFallbackDefault } from "~/lib/scim/access/fallbackDefault";
import { getServerAuthSession } from "~/server/auth";
import type { Access } from "~/zenstack/models";
import type { ScimAccessRecomputeJobData } from "~/workers/scimAccessRecomputeWorker";

import type { DowngradedUser } from "./scimMappingActions";

const roleValueSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .transform((v) => v.toLowerCase());
const accessSchema = z
  .enum(["ADMIN", "PROJECTADMIN", "USER", "NONE"])
  .nullable();

/**
 * Resolve the tier every affected user would hold before and after a role
 * mapping moves to `newMappedAccess` (`null` = the mapping is being deleted).
 *
 * Shared by the preview and save paths so the confirmation dialog and the
 * enqueued recompute can never disagree about who is affected.
 */
async function simulateRoleMappingChange(
  roleValue: string,
  newMappedAccess: Access | null
): Promise<DowngradedUser[]> {
  const fallbackDefault = await readScimFallbackDefault(baseDb);

  const [holders, allMappings] = await Promise.all([
    baseDb.user.findMany({
      where: { scimRoles: { has: roleValue }, isDeleted: false },
      select: { id: true, name: true, access: true, scimRoles: true },
    }),
    baseDb.scimRoleMapping.findMany({
      select: { roleValue: true, mappedAccess: true },
    }),
  ]);

  const currentByRole = new Map(
    allMappings.map((m) => [m.roleValue, m.mappedAccess])
  );
  const nextByRole = new Map(currentByRole);
  if (newMappedAccess === null) {
    nextByRole.delete(roleValue);
  } else {
    nextByRole.set(roleValue, newMappedAccess);
  }

  const downgraded: DowngradedUser[] = [];

  for (const user of holders) {
    const assignments = await baseDb.groupAssignment.findMany({
      where: { userId: user.id },
      select: { group: { select: { mappedAccess: true } } },
    });
    const groupTiers = assignments
      .map((a) => a.group.mappedAccess)
      .filter((v): v is Access => v !== null);

    const tiersFrom = (source: Map<string, Access>) =>
      user.scimRoles
        .map((r) => source.get(r))
        .filter((v): v is Access => v !== undefined);

    const currentEffective = resolveEffectiveAccess(
      groupTiers,
      fallbackDefault,
      tiersFrom(currentByRole)
    );
    const newEffective = resolveEffectiveAccess(
      groupTiers,
      fallbackDefault,
      tiersFrom(nextByRole)
    );

    if (ACCESS_RANK[newEffective] < ACCESS_RANK[currentEffective]) {
      downgraded.push({
        userId: user.id,
        name: user.name ?? user.id,
        currentAccess: currentEffective,
        newAccess: newEffective,
      });
    }
  }

  return downgraded;
}

export async function previewRoleMappingChange(
  roleValue: string,
  newMappedAccess: Access | null
): Promise<
  | { success: true; downgraded: DowngradedUser[] }
  | { success: false; error: string }
> {
  const session = await getServerAuthSession();
  if (!session?.user?.id || session.user.access !== "ADMIN") {
    return { success: false, error: "Unauthorized" };
  }

  let validatedRole: string;
  try {
    validatedRole = roleValueSchema.parse(roleValue);
    accessSchema.parse(newMappedAccess);
  } catch {
    return { success: false, error: "Invalid input" };
  }

  try {
    const downgraded = await simulateRoleMappingChange(
      validatedRole,
      newMappedAccess
    );
    return { success: true, downgraded };
  } catch (err) {
    console.error("[scimRoleMappingActions] preview failed", err);
    return { success: false, error: "Failed to preview role mapping" };
  }
}

/**
 * Create, retier, or delete a role mapping.
 *
 * `newMappedAccess === null` deletes the mapping — the deliberate encoding of
 * "this role no longer governs access", which is distinct from mapping it to
 * NONE (an explicit deny that still wins over group mapping).
 */
export async function saveRoleMappingChange(
  roleValue: string,
  newMappedAccess: Access | null
): Promise<{ success: boolean; error?: string }> {
  const session = await getServerAuthSession();
  if (!session?.user?.id || session.user.access !== "ADMIN") {
    return { success: false, error: "Unauthorized" };
  }

  let validatedRole: string;
  try {
    validatedRole = roleValueSchema.parse(roleValue);
    accessSchema.parse(newMappedAccess);
  } catch {
    return { success: false, error: "Invalid input" };
  }

  return runWithAuditContext({ userId: session.user.id }, async () => {
    try {
      const existing = await baseDb.scimRoleMapping.findUnique({
        where: { roleValue: validatedRole },
        select: { id: true, mappedAccess: true },
      });

      if (newMappedAccess === null) {
        if (!existing) {
          return { success: true };
        }
        await baseDb.scimRoleMapping.delete({
          where: { roleValue: validatedRole },
        });
      } else if (existing) {
        await baseDb.scimRoleMapping.update({
          where: { roleValue: validatedRole },
          data: { mappedAccess: newMappedAccess },
        });
      } else {
        await baseDb.scimRoleMapping.create({
          data: { roleValue: validatedRole, mappedAccess: newMappedAccess },
        });
      }

      await captureAuditEvent({
        action: existing && newMappedAccess === null ? "DELETE" : "UPDATE",
        entityType: "ScimRoleMapping",
        entityId: validatedRole,
        entityName: validatedRole,
        userId: session.user.id,
        changes: {
          mappedAccess: {
            old: existing?.mappedAccess ?? null,
            new: newMappedAccess,
          },
        },
        metadata: { source: "admin-mapping-config" },
      });

      const queue = getScimAccessRecomputeQueue();
      if (queue) {
        const jobData: ScimAccessRecomputeJobData = {
          adminUserId: session.user.id,
          roleValue: validatedRole,
        };
        await queue.add("scim-access-recompute", jobData);
      }

      return { success: true };
    } catch (err) {
      console.error(
        "[scimRoleMappingActions] saveRoleMappingChange failed",
        err
      );
      return { success: false, error: "Failed to save role mapping" };
    }
  }); // end runWithAuditContext
}
