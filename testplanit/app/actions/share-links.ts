"use server";

import { AuditAction } from "@prisma/client";
import bcrypt from "bcrypt";
import { getServerSession } from "next-auth";
import { withActionAuditContext } from "~/lib/auditContextWrappers";
import { prisma } from "~/lib/prisma";
import { generateShareKey } from "~/lib/share-tokens";
import { authOptions } from "~/server/auth";

/**
 * Server action to prepare share link data
 * Generates share key and hashes password if needed
 *
 * NOT wrapped in withActionAuditContext — this action does not emit
 * audit events (no direct prisma.auditLog.create, no hooked-model
 * mutations). Only audit-emitting actions need the ALS frame.
 */
export async function prepareShareLinkData(data: { password?: string | null }) {
  const shareKey = generateShareKey();

  let passwordHash: string | null = null;
  if (data.password) {
    passwordHash = await bcrypt.hash(data.password, 10);
  }

  return {
    shareKey,
    passwordHash,
  };
}

/**
 * Server action to create audit log for share link creation
 * Called after successful ZenStack creation.
 *
 * Wrapped in withActionAuditContext so the direct
 * prisma.auditLog.create below runs inside an AsyncLocalStorage frame
 * seeded with ipAddress/userAgent/requestId from next/headers. Identity
 * fields (userId/userEmail/userName) flow from the NextAuth session
 * callback triggered by the getServerSession call in the body. Together
 * these give complete actor context on every SHARE_LINK_CREATED audit row.
 */
export const auditShareLinkCreation = withActionAuditContext(
  async (shareLink: {
    id: string;
    shareKey: string;
    entityType: string;
    mode: string;
    title: string | null;
    projectId?: number;
    expiresAt: Date | null;
    notifyOnView: boolean;
    passwordHash: string | null;
  }) => {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return;
    }

    await prisma.auditLog.create({
      data: {
        userId: session.user.id,
        userEmail: session.user.email,
        userName: session.user.name,
        action: AuditAction.SHARE_LINK_CREATED,
        entityType: "ShareLink",
        entityId: shareLink.id,
        entityName: shareLink.title || `${shareLink.entityType} share`,
        metadata: {
          shareKey: shareLink.shareKey,
          entityType: shareLink.entityType,
          mode: shareLink.mode,
          hasPassword: !!shareLink.passwordHash,
          expiresAt: shareLink.expiresAt?.toISOString() || null,
          notifyOnView: shareLink.notifyOnView,
        },
        projectId: shareLink.projectId ?? null,
      },
    });
  }
);

/**
 * Server action to revoke a share link and create audit log.
 *
 * Wrapped in withActionAuditContext — same rationale as
 * auditShareLinkCreation. The direct prisma.auditLog.create for
 * SHARE_LINK_REVOKED now runs inside a fully populated AuditContext.
 */
export const revokeShareLink = withActionAuditContext(
  async (shareLinkId: string) => {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      throw new Error("Authentication required");
    }

    // Fetch share link details for audit log
    const shareLink = await prisma.shareLink.findUnique({
      where: { id: shareLinkId },
    });

    if (!shareLink) {
      throw new Error("Share link not found");
    }

    // Check permissions
    const project = shareLink.projectId
      ? await prisma.projects.findUnique({
          where: { id: shareLink.projectId },
        })
      : null;

    const canRevoke =
      session.user.access === "ADMIN" ||
      shareLink.createdById === session.user.id ||
      (project && project.createdBy === session.user.id);

    if (!canRevoke) {
      throw new Error("You do not have permission to revoke this share link");
    }

    // Create audit log
    await prisma.auditLog.create({
      data: {
        userId: session.user.id,
        userEmail: session.user.email,
        userName: session.user.name,
        action: AuditAction.SHARE_LINK_REVOKED,
        entityType: "ShareLink",
        entityId: shareLink.id,
        entityName: shareLink.title || `${shareLink.entityType} share`,
        metadata: {
          shareKey: shareLink.shareKey,
          entityType: shareLink.entityType,
          mode: shareLink.mode,
          viewCount: shareLink.viewCount,
        },
        projectId: shareLink.projectId,
      },
    });

    return { success: true };
  }
);
