import type { Session } from "next-auth";
import { baseDb } from "~/lib/db";
import { isProjectAdminFor } from "~/lib/services/areaPermission";

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
 * The bare project-ADMIN check against a KNOWN projectId — no mapping
 * validation, no SIMPLE_URL rejection. The server-side twin of the policies'
 * `projectId in auth().adminProjectIds` clause: system ADMIN, the project's
 * creator, a system PROJECTADMIN assigned to the project, or an effective
 * role on the project carrying Settings canAddEdit. The ladder lives in
 * lib/services/areaPermission.ts so this, the UI's `isProjectAdmin` flag and
 * the area-permission gates all answer alike.
 *
 * Exported for callers whose projectId does NOT come from an active
 * IntegrationProject mapping — e.g. the milestone unlink route, whose
 * escape-hatch semantics must keep working after the mapping (or the whole
 * ProjectIntegration) has been deactivated, since that is exactly the
 * orphaned-but-still-locked state unlink exists to resolve (WR-05).
 */
export async function authorizeProjectAdminForProject(
  session: Session,
  projectId: number
): Promise<MilestoneSyncAuthResult> {
  const userId = session.user?.id;
  if (!userId) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  // System admins are always project admins.
  if (session.user!.access === "ADMIN") {
    return { ok: true, status: 200, projectId };
  }

  const [project, isAdmin] = await Promise.all([
    baseDb.projects.findFirst({
      where: { id: projectId, isDeleted: false },
      select: { id: true },
    }),
    isProjectAdminFor(userId, projectId),
  ]);

  if (!project || !isAdmin) {
    return { ok: false, status: 403, error: "Forbidden" };
  }

  return { ok: true, status: 200, projectId };
}

/**
 * Authorize the three milestone-sync routes (preview/import/now). Layers an
 * EXPLICIT project-ADMIN check on top of `authorizeProjectImport` — the
 * latter allows ANY project member (userPermissions/groupPermissions/
 * assignedUsers membership), which is intentionally too weak for milestone
 * sync (T-17-05-01). The admin condition itself lives in
 * `authorizeProjectAdminForProject` above.
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

  const adminCheck = await authorizeProjectAdminForProject(
    session,
    base.projectId!
  );
  if (!adminCheck.ok) {
    return adminCheck;
  }

  return {
    ok: true,
    status: 200,
    projectId: base.projectId,
    provider: base.provider,
  };
}
