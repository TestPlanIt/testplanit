"use server";

import { prisma } from "~/lib/prisma";
import { getServerAuthSession } from "~/server/auth";

/**
 * Remove a single IntegrationProject mapping. When the removal leaves the
 * parent ProjectIntegration with zero active mappings, the parent is also
 * deactivated AND any inbound webhook for the project is hard-deleted.
 *
 * Why hard-delete: WebhookConfig.adapterType is locked to the parent
 * ProjectIntegration's provider (1:1 model). If the project no longer has
 * an active integration, the inbound webhook would either silently drop
 * incoming events or auto-create orphan rows for an unassigned provider.
 * WebhookConfig has no soft-delete column; FK cascades clean up dedup +
 * secrets rows (deliveries SetNull-cascade, retained for audit history).
 */
export async function removeIntegrationProjectMapping(
  integrationProjectId: string
): Promise<{
  success: boolean;
  error?: string;
  cascadedToParent: boolean;
  inboundWebhookDeletedCount: number;
}> {
  const session = await getServerAuthSession();
  if (!session?.user) {
    return {
      success: false,
      error: "Unauthorized",
      cascadedToParent: false,
      inboundWebhookDeletedCount: 0,
    };
  }

  const mapping = await prisma.integrationProject.findFirst({
    where: { id: integrationProjectId },
    include: {
      projectIntegration: {
        select: { id: true, projectId: true },
      },
    },
  });
  if (!mapping || !mapping.projectIntegration) {
    return {
      success: false,
      error: "Integration mapping not found",
      cascadedToParent: false,
      inboundWebhookDeletedCount: 0,
    };
  }

  const { id: projectIntegrationId, projectId } = mapping.projectIntegration;

  // Authorize: only ADMIN or members with project access can manage
  // integration mappings. Match the read-side authorization in the
  // GET handler in `/api/projects/[projectId]/integrations/route.ts`.
  const isAdmin = session.user.access === "ADMIN";
  if (!isAdmin) {
    const project = await prisma.projects.findFirst({
      where: {
        id: projectId,
        isDeleted: false,
        OR: [
          { userPermissions: { some: { userId: session.user.id } } },
          {
            groupPermissions: {
              some: {
                group: {
                  assignedUsers: { some: { userId: session.user.id } },
                },
              },
            },
          },
          {
            assignedUsers: { some: { userId: session.user.id } },
          },
        ],
      },
    });
    if (!project) {
      return {
        success: false,
        error: "Forbidden",
        cascadedToParent: false,
        inboundWebhookDeletedCount: 0,
      };
    }
  }

  return await prisma.$transaction(async (tx) => {
    await tx.integrationProject.update({
      where: { id: integrationProjectId },
      data: { isActive: false },
    });

    const remainingActive = await tx.integrationProject.count({
      where: {
        projectIntegrationId,
        isActive: true,
      },
    });

    if (remainingActive > 0) {
      return {
        success: true,
        cascadedToParent: false,
        inboundWebhookDeletedCount: 0,
      };
    }

    // Last active mapping removed — also deactivate the parent
    // ProjectIntegration so the project effectively has no integration.
    await tx.projectIntegration.update({
      where: { id: projectIntegrationId },
      data: { isActive: false },
    });

    const deleted = await tx.webhookConfig.deleteMany({
      where: { projectId, direction: "INBOUND" },
    });

    return {
      success: true,
      cascadedToParent: true,
      inboundWebhookDeletedCount: deleted.count,
    };
  });
}

/**
 * Authorize that the caller can manage integrations for `projectId`. Returns
 * the project row when allowed, null when not. Mirrors the access policy in
 * `GET /api/projects/[projectId]/integrations`.
 */
async function authorizeProjectIntegrationManagement(
  projectId: number,
  userId: string,
  isAdmin: boolean
): Promise<boolean> {
  if (isAdmin) return true;
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
  return project !== null;
}

