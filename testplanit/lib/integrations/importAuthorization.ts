import type { Session } from "next-auth";
import { prisma } from "~/lib/prisma";

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

  const mapping = await prisma.integrationProject.findFirst({
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

  const integration = await prisma.integration.findUnique({
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
    const project = await prisma.projects.findFirst({
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
