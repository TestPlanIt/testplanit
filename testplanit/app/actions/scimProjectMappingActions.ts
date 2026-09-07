"use server";

/**
 * Per-project group access-mapping admin server actions.
 *
 * Sibling of `scimMappingActions.ts` (org-wide tier) and
 * `scimRoleMappingActions.ts` (IdP roles). This one maps a group onto an
 * access tier for a single project.
 *
 * Unlike the org-wide tier, this does not go through the recompute worker:
 * mappings materialize into `GroupProjectPermission` rows, which the
 * permission engine already resolves through group membership. That means the
 * write is bounded by the number of mapped projects for one group — a handful
 * of rows — so it runs inline in the request's transaction, and no per-user
 * recompute is needed when membership changes.
 */

import { z } from "zod/v4";

import { runWithAuditContext } from "~/lib/auditContext";
import { captureAuditEvent } from "~/lib/services/auditLog";
import { baseDb } from "~/lib/db";
import {
  isProjectMappableAccess,
  materializeGroupProjectMappings,
} from "~/lib/scim/access/projectMappings";
import { getServerAuthSession } from "~/server/auth";
import type { Access } from "~/zenstack/models";

const groupIdSchema = z.number().int().positive();
const projectIdSchema = z.number().int().positive();
// NONE is absent by design: a group row cannot deny project access, so
// storing it would be a mapping that silently does nothing. See
// lib/scim/access/projectMappings.ts.
const projectAccessSchema = z.enum(["ADMIN", "PROJECTADMIN", "USER"]);

export interface GroupProjectMappingRow {
  projectId: number;
  projectName: string;
  mappedAccess: Access;
}

export async function listGroupProjectMappings(
  groupId: number
): Promise<
  | { success: true; mappings: GroupProjectMappingRow[] }
  | { success: false; error: string }
> {
  const session = await getServerAuthSession();
  if (!session?.user?.id || session.user.access !== "ADMIN") {
    return { success: false, error: "Unauthorized" };
  }

  let validatedGroupId: number;
  try {
    validatedGroupId = groupIdSchema.parse(groupId);
  } catch {
    return { success: false, error: "Invalid input" };
  }

  try {
    const rows = await baseDb.groupProjectAccessMapping.findMany({
      where: { groupId: validatedGroupId },
      select: {
        projectId: true,
        mappedAccess: true,
        project: { select: { name: true } },
      },
    });

    return {
      success: true,
      mappings: rows.map((r) => ({
        projectId: r.projectId,
        projectName: r.project.name,
        mappedAccess: r.mappedAccess,
      })),
    };
  } catch (err) {
    console.error("[scimProjectMappingActions] list failed", err);
    return { success: false, error: "Failed to load project mappings" };
  }
}

/**
 * Create, retier, or remove one group -> project mapping, then re-materialize
 * the group's derived permission rows.
 *
 * `newMappedAccess === null` removes the mapping, which withdraws the derived
 * grant. Members then fall back to whatever the project default gives them —
 * removing a mapping cannot itself deny access.
 */
export async function saveGroupProjectMapping(
  groupId: number,
  projectId: number,
  newMappedAccess: Access | null
): Promise<{ success: boolean; error?: string }> {
  const session = await getServerAuthSession();
  if (!session?.user?.id || session.user.access !== "ADMIN") {
    return { success: false, error: "Unauthorized" };
  }

  let validatedGroupId: number;
  let validatedProjectId: number;
  try {
    validatedGroupId = groupIdSchema.parse(groupId);
    validatedProjectId = projectIdSchema.parse(projectId);
    if (newMappedAccess !== null) {
      projectAccessSchema.parse(newMappedAccess);
      if (!isProjectMappableAccess(newMappedAccess)) {
        return { success: false, error: "Invalid input" };
      }
    }
  } catch {
    return { success: false, error: "Invalid input" };
  }

  return runWithAuditContext({ userId: session.user.id }, async () => {
    try {
      const existing = await baseDb.groupProjectAccessMapping.findUnique({
        where: {
          groupId_projectId: {
            groupId: validatedGroupId,
            projectId: validatedProjectId,
          },
        },
        select: { mappedAccess: true },
      });

      if (existing === null && newMappedAccess === null) {
        return { success: true };
      }

      // The mapping write and the materialization share a transaction: a
      // half-applied change would leave the permission rows disagreeing with
      // the mapping table, which is exactly the drift materializing was
      // meant to avoid.
      await baseDb.$transaction(async (tx) => {
        if (newMappedAccess === null) {
          await tx.groupProjectAccessMapping.delete({
            where: {
              groupId_projectId: {
                groupId: validatedGroupId,
                projectId: validatedProjectId,
              },
            },
          });
        } else {
          await tx.groupProjectAccessMapping.upsert({
            where: {
              groupId_projectId: {
                groupId: validatedGroupId,
                projectId: validatedProjectId,
              },
            },
            create: {
              groupId: validatedGroupId,
              projectId: validatedProjectId,
              mappedAccess: newMappedAccess,
            },
            update: { mappedAccess: newMappedAccess },
          });
        }

        await materializeGroupProjectMappings(tx, validatedGroupId);
      });

      await captureAuditEvent({
        action: newMappedAccess === null ? "DELETE" : "UPDATE",
        entityType: "GroupProjectAccessMapping",
        entityId: `${validatedGroupId}:${validatedProjectId}`,
        userId: session.user.id,
        changes: {
          mappedAccess: {
            old: existing?.mappedAccess ?? null,
            new: newMappedAccess,
          },
        },
        metadata: {
          source: "admin-mapping-config",
          scimGroupId: String(validatedGroupId),
          projectId: validatedProjectId,
        },
      });

      return { success: true };
    } catch (err) {
      console.error(
        "[scimProjectMappingActions] saveGroupProjectMapping failed",
        err
      );
      return { success: false, error: "Failed to save project mapping" };
    }
  }); // end runWithAuditContext
}