/**
 * Remove the project's ProjectIntegration entirely (the "Remove Integration"
 * top-level action). Hard-deletes inbound webhooks for the project as part
 * of the same transaction since the webhook adapter is locked to the
 * provider that's about to be unassigned.
 */
export async function removeProjectIntegration(
  projectIntegrationId: string
): Promise<{
  success: boolean;
  error?: string;
  inboundWebhookDeletedCount: number;
}> {
  const session = await getServerAuthSession();
  if (!session?.user) {
    return {
      success: false,
      error: "Unauthorized",
      inboundWebhookDeletedCount: 0,
    };
  }

  const target = await prisma.projectIntegration.findFirst({
    where: { id: projectIntegrationId },
    select: { projectId: true },
  });
  if (!target) {
    return {
      success: false,
      error: "Project integration not found",
      inboundWebhookDeletedCount: 0,
    };
  }

  const authorized = await authorizeProjectIntegrationManagement(
    target.projectId,
    session.user.id,
    session.user.access === "ADMIN"
  );
  if (!authorized) {
    return {
      success: false,
      error: "Forbidden",
      inboundWebhookDeletedCount: 0,
    };
  }

  return await prisma.$transaction(async (tx) => {
    await tx.projectIntegration.delete({
      where: { id: projectIntegrationId },
    });
    const deleted = await tx.webhookConfig.deleteMany({
      where: { projectId: target.projectId, direction: "INBOUND" },
    });
    return {
      success: true,
      inboundWebhookDeletedCount: deleted.count,
    };
  });
}

/**
 * Assign or switch the project's active issue integration. When the new
 * provider differs from the prior active provider, hard-deletes any inbound
 * webhook for the project — its adapter is locked to the old provider and
 * would mismatch the newly-assigned one.
 */
export async function switchProjectIntegration(input: {
  projectId: number;
  integrationId: number;
}): Promise<{
  success: boolean;
  error?: string;
  inboundWebhookDeletedCount: number;
  providerChanged: boolean;
}> {
  const { projectId, integrationId } = input;

  const session = await getServerAuthSession();
  if (!session?.user) {
    return {
      success: false,
      error: "Unauthorized",
      inboundWebhookDeletedCount: 0,
      providerChanged: false,
    };
  }

  const authorized = await authorizeProjectIntegrationManagement(
    projectId,
    session.user.id,
    session.user.access === "ADMIN"
  );
  if (!authorized) {
    return {
      success: false,
      error: "Forbidden",
      inboundWebhookDeletedCount: 0,
      providerChanged: false,
    };
  }

  const newIntegration = await prisma.integration.findFirst({
    where: { id: integrationId, status: "ACTIVE", isDeleted: false },
    select: { id: true, provider: true },
  });
  if (!newIntegration) {
    return {
      success: false,
      error: "Integration not found or inactive",
      inboundWebhookDeletedCount: 0,
      providerChanged: false,
    };
  }

  return await prisma.$transaction(async (tx) => {
    const priorActive = await tx.projectIntegration.findFirst({
      where: { projectId, isActive: true },
      include: { integration: { select: { provider: true } } },
    });
    const priorProvider = priorActive?.integration?.provider ?? null;

    await tx.projectIntegration.updateMany({
      where: { projectId, isActive: true },
      data: { isActive: false },
    });

    const existing = await tx.projectIntegration.findFirst({
      where: { projectId, integrationId },
    });
    if (existing) {
      await tx.projectIntegration.update({
        where: { id: existing.id },
        data: { isActive: true },
      });
    } else {
      await tx.projectIntegration.create({
        data: { projectId, integrationId, isActive: true, config: {} },
      });
    }

    const providerChanged = priorProvider !== newIntegration.provider;
    let inboundWebhookDeletedCount = 0;
    if (providerChanged) {
      const deleted = await tx.webhookConfig.deleteMany({
        where: { projectId, direction: "INBOUND" },
      });
      inboundWebhookDeletedCount = deleted.count;
    }

    return {
      success: true,
      inboundWebhookDeletedCount,
      providerChanged,
    };
  });
}
