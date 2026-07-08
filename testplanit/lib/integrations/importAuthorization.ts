import type { Session } from "next-auth";
import { baseDb } from "~/lib/db";

export interface ImportAuthResult {
  ok: boolean;
  status: number;
  error?: string;
  projectId?: number;
  provider?: string;
}

/**
 * Authorize a project-scoped bulk import (preview or trigger) for a single
 * linked external project. Allows system ADMINs and members of the mapping's
 * project — the same audience that can manage a project's integration mappings
 * (mirrors the check in `removeIntegrationProjectMapping`). Also resolves the
 * owning projectId + provider so callers don't re-read them.
 *
 * SIMPLE_URL integrations have no tracker API to pull from, so import is
 * rejected the same way sync is.
 */
export async function authorizeProjectImport(
  session: Session,
  integrationId: number,
  integrationProjectId: string
): Promise<ImportAuthResult> {
  const userId = session.user?.id;
  if (!userId) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  const mapping = await baseDb.integrationProject.findFirst({
    where: { id: integrationProjectId, isActive: true },
    include: {
      projectIntegration: {
        select: { integrationId: true, projectId: true },
      },
    },
  });
  if (!mapping?.projectIntegration) {
    return { ok: false, status: 404, error: "Integration mapping not found" };
  }
  if (mapping.projectIntegration.integrationId !== integrationId) {
    return {
      ok: false,
      status: 400,
      error: "Mapping does not belong to this integration",
    };
  }
  const projectId = mapping.projectIntegration.projectId;

  const integration = await baseDb.integration.findUnique({
    where: { id: integrationId },
    select: { provider: true },
  });
  if (!integration) {
    return { ok: false, status: 404, error: "Integration not found" };
  }
  if (integration.provider === "SIMPLE_URL") {
    return {
      ok: false,
      status: 400,
      error: "Import is not supported for Simple URL integrations",
    };
  }

  const isAdmin = session.user.access === "ADMIN";
  if (!isAdmin) {
    const project = await baseDb.projects.findFirst({
      where: {
        id: projectId,
        isDeleted: false,
        OR: [
          { userPermissions: { some: { userId } } },
          {
            groupPermissions: {
              some: {
                group: { assignedUsers: { some: { userId } } },
              },
            },
          },
          { assignedUsers: { some: { userId } } },
        ],
      },
      select: { id: true },
    });
    if (!project) {
      return { ok: false, status: 403, error: "Forbidden" };
    }
  }

  return { ok: true, status: 200, projectId, provider: integration.provider };
}

export interface MilestoneSyncAuthResult {
  ok: boolean;
  status: number;
  error?: string;
  projectId?: number;
  provider?: string;
}

/**
 * Authorize the three milestone-sync routes (preview/import/now). Layers an
 * EXPLICIT project-ADMIN check on top of `authorizeProjectImport` — the
 * latter allows ANY project member (userPermissions/groupPermissions/
 * assignedUsers membership), which is intentionally too weak for milestone
 * sync (T-17-05-01). Mirrors the `ProjectIntegration` `@@allow('create,
 * update,delete', …)` ACL condition (schema.zmodel ~4788-4794):
 *   project.creator == auth()
 *   || project.userPermissions?[... accessType == 'SPECIFIC_ROLE' && role.name == 'Project Admin']
 *   || project.assignedUsers?[... auth().access == 'PROJECTADMIN']
 *   || auth().access == 'ADMIN'
 *
 * Reuses `authorizeProjectImport` for mapping validation + projectId
 * resolution + SIMPLE_URL rejection, so this function's own DB check only
 * needs to answer "is this user a project admin for the resolved project?".
 */
export async function authorizeProjectMilestoneSyncAdmin(
  session: Session,
  integrationId: number,
  integrationProjectId: string
): Promise<MilestoneSyncAuthResult> {
  const base = await authorizeProjectImport(
    session,
    integrationId,
    integrationProjectId
  );
  if (!base.ok) {
    return base;
  }

  // authorizeProjectImport already validated session.user.id is present.
  const userId = session.user!.id!;

  // System admins are always project admins.
  if (session.user!.access === "ADMIN") {
    return {
      ok: true,
      status: 200,
      projectId: base.projectId,
      provider: base.provider,
    };
  }

  const isAdmin = await baseDb.projects.findFirst({
    where: {
      id: base.projectId!,
      isDeleted: false,
      OR: [
        { creator: { id: userId } },
        {
          userPermissions: {
            some: {
              userId,
              accessType: "SPECIFIC_ROLE",
              role: { name: "Project Admin" },
            },
          },
        },
        ...(session.user!.access === "PROJECTADMIN"
          ? [{ assignedUsers: { some: { userId } } }]
          : []),
      ],
    },
    select: { id: true },
  });

  if (!isAdmin) {
    return { ok: false, status: 403, error: "Forbidden" };
  }

  return {
    ok: true,
    status: 200,
    projectId: base.projectId,
    provider: base.provider,
  };
}
